import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng } from '../lib/hash';

interface ProbabilitiesProps {
  seedData: SeedData;
  paused?: boolean;
}

interface ProbBar {
  label: string;
  value: number;
  target: number;
}

const FAKE_LABELS = ['P(refactor)', 'P(ship)', 'P(revert)', 'P(debug)', 'P(coffee)', 'P(build)', 'P(deploy)', 'P(panic)'];

export function Probabilities({ seedData, paused = false }: ProbabilitiesProps) {
  const [bars, setBars] = useState<ProbBar[]>([]);
  const jitterPrngRef = useRef<() => number>(() => 0);

  useEffect(() => {
    const initPrng = derivePrng(seedData.seedInt, 30);
    jitterPrngRef.current = derivePrng(seedData.seedInt, 31);
    const newBars: ProbBar[] = [];

    // Pick 5 labels deterministically (Fisher–Yates with seeded prng)
    const pool = [...FAKE_LABELS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(initPrng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const labels = pool.slice(0, 5);

    for (let i = 0; i < 5; i++) {
      const val = initPrng();
      newBars.push({
        label: labels[i],
        value: val,
        target: val,
      });
    }

    setBars(newBars);
  }, [seedData]);

  useEffect(() => {
    if (paused || bars.length === 0) return;

    const interval = setInterval(() => {
      const prng = jitterPrngRef.current;
      setBars(prev => {
        const next = [...prev];
        const numJitter = prng() > 0.5 ? 2 : 1;
        for (let i = 0; i < numJitter; i++) {
          const idx = Math.floor(prng() * next.length);
          next[idx] = {
            ...next[idx],
            target: prng(),
          };
        }
        return next;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [bars.length, paused]);

  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">PROBABILITIES</div>
      <div className="p-4 flex-1 flex flex-col justify-between font-mono text-sm bg-cream">
        {bars.map((bar, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="font-bold">{bar.label}</span>
              <span>{(bar.target * 100).toFixed(1)}%</span>
            </div>
            <div className="flex">
              {renderBar(bar.target)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderBar(value: number) {
  const totalBlocks = 20;
  const filledBlocks = Math.floor(value * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;

  return (
    <div className="text-ph-blue font-bold tracking-[-1px]">
      {'█'.repeat(filledBlocks)}
      {'░'.repeat(emptyBlocks)}
    </div>
  );
}
