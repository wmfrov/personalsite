import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { generateEmbeddingTokens } from '../lib/tokens';

// Spring damping that approximates `${SNAP_EASING}` settling over ~SNAP_DURATION_MS:
// after a snap-jump teleports `baseX/baseY`, the per-frame spring (stiffness=lag*1.4,
// damping=0.62) overshoots then resolves on roughly that ease curve / time budget.
const SPRING_DAMPING = 0.62;

const NUM_DOTS = 120;
const NUM_CLUSTERS = 4;
const NUM_PINNED = 6;
const TRAIL_LIFETIME_MS = 900;

// Training-arc tunables. Each physics tick advances `step` by 1 (live and
// paused/scrub). An epoch is three back-to-back phases:
//   1. DISPERSE  — dots ease from their previous resting position to fresh
//                  random start positions for this epoch (smooth
//                  re-randomization, no hard cut at epoch boundaries).
//   2. CONVERGE  — dots ease from those random starts toward their
//                  cluster's converged home, ease-out cubic.
//   3. HOLD      — dots remain at home; snap-jumps may fire here.
// At ~60fps this is ~1.5s + 6s + 1.5s ≈ 9s per epoch.
const EPOCH_DISPERSE_STEPS = 90;
const EPOCH_CONVERGE_STEPS = 360;
const EPOCH_HOLD_STEPS = 90;
const EPOCH_TOTAL_STEPS = EPOCH_DISPERSE_STEPS + EPOCH_CONVERGE_STEPS + EPOCH_HOLD_STEPS;
const HOLD_PHASE_START_STEP = EPOCH_DISPERSE_STEPS + EPOCH_CONVERGE_STEPS;
// Tight Gaussian sigma around the cluster centroid at peak sharpness —
// less than half the old free-drift sigma (0.085), so converged epochs
// look visibly cleaner than the old steady state ever did.
const HOME_SIGMA = 0.035;
// Tiny per-frame sinusoidal jitter applied on top of the eased base,
// driven by per-dot phases — keeps the cloud breathing even at peak
// sharpness without breaking the cluster shape.
const JITTER_AMP = 0.006;
// Snap-jumps are gated to the settled hold phase only (so they don't
// fight the migration). One eligible attempt every SNAP_PERIOD_STEPS
// ticks, with ~50% chance of firing.
const SNAP_PERIOD_STEPS = 180;
const TAU = Math.PI * 2;

// Connection-layer tunables (replaces convex hulls).
// FOG mode draws every pair within PROX_RADIUS as faint ink strands plus a
// k-NN layer in cluster colors on top. ATTN mode draws a quiet k-NN ink
// underlay plus bold accent edges from the "you" dot to its top-K nearest
// other dots, weighted by a softmax over inverse distance.
const PROX_RADIUS = 0.18;
const K_NN = 2;
const ATTN_TOP_K = 5;
const ATTN_TEMPERATURE = 0.06;

type ConnectionMode = 'fog' | 'attn';

interface EmbeddingSpaceProps {
  seedData: SeedData;
  palette: Palette;
  /** Resolved accent color for the "you" dot. */
  accent: string;
  paused?: boolean;
  /** Increments by 1 per arrow press in export mode; advances one physics step. */
  stepFrame?: number;
}

interface Dot {
  id: number;
  baseX: number;
  baseY: number;
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  label: string;
  lag: number;
  isYou: boolean;
  cluster: number;        // 0..NUM_CLUSTERS-1 (cluster 0 = ink-tinted neutral)
  shape: number;          // 0=circle 1=square 2=triangle 3=diamond 4=plus
  size: number;           // pixel side length
  pinned: boolean;        // always-show label
  /** Cluster-converged target ("trained" position) for the CURRENT epoch.
   *  Resampled at every epoch reset from `clusterCentroidX/Y` + Gaussian
   *  (using animPrng) so snap-jumps can't permanently degrade cluster
   *  purity — each new epoch restores a clean home. */
  homeX: number;
  homeY: number;
  /** Random init position for the current epoch (uniform across panel).
   *  Resampled each epoch reset from the animation PRNG. */
  startX: number;
  startY: number;
  /** Position the dot was at when the current epoch began. The DISPERSE
   *  phase eases from here to `startX/Y` so the re-randomization is
   *  visually smooth instead of a hard cut. */
  disperseFromX: number;
  disperseFromY: number;
  /** Stable cluster centroid for this dot — the anchor home positions
   *  re-jitter around. Set once at init; never changes after that, so
   *  long-run cluster purity is preserved across many epochs. */
  clusterCentroidX: number;
  clusterCentroidY: number;
  /** Per-dot phases for the breathing jitter overlay. */
  jitterPhaseX: number;
  jitterPhaseY: number;
  /** Spring velocity used by the cursor-attraction integrator (overshoot). */
  svx: number;
  svy: number;
}

interface FrameSnapshot {
  dots: Dot[];
  step: number;
  epoch: number;
  nextSnapStep: number;
  prngState: number;
}

