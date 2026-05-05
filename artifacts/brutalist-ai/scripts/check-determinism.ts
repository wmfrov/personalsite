// Deterministic regression check for the seed pipeline. Run with:
//   pnpm --filter @workspace/brutalist-ai run check:determinism
// Exits non-zero if the same input ever produces different panel seeds,
// accent color, or "you" position across two parses.

import { parseSeed } from '../src/lib/hash';

const FIXTURES = ['hello world', 'PostHog', 'brutalism', '', '🎨 unicode 测试', 'a'.repeat(200)];

async function run() {
  let failed = 0;

  for (const input of FIXTURES) {
    const a = await parseSeed(input);
    const b = await parseSeed(input);

    const same =
      a.hash === b.hash &&
      a.seedInt === b.seedInt &&
      a.accentColor === b.accentColor &&
      a.youX === b.youX &&
      a.youY === b.youY &&
      a.panelSeeds.length === b.panelSeeds.length &&
      a.panelSeeds.every((s, i) => s === b.panelSeeds[i]);

    if (!same) {
      console.error(`FAIL: ${JSON.stringify(input)} produced non-deterministic output`);
      failed++;
    } else {
      console.log(`OK   ${JSON.stringify(input).padEnd(30)} hash=${a.hash.substring(0, 8)} accent=${a.accentColor}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed}/${FIXTURES.length} fixtures failed`);
    process.exit(1);
  }
  console.log(`\nAll ${FIXTURES.length} fixtures deterministic ✓`);
}

run();
