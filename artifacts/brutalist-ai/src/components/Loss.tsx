import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng } from '../lib/hash';

interface LossProps {
  seedData: SeedData;
  paused?: boolean;
  stepFrame?: number;
}

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇'];

export function Loss({ seedData, paused = false, stepFrame = 0 }: LossProps) {
  const [curve, setCurve] = useState<string>('');
  const animPrngRef = useRef<() => number>(() => 0);
  const levelRef = useRef(BLOCKS.length - 1);

  useEffect(() => {
    const initPrng = derivePrng(seedData.seedInt, 20);
    animPrngRef.current = derivePrng(seedData.seedInt, 21);
    let currentLevel = BLOCKS.length - 1;
    let initialCurve = '';

    for (let i = 0; i < 40; i++) {
      if (initPrng() < 0.1) {
        currentLevel = Math.min(BLOCKS.length - 1, currentLevel + 2);
      } else if (initPrng() < 0.3) {
        currentLevel = Math.max(0, currentLevel - 1);
      }
      initialCurve += BLOCKS[currentLevel];
    }

    levelRef.current = currentLevel;
    setCurve(initialCurve);
  }, [seedData]);

  const tick = () => {
    const prng = animPrngRef.current;
    setCurve(prev => {
      if (!prev) return prev;
      let nextLevel = levelRef.current;
      if (prng() < 0.1) {
        nextLevel = Math.min(BLOCKS.length - 1, nextLevel + 3);
      } else if (prng() < 0.4) {
        nextLevel = Math.max(0, nextLevel - 1);
      }
      levelRef.current = nextLevel;
      return prev.substring(1) + BLOCKS[nextLevel];
    });
  };

  useEffect(() => {
    if (paused || !curve) return;
    const interval = setInterval(tick, 300);
    return () => clearInterval(interval);
  }, [curve, paused]);

  useEffect(() => {
    if (!paused || stepFrame === 0 || !curve) return;
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);

  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">LOSS</div>
      <div className="p-4 flex-1 flex flex-col justify-center bg-cream">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-xs font-bold bg-ink text-cream px-1">L</span>
          <span className="font-mono text-xs text-ink/50 tracking-widest border-b-2 border-ink border-dotted flex-1">........................................</span>
        </div>
        <div className="font-mono text-xl whitespace-nowrap overflow-hidden text-ph-red font-bold tracking-[-1px]">
          {curve}
        </div>
      </div>
    </div>
  );
}
