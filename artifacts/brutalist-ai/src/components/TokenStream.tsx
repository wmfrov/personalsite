import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng } from '../lib/hash';
import { generateCharGrams } from '../lib/tokens';

interface TokenStreamProps {
  seedData: SeedData;
  paused?: boolean;
  stepFrame?: number;
}

const MAX_LEN = 220;

export function TokenStream({ seedData, paused = false, stepFrame = 0 }: TokenStreamProps) {
  const [stream, setStream] = useState<string>('');
  const [tokens, setTokens] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const idxRef = useRef(0);
  const streamRef = useRef('');

  useEffect(() => {
    const prng = derivePrng(seedData.seedInt, 40);
    const newTokens: string[] = [];
    for (let i = 0; i < 80; i++) {
      newTokens.push(generateCharGrams(seedData.input, prng));
    }
    setTokens(newTokens);
    setStream('');
    streamRef.current = '';
    idxRef.current = 0;
  }, [seedData]);

  const tick = () => {
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
    if (paused || tokens.length === 0) return;
    const interval = setInterval(tick, 120);
    return () => clearInterval(interval);
  }, [tokens, paused]);

  useEffect(() => {
    if (!paused || stepFrame === 0 || tokens.length === 0) return;
    tick();
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
