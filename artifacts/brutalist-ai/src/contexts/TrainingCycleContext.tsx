import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { CycleState, computeCycle } from '../lib/trainingCycle';

/**
 * The training cycle is a shared, single source of truth for the dashboard.
 * The provider drives a `rawStep` counter:
 *   - Live mode: rAF-incremented at ~60fps.
 *   - Paused/export mode: `rawStep === stepFrame` so scrubbing is a pure
 *     function of the slider value.
 * Every panel reads from the same store so the whole dashboard reacts to
 * the same beat.
 */

interface CycleStore {
  get(): CycleState;
  /** Subscribe; cb is called whenever rawStep changes. */
  subscribe(cb: () => void): () => void;
}

const Ctx = createContext<CycleStore | null>(null);

interface ProviderProps {
  /** When true, rawStep follows `stepFrame`. When false, rAF drives it. */
  paused: boolean;
  /** Scrubber frame in paused mode. Ignored in live mode. */
  stepFrame: number;
  /** Bumps to reset the cycle to 0 (entering export, switching seeds). */
  resetKey: string | number;
  children: React.ReactNode;
}

export function TrainingCycleProvider({
  paused,
  stepFrame,
  resetKey,
  children,
}: ProviderProps) {
  const stateRef = useRef<CycleState>(computeCycle(0));
  const listenersRef = useRef<Set<() => void>>(new Set());
  // rAF integrator state for live mode. We accumulate steps via rAF
  // monotonically; the value resets only on `resetKey` change.
  const rawStepRef = useRef(0);

  const store = useMemo<CycleStore>(
    () => ({
      get: () => stateRef.current,
      subscribe: cb => {
        listenersRef.current.add(cb);
        return () => {
          listenersRef.current.delete(cb);
        };
      },
    }),
    [],
  );

  const publish = (rawStep: number) => {
    const next = computeCycle(rawStep);
    if (
      next.rawStep === stateRef.current.rawStep &&
      next.epoch === stateRef.current.epoch &&
      next.step === stateRef.current.step
    ) {
      return;
    }
    stateRef.current = next;
    listenersRef.current.forEach(cb => cb());
  };

  // Reset to zero whenever the seed (or export entry) changes.
  useEffect(() => {
    rawStepRef.current = 0;
    publish(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Live mode: rAF tick.
  useEffect(() => {
    if (paused) return;
    let id: number;
    const tick = () => {
      rawStepRef.current += 1;
      publish(rawStepRef.current);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // Paused mode: rawStep === stepFrame (pure function of slider).
  useEffect(() => {
    if (!paused) return;
    const r = Math.max(0, stepFrame | 0);
    rawStepRef.current = r;
    publish(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, stepFrame]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/**
 * Subscribes to `rawStep`. Triggers a re-render every cycle tick — only
 * use in panels that genuinely need to react frame-by-frame (the
 * embedding panel). Other panels should prefer `useCycleStore` and read
 * inside their own slower ticker.
 */
export function useCycleRawStep(): number {
  const store = useRequireStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.get().rawStep,
    () => 0,
  );
}

/**
 * Subscribes only to `epoch`. Re-renders only on epoch boundary, which
 * is what panels like TokenStream care about for their divider markers.
 */
export function useCycleEpoch(): number {
  const store = useRequireStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.get().epoch,
    () => 0,
  );
}

/**
 * Returns the live store handle. Panels can call `store.get()` from
 * inside their own intervals/effects to read the current cycle without
 * forcing a 60fps re-render.
 */
export function useCycleStore(): CycleStore {
  return useRequireStore();
}

function useRequireStore(): CycleStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useCycle* must be used inside TrainingCycleProvider');
  return s;
}
