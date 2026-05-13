import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { generateProbabilityLabel } from '../lib/tokens';
import { CycleState, easeOutCubic } from '../lib/trainingCycle';
import { useCycleStore } from '../contexts/TrainingCycleContext';

interface ProbabilitiesProps {
  seedData: SeedData;
  palette: Palette;
}

interface ProbBar {
  label: string;
  value: number;
  target: number;
}

const NUM_BARS = 8;

// Targets per phase. DISPERSE: roughly uniform with some noise (model
// "forgot"). CONVERGE: spread by rank — top items climb, tail falls.
// HOLD: sharpened with a clear top-1 / top-2 chosen deterministically
// from the epoch number so each epoch settles on a different "answer".
function targetsForPhase(cycle: CycleState, prng: SeededPrng): number[] {
  const out: number[] = new Array(NUM_BARS);
  const winner = cycle.epoch % NUM_BARS;
  const runner = (cycle.epoch * 7 + 3) % NUM_BARS;

  if (cycle.phase === 'disperse') {
    for (let i = 0; i < NUM_BARS; i++) {
      out[i] = Math.max(0.02, Math.min(0.98, 1 / NUM_BARS + (prng() - 0.5) * 0.18));
    }
    return out;
  }

  const e = cycle.phase === 'hold' ? 1 : easeOutCubic(cycle.phaseProgress);
  for (let i = 0; i < NUM_BARS; i++) {
    let base: number;
    if (i === winner) base = 0.78;
    else if (i === runner) base = 0.42;
    else base = 0.06 + (prng() * 0.18);
    const uniform = 1 / NUM_BARS;
    out[i] = Math.max(0.02, Math.min(0.98, uniform + (base - uniform) * e));
  }
  return out;
}

export function Probabilities({ seedData, palette }: ProbabilitiesProps) {
  const [bars, setBars] = useState<ProbBar[]>([]);
  const jitterPrngRef = useRef<SeededPrng | null>(null);

  const cycleStore = useCycleStore();

  useEffect(() => {
    const initPrng = derivePrng(seedData, PanelSlot.ProbsInit);
    jitterPrngRef.current = derivePrng(seedData, PanelSlot.ProbsJitter);
    const newBars: ProbBar[] = [];
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

  // Phase-offset interval reads the shared cycle each tick.
  useEffect(() => {
    if (bars.length === 0) return;
    const prng = jitterPrngRef.current!;
    const phaseOffset = Math.floor(seedData.panelSeeds[PanelSlot.ProbsJitter] % 450);
    let cleanup: () => void = () => {};
    const start = setTimeout(() => {
      const interval = setInterval(() => {
        const cycle = cycleStore.get();
        setBars(prev => {
          if (prev.length === 0) return prev;
          const targets = targetsForPhase(cycle, prng);
          return prev.map((b, i) => ({ ...b, target: targets[i] }));
        });
      }, 500);
      cleanup = () => clearInterval(interval);
    }, phaseOffset);
    return () => {
      clearTimeout(start);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedData, bars.length]);

  const rankByTarget = [...bars]
    .map((b, i) => ({ i, t: b.target }))
    .sort((a, b) => b.t - a.t);
  const rankColor = new Map<number, string>();
  if (rankByTarget[0]) rankColor.set(rankByTarget[0].i, palette.accent1);
  if (rankByTarget[1]) rankColor.set(rankByTarget[1].i, palette.accent2);
  if (rankByTarget[2]) rankColor.set(rankByTarget[2].i, palette.accent3);

  return (
    <div className="retro-panel h-full flex flex-col min-h-0">
      <div className="retro-label shrink-0">PROBABILITIES</div>
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

function formatLogit(p: number): string {
  const clamped = Math.max(0.001, Math.min(0.999, p));
  const l = Math.log(clamped / (1 - clamped));
  const sign = l >= 0 ? '+' : '−';
  return `${sign}${Math.abs(l).toFixed(2)}`;
}
