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

interface Snapshot {
  weights: string[];
  prngState: number;
  flickerIdx: number;
}

export function Weights({ seedData, palette, paused = false, stepFrame = 0 }: WeightsProps) {
  const [weights, setWeights] = useState<string[]>([]);
  const [flickerIdx, setFlickerIdx] = useState<number>(-1);
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
    setFlickerIdx(-1);
  }, [seedData]);

  const tick = (current: string[], prng: SeededPrng): { weights: string[]; flickerIdx: number } => {
    if (current.length === 0) return { weights: current, flickerIdx: -1 };
    const next = [...current];
    const idx = Math.floor(prng() * next.length);
    next[idx] = formatWeight(prng);
    return { weights: next, flickerIdx: idx };
  };

  // Live: timer-driven flicker, seeded phase offset to break sync.
  useEffect(() => {
    if (paused || weights.length === 0) return;
    const prng = flickerPrngRef.current!;
    const phaseOffset = Math.floor((seedData.panelSeeds[PanelSlot.WeightsFlicker] % 350));
    const start = setTimeout(() => {
      setWeights(prev => {
        const r = tick(prev, prng);
        setFlickerIdx(r.flickerIdx);
        return r.weights;
      });
      const interval = setInterval(() => {
        setWeights(prev => {
          const r = tick(prev, prng);
          setFlickerIdx(r.flickerIdx);
          return r.weights;
        });
      }, 400);
      cleanup = () => clearInterval(interval);
    }, phaseOffset);
    let cleanup: () => void = () => clearTimeout(start);
    return () => {
      clearTimeout(start);
      cleanup();
    };
  }, [seedData, paused, weights.length]);

  // Paused: bidirectional frame stepping via snapshot history.
  useEffect(() => {
    if (!paused || weights.length === 0 || !flickerPrngRef.current) return;
    const prng = flickerPrngRef.current;
    const delta = stepFrame - lastFrameRef.current;
    if (delta > 0) {
      setWeights(prev => {
        let next = prev;
        let lastIdx = flickerIdx;
        for (let i = 0; i < delta; i++) {
          historyRef.current.push({ weights: next, prngState: prng.getState(), flickerIdx: lastIdx });
          const r = tick(next, prng);
          next = r.weights;
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
        setWeights(snap.weights);
        setFlickerIdx(snap.flickerIdx);
      }
    }
    lastFrameRef.current = stepFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);

  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">WEIGHTS</div>
      <div
        className="p-4 flex-1 flex flex-col justify-between font-mono text-sm overflow-hidden"
        style={{ background: palette.bg }}
      >
        {weights.map((w, i) => {
          const isFlicker = i === flickerIdx;
          return (
            <div key={i} className="flex justify-between items-center py-1">
              <span
                className="px-1 font-bold"
                style={{
                  background: palette.accent1,
                  color: palette.bg,
                }}
              >
                W_{i.toString().padStart(2, '0')}
              </span>
              <span
                className="font-bold px-1"
                style={
                  isFlicker
                    ? { background: palette.ink, color: palette.bg }
                    : { color: palette.ink }
                }
              >
                {w}
              </span>
            </div>
          );
        })}
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
