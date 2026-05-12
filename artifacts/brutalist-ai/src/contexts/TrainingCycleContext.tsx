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
 *   - Live mode: wall-clock based at a fixed virtual VIRTUAL_FPS so the
 *     animation pace is independent of the monitor's refresh rate (60Hz,
 *     120Hz, 144Hz all read identically). rAF still drives the publish
 *     loop so panels repaint each frame; the published value is
 *     `floor(elapsedMs / (1000 / VIRTUAL_FPS))`.
 *   - Paused/export mode: `rawStep === stepFrame` so scrubbing is a pure
 *     function of the slider value (byte-deterministic exports preserved).
 * Every panel reads from the same store so the whole dashboard reacts to
 * the same beat.
 */

const VIRTUAL_FPS = 60;
const MS_PER_VIRTUAL_STEP = 1000 / VIRTUAL_FPS;

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
  // Wall-clock integrator state for live mode. We snapshot the start time
  // when the rAF loop begins (or resets) and derive `rawStep` from elapsed
  // ms / MS_PER_VIRTUAL_STEP, so animation pace is the same on any
  // refresh rate. The value resets only on `resetKey` change.
  const rawStepRef = useRef(0);
  const liveStartMsRef = useRef<number>(0);

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
    liveStartMsRef.current = performance.now();
    publish(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Live mode: wall-clock-driven rAF tick. Pace is fixed at VIRTUAL_FPS
  // regardless of monitor refresh rate, so the same animation arc takes
  // the same real time on 60Hz, 120Hz, and 144Hz displays.
  useEffect(() => {
    if (paused) return;
    let id: number;
    // Anchor "step 0" to right now, biased by however many steps we
    // already advanced (so unpausing/reseeding does not jump backwards).
    const startMs = performance.now() - rawStepRef.current * MS_PER_VIRTUAL_STEP;
    liveStartMsRef.current = startMs;
    const tick = (now: number) => {
      const elapsed = now - liveStartMsRef.current;
      const next = Math.max(rawStepRef.current, Math.floor(elapsed / MS_PER_VIRTUAL_STEP));
      if (next !== rawStepRef.current) {
        rawStepRef.current = next;
        publish(next);
      }
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
