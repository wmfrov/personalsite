import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng } from '../lib/hash';

interface WeightsProps {
  seedData: SeedData;
  paused?: boolean;
}

export function Weights({ seedData, paused = false }: WeightsProps) {
  const [weights, setWeights] = useState<string[]>([]);
  const flickerPrngRef = useRef<() => number>(() => 0);

  useEffect(() => {
    const initPrng = derivePrng(seedData.seedInt, 10);
    flickerPrngRef.current = derivePrng(seedData.seedInt, 11);
    const initialWeights: string[] = [];
    for (let i = 0; i < 12; i++) {
      initialWeights.push(formatWeight(initPrng));
    }
    setWeights(initialWeights);
  }, [seedData]);

  useEffect(() => {
    if (paused || weights.length === 0) return;

    const interval = setInterval(() => {
      const prng = flickerPrngRef.current;
      setWeights(prev => {
        const next = [...prev];
        const idx = Math.floor(prng() * next.length);
        next[idx] = formatWeight(prng);
        return next;
      });
    }, 400);

    return () => clearInterval(interval);
  }, [seedData, paused, weights.length]);

  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">WEIGHTS</div>
      <div className="p-4 flex-1 flex flex-col justify-between font-mono text-sm overflow-hidden bg-cream">
        {weights.map((w, i) => (
          <div key={i} className="flex justify-between items-center py-1">
            <span className="text-ink/50">W_{i.toString().padStart(2, '0')}</span>
            <span className="font-bold">{w}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatWeight(prng: () => number): string {
  const sign = prng() > 0.5 ? '+' : '-';
  const r = prng();

  if (r < 0.2) {
    return `${sign}${(prng() * 9 + 1).toFixed(2)}e-${Math.floor(prng() * 5 + 1)}`;
  } else {
    return `${sign}${prng().toFixed(4)}`;
  }
}
