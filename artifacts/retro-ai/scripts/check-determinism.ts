// Deterministic regression check for the seed pipeline. Run with:
//   pnpm --filter @workspace/retro-ai run check:determinism
// Exits non-zero if the same input ever produces different panel seeds,
// accent index, or "you" position across two parses, OR if applying any
// palette to a seed produces a different resolved accent color across runs.

import { parseSeed } from '../src/lib/hash';
import { PALETTES, pickAccent } from '../src/lib/palettes';

const FIXTURES = ['hello world', 'PostHog', 'retro', '', '🎨 unicode 测试', 'a'.repeat(200)];

// Sample a handful of palettes (cover the spectrum: light, dark, mono).
const SAMPLE_PALETTE_IDS = ['plotter', 'riso', 'lab', 'mono', 'inverted'];

async function run() {
  let failed = 0;

  for (const input of FIXTURES) {
    const a = await parseSeed(input);
    const b = await parseSeed(input);

    const sameSeed =
      a.hash === b.hash &&
      a.seedInt === b.seedInt &&
      a.accentIndex === b.accentIndex &&
      a.youX === b.youX &&
      a.youY === b.youY &&
      a.panelSeeds.length === b.panelSeeds.length &&
      a.panelSeeds.every((s, i) => s === b.panelSeeds[i]);

    if (!sameSeed) {
      console.error(`FAIL: ${JSON.stringify(input)} produced non-deterministic seed output`);
      failed++;
      continue;
    }

    // Per (seed, palette) the resolved accent must also be stable + match
    // what a fresh resolution against the same palette would produce.
    let palettesOk = true;
    for (const palId of SAMPLE_PALETTE_IDS) {
      const palette = PALETTES.find(p => p.id === palId)!;
      const c1 = pickAccent(palette, a.accentIndex);
      const c2 = pickAccent(palette, b.accentIndex);
      if (c1 !== c2) {
        console.error(`FAIL: ${JSON.stringify(input)} × ${palId} resolved to different accents`);
        palettesOk = false;
      }
    }
    if (!palettesOk) {
      failed++;
      continue;
    }

    const sampleAccents = SAMPLE_PALETTE_IDS
      .map(id => `${id}=${pickAccent(PALETTES.find(p => p.id === id)!, a.accentIndex)}`)
      .join(' ');
    console.log(`OK   ${JSON.stringify(input).padEnd(30)} hash=${a.hash.substring(0, 8)} accent[${a.accentIndex}]  ${sampleAccents}`);
  }

  if (failed > 0) {
    console.error(`\n${failed}/${FIXTURES.length} fixtures failed`);
    process.exit(1);
  }
  console.log(`\nAll ${FIXTURES.length} fixtures × ${SAMPLE_PALETTE_IDS.length} palettes deterministic ✓`);
}

run();