interface Trail {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  cluster: number;
}

interface ClusterMeta {
  centroidX: number;
  centroidY: number;
  dimAxisLabel: string;
}

function gaussian(prng: SeededPrng): number {
  // Box–Muller (only need one component).
  const u = Math.max(1e-9, prng());
  const v = prng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Connection-layer types and pure helpers. Exported only at module scope so
// they participate in cheap useMemo caching keyed on a quantized position
// snapshot (positions hashed to 1e-3, see `posKey` in EmbeddingSpace).
type ProxEdge = { x1: number; y1: number; x2: number; y2: number; dist: number };
type KnnEdge = { x1: number; y1: number; x2: number; y2: number; cluster: number };
type AttnEdge = { x1: number; y1: number; x2: number; y2: number; weight: number; targetId: number };

function computeProxEdges(dots: Dot[]): ProxEdge[] {
  const out: ProxEdge[] = [];
  for (let i = 0; i < dots.length; i++) {
    const di = dots[i];
    for (let j = i + 1; j < dots.length; j++) {
      const dj = dots[j];
      const dx = dj.x - di.x;
      const dy = dj.y - di.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= PROX_RADIUS) {
        out.push({ x1: di.x, y1: di.y, x2: dj.x, y2: dj.y, dist: d });
      }
    }
  }
  return out;
}

/**
 * Undirected k-nearest-neighbor edges, deduped by ordered index pair.
 * `sameClusterOnly=true` keeps only edges between dots that share a cluster
 * (FOG mode — produces the colored cluster web that mirrors the canvas
 * mockup). `false` keeps every k-NN edge for use as a quiet ink underlay
 * in ATTN mode.
 */
function computeKnnEdges(dots: Dot[], sameClusterOnly: boolean): KnnEdge[] {
  const out: KnnEdge[] = [];
  if (dots.length === 0) return out;
  const seen = new Set<number>();
  const stride = dots.length;
  for (let i = 0; i < dots.length; i++) {
    const di = dots[i];
    const cands: { idx: number; dist: number }[] = [];
    for (let j = 0; j < dots.length; j++) {
      if (j === i) continue;
      const dj = dots[j];
      const dx = dj.x - di.x;
      const dy = dj.y - di.y;
      cands.push({ idx: j, dist: Math.sqrt(dx * dx + dy * dy) });
    }
    cands.sort((a, b) => a.dist - b.dist);
    for (let k = 0; k < Math.min(K_NN, cands.length); k++) {
      const n = cands[k];
      const a = i < n.idx ? i : n.idx;
      const b = i < n.idx ? n.idx : i;
      const key = a * stride + b;
      if (seen.has(key)) continue;
      seen.add(key);
      const dn = dots[n.idx];
      if (sameClusterOnly && di.cluster !== dn.cluster) continue;
      out.push({ x1: di.x, y1: di.y, x2: dn.x, y2: dn.y, cluster: di.cluster });
    }
  }
  return out;
}

/**
 * Top-K attention edges from the "you" dot, weighted by softmax(-dist/τ).
 * Returns [] if no "you" dot is present (e.g. before initial dot population).
 */
