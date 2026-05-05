import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { CycleState, computeCycle, Phase } from '../lib/trainingCycle';
import { useCycleStore } from '../contexts/TrainingCycleContext';

interface WeightsProps {
  seedData: SeedData;
  palette: Palette;
  paused?: boolean;
  /** Current target frame. Each ±1 step advances or rewinds one tick. */
  stepFrame?: number;
}

interface WeightRow {
  val: number;
  formatted: string;
  /** Last N raw values (oldest → newest). Used to draw the row sparkline. */
  spark: number[];
}

interface Snapshot {
  rows: WeightRow[];
  prngState: number;
  flickerIdx: number;
}

const MAX_ROWS = 32;
const MIN_ROWS = 12;
const SPARK_LEN = 12;
const ROW_HEIGHT_PX = 22;

// How many rows flicker in a given tick, by training phase. DISPERSE +
// CONVERGE feel like an active "learning" model; HOLD reads as settled —
// most ticks are no-ops, with the occasional slow drift.
function flickerCountForPhase(phase: Phase, prng: SeededPrng): number {
  const r = prng(); // always consumed so PRNG state is phase-independent
  if (phase === 'disperse') return 2;
  if (phase === 'converge') return 1;
  // hold: ~25% of ticks fire one flicker
  return r < 0.25 ? 1 : 0;
}

