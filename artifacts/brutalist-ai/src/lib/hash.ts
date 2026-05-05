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
}

// Each panel gets its own PRNG seeded from a different slice of the hash so
// runtime randomness stays deterministic per seed and panel ordering does not
// leak into other panels' streams. The remainder of the hash beyond the first
// 14 chars feeds these derived seeds.
export function derivePrng(seedInt: number, offset: number) {
  // Mix the base seed with a per-panel offset so each panel's stream is
  // distinct but still fully derived from the input hash.
  const mixed = (seedInt ^ Math.imul(offset + 1, 0x9E3779B1)) | 0;
  return mulberry32(mixed);
}

export async function parseSeed(input: string): Promise<SeedData> {
  const hash = await generateHash(input);

  // First 8 chars -> integer seed for PRNG
  const seedInt = parseInt(hash.substring(0, 8), 16);
  const prng = mulberry32(seedInt);

  // Next 2 chars -> accent color (mod 3)
  const accentByte = parseInt(hash.substring(8, 10), 16);
  const accents = ['#f54e00', '#1d4aff', '#f9bd2b']; // red, blue, yellow
  const accentColor = accents[accentByte % 3];

  // Next 4 chars -> position of "you" dot (split into x and y bytes)
  const xByte = parseInt(hash.substring(10, 12), 16);
  const yByte = parseInt(hash.substring(12, 14), 16);

  const youX = xByte / 255; // 0.0 to 1.0
  const youY = yByte / 255; // 0.0 to 1.0

  return {
    input,
    hash,
    seedInt,
    prng,
    accentColor,
    youX,
    youY,
  };
}
