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
const K = 3;

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

type Edge = { a: number; b: number; sameCluster: boolean; color: string };
const EDGES: Edge[] = (() => {
  const seen = new Set<string>();
  const out: Edge[] = [];
  for (const d of DOTS) {
    const dists = DOTS
      .filter(o => o.id !== d.id)
      .map(o => ({ id: o.id, cluster: o.cluster, dist: Math.hypot(o.x - d.x, o.y - d.y) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, K);
    for (const n of dists) {
      const key = d.id < n.id ? `${d.id}-${n.id}` : `${n.id}-${d.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sameCluster = n.cluster === d.cluster;
      out.push({
        a: d.id,
        b: n.id,
        sameCluster,
        color: sameCluster ? CLUSTER_COLORS[d.cluster] : PALETTE.ink,
      });
    }
  }
  return out;
})();

export function KnnWeb() {
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
          <span style={{ opacity: 0.5 }}>D-256 · N={NUM_DOTS} · k=3</span>
        </div>

        <div className="absolute" style={{ top: 28, left: 0, right: 0, bottom: 0 }}>
          <div className="absolute text-[9px] font-bold" style={{ top: 4, left: 4, color: PALETTE.ink }}>
            ↑ DIM_82
          </div>
          <div className="absolute text-[9px] font-bold" style={{ bottom: 4, right: 4, color: PALETTE.ink }}>
            DIM_165 →
          </div>

          {/* k-NN web — every dot connects to its 3 nearest neighbors. Same-cluster
              edges drawn solid in cluster color; cross-cluster edges drawn faintly
              in ink dashes. Cluster topology emerges from the graph itself. */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {EDGES.map((e, i) => {
              const a = DOTS[e.a];
              const b = DOTS[e.b];
              return (
                <line
                  key={i}
                  x1={`${a.x * 100}%`}
                  y1={`${a.y * 100}%`}
                  x2={`${b.x * 100}%`}
                  y2={`${b.y * 100}%`}
                  stroke={e.color}
                  strokeOpacity={e.sameCluster ? 0.7 : 0.25}
                  strokeWidth={e.sameCluster ? 1.5 : 1}
                  strokeDasharray={e.sameCluster ? undefined : '3 3'}
                />
              );
            })}
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
                  zIndex: 2,
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
                  zIndex: 3,
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
