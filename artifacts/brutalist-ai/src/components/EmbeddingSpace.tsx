import React, { useEffect, useRef, useState } from 'react';
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
  /** Drift velocity (slow random walk). */
  vx: number;
  vy: number;
  /** Spring velocity used by the cursor-attraction integrator (overshoot). */
  svx: number;
  svy: number;
}

interface FrameSnapshot {
  dots: Dot[];
  snapTimer: number;
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
  const [, forceTick] = useState(0); // re-render trails over time even if dots don't change

  const mouseRef = useRef({ x: -1000, y: -1000, active: false });
  const dotsRef = useRef<Dot[]>([]);
  const animPrngRef = useRef<SeededPrng | null>(null);
  const historyRef = useRef<FrameSnapshot[]>([]);
  const lastFrameRef = useRef(0);
  const trailsRef = useRef<Trail[]>([]);

  useEffect(() => {
    const prng = derivePrng(seedData, PanelSlot.EmbeddingLayout);
    // Separate animation PRNG so snap-jumps stay reproducible per seed.
    animPrngRef.current = derivePrng(seedData, PanelSlot.EmbeddingAnim);

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
      vx: (prng() - 0.5) * 0.001,
      vy: (prng() - 0.5) * 0.001,
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
      // Gaussian scatter around the centroid; clamp inside [0.04..0.96].
      let x = c.centroidX + gaussian(prng) * 0.085;
      let y = c.centroidY + gaussian(prng) * 0.085;
      x = Math.max(0.04, Math.min(0.96, x));
      y = Math.max(0.04, Math.min(0.96, y));

      const shape = Math.floor(prng() * 5);
      const sizeRoll = prng();
      const size = sizeRoll < 0.55 ? 6 : sizeRoll < 0.9 ? 8 : 10;

      newDots.push({
        id: i + 1,
        baseX: x,
        baseY: y,
        targetX: x,
        targetY: y,
        x,
        y,
        label: tokens[i],
        lag: 0.05 + prng() * 0.2,
        isYou: false,
        cluster,
        shape,
        size,
        pinned: pinnedIds.has(i + 1),
        vx: (prng() - 0.5) * 0.0005,
        vy: (prng() - 0.5) * 0.0005,
        svx: 0,
        svy: 0,
      });
    }

    setClusters(newClusters);
    setDots(newDots);
    dotsRef.current = newDots;
    snapTimerRef.current = 0;
    historyRef.current = [];
    trailsRef.current = [];
    lastFrameRef.current = 0;
  }, [seedData]);

  const snapTimerRef = useRef(0);
  const stepPhysics = (dt: number) => {
    snapTimerRef.current += dt;
    if (snapTimerRef.current > 3000) {
      snapTimerRef.current = 0;
      const ap = animPrngRef.current;
      if (ap && ap() > 0.5 && dotsRef.current.length > 1) {
        const idx = 1 + Math.floor(ap() * (dotsRef.current.length - 1));
        const d = dotsRef.current[idx];
        if (d) {
          // Intentional hard-cut teleport: brutalist snap-jump is a single-
          // frame relocation. Trails are a LIVE-only decoration — they read
          // from `performance.now()`, so emitting them in export/paused mode
          // would make the same `stepFrame` render differently depending on
          // wall-clock time, breaking byte-identical bidirectional stepping.
          // We therefore only push trails while live.
          const fromX = d.x;
          const fromY = d.y;
          d.baseX = ap();
          d.baseY = ap();
          d.x = d.baseX;
          d.y = d.baseY;
          d.targetX = d.baseX;
          d.targetY = d.baseY;
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

    // Drop expired trails.
    if (trailsRef.current.length > 0) {
      const now = performance.now();
      trailsRef.current = trailsRef.current.filter(t => now - t.startedAt < TRAIL_LIFETIME_MS);
    }

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseActive = mouseRef.current.active;

    const newDots = [...dotsRef.current];

    for (let i = 0; i < newDots.length; i++) {
      const dot = newDots[i];

      if (mouseActive) {
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
        dot.baseX += dot.vx;
        dot.baseY += dot.vy;
        if (dot.baseX < 0 || dot.baseX > 1) dot.vx *= -1;
        if (dot.baseY < 0 || dot.baseY > 1) dot.vy *= -1;
        dot.baseX = Math.max(0, Math.min(1, dot.baseX));
        dot.baseY = Math.max(0, Math.min(1, dot.baseY));
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
          snapTimer: snapTimerRef.current,
          prngState: prng.getState(),
        });
        stepPhysics(16);
      }
    } else if (delta < 0) {
      let snap: FrameSnapshot | undefined;
      for (let i = 0; i < -delta; i++) snap = historyRef.current.pop() ?? snap;
      if (snap) {
        prng.setState(snap.prngState);
        snapTimerRef.current = snap.snapTimer;
        dotsRef.current = snap.dots.map(d => ({ ...d }));
        setDots(dotsRef.current);
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

  // Compute the connection layer fresh each render so edges follow the live
  // drift physics. With NUM_DOTS=120 the all-pairs proximity scan is ~7,140
  // distance computations, and k-NN per dot is ~120*119 sort entries — both
  // comfortably under a 16ms frame budget. Everything derives from current
  // dot.x/dot.y (no time-based randomness), so paused/export stepping stays
  // byte-identical for a given mode.
  type ProxEdge = { x1: number; y1: number; x2: number; y2: number; dist: number };
  type KnnEdge = { x1: number; y1: number; x2: number; y2: number; cluster: number };
  type AttnEdge = { x1: number; y1: number; x2: number; y2: number; weight: number; targetId: number };

  const proxEdges: ProxEdge[] = [];
  const knnEdges: KnnEdge[] = [];
  const attnEdges: AttnEdge[] = [];

  if (dots.length > 0) {
    if (mode === 'fog') {
      for (let i = 0; i < dots.length; i++) {
        const di = dots[i];
        for (let j = i + 1; j < dots.length; j++) {
          const dj = dots[j];
          const dx = dj.x - di.x;
          const dy = dj.y - di.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d <= PROX_RADIUS) {
            proxEdges.push({ x1: di.x, y1: di.y, x2: dj.x, y2: dj.y, dist: d });
          }
        }
      }
    }

    // k-NN — undirected, deduped. In FOG mode we keep only same-cluster edges
    // (the colored web mirrors the canvas mockup); in ATTN mode we keep all
    // k-NN as a quiet ink underlay so the eye still reads the topology.
    const seen = new Set<number>();
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
        const key = a * NUM_DOTS + b;
        if (seen.has(key)) continue;
        seen.add(key);
        const dn = dots[n.idx];
        if (mode === 'fog' && di.cluster !== dn.cluster) continue;
        knnEdges.push({ x1: di.x, y1: di.y, x2: dn.x, y2: dn.y, cluster: di.cluster });
      }
    }

    if (mode === 'attn') {
      const you = dots.find(d => d.isYou);
      if (you) {
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
        others.forEach((o, i) => {
          attnEdges.push({
            x1: you.x,
            y1: you.y,
            x2: o.x,
            y2: o.y,
            weight: scores[i] / sum,
            targetId: o.id,
          });
        });
      }
    }
  }

  const attnWeightById = new Map<number, number>();
  for (const e of attnEdges) attnWeightById.set(e.targetId, e.weight);

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
                border: `1px solid ${palette.bg}`,
                borderLeft: 'none',
                opacity: mode === 'attn' ? 1 : 0.6,
              }}
              aria-pressed={mode === 'attn'}
              aria-label="Attention from you to top-k"
            >ATTN</button>
          </div>
          <span style={{ color: palette.bg, opacity: 0.5 }}>D-256 · N={NUM_DOTS}</span>
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
          const showLabel = dot.pinned || isHovered || isNeighbor || isAttended;
          // Attended target chips share styling with the "you" chip (accent
          // background, ink border) so the attention relationship reads at a
          // glance. Pinned + attended combines into one chip with `· NN%`.
          const useAccentChip = dot.isYou || isAttended;

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

              {showLabel && (
                <div
                  className="absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap px-1 select-none font-mono text-xs font-bold"
                  style={{
                    backgroundColor: useAccentChip ? accent : isHovered || isNeighbor ? palette.ink : palette.bg,
                    color: useAccentChip ? palette.ink : isHovered || isNeighbor ? palette.bg : palette.ink,
                    transform: isHovered || isNeighbor || isAttended ? 'scale(1.15)' : 'scale(1)',
                    transformOrigin: 'left center',
                    border: useAccentChip ? `2px solid ${palette.ink}` : dot.pinned ? `1px solid ${palette.ink}` : 'none',
                  }}
                >
                  {dot.label}{isAttended ? ` · ${(attnWeight! * 100).toFixed(0)}%` : ''}
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
