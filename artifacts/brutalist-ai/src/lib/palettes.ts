export interface Palette {
  id: string;
  name: string;
  bg: string;
  ink: string;
  accent1: string;
  accent2: string;
  accent3: string;
  inverted?: boolean;
}

export const PALETTES: Palette[] = [
  { id: 'plotter',      name: 'PLOTTER',      bg: '#eeefe9', ink: '#0a0a0a', accent1: '#3066be', accent2: '#d62246', accent3: '#3a8c5f' },
  { id: 'riso',         name: 'RISOGRAPH',    bg: '#f1ece1', ink: '#111111', accent1: '#ff5a36', accent2: '#2c5fbf', accent3: '#f2c14e' },
  { id: 'newsprint',    name: 'NEWSPRINT',    bg: '#f4f0e6', ink: '#1a1a1a', accent1: '#b81d24', accent2: '#1f3a93', accent3: '#c9a227' },
  { id: 'phosphor',     name: 'PHOSPHOR',     bg: '#ece8df', ink: '#0c0c0c', accent1: '#ff6b00', accent2: '#ffd166', accent3: '#7c3aed' },
  { id: 'lab',          name: 'LAB',          bg: '#eeefe9', ink: '#101010', accent1: '#00a86b', accent2: '#e63946', accent3: '#3d5a80' },
  { id: 'memphis',      name: 'MEMPHIS',      bg: '#f0ece2', ink: '#111111', accent1: '#ff3b3f', accent2: '#22577a', accent3: '#ffd400' },
  { id: 'construction', name: 'CONSTRUCTION', bg: '#e8e6df', ink: '#0a0a0a', accent1: '#ff8200', accent2: '#1457a6', accent3: '#fff200' },
  { id: 'botanical',    name: 'BOTANICAL',    bg: '#efece2', ink: '#0e0e0e', accent1: '#bb4430', accent2: '#7ebc89', accent3: '#3d348b' },
  { id: 'mono',         name: 'MONO+ONE',     bg: '#eeefe9', ink: '#0a0a0a', accent1: '#ff4d00', accent2: '#5a5a5a', accent3: '#9a9a9a' },
  { id: 'inverted',     name: 'INVERTED',     bg: '#0e0e0e', ink: '#eeefe9', accent1: '#ff5a36', accent2: '#7be0a3', accent3: '#ffd166', inverted: true },
];

export const DEFAULT_PALETTE_ID = 'plotter';

export function getPalette(id: string | undefined | null): Palette {
  if (!id) return PALETTES.find(p => p.id === DEFAULT_PALETTE_ID)!;
  return PALETTES.find(p => p.id === id) ?? PALETTES.find(p => p.id === DEFAULT_PALETTE_ID)!;
}

export function pickAccent(palette: Palette, idx: 0 | 1 | 2): string {
  return [palette.accent1, palette.accent2, palette.accent3][idx];
}

export function applyPaletteVars(el: HTMLElement | null, palette: Palette) {
  if (!el) return;
  el.style.setProperty('--bg', palette.bg);
  el.style.setProperty('--ink', palette.ink);
  el.style.setProperty('--accent1', palette.accent1);
  el.style.setProperty('--accent2', palette.accent2);
  el.style.setProperty('--accent3', palette.accent3);
  el.style.setProperty('--shadow-brutal', `4px 4px 0 0 ${palette.ink}`);
}
