import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';

interface LossProps {
  seedData: SeedData;
  paused?: boolean;
  stepFrame?: number;
}

interface Snapshot {
  curve: string;
  level: number;
  prngState: number;
}

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇'];

export function Loss({ seedData, paused = false, stepFrame = 0 }: LossProps) {
  const [curve, setCurve] = useState<string>('');
  const animPrngRef = useRef<SeededPrng | null>(null);
  const levelRef = useRef(BLOCKS.length - 1);
  const historyRef = useRef<Snapshot[]>([]);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    const initPrng = derivePrng(seedData, PanelSlot.LossInit);
    animPrngRef.current = derivePrng(seedData, PanelSlot.LossAnim);
    historyRef.current = [];
    lastFrameRef.current = 0;

    let currentLevel = BLOCKS.length - 1;
    let initialCurve = '';
    for (let i = 0; i < 40; i++) {
      if (initPrng() < 0.1) currentLevel = Math.min(BLOCKS.length - 1, currentLevel + 2);
      else if (initPrng() < 0.3) currentLevel = Math.max(0, currentLevel - 1);
      initialCurve += BLOCKS[currentLevel];
    }
    levelRef.current = currentLevel;
    setCurve(initialCurve);
  }, [seedData]);

  const tick = (current: string, level: number, prng: SeededPrng) => {
    if (!current) return { curve: current, level };
    let nextLevel = level;
    if (prng() < 0.1) nextLevel = Math.min(BLOCKS.length - 1, nextLevel + 3);
    else if (prng() < 0.4) nextLevel = Math.max(0, nextLevel - 1);
    return { curve: current.substring(1) + BLOCKS[nextLevel], level: nextLevel };
  };

  // Seeded phase offset to break tick synchrony with other panels.
  useEffect(() => {
    if (paused || !curve) return;
    const prng = animPrngRef.current!;
    const phaseOffset = Math.floor(seedData.panelSeeds[PanelSlot.LossAnim] % 250);
    let cleanup: () => void = () => {};
    const start = setTimeout(() => {
      const interval = setInterval(() => {
        setCurve(prev => {
          const r = tick(prev, levelRef.current, prng);
          levelRef.current = r.level;
          return r.curve;
        });
      }, 300);
      cleanup = () => clearInterval(interval);
    }, phaseOffset);
    return () => {
      clearTimeout(start);
      cleanup();
    };
  }, [seedData, curve, paused]);

  useEffect(() => {
    if (!paused || !curve || !animPrngRef.current) return;
    const prng = animPrngRef.current;
    const delta = stepFrame - lastFrameRef.current;
    if (delta > 0) {
      setCurve(prev => {
        let s = prev;
        let lvl = levelRef.current;
        for (let i = 0; i < delta; i++) {
          historyRef.current.push({ curve: s, level: lvl, prngState: prng.getState() });
          const r = tick(s, lvl, prng);
          s = r.curve;
          lvl = r.level;
        }
        levelRef.current = lvl;
        return s;
      });
    } else if (delta < 0) {
      let snap: Snapshot | undefined;
      for (let i = 0; i < -delta; i++) snap = historyRef.current.pop() ?? snap;
      if (snap) {
        prng.setState(snap.prngState);
        levelRef.current = snap.level;
        setCurve(snap.curve);
      }
    }
    lastFrameRef.current = stepFrame;
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
