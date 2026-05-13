import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { Palette, accentOnInk } from '../lib/palettes';
import { generateMixedToken } from '../lib/tokens';
import { useCycleStore } from '../contexts/TrainingCycleContext';

interface TokenStreamProps {
  seedData: SeedData;
  palette: Palette;
}

const AVG_TOKEN_PX = 48;
const LINE_HEIGHT_PX = 22;
const MIN_VISIBLE = 60;
const MAX_VISIBLE = 800;
const GEN_BUFFER = 800;

// Marker prefix used to detect / render the epoch-boundary divider
// alongside normal tokens. Must NOT collide with any token shape coming
// out of `generateMixedToken`.
const EPOCH_DIVIDER_PREFIX = '⟦EPOCH:';

export function TokenStream({ seedData, palette }: TokenStreamProps) {
  const [visibleTokens, setVisibleTokens] = useState<string[]>([]);
  const [maxTokens, setMaxTokens] = useState<number>(MIN_VISIBLE);
  const tokensRef = useRef<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const idxRef = useRef(0);
  const lastEpochRef = useRef(0);
  const visibleRef = useRef<string[]>([]);
  const maxTokensRef = useRef<number>(MIN_VISIBLE);

  const cycleStore = useCycleStore();

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
    lastEpochRef.current = 0;
  }, [seedData]);

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

  // One advance of the token stream. If the cycle's epoch advanced since
  // the last tick, prepend an epoch-boundary marker before the regular
  // token so the user can see "training restarted" in the stream.
  const tickOnce = (epoch: number) => {
    const tokens = tokensRef.current;
    if (tokens.length === 0) return;
    const cap = maxTokensRef.current;
    let next = visibleRef.current.slice();
    if (epoch !== lastEpochRef.current) {
      next.push(`${EPOCH_DIVIDER_PREFIX}${epoch}⟧`);
      lastEpochRef.current = epoch;
    }
    next.push(tokens[idxRef.current]);
    while (next.length > cap) next.shift();
    visibleRef.current = next;
    setVisibleTokens(next);
    idxRef.current = (idxRef.current + 1) % tokens.length;

    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (tokensRef.current.length === 0) return;
    const interval = setInterval(() => tickOnce(cycleStore.get().epoch), 120);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedData]);

  // The Token Stream box always uses palette.ink as its background (cream-on-dark
  // becomes cream-on-cream in the inverted palette). For the inverted palette,
  // the raw accent values and palette.bg are too light against that cream,
  // so substitute darker on-cream variants. Non-inverted palettes keep their
  // original colors via the short-circuit on palette.inverted.
  type TokenRole = 'default' | 'prompt' | 'divider' | 'caret' | 'a1' | 'a2' | 'a3';
  const onCream = (role: TokenRole): string => {
    if (!palette.inverted) {
      switch (role) {
        case 'default':
        case 'caret':
          return palette.bg;
        case 'prompt':
        case 'divider':
        case 'a3':
          return palette.accent3;
        case 'a1':
          return palette.accent1;
        case 'a2':
          return palette.accent2;
      }
    }
    // Inverted palette: cream background. Reuse the shared
    // `accentOnInk` deeper-accent table so this remap stays in sync with
    // every other "accent on cream ink" surface (e.g. the REC indicator
    // on the panel label, the HELLO chip on the About back).
    switch (role) {
      case 'default':
      case 'caret':
        return '#0e0e0e';
      case 'a1':
        return accentOnInk(palette, 0);
      case 'a2':
        return accentOnInk(palette, 1);
      case 'a3':
      case 'prompt':
      case 'divider':
        return accentOnInk(palette, 2);
    }
  };

  const renderToken = (tok: string, i: number) => {
    if (tok.startsWith(EPOCH_DIVIDER_PREFIX)) {
      // Pull the epoch number out of the marker for the rendered divider.
      const n = tok.slice(EPOCH_DIVIDER_PREFIX.length, -1);
      return (
        <span key={i} style={{ color: onCream('divider'), display: 'block', opacity: 0.85 }}>
          {`─── epoch ${n} ───`}
        </span>
      );
    }
    let color = onCream('default');
    if (tok.startsWith('▁')) color = onCream('a3');
    else if (tok.startsWith('##')) color = onCream('a1');
    else if (tok.startsWith('<') && tok.endsWith('>')) color = onCream('a2');
    else if (tok.startsWith('t_') || tok.startsWith('tok_')) color = onCream('a2');

    return (
      <span key={i} style={{ color }}>
        {tok}{' '}
      </span>
    );
  };

  return (
    <div className="retro-panel h-full flex flex-col min-h-0">
      <div className="retro-label shrink-0 flex justify-between">
        <span>TOKEN STREAM</span>
        <span className="animate-pulse" style={{ color: accentOnInk(palette, 0) }}>
          ● REC
        </span>
      </div>
      <div
        ref={containerRef}
        className="p-4 flex-1 font-mono text-sm leading-relaxed overflow-hidden break-words"
        style={{ background: palette.ink, color: palette.bg }}
      >
        <span style={{ color: onCream('prompt') }}>{`> `}</span>
        {visibleTokens.map(renderToken)}
        <span className="caret-blink" style={{ color: onCream('caret') }}>█</span>
      </div>
    </div>
  );
}
