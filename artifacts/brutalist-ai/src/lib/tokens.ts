import { SeedData } from './hash';

const defaultTokenFragments = [
  '▁the', '▁and', 'tion', '▁you', '##ing', '<eos>', '▁is', '▁to', '▁of', '▁a', '▁in', '▁that', '##s', '##ly', '##ed', '▁it', '##er', '▁for', '▁on', '▁with', '▁as', '##ment', '##al', '##ic', '▁be', '▁this', '▁was'
];

export function generateEmbeddingTokens(count: number, prng: () => number): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = prng();
    const idx = Math.floor(r * defaultTokenFragments.length);
    tokens.push(defaultTokenFragments[idx]);
  }
  return tokens;
}

export function generateCharGrams(input: string, prng: () => number): string {
  // If input is very short, fallback to fake fragments
  if (input.length < 3) {
    return defaultTokenFragments[Math.floor(prng() * defaultTokenFragments.length)];
  }
  
  // Pick random 2-3 char sequence from input
  const len = prng() > 0.5 ? 2 : 3;
  const maxStart = input.length - len;
  if (maxStart <= 0) return input;
  
  const start = Math.floor(prng() * (maxStart + 1));
  return '##' + input.substring(start, start + len).toLowerCase();
}
