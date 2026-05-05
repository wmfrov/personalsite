const PALETTE = { bg: '#eeefe9', ink: '#0a0a0a', a1: '#3066be', a2: '#d62246', a3: '#3a8c5f' };
const NUM_DOTS = 60;
const NUM_CLUSTERS = 4;
const CLUSTER_CENTERS = [
  { x: 0.27, y: 0.30 },
  { x: 0.73, y: 0.30 },
  { x: 0.30, y: 0.72 },
  { x: 0.72, y: 0.70 },
];
const CLUSTER_COLORS = [PALETTE.ink, PALETTE.a1, PALETTE.a2, PALETTE.a3];
const ACCENT = '#ff7a00';
const YOU_ID = 5;
const PINNED_LABELS: Record<number, string> = {
  5: 'hello world', 3: '_a', 13: '_with', 22: '##ed', 34: '_it', 49: '<eos>',
};
const PINNED_IDS = Object.keys(PINNED_LABELS).map(Number);
const K_NN = 3;
const ATTENTION_WEIGHTS = [
  { id: 13, w: 0.42 },
  { id: 22, w: 0.31 },
  { id: 34, w: 0.18 },
  { id: 7, w: 0.06 },
  { id: 49, w: 0.03 },
];

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Dot = { id: number; x: number; y: number; cluster: number };
const DOTS: Dot[] = (() => {
  const r = rng(7);
  return Array.from({ length: NUM_DOTS }, (_, i) => {
    const cluster = i % NUM_CLUSTERS;
    const c = CLUSTER_CENTERS[cluster];
    const radius = 0.06 + r() * 0.10;
    const angle = r() * Math.PI * 2;
    return { id: i, x: c.x + Math.cos(angle) * radius, y: c.y + Math.sin(angle) * radius, cluster };
  });
})();

const KNN_EDGES: { a: number; b: number }[] = (() => {
  const seen = new Set<string>();
  const out: { a: number; b: number }[] = [];
  for (const d of DOTS) {
    const dists = DOTS
      .filter(o => o.id !== d.id)
      .map(o => ({ id: o.id, dist: Math.hypot(o.x - d.x, o.y - d.y) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, K_NN);
    for (const n of dists) {
      const key = d.id < n.id ? `${d.id}-${n.id}` : `${n.id}-${d.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: d.id, b: n.id });
    }
  }
  return out;
})();

export function Attention() {
  const you = DOTS[YOU_ID];
  return (
    <div
      className="min-h-screen w-screen flex items-center justify-center font-mono"
      style={{ background: '#1a1a1a' }}
    >
      <div
        className="relative"
        style={{
          width: 488,
          height: 508,
          background: PALETTE.bg,
          border: `4px solid ${PALETTE.ink}`,
          boxShadow: `6px 6px 0 0 ${PALETTE.ink}`,
        }}
      >
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 text-xs font-bold"
          style={{ height: 28, background: PALETTE.ink, color: PALETTE.bg }}
        >
          <span>EMBEDDING SPACE</span>
          <span style={{ opacity: 0.5 }}>D-256 · N={NUM_DOTS} · ATTN→TOP-5</span>
        </div>

        <div className="absolute" style={{ top: 28, left: 0, right: 0, bottom: 0 }}>
          <div className="absolute text-[9px] font-bold" style={{ top: 4, left: 4, color: PALETTE.ink }}>
            ↑ DIM_82
          </div>
          <div className="absolute text-[9px] font-bold" style={{ bottom: 4, right: 4, color: PALETTE.ink }}>
            DIM_165 →
          </div>

          {/* Quiet k-NN base layer — cluster topology you can read but doesn't
              shout. Then bold attention edges from "you" to its top predicted
              tokens, weighted by probability. Ties this panel to Probabilities. */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {KNN_EDGES.map((e, i) => {
              const a = DOTS[e.a];
              const b = DOTS[e.b];
              return (
                <line
                  key={`k-${i}`}
                  x1={`${a.x * 100}%`}
                  y1={`${a.y * 100}%`}
                  x2={`${b.x * 100}%`}
                  y2={`${b.y * 100}%`}
                  stroke={PALETTE.ink}
                  strokeOpacity={0.18}
                  strokeWidth={0.8}
                />
              );
            })}
            {ATTENTION_WEIGHTS.map((aw, i) => {
              const t = DOTS[aw.id];
              const w = 1 + aw.w * 7;
              return (
                <g key={`a-${i}`}>
                  <line
                    x1={`${you.x * 100}%`}
                    y1={`${you.y * 100}%`}
                    x2={`${t.x * 100}%`}
                    y2={`${t.y * 100}%`}
                    stroke={PALETTE.ink}
                    strokeOpacity={1}
                    strokeWidth={w + 2}
                  />
                  <line
                    x1={`${you.x * 100}%`}
                    y1={`${you.y * 100}%`}
                    x2={`${t.x * 100}%`}
                    y2={`${t.y * 100}%`}
                    stroke={ACCENT}
                    strokeOpacity={0.85 + aw.w * 0.15}
                    strokeWidth={w}
                  />
                </g>
              );
            })}
          </svg>

          {DOTS.map(d => {
            const isYou = d.id === YOU_ID;
            const isPinned = PINNED_IDS.includes(d.id);
            const isAttended = ATTENTION_WEIGHTS.some(a => a.id === d.id);
            const color = CLUSTER_COLORS[d.cluster];
            const size = isYou ? 11 : isAttended ? 9 : isPinned ? 7 : 5;
            return (
              <div
                key={d.id}
                className="absolute"
                style={{
                  left: `${d.x * 100}%`,
                  top: `${d.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: size,
                  height: size,
                  background: color,
                  border: isYou ? `2px solid ${ACCENT}` : isAttended ? `2px solid ${PALETTE.ink}` : 'none',
                  zIndex: 2,
                }}
              />
            );
          })}

          {PINNED_IDS.map(id => {
            const d = DOTS.find(x => x.id === id);
            if (!d) return null;
            const isYou = d.id === YOU_ID;
            const aw = ATTENTION_WEIGHTS.find(a => a.id === id);
            return (
              <div
                key={`l-${id}`}
                className="absolute text-[9px] font-bold whitespace-nowrap px-1"
                style={{
                  left: `${d.x * 100}%`,
                  top: `${d.y * 100}%`,
                  transform: 'translate(8px, -50%)',
                  background: isYou ? PALETTE.ink : aw ? ACCENT : PALETTE.bg,
                  color: isYou || aw ? PALETTE.bg : PALETTE.ink,
                  border: `1px solid ${PALETTE.ink}`,
                  zIndex: 3,
                }}
              >
                {PINNED_LABELS[id]}{aw ? ` ${(aw.w * 100).toFixed(0)}%` : ''}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
