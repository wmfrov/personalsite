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
const YOU_ID = 5;
const PINNED_LABELS: Record<number, string> = {
  5: 'hello world', 3: '_a', 13: '_with', 22: '##ed', 34: '_it', 49: '<eos>',
};
const PINNED_IDS = Object.keys(PINNED_LABELS).map(Number);

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

function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length <= 1) return pts.slice();
  const sorted = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (O: any, A: any, B: any) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
  const lower: any[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: any[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function Current() {
  const hulls = Array.from({ length: NUM_CLUSTERS }, (_, ci) =>
    convexHull(DOTS.filter(d => d.cluster === ci))
  );
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
          <span style={{ opacity: 0.5 }}>D-256 · N={NUM_DOTS}</span>
        </div>

        <div className="absolute" style={{ top: 28, left: 0, right: 0, bottom: 0 }}>
          <div
            className="absolute text-[9px] font-bold"
            style={{ top: 4, left: 4, color: PALETTE.ink }}
          >
            ↑ DIM_82
          </div>
          <div
            className="absolute text-[9px] font-bold"
            style={{ bottom: 4, right: 4, color: PALETTE.ink }}
          >
            DIM_165 →
          </div>

          {/* CLUSTER HULLS — the visual style being replaced */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {hulls.map((h, ci) =>
              h.length < 3 ? null : (
                <polygon
                  key={ci}
                  points={h.map(p => `${p.x * 100},${p.y * 100}`).join(' ')}
                  fill={CLUSTER_COLORS[ci]}
                  fillOpacity={0.08}
                  stroke={CLUSTER_COLORS[ci]}
                  strokeOpacity={0.5}
                  strokeWidth={0.4}
                  strokeDasharray="1 0.7"
                  vectorEffect="non-scaling-stroke"
                />
              )
            )}
          </svg>

          {DOTS.map(d => {
            const isYou = d.id === YOU_ID;
            const isPinned = PINNED_IDS.includes(d.id);
            const color = CLUSTER_COLORS[d.cluster];
            const size = isYou ? 9 : isPinned ? 7 : 5;
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
                  border: isYou ? `2px solid ${PALETTE.ink}` : 'none',
                }}
              />
            );
          })}

          {PINNED_IDS.map(id => {
            const d = DOTS.find(x => x.id === id);
            if (!d) return null;
            const isYou = d.id === YOU_ID;
            return (
              <div
                key={`l-${id}`}
                className="absolute text-[9px] font-bold whitespace-nowrap px-1"
                style={{
                  left: `${d.x * 100}%`,
                  top: `${d.y * 100}%`,
                  transform: 'translate(8px, -50%)',
                  background: isYou ? PALETTE.ink : PALETTE.bg,
                  color: isYou ? PALETTE.bg : PALETTE.ink,
                  border: `1px solid ${PALETTE.ink}`,
                }}
              >
                {PINNED_LABELS[id]}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
