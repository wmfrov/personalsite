import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';

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

// Pre-compute a fixed pool of rows so flicker indices stay deterministic
// regardless of how many we end up rendering at a given viewport size.
const MAX_ROWS = 32;
const MIN_ROWS = 12;
const SPARK_LEN = 12;
// Approximate per-row pixel height (chip + sparkline gap); used to decide
// how many rows fit in the current container.
const ROW_HEIGHT_PX = 22;

export function Weights({ seedData, palette, paused = false, stepFrame = 0 }: WeightsProps) {
  const [rows, setRows] = useState<WeightRow[]>([]);
  const [flickerIdx, setFlickerIdx] = useState<number>(-1);
  const [visibleCount, setVisibleCount] = useState<number>(MIN_ROWS);
  const flickerPrngRef = useRef<SeededPrng | null>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const lastFrameRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

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

  // Resize observer — recompute how many rows fit in the body. Snapshots
  // record the full MAX_ROWS array, so changing visibleCount across renders
  // never invalidates history.
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

  const tick = (current: WeightRow[], prng: SeededPrng): { rows: WeightRow[]; flickerIdx: number } => {
    if (current.length === 0) return { rows: current, flickerIdx: -1 };
    const next = current.slice();
    const idx = Math.floor(prng() * next.length);
    const v = randomWeight(prng);
    const prevSpark = next[idx].spark;
    const spark = prevSpark.length >= SPARK_LEN ? [...prevSpark.slice(1), v] : [...prevSpark, v];
    next[idx] = { val: v, formatted: formatWeight(v), spark };
    return { rows: next, flickerIdx: idx };
  };

  // Live: timer-driven flicker, seeded phase offset to break sync.
  useEffect(() => {
    if (paused || rows.length === 0) return;
    const prng = flickerPrngRef.current!;
    const phaseOffset = Math.floor((seedData.panelSeeds[PanelSlot.WeightsFlicker] % 350));
    let cleanup: () => void = () => {};
    const start = setTimeout(() => {
      const interval = setInterval(() => {
        setRows(prev => {
          const r = tick(prev, prng);
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
  }, [seedData, paused, rows.length]);

  // Paused: bidirectional frame stepping via snapshot history.
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
          const r = tick(next, prng);
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
  // Map raw weight in roughly [-1, 1] to bar height in [0, 1]. Scientific
  // weights with magnitudes below ~0.01 just show as flat low bars, which
  // is the desired "this row is currently small" reading.
  const W = 50;
  const H = 12;
  const n = SPARK_LEN;
  // Right-align the sparkline so newer points sit next to the value column.
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
  // ~20% are scientific-small; rest live in roughly [-1, 1].
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
    // Scientific: keep the same `±X.XXe-N` shape as the previous version.
    const exp = Math.floor(-Math.log10(a));
    const mant = a * Math.pow(10, exp);
    return `${sign}${mant.toFixed(2)}e-${exp}`;
  }
  return `${sign}${a.toFixed(4)}`;
}
