// Shared training-cycle signal. Every panel reads from this so the
// dashboard reads as "one model training in real time" instead of five
// independent visualizations.
//
// Constants mirror the cadence the embedding panel was already using:
// each epoch is DISPERSE (re-randomize) → CONVERGE (settle to clusters)
// → HOLD (settled / snap-jump window). At ~60fps that's roughly
// 3s + 12s + 6s ≈ 21s per epoch.

export const EPOCH_DISPERSE_STEPS = 180;
export const EPOCH_CONVERGE_STEPS = 720;
export const EPOCH_HOLD_STEPS = 360;
export const EPOCH_TOTAL_STEPS =
  EPOCH_DISPERSE_STEPS + EPOCH_CONVERGE_STEPS + EPOCH_HOLD_STEPS;
export const HOLD_PHASE_START_STEP = EPOCH_DISPERSE_STEPS + EPOCH_CONVERGE_STEPS;

export type Phase = 'disperse' | 'converge' | 'hold';

export interface CycleState {
  /** Monotonically increasing tick counter shared by every panel. */
  rawStep: number;
  /** How many full epochs have elapsed since the cycle reset. */
  epoch: number;
  /** Step within the current epoch, 0..EPOCH_TOTAL_STEPS-1. */
  step: number;
  phase: Phase;
  /** 0..1 progress through the current phase (1 in HOLD once settled). */
  phaseProgress: number;
}

/**
 * Derive the canonical cycle state from a raw tick count. Pure function —
 * any consumer can recompute the cycle for any rawStep without
 * coordinating with the embedding panel.
 */
export function computeCycle(rawStep: number): CycleState {
  const r = Math.max(0, rawStep | 0);
  const epoch = Math.floor(r / EPOCH_TOTAL_STEPS);
  const step = r - epoch * EPOCH_TOTAL_STEPS;
  let phase: Phase;
  let phaseProgress: number;
  if (step < EPOCH_DISPERSE_STEPS) {
    phase = 'disperse';
    phaseProgress = step / EPOCH_DISPERSE_STEPS;
  } else if (step < HOLD_PHASE_START_STEP) {
    phase = 'converge';
    phaseProgress = (step - EPOCH_DISPERSE_STEPS) / EPOCH_CONVERGE_STEPS;
  } else {
    phase = 'hold';
    // HOLD is "settled" — phaseProgress climbs 0→1 across the hold so
    // panels that want to read "how settled are we" can still do so.
    phaseProgress = (step - HOLD_PHASE_START_STEP) / EPOCH_HOLD_STEPS;
  }
  return { rawStep: r, epoch, step, phase, phaseProgress };
}

/** Ease-out cubic, used by panels reacting to phaseProgress. */
export function easeOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - u, 3);
}
