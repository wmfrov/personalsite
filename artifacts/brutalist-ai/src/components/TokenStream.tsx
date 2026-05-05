import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette } from '../lib/palettes';
import { generateMixedToken } from '../lib/tokens';

interface TokenStreamProps {
  seedData: SeedData;
  palette: Palette;
  paused?: boolean;
  stepFrame?: number;
}

interface Snapshot {
  tokens: string[];
  idx: number;
  /** Capture the visible-token cap at snapshot time so paused replay
   * stays bit-identical even if the container is resized between
   * stepping operations. */
  maxTokens: number;
}

// Conservative average pixel cost per rendered token (incl. trailing
// space). Used to size the visible-token cap from the container.
const AVG_TOKEN_PX = 48;
// Tailwind text-sm × leading-relaxed.
const LINE_HEIGHT_PX = 22;
const MIN_VISIBLE = 60;
const MAX_VISIBLE = 800;
// Generation buffer is large so the stream doesn't visibly loop within
// a normal session.
const GEN_BUFFER = 800;

export function TokenStream({ seedData, palette, paused = false, stepFrame = 0 }: TokenStreamProps) {
  const [visibleTokens, setVisibleTokens] = useState<string[]>([]);
  const [maxTokens, setMaxTokens] = useState<number>(MIN_VISIBLE);
  const tokensRef = useRef<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const idxRef = useRef(0);
  const visibleRef = useRef<string[]>([]);
  const historyRef = useRef<Snapshot[]>([]);
  const lastFrameRef = useRef(0);
  const maxTokensRef = useRef<number>(MIN_VISIBLE);

  useEffect(() => {
    maxTokensRef.current = maxTokens;
  }, [maxTokens]);

  useEffect(() => {
    const prng: SeededPrng = derivePrng(seedData, PanelSlot.TokenStream);
    const newTokens: string[] = [];
    for (let i = 0; i < GEN_BUFFER; i++) {
      newTokens.push(generateMixedToken(seedData.input, prng));
    }
    tokensRef.current = newTokens;
    setVisibleTokens([]);
    visibleRef.current = [];
    idxRef.current = 0;
    historyRef.current = [];
    lastFrameRef.current = 0;
  }, [seedData]);

  // Size the visible-token cap from the actual container size so the box
  // fills its space on a wide viewport instead of stopping at 60.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width;
        const h = e.contentRect.height;
        const lines = Math.max(1, Math.floor(h / LINE_HEIGHT_PX));
        const perLine = Math.max(4, Math.floor(w / AVG_TOKEN_PX));
        const cap = Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, lines * perLine));
        setMaxTokens(prev => (prev === cap ? prev : cap));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tickOnce = () => {
    const tokens = tokensRef.current;
    if (tokens.length === 0) return;
    const next = [...visibleRef.current, tokens[idxRef.current]];
    const cap = maxTokensRef.current;
    while (next.length > cap) next.shift();
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
        historyRef.current.push({
          tokens: [...visibleRef.current],
          idx: idxRef.current,
          maxTokens: maxTokensRef.current,
        });
        tickOnce();
      }
    } else if (delta < 0) {
      let snap: Snapshot | undefined;
      for (let i = 0; i < -delta; i++) snap = historyRef.current.pop() ?? snap;
      if (snap) {
        visibleRef.current = snap.tokens;
        idxRef.current = snap.idx;
        maxTokensRef.current = snap.maxTokens;
        setMaxTokens(snap.maxTokens);
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
    else if (tok.startsWith('t_') || tok.startsWith('tok_')) color = palette.accent2; // tok ID

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
