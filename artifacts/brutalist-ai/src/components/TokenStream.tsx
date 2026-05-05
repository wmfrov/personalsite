import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng, PanelSlot, SeededPrng } from '../lib/hash';
import { generateCharGrams } from '../lib/tokens';

interface TokenStreamProps {
  seedData: SeedData;
  paused?: boolean;
  stepFrame?: number;
}

interface Snapshot {
  stream: string;
  idx: number;
}

const MAX_LEN = 220;

export function TokenStream({ seedData, paused = false, stepFrame = 0 }: TokenStreamProps) {
  const [stream, setStream] = useState<string>('');
  const tokensRef = useRef<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const idxRef = useRef(0);
  const streamRef = useRef('');
  const historyRef = useRef<Snapshot[]>([]);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    const prng: SeededPrng = derivePrng(seedData, PanelSlot.TokenStream);
    const newTokens: string[] = [];
    for (let i = 0; i < 80; i++) newTokens.push(generateCharGrams(seedData.input, prng));
    tokensRef.current = newTokens;
    setStream('');
    streamRef.current = '';
    idxRef.current = 0;
    historyRef.current = [];
    lastFrameRef.current = 0;
  }, [seedData]);

  const tickOnce = () => {
    const tokens = tokensRef.current;
    if (tokens.length === 0) return;
    let s = streamRef.current + tokens[idxRef.current] + ' ';
    if (s.length > MAX_LEN) {
      const overflow = s.length - MAX_LEN;
      const cutAt = s.indexOf(' ', overflow);
      s = cutAt === -1 ? s.slice(overflow) : s.slice(cutAt + 1);
    }
    streamRef.current = s;
    setStream(s);
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
        historyRef.current.push({ stream: streamRef.current, idx: idxRef.current });
        tickOnce();
      }
    } else if (delta < 0) {
      let snap: Snapshot | undefined;
      for (let i = 0; i < -delta; i++) snap = historyRef.current.pop() ?? snap;
      if (snap) {
        streamRef.current = snap.stream;
        idxRef.current = snap.idx;
        setStream(snap.stream);
      }
    }
    lastFrameRef.current = stepFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);

  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0 flex justify-between">
        <span>TOKEN STREAM</span>
        <span className="text-ph-red animate-pulse">● REC</span>
      </div>
      <div
        ref={containerRef}
        className="p-4 flex-1 font-mono text-sm leading-relaxed overflow-hidden break-words bg-ink text-cream"
      >
        <span className="text-ph-yellow">{`> `}</span>
        {stream}
        <span className="caret-blink">█</span>
      </div>
    </div>
  );
}
