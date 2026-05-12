import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { generateEmbeddingTokens } from '../lib/tokens';
import {
  CycleState,
  HOLD_PHASE_START_STEP,
  computeCycle,
} from '../lib/trainingCycle';
import { useCycleStore } from '../contexts/TrainingCycleContext';

// Spring damping that approximates `${SNAP_EASING}` settling over ~SNAP_DURATION_MS:
// after a snap-jump teleports `baseX/baseY`, the per-frame spring (stiffness=lag*1.4,
// damping=0.62) overshoots then resolves on roughly that ease curve / time budget.
const SPRING_DAMPING = 0.62;

const NUM_DOTS = 120;
const NUM_CLUSTERS = 4;
const NUM_PINNED = 6;
const TRAIL_LIFETIME_MS = 900;

// Training-arc tunables. The epoch / step / phase signal itself now
// lives in `lib/trainingCycle.ts` and is shared by every panel via the
// `TrainingCycleContext`. The embedding consumes that signal and
// remains the visual writer (dot positions, snap-jumps, per-epoch
// re-randomization).
const HOME_SIGMA = 0.11;
const JITTER_AMP = 0.006;
const YOU_JITTER_AMP = 0.0024;
const SNAP_PERIOD_STEPS = 120;
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

// Spatial grid cell size = PROX_RADIUS so the 3x3 cell neighborhood around
// any dot is guaranteed to contain every other dot within PROX_RADIUS. This
// makes prox-edge computation O(N + edges) and seeds k-NN candidates from a
// small local set instead of a full N×N sort. For k-NN we keep a fallback
// to a full scan whenever the grid neighborhood doesn't have enough close
// candidates, so the output is byte-identical to the original O(N²) version.
const GRID_CELL = PROX_RADIUS;
const GRID_DIM = Math.max(1, Math.ceil(1 / GRID_CELL));

type ConnectionMode = 'fog' | 'attn';

