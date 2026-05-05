import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';

interface WeightsProps {
  seedData: SeedData;
  paused?: boolean;
  /** Current target frame. Each ±1 step advances or rewinds one tick. */
  stepFrame?: number;
}

interface Snapshot {
  weights: string[];
  prngState: number;
}

export function Weights({ seedData, paused = false, stepFrame = 0 }: WeightsProps) {
  const [weights, setWeights] = useState<string[]>([]);
  const flickerPrngRef = useRef<SeededPrng | null>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    const initPrng = derivePrng(seedData, PanelSlot.WeightsInit);
    flickerPrngRef.current = derivePrng(seedData, PanelSlot.WeightsFlicker);
    historyRef.current = [];
    lastFrameRef.current = 0;
    const initialWeights: string[] = [];
    for (let i = 0; i < 12; i++) initialWeights.push(formatWeight(initPrng));
    setWeights(initialWeights);
  }, [seedData]);

  const tick = (current: string[], prng: SeededPrng): string[] => {
    if (current.length === 0) return current;
    const next = [...current];
    const idx = Math.floor(prng() * next.length);
    next[idx] = formatWeight(prng);
    return next;
  };

  // Live mode: timer-driven flicker (no history).
  useEffect(() => {
    if (paused || weights.length === 0) return;
    const prng = flickerPrngRef.current!;
    const interval = setInterval(() => {
      setWeights(prev => tick(prev, prng));
    }, 400);
    return () => clearInterval(interval);
  }, [seedData, paused, weights.length]);

  // Paused mode: arrow-key driven step with full bidirectional history.
  useEffect(() => {
    if (!paused || weights.length === 0 || !flickerPrngRef.current) return;
    const prng = flickerPrngRef.current;
    const delta = stepFrame - lastFrameRef.current;
    if (delta > 0) {
      setWeights(prev => {
        let next = prev;
        for (let i = 0; i < delta; i++) {
          historyRef.current.push({ weights: next, prngState: prng.getState() });
          next = tick(next, prng);
        }
        return next;
      });
    } else if (delta < 0) {
      let snap: Snapshot | undefined;
      for (let i = 0; i < -delta; i++) snap = historyRef.current.pop() ?? snap;
      if (snap) {
        prng.setState(snap.prngState);
        setWeights(snap.weights);
      }
    }
    lastFrameRef.current = stepFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);

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

function formatWeight(prng: SeededPrng): string {
  const sign = prng() > 0.5 ? '+' : '-';
  const r = prng();
  if (r < 0.2) return `${sign}${(prng() * 9 + 1).toFixed(2)}e-${Math.floor(prng() * 5 + 1)}`;
  return `${sign}${prng().toFixed(4)}`;
}
