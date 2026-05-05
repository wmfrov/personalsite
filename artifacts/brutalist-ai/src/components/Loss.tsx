import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';

interface LossProps {
  seedData: SeedData;
  palette: Palette;
  paused?: boolean;
  stepFrame?: number;
}

interface Snapshot {
  levels: number[];
  level: number;
  prngState: number;
}

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇'];
const NUM_BLOCKS = 40;

export function Loss({ seedData, palette, paused = false, stepFrame = 0 }: LossProps) {
  // Track levels (0..6) per column so we can color-tint each glyph by value.
  const [levels, setLevels] = useState<number[]>([]);
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
    const initial: number[] = [];
    for (let i = 0; i < NUM_BLOCKS; i++) {
      if (initPrng() < 0.1) currentLevel = Math.min(BLOCKS.length - 1, currentLevel + 2);
      else if (initPrng() < 0.3) currentLevel = Math.max(0, currentLevel - 1);
      initial.push(currentLevel);
    }
    levelRef.current = currentLevel;
    setLevels(initial);
  }, [seedData]);

  const tick = (current: number[], level: number, prng: SeededPrng) => {
    if (current.length === 0) return { levels: current, level };
    let nextLevel = level;
    if (prng() < 0.1) nextLevel = Math.min(BLOCKS.length - 1, nextLevel + 3);
    else if (prng() < 0.4) nextLevel = Math.max(0, nextLevel - 1);
    return { levels: [...current.slice(1), nextLevel], level: nextLevel };
  };

  // Seeded phase offset to break tick synchrony with other panels.
  useEffect(() => {
    if (paused || levels.length === 0) return;
    const prng = animPrngRef.current!;
    const phaseOffset = Math.floor(seedData.panelSeeds[PanelSlot.LossAnim] % 250);
    let cleanup: () => void = () => {};
    const start = setTimeout(() => {
      const interval = setInterval(() => {
        setLevels(prev => {
          const r = tick(prev, levelRef.current, prng);
          levelRef.current = r.level;
          return r.levels;
        });
      }, 300);
      cleanup = () => clearInterval(interval);
    }, phaseOffset);
    return () => {
      clearTimeout(start);
      cleanup();
    };
  }, [seedData, levels.length, paused]);

  useEffect(() => {
    if (!paused || levels.length === 0 || !animPrngRef.current) return;
    const prng = animPrngRef.current;
    const delta = stepFrame - lastFrameRef.current;
    if (delta > 0) {
      setLevels(prev => {
        let s = prev;
        let lvl = levelRef.current;
        for (let i = 0; i < delta; i++) {
          historyRef.current.push({ levels: [...s], level: lvl, prngState: prng.getState() });
          const r = tick(s, lvl, prng);
          s = r.levels;
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
        setLevels(snap.levels);
      }
    }
    lastFrameRef.current = stepFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);

  // Color buckets: low loss (≤2) = accent3 (good), mid (3-4) = accent2,
  // high (≥5) = accent1 (alarm).
  const colorFor = (lvl: number) => {
    if (lvl <= 2) return palette.accent3;
    if (lvl <= 4) return palette.accent2;
    return palette.accent1;
  };

  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">LOSS</div>
      <div className="p-4 flex-1 flex flex-col justify-center" style={{ background: palette.bg }}>
        <div className="flex items-center gap-2 mb-2">
          <span
            className="font-mono text-xs font-bold px-1"
            style={{ background: palette.ink, color: palette.bg }}
          >
            L
          </span>
          <span
            className="font-mono text-xs tracking-widest border-b-2 border-dotted flex-1"
            style={{ color: palette.ink, opacity: 0.5, borderColor: palette.ink }}
          >
            ........................................
          </span>
        </div>
        <div className="font-mono text-xl whitespace-nowrap overflow-hidden font-bold tracking-[-1px]">
          {levels.map((lvl, i) => (
            <span key={i} style={{ color: colorFor(lvl) }}>
              {BLOCKS[lvl]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