interface EmbeddingSpaceProps {
  seedData: SeedData;
  palette: Palette;
  /** Resolved accent color for the "you" dot. */
  accent: string;
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
  cluster: number;
  shape: number;
  size: number;
  pinned: boolean;
  homeX: number;
  homeY: number;
  startX: number;
  startY: number;
  disperseFromX: number;
  disperseFromY: number;
  clusterCentroidX: number;
  clusterCentroidY: number;
  jitterPhaseX: number;
  jitterPhaseY: number;
  svx: number;
  svy: number;
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
  const u = Math.max(1e-9, prng());
  const v = prng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ───────────────────────────────────────────────────────────────────
// Spatial grid + edge helpers (pure, snapshot-stable)
// ───────────────────────────────────────────────────────────────────

type ProxEdge = { x1: number; y1: number; x2: number; y2: number; dist: number };
type KnnEdge = { x1: number; y1: number; x2: number; y2: number; cluster: number };
type AttnEdge = { x1: number; y1: number; x2: number; y2: number; weight: number; targetId: number };

interface SpatialGrid {
  cells: number[][];
  dim: number;
}

function buildGrid(dots: Dot[]): SpatialGrid {
  const dim = GRID_DIM;
  const cells: number[][] = new Array(dim * dim);
  for (let i = 0; i < cells.length; i++) cells[i] = [];
  for (let i = 0; i < dots.length; i++) {
    const d = dots[i];
    const cx = Math.min(dim - 1, Math.max(0, Math.floor(d.x / GRID_CELL)));
    const cy = Math.min(dim - 1, Math.max(0, Math.floor(d.y / GRID_CELL)));
    cells[cy * dim + cx].push(i);
  }
  return { cells, dim };
}

/**
 * All pairs within PROX_RADIUS. Iterates cell pairs in the lower/right half
 * of the 3×3 neighborhood so each pair is visited exactly once. Output is
 * the same edge set as the original O(N²) version (order may differ but
 * the canvas painter is order-agnostic).
 */
function computeProxEdges(dots: Dot[], grid?: SpatialGrid): ProxEdge[] {
  const out: ProxEdge[] = [];
  const g = grid ?? buildGrid(dots);
  const r2 = PROX_RADIUS * PROX_RADIUS;
  const dim = g.dim;
  for (let cy = 0; cy < dim; cy++) {
    for (let cx = 0; cx < dim; cx++) {
      const cellA = g.cells[cy * dim + cx];
      if (cellA.length === 0) continue;
      // Visit each unordered cell-pair exactly once: same cell + the four
      // neighbors at offsets (+1,0), (-1,+1), (0,+1), (+1,+1).
      const offsets: [number, number][] = [
        [0, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ];
      for (const [dx, dy] of offsets) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= dim || ny < 0 || ny >= dim) continue;
        const cellB = g.cells[ny * dim + nx];
        if (cellB.length === 0) continue;
        const sameCell = dx === 0 && dy === 0;
        for (let ai = 0; ai < cellA.length; ai++) {
          const i = cellA[ai];
          const di = dots[i];
          const startBi = sameCell ? ai + 1 : 0;
          for (let bi = startBi; bi < cellB.length; bi++) {
            const j = cellB[bi];
            const dj = dots[j];
            const ddx = dj.x - di.x;
            const ddy = dj.y - di.y;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 <= r2) {
              out.push({ x1: di.x, y1: di.y, x2: dj.x, y2: dj.y, dist: Math.sqrt(d2) });
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Undirected k-nearest-neighbor edges, deduped by ordered index pair.
 * Candidates come from the dot's own cell + 8 neighbors; if the K-th
 * candidate's distance is ≥ GRID_CELL (or there aren't enough candidates)
 * we fall back to a full scan for that dot — guaranteeing the same K
 * nearest neighbors as the original implementation.
 */
function computeKnnEdges(dots: Dot[], sameClusterOnly: boolean, grid?: SpatialGrid): KnnEdge[] {
  const out: KnnEdge[] = [];
  if (dots.length === 0) return out;
  const g = grid ?? buildGrid(dots);
  const seen = new Set<number>();
  const stride = dots.length;
  const dim = g.dim;

  for (let i = 0; i < dots.length; i++) {
    const di = dots[i];
    const cx = Math.min(dim - 1, Math.max(0, Math.floor(di.x / GRID_CELL)));
    const cy = Math.min(dim - 1, Math.max(0, Math.floor(di.y / GRID_CELL)));
    let cands: { idx: number; dist: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= dim || ny < 0 || ny >= dim) continue;
        const cell = g.cells[ny * dim + nx];
        for (const j of cell) {
          if (j === i) continue;
          const dj = dots[j];
          const ddx = dj.x - di.x;
          const ddy = dj.y - di.y;
          cands.push({ idx: j, dist: Math.sqrt(ddx * ddx + ddy * ddy) });
        }
      }
    }
    cands.sort((a, b) => a.dist - b.dist);
    // Fallback: if we don't have enough close candidates, the K-th nearest
    // might live outside the 3×3 neighborhood. Re-scan all dots so the
    // result matches the original O(N²) version exactly.
    const needFallback =
      cands.length < K_NN ||
      (cands.length >= K_NN && cands[K_NN - 1].dist >= GRID_CELL);
    if (needFallback) {
      cands = [];
      for (let j = 0; j < dots.length; j++) {
        if (j === i) continue;
        const dj = dots[j];
        const ddx = dj.x - di.x;
        const ddy = dj.y - di.y;
        cands.push({ idx: j, dist: Math.sqrt(ddx * ddx + ddy * ddy) });
      }
      cands.sort((a, b) => a.dist - b.dist);
    }
    const lim = Math.min(K_NN, cands.length);
    for (let k = 0; k < lim; k++) {
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

function computeAttnEdges(dots: Dot[]): AttnEdge[] {
  let you: Dot | undefined;
  for (const d of dots) {
    if (d.isYou) {
      you = d;
      break;
    }
  }
  if (!you) return [];
  const others: { id: number; x: number; y: number; dist: number }[] = [];
  for (const d of dots) {
    if (d.isYou) continue;
    const dx = d.x - you.x;
    const dy = d.y - you.y;
    others.push({ id: d.id, x: d.x, y: d.y, dist: Math.sqrt(dx * dx + dy * dy) });
  }
  others.sort((a, b) => a.dist - b.dist);
  const top = others.slice(0, ATTN_TOP_K);
  const scores = top.map(o => Math.exp(-o.dist / ATTN_TEMPERATURE));
  const sum = scores.reduce((a, b) => a + b, 0) || 1;
  return top.map((o, i) => ({
    x1: you!.x,
    y1: you!.y,
    x2: o.x,
    y2: o.y,
    weight: scores[i] / sum,
    targetId: o.id,
  }));
}

// ───────────────────────────────────────────────────────────────────
// Header EPOCH/STEP chip — subscribes directly to the cycle store so
// the chip text stays exactly in sync with the rendered frame. React
// only re-renders this tiny <span>, not the whole panel, so the perf
// cost is negligible.
// ───────────────────────────────────────────────────────────────────

function CycleHeaderChip({ palette }: { palette: Palette }) {
  const store = useCycleStore();
  const [snap, setSnap] = useState(() => {
    const c = store.get();
    return { epoch: c.epoch, step: c.step };
  });
  useEffect(() => {
    const update = () => {
      const c = store.get();
      setSnap(prev =>
        prev.epoch === c.epoch && prev.step === c.step ? prev : { epoch: c.epoch, step: c.step },
      );
    };
    update();
    return store.subscribe(update);
  }, [store]);
  return (
    <span style={{ color: palette.bg, opacity: 0.5 }}>
      EPOCH {snap.epoch.toString().padStart(2, '0')} · STEP {snap.step.toString().padStart(4, '0')} · N={NUM_DOTS}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────
// Main panel
// ───────────────────────────────────────────────────────────────────

export function EmbeddingSpace({
  seedData,
  palette,
  accent,
}: EmbeddingSpaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // `dots` only changes on init or scrub-restore — never every physics
  // tick. Per-frame motion is applied imperatively to dot DOM nodes.
  const [dots, setDots] = useState<Dot[]>([]);
  const [hoveredDotId, setHoveredDotId] = useState<number | null>(null);
  const [nearestNeighbors, setNearestNeighbors] = useState<number[]>([]);
  const [clusters, setClusters] = useState<ClusterMeta[]>([]);
  const [mode, setMode] = useState<ConnectionMode>('fog');
  // Low-rate tick used by ATTN-mode chips so the displayed % refreshes
  // a few times per second without forcing a 60fps re-render of every
  // dot. Cheap because dot positions are written imperatively, not
  // through React state.
  const [, setAttnTick] = useState(0);

  const mouseRef = useRef({ x: -1000, y: -1000, active: false });
  const dotsRef = useRef<Dot[]>([]);
  const dotElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const animPrngRef = useRef<SeededPrng | null>(null);
  const trailsRef = useRef<Trail[]>([]);
  const lastRawStepRef = useRef(0);
  const lastEpochRef = useRef(0);
  const nextSnapStepRef = useRef(HOLD_PHASE_START_STEP + 30);

  // Container pixel dimensions, kept up-to-date via ResizeObserver. All
  // canvas painting and DOM transforms read from this ref so we never pay
  // for a getBoundingClientRect per frame.
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // Refs for state that paintFrame needs but should not cause the cycle
  // subscription to re-bind. These are assigned during render (below,
  // before the return statement) so the synchronous useLayoutEffect
  // paintFrame call sees the latest values.
  const modeRef = useRef(mode);
  const paletteRef = useRef(palette);
  const accentRef = useRef(accent);
  const hoveredRef = useRef<number | null>(hoveredDotId);
  const nnRef = useRef<number[]>(nearestNeighbors);
  // Cached container DOMRect so the per-tick physics step doesn't pay
  // for a getBoundingClientRect every frame. Refreshed by the
  // ResizeObserver and on the next mouse-move after a possible scroll.
  const rectRef = useRef<DOMRect | null>(null);
  // Latest attention weights by dotId, updated on every paint so React
  // chip rendering can read them via the slow attnTick refresh.
  const attnWeightsRef = useRef<Map<number, number>>(new Map());

  const store = useCycleStore();

  // Initial dot population (re-runs only on seed change).
  useEffect(() => {
    const prng = derivePrng(seedData, PanelSlot.EmbeddingLayout);
    const animPrng = derivePrng(seedData, PanelSlot.EmbeddingAnim);
    animPrngRef.current = animPrng;

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
      shape: 1,
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
      jitterPhaseX: ((seedData.panelSeeds[PanelSlot.EmbeddingLayout] ?? seedData.seedInt) & 0xffff) / 0xffff * TAU,
      jitterPhaseY: (((seedData.panelSeeds[PanelSlot.EmbeddingLayout] ?? seedData.seedInt) >>> 16) & 0xffff) / 0xffff * TAU,
      svx: 0,
      svy: 0,
    });

    const pinnedIds = new Set<number>();
    while (pinnedIds.size < NUM_PINNED) {
      pinnedIds.add(1 + Math.floor(prng() * (NUM_DOTS - 1)));
    }

    for (let i = 0; i < NUM_DOTS - 1; i++) {
      const cluster = i % NUM_CLUSTERS;
      const c = newClusters[cluster];
      let homeX = c.centroidX + gaussian(prng) * HOME_SIGMA;
      let homeY = c.centroidY + gaussian(prng) * HOME_SIGMA;
      homeX = Math.max(0.04, Math.min(0.96, homeX));
      homeY = Math.max(0.04, Math.min(0.96, homeY));

      const shape = Math.floor(prng() * 5);
      const sizeRoll = prng();
      const size = sizeRoll < 0.55 ? 6 : sizeRoll < 0.9 ? 8 : 10;
      const jitterPhaseX = prng() * TAU;
      const jitterPhaseY = prng() * TAU;

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
    lastRawStepRef.current = 0;
    lastEpochRef.current = 0;
    nextSnapStepRef.current = HOLD_PHASE_START_STEP + 30;
    trailsRef.current = [];
  }, [seedData]);

  // Pure mutation of dotsRef — no React state writes per tick.
  const stepPhysics = (cycle: CycleState) => {
    if (cycle.epoch !== lastEpochRef.current) {
      const ap = animPrngRef.current;
      if (ap) {
        for (const d of dotsRef.current) {
          if (d.isYou) continue;
          d.disperseFromX = d.x;
          d.disperseFromY = d.y;
          d.startX = 0.04 + ap() * 0.92;
          d.startY = 0.04 + ap() * 0.92;
          const nh = d.clusterCentroidX + gaussian(ap) * HOME_SIGMA;
          const nv = d.clusterCentroidY + gaussian(ap) * HOME_SIGMA;
          d.homeX = Math.max(0.04, Math.min(0.96, nh));
          d.homeY = Math.max(0.04, Math.min(0.96, nv));
        }
      }
      lastEpochRef.current = cycle.epoch;
      nextSnapStepRef.current = HOLD_PHASE_START_STEP + 30;
    }

    const sStep = cycle.step;
    const inHold = sStep >= HOLD_PHASE_START_STEP;
    if (inHold && sStep >= nextSnapStepRef.current) {
      nextSnapStepRef.current = sStep + SNAP_PERIOD_STEPS;
      const ap = animPrngRef.current;
      if (ap && ap() > 0.5 && dotsRef.current.length > 1) {
        const idx = 1 + Math.floor(ap() * (dotsRef.current.length - 1));
        const d = dotsRef.current[idx];
        if (d && !d.isYou) {
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

    if (trailsRef.current.length > 0) {
      const now = performance.now();
      trailsRef.current = trailsRef.current.filter(t => now - t.startedAt < TRAIL_LIFETIME_MS);
    }

    const w = sizeRef.current.w;
    const h = sizeRef.current.h;
    const containerRect = rectRef.current;
    const mouseActive = mouseRef.current.active && !!containerRect && w > 0 && h > 0;

    const phase = cycle.phase;
    const phaseProgress = phase === 'hold' ? 1 : cycle.phaseProgress;
    const eased = phase === 'hold' ? 1 : 1 - Math.pow(1 - phaseProgress, 3);

    const dotsArr = dotsRef.current;
    for (let i = 0; i < dotsArr.length; i++) {
      const dot = dotsArr[i];

      if (!dot.isYou) {
        let fromX: number, fromY: number, toX: number, toY: number;
        if (phase === 'disperse') {
          fromX = dot.disperseFromX; fromY = dot.disperseFromY;
          toX = dot.startX;          toY = dot.startY;
        } else {
          fromX = dot.startX; fromY = dot.startY;
          toX = dot.homeX;    toY = dot.homeY;
        }
        const easedX = fromX + (toX - fromX) * eased;
        const easedY = fromY + (toY - fromY) * eased;
        const jx = JITTER_AMP * Math.sin(sStep * 0.04 + dot.jitterPhaseX);
        const jy = JITTER_AMP * Math.cos(sStep * 0.05 + dot.jitterPhaseY);
        dot.baseX = Math.max(0, Math.min(1, easedX + jx));
        dot.baseY = Math.max(0, Math.min(1, easedY + jy));
      } else {
        const jx = YOU_JITTER_AMP * Math.sin(sStep * 0.04 + dot.jitterPhaseX);
        const jy = YOU_JITTER_AMP * Math.cos(sStep * 0.05 + dot.jitterPhaseY);
        dot.baseX = Math.max(0, Math.min(1, dot.homeX + jx));
        dot.baseY = Math.max(0, Math.min(1, dot.homeY + jy));
      }

      if (mouseActive && containerRect) {
        const mx = (mouseRef.current.x - containerRect.left) / containerRect.width;
        const my = (mouseRef.current.y - containerRect.top) / containerRect.height;
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

      const stiffness = dot.lag * 1.4;
      dot.svx = dot.svx * SPRING_DAMPING + (dot.targetX - dot.x) * stiffness;
      dot.svy = dot.svy * SPRING_DAMPING + (dot.targetY - dot.y) * stiffness;
      dot.x += dot.svx;
      dot.y += dot.svy;
    }
  };

  // Imperative paint: writes dot transforms + redraws the edges canvas.
  // Pure function of dotsRef + the *Ref state mirrors. Called from the
  // cycle subscription and from a useLayoutEffect on every React render.
  const paintFrame = () => {
    const w = sizeRef.current.w;
    const h = sizeRef.current.h;
    if (w === 0 || h === 0) return;

    const dotsArr = dotsRef.current;
    const els = dotElsRef.current;
    for (let i = 0; i < dotsArr.length; i++) {
      const d = dotsArr[i];
      const el = els.get(d.id);
      if (el) {
        el.style.transform = `translate3d(${d.x * w}px, ${d.y * h}px, 0) translate(-50%, -50%)`;
      }
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = sizeRef.current.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const palette = paletteRef.current;
    const accent = accentRef.current;
    const mode = modeRef.current;
    const colorForCluster = (cluster: number): string => {
      if (cluster === 0) return palette.ink;
      if (cluster === 1) return palette.accent1;
      if (cluster === 2) return palette.accent2;
      return palette.accent3;
    };

    const grid = buildGrid(dotsArr);

    // FOG: prox underlay, then colored k-NN web.
    if (mode === 'fog') {
      const proxEdges = computeProxEdges(dotsArr, grid);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = palette.ink;
      for (const e of proxEdges) {
        const op = (1 - e.dist / PROX_RADIUS) * 0.32;
        if (op <= 0.01) continue;
        ctx.globalAlpha = op;
        ctx.beginPath();
        ctx.moveTo(e.x1 * w, e.y1 * h);
        ctx.lineTo(e.x2 * w, e.y2 * h);
        ctx.stroke();
      }
    }

    const knnEdges = computeKnnEdges(dotsArr, mode === 'fog', grid);
    if (mode === 'fog') {
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.85;
      for (const e of knnEdges) {
        ctx.strokeStyle = colorForCluster(e.cluster);
        ctx.beginPath();
        ctx.moveTo(e.x1 * w, e.y1 * h);
        ctx.lineTo(e.x2 * w, e.y2 * h);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.18;
      for (const e of knnEdges) {
        ctx.beginPath();
        ctx.moveTo(e.x1 * w, e.y1 * h);
        ctx.lineTo(e.x2 * w, e.y2 * h);
        ctx.stroke();
      }
    }

    // ATTN: ink halo + accent stroke from "you" to top-K.
    if (mode === 'attn') {
      const attnEdges = computeAttnEdges(dotsArr);
      attnWeightsRef.current = new Map();
      for (const e of attnEdges) attnWeightsRef.current.set(e.targetId, e.weight);
      for (const e of attnEdges) {
        const lw = 1 + e.weight * 7;
        ctx.strokeStyle = palette.ink;
        ctx.globalAlpha = 1;
        ctx.lineWidth = lw + 2;
        ctx.beginPath();
        ctx.moveTo(e.x1 * w, e.y1 * h);
        ctx.lineTo(e.x2 * w, e.y2 * h);
        ctx.stroke();

        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.85 + e.weight * 0.15;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(e.x1 * w, e.y1 * h);
        ctx.lineTo(e.x2 * w, e.y2 * h);
        ctx.stroke();
      }
    } else {
      attnWeightsRef.current = new Map();
    }

    // Trails.
    if (trailsRef.current.length > 0) {
      const now = performance.now();
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 3]);
      for (const t of trailsRef.current) {
        const age = (now - t.startedAt) / TRAIL_LIFETIME_MS;
        if (age >= 1) continue;
        ctx.strokeStyle = colorForCluster(t.cluster);
        ctx.globalAlpha = (1 - age) * 0.85;
        ctx.beginPath();
        ctx.moveTo(t.fromX * w, t.fromY * h);
        ctx.lineTo(t.toX * w, t.toY * h);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Hover NN lines (ATTN, non-"you" hover).
    const hovered = hoveredRef.current;
    if (mode === 'attn' && hovered !== null && hovered !== 0) {
      let hDot: Dot | undefined;
      for (const d of dotsArr) {
        if (d.id === hovered) {
          hDot = d;
          break;
        }
      }
      if (hDot) {
        ctx.strokeStyle = palette.ink;
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3;
        for (const nId of nnRef.current) {
          let nDot: Dot | undefined;
          for (const d of dotsArr) {
            if (d.id === nId) {
              nDot = d;
              break;
            }
          }
          if (!nDot) continue;
          ctx.beginPath();
          ctx.moveTo(hDot.x * w, hDot.y * h);
          ctx.lineTo(nDot.x * w, nDot.y * h);
          ctx.stroke();
        }
      }
    }

    ctx.globalAlpha = 1;
  };

  // Resize observer: keep the canvas internal pixel buffer matched to the
  // container so we can paint in CSS pixels without per-frame layout reads.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const apply = () => {
      const rect = container.getBoundingClientRect();
      rectRef.current = rect;
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      const h = rect.height;
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      paintFrame();
    };
    apply();

    const ro = new ResizeObserver(apply);
    ro.observe(container);
    // Page-level scroll can move the container without resizing it,
    // which would invalidate the cached rect's left/top used for mouse
    // attraction. Refresh on scroll (passive — never blocks).
    const onScroll = () => {
      rectRef.current = container.getBoundingClientRect();
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive physics from the shared cycle store. Subscribing imperatively
  // (instead of useSyncExternalStore) means EmbeddingSpace itself does
  // NOT re-render every tick; only paintFrame writes to the DOM/canvas.
  useEffect(() => {
    if (dotsRef.current.length === 0 || !animPrngRef.current) return;
    const prng = animPrngRef.current;

    const handle = () => {
      const cycle = store.get();
      const delta = cycle.rawStep - lastRawStepRef.current;
      if (delta > 0) {
        for (let i = 0; i < delta; i++) {
          const targetRaw = lastRawStepRef.current + i + 1;
          stepPhysics(computeCycle(targetRaw));
        }
      }
      lastRawStepRef.current = cycle.rawStep;
      paintFrame();
    };

    // Process whatever is already in the store on (re-)subscribe so the
    // panel catches up after a seed change without waiting for the next tick.
    handle();
    const unsub = store.subscribe(handle);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, dots]);

  // Repaint after every React render so transform/visual state stays in
  // sync with whatever just changed (mode toggle, hover, palette, etc.).
  useLayoutEffect(() => {
    paintFrame();
  });

  // Slow tick that refreshes ATTN chip percentages without a 60fps render.
  useEffect(() => {
    if (mode !== 'attn') return;
    const id = setInterval(() => setAttnTick(n => (n + 1) | 0), 250);
    return () => clearInterval(id);
  }, [mode]);

  const handleMouseMove = (e: React.MouseEvent) => {
    // Refresh the cached rect on the first move after a possible scroll
    // so mouse-attraction physics keeps tracking the cursor accurately
    // without paying for getBoundingClientRect every cycle tick.
    const c = containerRef.current;
    if (c) rectRef.current = c.getBoundingClientRect();
    mouseRef.current = { x: e.clientX, y: e.clientY, active: true };
  };

  const handleMouseLeave = () => {
    mouseRef.current.active = false;
    setHoveredDotId(null);
    setNearestNeighbors([]);
  };

  // Recompute nearest neighbors only on hover change. Reads from dotsRef
  // (live positions) instead of stale `dots` state so we don't depend on
  // the per-frame React update path. While hovering, refresh at ~6Hz so
  // the highlighted neighbors track the cluster as dots drift.
  useEffect(() => {
    if (hoveredDotId === null) return;
    const compute = () => {
      const arr = dotsRef.current;
      let hover: Dot | undefined;
      for (const d of arr) {
        if (d.id === hoveredDotId) {
          hover = d;
          break;
        }
      }
      if (!hover) return;
      const dists: { id: number; dist: number }[] = [];
      for (const d of arr) {
        if (d.id === hoveredDotId) continue;
        const dx = d.x - hover.x;
        const dy = d.y - hover.y;
        dists.push({ id: d.id, dist: Math.sqrt(dx * dx + dy * dy) });
      }
      dists.sort((a, b) => a.dist - b.dist);
      const next = dists.slice(0, 3).map(d => d.id);
      // Skip the setState if the list is identical — avoids needless
      // re-renders + canvas repaints while hovering.
      const prev = nnRef.current;
      if (
        prev.length === next.length &&
        prev[0] === next[0] &&
        prev[1] === next[1] &&
        prev[2] === next[2]
      ) {
        return;
      }
      setNearestNeighbors(next);
    };
    compute();
    const id = setInterval(compute, 160);
    return () => clearInterval(id);
  }, [hoveredDotId]);

  const colorForCluster = (cluster: number): string => {
    if (cluster === 0) return palette.ink;
    if (cluster === 1) return palette.accent1;
    if (cluster === 2) return palette.accent2;
    return palette.accent3;
  };

  // Sync visual-state ref mirrors during render so the synchronous
  // useLayoutEffect paint immediately below reads up-to-date values.
  // Mutating refs in render is allowed because it's an idempotent local
  // assignment with no side effects; the alternative (useEffect mirror)
  // runs AFTER useLayoutEffect, which would leave the canvas one commit
  // stale on mode/palette/hover changes.
  modeRef.current = mode;
  paletteRef.current = palette;
  accentRef.current = accent;
  hoveredRef.current = hoveredDotId;
  nnRef.current = nearestNeighbors;

  // Snapshot of attention weights for chip rendering. Refreshed via
  // `attnTick` (5Hz) — chip percentages may lag by ~250ms, which is
  // imperceptible for the decorative badge.
  const attnWeightById = attnWeightsRef.current;

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
          <CycleHeaderChip palette={palette} />
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

        {/* Single canvas replaces the two SVG layers (prox + k-NN + attn
            edges, drift trails, hover NN lines). Painting cost is now
            roughly proportional to edge count instead of edge count plus
            SVG tree reconciliation. */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none z-10"
        />

        {/* Dots (DOM-positioned so per-dot mouse events keep working).
            Position is applied imperatively to el.style.transform from
            paintFrame; React only writes structural style here so it
            never overwrites our per-frame transform. */}
        {dots.map(dot => {
          const isHovered = hoveredDotId === dot.id;
          const isNeighbor = nearestNeighbors.includes(dot.id);
          const attnWeight = attnWeightById.get(dot.id);
          const isAttended = attnWeight !== undefined;
          const dotColor = dot.isYou ? accent : colorForCluster(dot.cluster);
          const showFullChip = dot.pinned || isHovered || isNeighbor;
          const useAccentChip = dot.isYou || (showFullChip && isAttended);
          const showCompactBadge = !showFullChip && isAttended;

          return (
            <div
              key={dot.id}
              ref={el => {
                if (el) dotElsRef.current.set(dot.id, el);
                else dotElsRef.current.delete(dot.id);
              }}
              className="absolute pointer-events-auto"
              style={{
                left: 0,
                top: 0,
                willChange: 'transform',
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
                    // In the inverted palette, palette.ink is light cream and the
                    // accents are also light, so light-on-accent vanishes. Use the
                    // dark palette.bg as chip text color in that case.
                    color: useAccentChip
                      ? (palette.inverted ? palette.bg : palette.ink)
                      : isHovered || isNeighbor ? palette.bg : palette.ink,
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
                    color: palette.inverted ? palette.bg : palette.ink,
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
