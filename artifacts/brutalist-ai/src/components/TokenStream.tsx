import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng } from '../lib/hash';
import { generateCharGrams } from '../lib/tokens';

interface TokenStreamProps {
  seedData: SeedData;
  paused?: boolean;
}

const MAX_LEN = 220;

export function TokenStream({ seedData, paused = false }: TokenStreamProps) {
  const [stream, setStream] = useState<string>('');
  const [tokens, setTokens] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prng = derivePrng(seedData.seedInt, 40);
    const newTokens: string[] = [];
    for (let i = 0; i < 80; i++) {
      newTokens.push(generateCharGrams(seedData.input, prng));
    }
    setTokens(newTokens);
    setStream('');
  }, [seedData]);

  useEffect(() => {
    if (paused || tokens.length === 0) return;

    let currentIdx = 0;
    let currentStream = '';

    const interval = setInterval(() => {
      currentStream += tokens[currentIdx] + ' ';

      // Sliding window: drop tokens off the front so the stream loops
      // seamlessly without a visible reset.
      if (currentStream.length > MAX_LEN) {
        const overflow = currentStream.length - MAX_LEN;
        const cutAt = currentStream.indexOf(' ', overflow);
        currentStream =
          cutAt === -1 ? currentStream.slice(overflow) : currentStream.slice(cutAt + 1);
      }

      setStream(currentStream);

      currentIdx = (currentIdx + 1) % tokens.length;

      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }, 120);

    return () => clearInterval(interval);
  }, [tokens, paused]);

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