function computeAttnEdges(dots: Dot[]): AttnEdge[] {
  const you = dots.find(d => d.isYou);
  if (!you) return [];
  const others = dots
    .filter(d => !d.isYou)
    .map(d => {
      const dx = d.x - you.x;
      const dy = d.y - you.y;
      return { id: d.id, x: d.x, y: d.y, dist: Math.sqrt(dx * dx + dy * dy) };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, ATTN_TOP_K);
  const scores = others.map(o => Math.exp(-o.dist / ATTN_TEMPERATURE));
  const sum = scores.reduce((a, b) => a + b, 0) || 1;
  return others.map((o, i) => ({
    x1: you.x,
    y1: you.y,
    x2: o.x,
    y2: o.y,
    weight: scores[i] / sum,
    targetId: o.id,
  }));
}

export function EmbeddingSpace({
  seedData,
  palette,
  accent,
  paused = false,
  stepFrame = 0,
}: EmbeddingSpaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dots, setDots] = useState<Dot[]>([]);
  const [hoveredDotId, setHoveredDotId] = useState<number | null>(null);
  const [nearestNeighbors, setNearestNeighbors] = useState<number[]>([]);
  const [clusters, setClusters] = useState<ClusterMeta[]>([]);
  const [mode, setMode] = useState<ConnectionMode>('fog');
  // Surfaced for the EPOCH/STEP header chip; updated every physics tick.
  const [epochStep, setEpochStep] = useState({ epoch: 0, step: 0 });
  const [, forceTick] = useState(0); // re-render trails over time even if dots don't change

  const mouseRef = useRef({ x: -1000, y: -1000, active: false });
  const dotsRef = useRef<Dot[]>([]);
  const animPrngRef = useRef<SeededPrng | null>(null);
  const historyRef = useRef<FrameSnapshot[]>([]);
  const lastFrameRef = useRef(0);
  const trailsRef = useRef<Trail[]>([]);
  // Training-arc state (refs so the per-tick physics closure reads fresh
  // values without rebuilding the rAF loop every frame).
  const stepRef = useRef(0);
  const epochRef = useRef(0);
  const nextSnapStepRef = useRef(HOLD_PHASE_START_STEP + 30);

  useEffect(() => {
    const prng = derivePrng(seedData, PanelSlot.EmbeddingLayout);
    // Separate animation PRNG so snap-jumps stay reproducible per seed.
    const animPrng = derivePrng(seedData, PanelSlot.EmbeddingAnim);
    animPrngRef.current = animPrng;

    // Cluster centroids spread across panel with seeded jitter.
    const baseCentroids = [
      { x: 0.27, y: 0.28 },
      { x: 0.73, y: 0.27 },
      { x: 0.28, y: 0.74 },
      { x: 0.74, y: 0.73 },
    ];
    const newClusters: ClusterMeta[] = baseCentroids.map((c, i) => ({
      centroidX: c.x + (prng() - 0.5) * 0.06,
      centroidY: c.y + (prng() - 0.5) * 0.06,
      dimAxisLabel: `dim_${(seedData.panelSeeds[PanelSlot.EmbeddingLayout] >> (i * 4)) & 0xff}`,
    }));

    const tokens = generateEmbeddingTokens(NUM_DOTS - 1, prng);
    const newDots: Dot[] = [];

    // "You" dot uses precise position from seedData so it stays seed-stable.
    // It does not participate in the training arc — it's the fixed reference
    // point across all epochs.
    newDots.push({
      id: 0,
      baseX: seedData.youX,
      baseY: seedData.youY,
      targetX: seedData.youX,
      targetY: seedData.youY,
      x: seedData.youX,
      y: seedData.youY,
      label: seedData.input,
      lag: 0.1,
      isYou: true,
      cluster: -1,
      shape: 1, // square (matches the "you" emphasis)
      size: 14,
      pinned: true,
      homeX: seedData.youX,
      homeY: seedData.youY,
      startX: seedData.youX,
      startY: seedData.youY,
      disperseFromX: seedData.youX,
      disperseFromY: seedData.youY,
      clusterCentroidX: seedData.youX,
      clusterCentroidY: seedData.youY,
      jitterPhaseX: 0,
      jitterPhaseY: 0,
      svx: 0,
      svy: 0,
    });

    // Pre-pick which non-"you" indices get pinned labels (deterministic).
    const pinnedIds = new Set<number>();
    while (pinnedIds.size < NUM_PINNED) {
      pinnedIds.add(1 + Math.floor(prng() * (NUM_DOTS - 1)));
    }

    for (let i = 0; i < NUM_DOTS - 1; i++) {
      const cluster = i % NUM_CLUSTERS; // round-robin → ~equal-sized clusters
      const c = newClusters[cluster];
      // Tight Gaussian scatter around the centroid: this is the converged
      // "trained" target. Clamp inside [0.04..0.96] to keep it on-canvas.
      let homeX = c.centroidX + gaussian(prng) * HOME_SIGMA;
      let homeY = c.centroidY + gaussian(prng) * HOME_SIGMA;
      homeX = Math.max(0.04, Math.min(0.96, homeX));
      homeY = Math.max(0.04, Math.min(0.96, homeY));

      const shape = Math.floor(prng() * 5);
      const sizeRoll = prng();
      const size = sizeRoll < 0.55 ? 6 : sizeRoll < 0.9 ? 8 : 10;
      const jitterPhaseX = prng() * TAU;
      const jitterPhaseY = prng() * TAU;

      // Random init position (uniform across the panel) for epoch 0,
      // sampled from the animation PRNG so subsequent epoch resets stay on
      // a single reproducible stream.
      const startX = 0.04 + animPrng() * 0.92;
      const startY = 0.04 + animPrng() * 0.92;

      newDots.push({
        id: i + 1,
        baseX: startX,
        baseY: startY,
        targetX: startX,
        targetY: startY,
        x: startX,
        y: startY,
        label: tokens[i],
        lag: 0.05 + prng() * 0.2,
        isYou: false,
        cluster,
        shape,
        size,
        pinned: pinnedIds.has(i + 1),
        homeX,
        homeY,
        startX,
        startY,
        // Epoch 0 has no "previous resting position"; setting disperseFrom
        // = startX/Y makes the DISPERSE phase a no-op (dot sits at its
        // random start) before the visible CONVERGE migration begins.
        disperseFromX: startX,
        disperseFromY: startY,
        clusterCentroidX: c.centroidX,
        clusterCentroidY: c.centroidY,
        jitterPhaseX,
        jitterPhaseY,
        svx: 0,
        svy: 0,
      });
    }

    setClusters(newClusters);
    setDots(newDots);
    dotsRef.current = newDots;
    stepRef.current = 0;
    epochRef.current = 0;
    nextSnapStepRef.current = HOLD_PHASE_START_STEP + 30;
    setEpochStep({ epoch: 0, step: 0 });
    historyRef.current = [];
    trailsRef.current = [];
    lastFrameRef.current = 0;
  }, [seedData]);

  const stepPhysics = (_dt: number) => {
    // Each call advances exactly one tick. The live rAF loop calls us at
    // ~60Hz; paused/scrub calls us per arrow press. Driving everything from
    // a discrete step counter (not wall-clock dt) is what makes the paused
    // export stream byte-identical across runs and machines.
    stepRef.current += 1;
    const step = stepRef.current;

    // Epoch reset: smoothly re-randomize. For every non-"you" dot, freeze
    // its current visual position as `disperseFromX/Y` (so the new epoch's
    // DISPERSE phase eases out of where it was), pick fresh random
    // `startX/Y`, and resample `homeX/Y` from the dot's stable
    // `clusterCentroidX/Y` + Gaussian. Resampling home is what restores
    // cluster purity after snap-jumps mutated `homeX/Y` during the hold —
    // each new epoch starts from a clean cluster again.
    if (step >= EPOCH_TOTAL_STEPS) {
      const ap = animPrngRef.current;
      if (ap) {
        for (const d of dotsRef.current) {
          if (d.isYou) continue;
          d.disperseFromX = d.x;
          d.disperseFromY = d.y;
          d.startX = 0.04 + ap() * 0.92;
          d.startY = 0.04 + ap() * 0.92;
          let nh = d.clusterCentroidX + gaussian(ap) * HOME_SIGMA;
          let nv = d.clusterCentroidY + gaussian(ap) * HOME_SIGMA;
          d.homeX = Math.max(0.04, Math.min(0.96, nh));
          d.homeY = Math.max(0.04, Math.min(0.96, nv));
        }
      }
      epochRef.current += 1;
      stepRef.current = 0;
      nextSnapStepRef.current = HOLD_PHASE_START_STEP + 30;
    }

    // Snap-jump: only eligible during the settled hold phase (suppressed
    // during DISPERSE + CONVERGE so it doesn't fight the migration).
    // Step-keyed schedule keeps it deterministic across pause/scrub.
    const inHold = stepRef.current >= HOLD_PHASE_START_STEP;
    if (inHold && stepRef.current >= nextSnapStepRef.current) {
      nextSnapStepRef.current = stepRef.current + SNAP_PERIOD_STEPS;
      const ap = animPrngRef.current;
      if (ap && ap() > 0.5 && dotsRef.current.length > 1) {
        const idx = 1 + Math.floor(ap() * (dotsRef.current.length - 1));
        const d = dotsRef.current[idx];
        if (d && !d.isYou) {
          // Intentional hard-cut teleport on top of the converged target —
          // moves the dot's home so the snap reads as "this token just
          // remapped within the embedding space". The mutation is bounded
          // to the current epoch: the next epoch reset resamples home from
          // `clusterCentroidX/Y`, restoring cluster purity. Trails are a
          // LIVE-only decoration (see paused-mode comment in render).
          const fromX = d.x;
          const fromY = d.y;
          const newHomeX = 0.05 + ap() * 0.9;
          const newHomeY = 0.05 + ap() * 0.9;
          d.homeX = newHomeX;
          d.homeY = newHomeY;
          d.baseX = newHomeX;
          d.baseY = newHomeY;
          d.x = newHomeX;
          d.y = newHomeY;
          d.targetX = newHomeX;
          d.targetY = newHomeY;
          if (!paused) {
            trailsRef.current.push({
              fromX,
              fromY,
              toX: d.x,
              toY: d.y,
              startedAt: performance.now(),
              cluster: d.cluster,
            });
          }
        }
      }
    }

    // Drop expired trails (LIVE-only decoration).
    if (trailsRef.current.length > 0) {
      const now = performance.now();
      trailsRef.current = trailsRef.current.filter(t => now - t.startedAt < TRAIL_LIFETIME_MS);
    }

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseActive = mouseRef.current.active;

    // Training-arc phase + eased phase progress. DISPERSE eases from the
    // dot's previous resting position to the new random start; CONVERGE
    // eases from the random start to the cluster home; HOLD pins at home.
    // Ease-out cubic in both moving phases — early motion feels fast, the
    // tail of each phase feels patient.
    let phase: 'disperse' | 'converge' | 'hold';
    let phaseProgress: number;
    const sStep = stepRef.current;
    if (sStep < EPOCH_DISPERSE_STEPS) {
      phase = 'disperse';
      phaseProgress = sStep / EPOCH_DISPERSE_STEPS;
    } else if (sStep < HOLD_PHASE_START_STEP) {
      phase = 'converge';
      phaseProgress = (sStep - EPOCH_DISPERSE_STEPS) / EPOCH_CONVERGE_STEPS;
    } else {
      phase = 'hold';
      phaseProgress = 1;
    }
    const eased = phase === 'hold' ? 1 : 1 - Math.pow(1 - phaseProgress, 3);

    const newDots = [...dotsRef.current];

    for (let i = 0; i < newDots.length; i++) {
      const dot = newDots[i];

      if (!dot.isYou) {
        // Pick the lerp endpoints based on the current phase. Then overlay
        // a small per-dot sinusoidal jitter so even at peak sharpness the
        // cluster keeps breathing. Pure function of (step, dot fields) →
        // fully deterministic, snapshot-stable.
        let fromX: number, fromY: number, toX: number, toY: number;
        if (phase === 'disperse') {
          fromX = dot.disperseFromX; fromY = dot.disperseFromY;
          toX = dot.startX;          toY = dot.startY;
        } else {
          // converge | hold (eased = 1 in hold so this collapses to home)
          fromX = dot.startX; fromY = dot.startY;
          toX = dot.homeX;    toY = dot.homeY;
        }
        const easedX = fromX + (toX - fromX) * eased;
        const easedY = fromY + (toY - fromY) * eased;
        const jx = JITTER_AMP * Math.sin(sStep * 0.04 + dot.jitterPhaseX);
        const jy = JITTER_AMP * Math.cos(sStep * 0.05 + dot.jitterPhaseY);
        dot.baseX = Math.max(0, Math.min(1, easedX + jx));
        dot.baseY = Math.max(0, Math.min(1, easedY + jy));
      }

      if (mouseActive && !paused) {
        const mx = (mouseRef.current.x - rect.left) / rect.width;
        const my = (mouseRef.current.y - rect.top) / rect.height;
        const dx = mx - dot.baseX;
        const dy = my - dot.baseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pull = Math.max(0, 1 - dist * 2);
        dot.targetX = dot.baseX + dx * pull * 0.2;
        dot.targetY = dot.baseY + dy * pull * 0.2;
      } else {
        dot.targetX = dot.baseX;
        dot.targetY = dot.baseY;
      }

      // Spring + damping for cursor-attract overshoot.
      const stiffness = dot.lag * 1.4;
      dot.svx = dot.svx * SPRING_DAMPING + (dot.targetX - dot.x) * stiffness;
      dot.svy = dot.svy * SPRING_DAMPING + (dot.targetY - dot.y) * stiffness;
      dot.x += dot.svx;
      dot.y += dot.svy;
    }

    dotsRef.current = newDots;
    setDots(newDots);
    setEpochStep({ epoch: epochRef.current, step: stepRef.current });
  };

  useEffect(() => {
    if (paused) return;
    let animationFrameId: number;
    let lastTime = performance.now();

    const animate = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;
      stepPhysics(dt);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // Paused: bidirectional frame stepping via snapshot history (state + PRNG).
  useEffect(() => {
    if (!paused) return;
    const prng = animPrngRef.current;
    if (!prng) return;

    const delta = stepFrame - lastFrameRef.current;
    if (delta > 0) {
      for (let i = 0; i < delta; i++) {
        historyRef.current.push({
          dots: dotsRef.current.map(d => ({ ...d })),
          step: stepRef.current,
          epoch: epochRef.current,
          nextSnapStep: nextSnapStepRef.current,
          prngState: prng.getState(),
        });
        stepPhysics(16);
      }
    } else if (delta < 0) {
      let snap: FrameSnapshot | undefined;
      for (let i = 0; i < -delta; i++) snap = historyRef.current.pop() ?? snap;
      if (snap) {
        prng.setState(snap.prngState);
        stepRef.current = snap.step;
        epochRef.current = snap.epoch;
        nextSnapStepRef.current = snap.nextSnapStep;
        dotsRef.current = snap.dots.map(d => ({ ...d }));
        setDots(dotsRef.current);
        setEpochStep({ epoch: snap.epoch, step: snap.step });
      }
    }
    lastFrameRef.current = stepFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);

  // When entering paused/export mode, drop any in-flight trails so they
  // never participate in the deterministic frame stream. Trails are a
  // LIVE-only decoration (see physics step comment).
  useEffect(() => {
    if (paused) {
      trailsRef.current = [];
      forceTick(n => n + 1);
    }
  }, [paused]);

  const handleMouseMove = (e: React.MouseEvent) => {
    mouseRef.current = { x: e.clientX, y: e.clientY, active: true };
  };

  const handleMouseLeave = () => {
    mouseRef.current.active = false;
    setHoveredDotId(null);
    setNearestNeighbors([]);
  };

  useEffect(() => {
    if (hoveredDotId === null || paused) return;

    const hoverDot = dots.find(d => d.id === hoveredDotId);
    if (!hoverDot) return;

    const dists = dots
      .filter(d => d.id !== hoveredDotId)
      .map(d => ({
        id: d.id,
        dist: Math.sqrt(Math.pow(d.x - hoverDot.x, 2) + Math.pow(d.y - hoverDot.y, 2)),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
      .map(d => d.id);

    setNearestNeighbors(dists);
  }, [hoveredDotId, dots, paused]);

  // Map cluster index → palette color. Cluster 0 stays ink-tinted so the
  // composition reads as "ink + 3 accents" instead of "4 noisy accents".
  const colorForCluster = (cluster: number): string => {
    if (cluster === 0) return palette.ink;
    if (cluster === 1) return palette.accent1;
    if (cluster === 2) return palette.accent2;
    return palette.accent3;
  };

  // Quantize dot positions to 1e-3 to build a stable cache key. During live
  // drift the key changes nearly every frame (recomputation is required to
  // follow physics anyway), but during pause/export-stepping the same frame
  // can re-render multiple times — memoization makes those re-renders free.
  // Cluster id is folded in so cluster reassignment also invalidates the
  // cache. Result: edge math derived only from current dot.x/dot.y so
  // paused/step export rendering remains deterministic per mode.
  const posKey = useMemo(() => {
    let s = '';
    for (const d of dots) {
      s += ((d.x * 1000) | 0) + ',' + ((d.y * 1000) | 0) + ',' + d.cluster + ';';
    }
    return s;
  }, [dots]);

  const proxEdges = useMemo(
    () => (mode === 'fog' ? computeProxEdges(dots) : []),
    // posKey captures dots' material content; recomputation is gated on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posKey, mode],
  );
  const knnEdges = useMemo(
    () => computeKnnEdges(dots, mode === 'fog'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posKey, mode],
  );
  const attnEdges = useMemo(
    () => (mode === 'attn' ? computeAttnEdges(dots) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posKey, mode],
  );

  const attnWeightById = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of attnEdges) m.set(e.targetId, e.weight);
    return m;
  }, [attnEdges]);

  const now = performance.now();

  return (
    <div className="brutalist-panel w-full h-full flex flex-col overflow-hidden">
      <div className="brutalist-label z-10 w-full shrink-0 flex justify-between items-center gap-2">
        <span>EMBEDDING SPACE</span>
        <div className="flex items-center gap-2">
          <div className="flex" role="group" aria-label="Connection mode">
            <button
              type="button"
              onClick={() => setMode('fog')}
              className="font-mono font-bold uppercase tracking-wider px-1.5 leading-none cursor-pointer"
              style={{
                fontSize: 9,
                paddingTop: 2,
                paddingBottom: 2,
                background: mode === 'fog' ? palette.bg : 'transparent',
                color: mode === 'fog' ? palette.ink : palette.bg,
                border: `1px solid ${palette.bg}`,
                opacity: mode === 'fog' ? 1 : 0.6,
              }}
              aria-pressed={mode === 'fog'}
              aria-label="Proximity fog + k-NN"
            >FOG</button>
            <button
              type="button"
              onClick={() => setMode('attn')}
              className="font-mono font-bold uppercase tracking-wider px-1.5 leading-none cursor-pointer"
              style={{
                fontSize: 9,
                paddingTop: 2,
                paddingBottom: 2,
                background: mode === 'attn' ? palette.bg : 'transparent',
                color: mode === 'attn' ? palette.ink : palette.bg,
                borderTop: `1px solid ${palette.bg}`,
                borderRight: `1px solid ${palette.bg}`,
                borderBottom: `1px solid ${palette.bg}`,
                borderLeft: 'none',
                opacity: mode === 'attn' ? 1 : 0.6,
              }}
              aria-pressed={mode === 'attn'}
              aria-label="Attention from you to top-k"
            >ATTN</button>
          </div>
          <span style={{ color: palette.bg, opacity: 0.5 }}>
            EPOCH {epochStep.epoch.toString().padStart(2, '0')} · STEP {epochStep.step.toString().padStart(4, '0')} · N={NUM_DOTS}
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 w-full h-full cursor-crosshair overflow-hidden"
        style={{ background: palette.bg }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Frame + axes */}
        <div
          className="absolute inset-0 pointer-events-none m-4"
          style={{ border: `1px solid ${palette.ink}`, opacity: 0.18 }}
        />
        <div
          className="absolute top-1/2 left-4 right-4 h-px pointer-events-none"
          style={{ background: palette.ink, opacity: 0.15 }}
        />
        <div
          className="absolute left-1/2 top-4 bottom-4 w-px pointer-events-none"
          style={{ background: palette.ink, opacity: 0.15 }}
        />

        {/* Tick marks (every 10%) */}
        <div className="absolute inset-4 pointer-events-none">
          {Array.from({ length: 11 }).map((_, i) => {
            const pct = i * 10;
            return (
              <React.Fragment key={`tick-${i}`}>
                <div className="absolute top-0 w-px" style={{ left: `${pct}%`, height: '6px', background: palette.ink, opacity: 0.4 }} />
                <div className="absolute bottom-0 w-px" style={{ left: `${pct}%`, height: '6px', background: palette.ink, opacity: 0.4 }} />
                <div className="absolute left-0 h-px" style={{ top: `${pct}%`, width: '6px', background: palette.ink, opacity: 0.4 }} />
                <div className="absolute right-0 h-px" style={{ top: `${pct}%`, width: '6px', background: palette.ink, opacity: 0.4 }} />
              </React.Fragment>
            );
          })}

          {/* Numeric axis tick labels (5 per axis, every 25%) */}
          {[0, 25, 50, 75, 99].map(pct => (
            <React.Fragment key={`tlbl-${pct}`}>
              <div
                className="absolute font-mono font-bold"
                style={{
                  left: `${pct}%`,
                  bottom: -16,
                  transform: 'translateX(-50%)',
                  fontSize: 9,
                  color: palette.ink,
                  opacity: 0.55,
                }}
              >
                {pct.toString().padStart(2, '0')}
              </div>
              <div
                className="absolute font-mono font-bold"
                style={{
                  top: `${pct}%`,
                  left: -22,
                  transform: 'translateY(-50%)',
                  fontSize: 9,
                  color: palette.ink,
                  opacity: 0.55,
                }}
              >
                {pct.toString().padStart(2, '0')}
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Dim axis labels (corner-anchored, brutalist style) */}
        {clusters[0] && (
          <>
            <div
              className="absolute font-mono font-bold uppercase tracking-widest pointer-events-none"
              style={{
                left: 8,
                top: 8,
                fontSize: 10,
                color: palette.ink,
                opacity: 0.7,
                background: palette.bg,
                padding: '0 2px',
              }}
            >
              ↑ {clusters[0].dimAxisLabel}
            </div>
            <div
              className="absolute font-mono font-bold uppercase tracking-widest pointer-events-none"
              style={{
                right: 8,
                bottom: 8,
                fontSize: 10,
                color: palette.ink,
                opacity: 0.7,
                background: palette.bg,
                padding: '0 2px',
              }}
            >
              {clusters[1]?.dimAxisLabel ?? 'dim'} →
            </div>
          </>
        )}

        {/* Connection layer (replaces cluster hulls). FOG mode: faint
            proximity strands underneath sharper colored k-NN. ATTN mode:
            quiet ink k-NN underlay underneath bold accent attention edges
            from the "you" dot. Endpoints recompute every render from
            current dot.x/dot.y so edges follow live drift. */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible">
          {mode === 'fog' && proxEdges.map((e, i) => {
            const op = (1 - e.dist / PROX_RADIUS) * 0.32;
            return (
              <line
                key={`prox-${i}`}
                x1={`${e.x1 * 100}%`}
                y1={`${e.y1 * 100}%`}
                x2={`${e.x2 * 100}%`}
                y2={`${e.y2 * 100}%`}
                stroke={palette.ink}
                strokeOpacity={op}
                strokeWidth={0.6}
              />
            );
          })}
          {knnEdges.map((e, i) => (
            <line
              key={`knn-${i}`}
              x1={`${e.x1 * 100}%`}
              y1={`${e.y1 * 100}%`}
              x2={`${e.x2 * 100}%`}
              y2={`${e.y2 * 100}%`}
              stroke={mode === 'fog' ? colorForCluster(e.cluster) : palette.ink}
              strokeOpacity={mode === 'fog' ? 0.85 : 0.18}
              strokeWidth={mode === 'fog' ? 1.6 : 0.8}
            />
          ))}
          {mode === 'attn' && attnEdges.map((e, i) => {
            const w = 1 + e.weight * 7;
            return (
              <g key={`attn-${i}`}>
                <line
                  x1={`${e.x1 * 100}%`}
                  y1={`${e.y1 * 100}%`}
                  x2={`${e.x2 * 100}%`}
                  y2={`${e.y2 * 100}%`}
                  stroke={palette.ink}
                  strokeOpacity={1}
                  strokeWidth={w + 2}
                />
                <line
                  x1={`${e.x1 * 100}%`}
                  y1={`${e.y1 * 100}%`}
                  x2={`${e.x2 * 100}%`}
                  y2={`${e.y2 * 100}%`}
                  stroke={accent}
                  strokeOpacity={0.85 + e.weight * 0.15}
                  strokeWidth={w}
                />
              </g>
            );
          })}
        </svg>

        {/* Trails + neighbor lines stay on the %-based SVG (line elements DO
            accept percentage units for x1/y1/x2/y2 unlike polygon points). */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible">
          {/* Drift trails (snap-jump ghosts) — LIVE-only; suppressed when
              paused so export stepping stays byte-identical. */}
          {!paused && trailsRef.current.map((t, i) => {
            const age = (now - t.startedAt) / TRAIL_LIFETIME_MS;
            if (age >= 1) return null;
            const opacity = 1 - age;
            const color = colorForCluster(t.cluster);
            return (
              <line
                key={`trail-${i}-${t.startedAt}`}
                x1={`${t.fromX * 100}%`}
                y1={`${t.fromY * 100}%`}
                x2={`${t.toX * 100}%`}
                y2={`${t.toY * 100}%`}
                stroke={color}
                strokeOpacity={opacity * 0.85}
                strokeWidth={2}
                strokeDasharray="2 3"
              />
            );
          })}

          {/* Nearest-neighbor lines on hover. Suppressed in FOG mode (k-NN
              already shown for every dot) and when hovering "you" in ATTN
              mode (attention edges already emanate from there). */}
          {mode === 'attn' && hoveredDotId !== null && hoveredDotId !== 0 &&
            nearestNeighbors.map(nId => {
              const hDot = dots.find(d => d.id === hoveredDotId);
              const nDot = dots.find(d => d.id === nId);
              if (!hDot || !nDot) return null;
              return (
                <line
                  key={`line-${hDot.id}-${nDot.id}`}
                  x1={`${hDot.x * 100}%`}
                  y1={`${hDot.y * 100}%`}
                  x2={`${nDot.x * 100}%`}
                  y2={`${nDot.y * 100}%`}
                  stroke={palette.ink}
                  strokeWidth="3"
                />
              );
            })}
        </svg>

        {/* Dots (DOM-positioned so per-dot mouse events keep working) */}
        {dots.map(dot => {
          const isHovered = hoveredDotId === dot.id;
          const isNeighbor = nearestNeighbors.includes(dot.id);
          const attnWeight = attnWeightById.get(dot.id);
          const isAttended = attnWeight !== undefined;
          const dotColor = dot.isYou ? accent : colorForCluster(dot.cluster);
          // The "full" token label chip shows on the same triggers as before
          // (pinned / hover / NN). Attended-but-otherwise-unmarked dots get a
          // separate compact %-only badge so the attention info shows without
          // forcing a token chip on every drifting target.
          const showFullChip = dot.pinned || isHovered || isNeighbor;
          // Pinned + attended → one merged accent chip with `· NN%` appended
          // (matches the canvas mockup behavior for the lucky pinned-target
          // overlap case). "you" always gets the accent treatment.
          const useAccentChip = dot.isYou || (showFullChip && isAttended);
          const showCompactBadge = !showFullChip && isAttended;

          return (
            <div
              key={dot.id}
              className="absolute pointer-events-auto"
              style={{
                left: `${dot.x * 100}%`,
                top: `${dot.y * 100}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: dot.isYou ? 30 : isHovered ? 40 : isAttended ? 28 : isNeighbor ? 25 : dot.pinned ? 20 : 10,
              }}
              onMouseEnter={() => setHoveredDotId(dot.id)}
              onMouseLeave={() => setHoveredDotId(prev => (prev === dot.id ? null : prev))}
            >
              <DotGlyph
                shape={dot.shape}
                size={dot.size}
                color={dotColor}
                ink={palette.ink}
                isYou={dot.isYou}
              />

              {showFullChip && (
                <div
                  className="absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap px-1 select-none font-mono text-xs font-bold"
                  style={{
                    backgroundColor: useAccentChip ? accent : isHovered || isNeighbor ? palette.ink : palette.bg,
                    color: useAccentChip ? palette.ink : isHovered || isNeighbor ? palette.bg : palette.ink,
                    transform: isHovered || isNeighbor ? 'scale(1.15)' : 'scale(1)',
                    transformOrigin: 'left center',
                    border: useAccentChip ? `2px solid ${palette.ink}` : dot.pinned ? `1px solid ${palette.ink}` : 'none',
                  }}
                >
                  {dot.label}{isAttended ? ` · ${(attnWeight! * 100).toFixed(0)}%` : ''}
                </div>
              )}

              {showCompactBadge && (
                <div
                  className="absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap px-1 select-none font-mono font-bold"
                  style={{
                    fontSize: 10,
                    lineHeight: 1.1,
                    backgroundColor: accent,
                    color: palette.ink,
                    border: `1.5px solid ${palette.ink}`,
                  }}
                >
                  {(attnWeight! * 100).toFixed(0)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DotGlyphProps {
  shape: number;
  size: number;
  color: string;
  ink: string;
  isYou: boolean;
}

function DotGlyph({ shape, size, color, ink, isYou }: DotGlyphProps) {
  const s = size;
  // The "you" dot keeps the original square + drop-shadow emphasis from v1.
  if (isYou) {
    return (
      <div
        style={{
          width: s,
          height: s,
          background: color,
          boxShadow: `4px 4px 0 0 ${ink}`,
        }}
      />
    );
  }

  // SVG glyphs render crisp at any pixel ratio (important for export).
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: 'block' }}>
      {shape === 0 && <circle cx={s / 2} cy={s / 2} r={s / 2} fill={color} />}
      {shape === 1 && <rect width={s} height={s} fill={color} />}
      {shape === 2 && <polygon points={`${s / 2},0 ${s},${s} 0,${s}`} fill={color} />}
      {shape === 3 && <polygon points={`${s / 2},0 ${s},${s / 2} ${s / 2},${s} 0,${s / 2}`} fill={color} />}
      {shape === 4 && (
        <>
          <rect x={s * 0.4} y={0} width={s * 0.2} height={s} fill={color} />
          <rect x={0} y={s * 0.4} width={s} height={s * 0.2} fill={color} />
        </>
      )}
    </svg>
  );
}
