import { SeedData } from './hash';

const defaultTokenFragments = [
  '▁the', '▁and', 'tion', '▁you', '##ing', '<eos>', '▁is', '▁to', '▁of', '▁a', '▁in', '▁that', '##s', '##ly', '##ed', '▁it', '##er', '▁for', '▁on', '▁with', '▁as', '##ment', '##al', '##ic', '▁be', '▁this', '▁was'
];

// Curated BPE-style vocab — word-piece starters (▁), suffixes (##), bare
// stems, and a small specials pool. Used by TokenStream so the rendered
// stream looks like real tokenizer output rather than just chargrams of
// the user's input.
const BPE_STARTERS = [
  '▁the', '▁and', '▁of', '▁to', '▁a', '▁in', '▁is', '▁it', '▁for', '▁on',
  '▁with', '▁as', '▁be', '▁this', '▁was', '▁are', '▁from', '▁that', '▁by',
  '▁we', '▁they', '▁you', '▁i', '▁he', '▁she', '▁not', '▁but', '▁or',
  '▁if', '▁when', '▁all', '▁one', '▁two', '▁model', '▁token', '▁layer',
  '▁vector', '▁gradient', '▁loss', '▁embed', '▁head', '▁batch', '▁logit',
  '▁learn', '▁train', '▁eval', '▁forward', '▁back',
];
const BPE_SUFFIXES = [
  '##ing', '##ed', '##ly', '##s', '##er', '##est', '##ment', '##al', '##ic',
  '##ous', '##ive', '##ity', '##ate', '##ize', '##able', '##ful', '##less',
  '##ness', '##tion', '##ization', '##ify', '##ish', '##ant', '##ence',
  '##ance', '##ity', '##ory', '##ary',
];
const BPE_STEMS = [
  'tion', 'ment', 'able', 'tive', 'ence', 'ance', 'ical', 'ural', 'pres',
  'pose', 'pute', 'gen', 'syn', 'log', 'graph', 'meta', 'proto', 'micro',
  'macro', 'sub', 'super', 'inter', 'trans', 'multi', 'poly', 'mono',
  'auto', 'self',
];
const SPECIALS = [
  '<bos>', '<eos>', '<pad>', '<unk>', '<mask>', '<sep>', '<cls>', '<s>',
  '</s>', '<bot>', '<usr>', '<sys>',
];

/**
 * Pick a token from one of three pools, weighted to match the brief:
 *  ~25% chargram of the user's input,
 *  ~50% from the curated BPE vocab,
 *  ~25% specials / numeric / hex pseudo-tokens.
 *
 * Token marker prefixes (▁ / ## / <…>) are preserved so downstream
 * syntax-coloring (TokenStream) keeps working.
 */
export function generateMixedToken(input: string, prng: () => number): string {
  const r = prng();
  if (r < 0.25) {
    const cg = generateCharGrams(input, prng);
    // Roughly half the chargrams already get '##' from generateCharGrams;
    // randomize the marker for variety.
    const m = prng();
    if (m < 0.4) return cg; // keep '##' marker
    if (m < 0.7) return '▁' + cg.replace(/^##/, '');
    return cg.replace(/^##/, '');
  }
  if (r < 0.75) {
    const m = prng();
    if (m < 0.5) return BPE_STARTERS[Math.floor(prng() * BPE_STARTERS.length)];
    if (m < 0.8) return BPE_SUFFIXES[Math.floor(prng() * BPE_SUFFIXES.length)];
    return BPE_STEMS[Math.floor(prng() * BPE_STEMS.length)];
  }
  // Specials / numeric / hex pseudo-tokens.
  const m = prng();
  if (m < 0.45) return SPECIALS[Math.floor(prng() * SPECIALS.length)];
  if (m < 0.7) {
    const id = Math.floor(prng() * 50000);
    return `t_${id}`;
  }
  if (m < 0.9) {
    const hex = Math.floor(prng() * 65536).toString(16).padStart(4, '0');
    return `<unk_0x${hex}>`;
  }
  const hex = Math.floor(prng() * 65536).toString(16).padStart(4, '0');
  return `▁0x${hex}`;
}

/**
 * Pool used by the Probabilities panel. Picks an inscrutable token-style
 * label rather than the old joke `P(coffee)` set. Mix of word-pieces,
 * specials, numeric tok IDs, and hex pseudo-IDs.
 */
export function generateProbabilityLabel(prng: () => number): string {
  const r = prng();
  if (r < 0.35) {
    // Word-piece (▁ starter or ## suffix or bare stem).
    const m = prng();
    if (m < 0.45) return BPE_STARTERS[Math.floor(prng() * BPE_STARTERS.length)];
    if (m < 0.8) return BPE_SUFFIXES[Math.floor(prng() * BPE_SUFFIXES.length)];
    return BPE_STEMS[Math.floor(prng() * BPE_STEMS.length)];
  }
  if (r < 0.55) return SPECIALS[Math.floor(prng() * SPECIALS.length)];
  if (r < 0.8) {
    const id = Math.floor(prng() * 50000);
    return `tok_${id}`;
  }
  const hex = Math.floor(prng() * 65536).toString(16).padStart(4, '0');
  return `0x${hex}`;
}

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
