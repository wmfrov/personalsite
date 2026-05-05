// SHA-256 wrapper + Mulberry32 PRNG + seed slicing

export async function generateHash(input: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function mulberry32(seed: number) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = seed;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

export interface SeedData {
  input: string;
  hash: string;
  seedInt: number;
  prng: () => number;
  accentColor: string;
  youX: number;
  youY: number;
  /** Per-panel seeds parsed directly from non-overlapping SHA-256 slices. */
  panelSeeds: number[];
}

/** Panel slot indices into SeedData.panelSeeds. */
export const PanelSlot = {
  EmbeddingLayout: 0,
  EmbeddingAnim: 1,
  WeightsInit: 2,
  WeightsFlicker: 3,
  LossInit: 4,
  LossAnim: 5,
  ProbsInit: 6,
  ProbsJitter: 7,
  TokenStream: 8,
} as const;

/**
 * Build a fresh PRNG for one panel. Each panel slot maps to a non-overlapping
 * 5-hex-char slice of the SHA-256 hash, so randomness is fully derived from
 * the input string and stays deterministic per seed.
 */
export function derivePrng(seed: SeedData, slot: number) {
  return mulberry32(seed.panelSeeds[slot] ?? seed.seedInt);
}

export async function parseSeed(input: string): Promise<SeedData> {
  const hash = await generateHash(input);

  // 0..8   -> integer seed for the master PRNG
  const seedInt = parseInt(hash.substring(0, 8), 16);
  const prng = mulberry32(seedInt);

  // 8..10  -> accent color (PostHog red / blue / yellow)
  const accentByte = parseInt(hash.substring(8, 10), 16);
  const accents = ['#f54e00', '#1d4aff', '#f9bd2b'];
  const accentColor = accents[accentByte % 3];

  // 10..14 -> "you" dot position
  const xByte = parseInt(hash.substring(10, 12), 16);
  const yByte = parseInt(hash.substring(12, 14), 16);
  const youX = xByte / 255;
  const youY = yByte / 255;

  // 14..59 -> nine 5-hex-char panel seeds (45 chars; 5 chars reserved tail)
  const panelSeeds: number[] = [];
  const SLOT_LEN = 5;
  const NUM_SLOTS = 9;
  for (let i = 0; i < NUM_SLOTS; i++) {
    const start = 14 + i * SLOT_LEN;
    panelSeeds.push(parseInt(hash.substring(start, start + SLOT_LEN), 16));
  }

  return {
    input,
    hash,
    seedInt,
    prng,
    accentColor,
    youX,
    youY,
    panelSeeds,
  };
}
