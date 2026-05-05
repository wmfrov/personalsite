import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { generateProbabilityLabel } from '../lib/tokens';

interface ProbabilitiesProps {
  seedData: SeedData;
  palette: Palette;
  paused?: boolean;
  stepFrame?: number;
}

interface ProbBar {
  label: string;
  value: number;
  target: number;
}

interface Snapshot {
  bars: ProbBar[];
  prngState: number;
}

const NUM_BARS = 8;

export function Probabilities({ seedData, palette, paused = false, stepFrame = 0 }: ProbabilitiesProps) {
  const [bars, setBars] = useState<ProbBar[]>([]);
  const jitterPrngRef = useRef<SeededPrng | null>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    const initPrng = derivePrng(seedData, PanelSlot.ProbsInit);
    jitterPrngRef.current = derivePrng(seedData, PanelSlot.ProbsJitter);
    historyRef.current = [];
    lastFrameRef.current = 0;
    const newBars: ProbBar[] = [];
    // De-duped pool of inscrutable token-style labels.
    const labels = new Set<string>();
    let guard = 0;
    while (labels.size < NUM_BARS && guard < NUM_BARS * 8) {
      labels.add(generateProbabilityLabel(initPrng));
      guard++;
    }
    const labelArr = Array.from(labels).slice(0, NUM_BARS);
    while (labelArr.length < NUM_BARS) labelArr.push(generateProbabilityLabel(initPrng));
    for (let i = 0; i < NUM_BARS; i++) {
      const val = initPrng();
      newBars.push({ label: labelArr[i], value: val, target: val });
    }
    setBars(newBars);
  }, [seedData]);

  const tick = (current: ProbBar[], prng: SeededPrng): ProbBar[] => {
    if (current.length === 0) return current;
    const next = [...current];
    const numJitter = prng() > 0.5 ? 2 : 1;
    for (let i = 0; i < numJitter; i++) {
      const idx = Math.floor(prng() * next.length);
      next[idx] = { ...next[idx], target: prng() };
    }
    return next;
  };

  // Seeded phase offset prevents lockstep ticking with the other panels.
  useEffect(() => {
    if (paused || bars.length === 0) return;
    const prng = jitterPrngRef.current!;
    const phaseOffset = Math.floor(seedData.panelSeeds[PanelSlot.ProbsJitter] % 450);
    let cleanup: () => void = () => {};
    const start = setTimeout(() => {
      const interval = setInterval(() => setBars(prev => tick(prev, prng)), 500);
      cleanup = () => clearInterval(interval);
    }, phaseOffset);
    return () => {
      clearTimeout(start);
      cleanup();
    };
  }, [seedData, bars.length, paused]);

  useEffect(() => {
    if (!paused || bars.length === 0 || !jitterPrngRef.current) return;
    const prng = jitterPrngRef.current;
    const delta = stepFrame - lastFrameRef.current;
    if (delta > 0) {
      setBars(prev => {
        let next = prev;
        for (let i = 0; i < delta; i++) {
          historyRef.current.push({ bars: next, prngState: prng.getState() });
          next = tick(next, prng);
        }
        return next;
      });
    } else if (delta < 0) {
      let snap: Snapshot | undefined;
      for (let i = 0; i < -delta; i++) snap = historyRef.current.pop() ?? snap;
      if (snap) {
        prng.setState(snap.prngState);
        setBars(snap.bars);
      }
    }
    lastFrameRef.current = stepFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);

  // Rank bars by current target value to assign podium colors.
  // Top-3 get accent1/accent2/accent3 (1st/2nd/3rd); the rest stay ink.
  const rankByTarget = [...bars]
    .map((b, i) => ({ i, t: b.target }))
    .sort((a, b) => b.t - a.t);
  const rankColor = new Map<number, string>();
  if (rankByTarget[0]) rankColor.set(rankByTarget[0].i, palette.accent1);
  if (rankByTarget[1]) rankColor.set(rankByTarget[1].i, palette.accent2);
  if (rankByTarget[2]) rankColor.set(rankByTarget[2].i, palette.accent3);

  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">PROBABILITIES</div>
      <div
        className="px-3 py-2 flex-1 flex flex-col justify-between font-mono text-xs overflow-hidden"
        style={{ background: palette.bg }}
      >
        {bars.map((bar, i) => {
          const color = rankColor.get(i) ?? palette.ink;
          const rank = rankByTarget.findIndex(r => r.i === i);
          const badge = rank === 0 ? '①' : rank === 1 ? '②' : rank === 2 ? '③' : '·';
          const logit = formatLogit(bar.target);
          return (
            <div key={i} className="flex flex-col gap-0.5 leading-none">
              <div className="flex justify-between items-baseline text-[11px] gap-2">
                <span className="font-bold flex items-center gap-1 truncate" style={{ color: palette.ink }}>
                  <span style={{ color }}>{badge}</span>
                  <span className="truncate">{bar.label}</span>
                </span>
                <span className="ml-auto tabular-nums opacity-60 shrink-0" style={{ color: palette.ink }}>
                  {logit}
                </span>
                <span className="tabular-nums shrink-0" style={{ color }}>
                  {(bar.target * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex">{renderBar(bar.target, color, palette)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderBar(value: number, color: string, palette: Palette) {
  const totalBlocks = 24;
  const filledBlocks = Math.floor(value * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  return (
    <div className="font-bold tracking-[-1px] text-[11px]">
      <span style={{ color }}>{'█'.repeat(filledBlocks)}</span>
      <span style={{ color: palette.ink, opacity: 0.3 }}>{'░'.repeat(emptyBlocks)}</span>
    </div>
  );
}

// Approximate log-odds of the displayed probability. Clamped so very
// small / very large targets don't blow up to ±Infinity.
function formatLogit(p: number): string {
  const clamped = Math.max(0.001, Math.min(0.999, p));
  const l = Math.log(clamped / (1 - clamped));
  const sign = l >= 0 ? '+' : '−';
  return `${sign}${Math.abs(l).toFixed(2)}`;
}
