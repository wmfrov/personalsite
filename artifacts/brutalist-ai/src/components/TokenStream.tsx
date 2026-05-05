import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { generateCharGrams } from '../lib/tokens';

interface TokenStreamProps {
  seedData: SeedData;
  palette: Palette;
  paused?: boolean;
  stepFrame?: number;
}

interface Snapshot {
  tokens: string[];
  idx: number;
}

const MAX_TOKENS = 60;

export function TokenStream({ seedData, palette, paused = false, stepFrame = 0 }: TokenStreamProps) {
  const [visibleTokens, setVisibleTokens] = useState<string[]>([]);
  const tokensRef = useRef<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const idxRef = useRef(0);
  const visibleRef = useRef<string[]>([]);
  const historyRef = useRef<Snapshot[]>([]);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    const prng: SeededPrng = derivePrng(seedData, PanelSlot.TokenStream);
    const newTokens: string[] = [];
    // Mix in BPE-ish markers (~30% leading "▁"), occasional "##" subwords
    // (~10%), and a few "<...>" specials so syntax coloring has real targets.
    for (let i = 0; i < 80; i++) {
      let t = generateCharGrams(seedData.input, prng);
      const r = prng();
      if (r < 0.3) t = '▁' + t;
      else if (r < 0.4) t = '##' + t;
      else if (r < 0.43) t = `<${t.toUpperCase().slice(0, 4)}>`;
      newTokens.push(t);
    }
    tokensRef.current = newTokens;
    setVisibleTokens([]);
    visibleRef.current = [];
    idxRef.current = 0;
    historyRef.current = [];
    lastFrameRef.current = 0;
  }, [seedData]);

  const tickOnce = () => {
    const tokens = tokensRef.current;
    if (tokens.length === 0) return;
    const next = [...visibleRef.current, tokens[idxRef.current]];
    while (next.length > MAX_TOKENS) next.shift();
    visibleRef.current = next;
    setVisibleTokens(next);
    idxRef.current = (idxRef.current + 1) % tokens.length;

    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (paused || tokensRef.current.length === 0) return;
    const interval = setInterval(tickOnce, 120);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedData, paused]);

  useEffect(() => {
    if (!paused || tokensRef.current.length === 0) return;
    const delta = stepFrame - lastFrameRef.current;
    if (delta > 0) {
      for (let i = 0; i < delta; i++) {
        historyRef.current.push({ tokens: [...visibleRef.current], idx: idxRef.current });
        tickOnce();
      }
    } else if (delta < 0) {
      let snap: Snapshot | undefined;
      for (let i = 0; i < -delta; i++) snap = historyRef.current.pop() ?? snap;
      if (snap) {
        visibleRef.current = snap.tokens;
        idxRef.current = snap.idx;
        setVisibleTokens(snap.tokens);
      }
    }
    lastFrameRef.current = stepFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);

  // Render each token in palette-driven color based on its marker class.
  const renderToken = (tok: string, i: number) => {
    let color = palette.bg; // default = readable on dark bg
    if (tok.startsWith('▁')) color = palette.accent3;        // word-piece start
    else if (tok.startsWith('##')) color = palette.accent1;  // subword
    else if (tok.startsWith('<') && tok.endsWith('>')) color = palette.accent2; // special

    return (
      <span key={i} style={{ color }}>
        {tok}{' '}
      </span>
    );
  };

  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0 flex justify-between">
        <span>TOKEN STREAM</span>
        <span
          className={paused ? '' : 'animate-pulse'}
          style={{ color: palette.accent1 }}
        >
          ● REC
        </span>
      </div>
      <div
        ref={containerRef}
        className="p-4 flex-1 font-mono text-sm leading-relaxed overflow-hidden break-words"
        style={{ background: palette.ink, color: palette.bg }}
      >
        <span style={{ color: palette.accent3 }}>{`> `}</span>
        {visibleTokens.map(renderToken)}
        <span className={paused ? '' : 'caret-blink'} style={{ color: palette.bg }}>█</span>
      </div>
    </div>
  );
}