export function Weights({ seedData, palette, paused = false, stepFrame = 0 }: WeightsProps) {
  const [rows, setRows] = useState<WeightRow[]>([]);
  const [flickerIdx, setFlickerIdx] = useState<number>(-1);
  const [visibleCount, setVisibleCount] = useState<number>(MIN_ROWS);
  const flickerPrngRef = useRef<SeededPrng | null>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const lastFrameRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  const cycleStore = useCycleStore();

  useEffect(() => {
    const initPrng = derivePrng(seedData, PanelSlot.WeightsInit);
    flickerPrngRef.current = derivePrng(seedData, PanelSlot.WeightsFlicker);
    historyRef.current = [];
    lastFrameRef.current = 0;
    const initial: WeightRow[] = [];
    for (let i = 0; i < MAX_ROWS; i++) {
      const v = randomWeight(initPrng);
      initial.push({ val: v, formatted: formatWeight(v), spark: [v] });
    }
    setRows(initial);
    setFlickerIdx(-1);
  }, [seedData]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const h = e.contentRect.height;
        const n = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(h / ROW_HEIGHT_PX)));
        setVisibleCount(prev => (prev === n ? prev : n));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tick = (
    current: WeightRow[],
    cycle: CycleState,
    prng: SeededPrng,
  ): { rows: WeightRow[]; flickerIdx: number } => {
    if (current.length === 0) return { rows: current, flickerIdx: -1 };
    const count = flickerCountForPhase(cycle.phase, prng);
    if (count === 0) return { rows: current, flickerIdx: -1 };
    const next = current.slice();
    let lastIdx = -1;
    for (let k = 0; k < count; k++) {
      const idx = Math.floor(prng() * next.length);
      const v = randomWeight(prng);
      const prevSpark = next[idx].spark;
      const spark =
        prevSpark.length >= SPARK_LEN ? [...prevSpark.slice(1), v] : [...prevSpark, v];
      next[idx] = { val: v, formatted: formatWeight(v), spark };
      lastIdx = idx;
    }
    return { rows: next, flickerIdx: lastIdx };
  };

  // Live: timer-driven flicker, seeded phase offset to break sync.
  // Each fire reads the current shared cycle so flicker activity tracks
  // the dashboard-wide training arc.
  useEffect(() => {
    if (paused || rows.length === 0) return;
    const prng = flickerPrngRef.current!;
    const phaseOffset = Math.floor((seedData.panelSeeds[PanelSlot.WeightsFlicker] % 350));
    let cleanup: () => void = () => {};
    const start = setTimeout(() => {
      const interval = setInterval(() => {
        const cycle = cycleStore.get();
        setRows(prev => {
          const r = tick(prev, cycle, prng);
          setFlickerIdx(r.flickerIdx);
          return r.rows;
        });
      }, 400);
      cleanup = () => clearInterval(interval);
    }, phaseOffset);
    return () => {
      clearTimeout(start);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedData, paused, rows.length]);

  // Paused: bidirectional frame stepping via snapshot history. Each tick
  // reads the cycle for that exact frame so the panel stays a pure
  // function of stepFrame end-to-end.
  useEffect(() => {
    if (!paused || rows.length === 0 || !flickerPrngRef.current) return;
    const prng = flickerPrngRef.current;
    const delta = stepFrame - lastFrameRef.current;
    if (delta > 0) {
      setRows(prev => {
        let next = prev;
        let lastIdx = flickerIdx;
        for (let i = 0; i < delta; i++) {
          historyRef.current.push({ rows: next, prngState: prng.getState(), flickerIdx: lastIdx });
          const cycle = computeCycle(lastFrameRef.current + i + 1);
          const r = tick(next, cycle, prng);
          next = r.rows;
          lastIdx = r.flickerIdx;
        }
        setFlickerIdx(lastIdx);
        return next;
      });
    } else if (delta < 0) {
      let snap: Snapshot | undefined;
      for (let i = 0; i < -delta; i++) snap = historyRef.current.pop() ?? snap;
      if (snap) {
        prng.setState(snap.prngState);
        setRows(snap.rows);
        setFlickerIdx(snap.flickerIdx);
      }
    }
    lastFrameRef.current = stepFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);

  const visibleRows = rows.slice(0, visibleCount);

  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">WEIGHTS</div>
      <div
        ref={bodyRef}
        className="px-2 py-2 flex-1 flex flex-col justify-between font-mono text-[11px] overflow-hidden"
        style={{ background: palette.bg }}
      >
        {visibleRows.map((row, i) => {
          const isFlicker = i === flickerIdx;
          return (
            <div key={i} className="flex items-center gap-1 leading-none">
              <span
                className="px-1 font-bold shrink-0"
                style={{
                  background: palette.accent1,
                  color: palette.bg,
                  fontSize: 10,
                }}
              >
                W_{i.toString().padStart(2, '0')}
              </span>
              <Sparkline values={row.spark} color={palette.ink} accent={palette.accent1} />
              <span
                className="font-bold px-1 shrink-0 ml-auto tabular-nums"
                style={
                  isFlicker
                    ? { background: palette.ink, color: palette.bg }
                    : { color: palette.ink }
                }
              >
                {row.formatted}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Sparkline({ values, color, accent }: { values: number[]; color: string; accent: string }) {
  const W = 50;
  const H = 12;
  const n = SPARK_LEN;
  const startX = n - values.length;
  const bars = values.map((v, i) => {
    const m = Math.min(1, Math.abs(v));
    const h = Math.max(1, m * H);
    const x = ((startX + i) / n) * W;
    const w = W / n - 0.6;
    const y = H - h;
    const positive = v >= 0;
    return (
      <rect
        key={i}
        x={x}
        y={y}
        width={w}
        height={h}
        fill={positive ? color : accent}
        opacity={i === values.length - 1 ? 1 : 0.55}
      />
    );
  });
  return (
    <svg width={W} height={H} className="shrink-0" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {bars}
    </svg>
  );
}

function randomWeight(prng: SeededPrng): number {
  const r = prng();
  if (r < 0.2) {
    const sign = prng() > 0.5 ? 1 : -1;
    const mantissa = prng() * 9 + 1;
    const exp = Math.floor(prng() * 5 + 1);
    return sign * (mantissa * Math.pow(10, -exp));
  }
  const sign = prng() > 0.5 ? 1 : -1;
  return sign * prng();
}

function formatWeight(v: number): string {
  const sign = v >= 0 ? '+' : '-';
  const a = Math.abs(v);
  if (a < 0.01) {
    const exp = Math.floor(-Math.log10(a));
    const mant = a * Math.pow(10, exp);
    return `${sign}${mant.toFixed(2)}e-${exp}`;
  }
  return `${sign}${a.toFixed(4)}`;
}
