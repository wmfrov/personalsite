import React, { useEffect, useRef, useState } from 'react';
import { Footer } from '../components/Footer';
import { EmbeddingSpace } from '../components/EmbeddingSpace';
import { Weights } from '../components/Weights';
import { TokenStream } from '../components/TokenStream';
import { Loss } from '../components/Loss';
import { Probabilities } from '../components/Probabilities';
import { FlipPanel } from '../components/FlipPanel';
import { AboutBack } from '../components/back/About';
import { ContactBack } from '../components/back/Contact';
import { ScratchpadBack } from '../components/back/Scratchpad';
import { UsesBack } from '../components/back/Uses';
import { ProjectsBack } from '../components/back/Projects';
import { parseSeed, SeedData } from '../lib/hash';
import { applyPaletteVars, DEFAULT_PALETTE_ID, getPalette, PALETTES, pickAccent } from '../lib/palettes';
import { TrainingCycleProvider } from '../contexts/TrainingCycleContext';

type PanelKey = 'token' | 'weights' | 'loss' | 'probs' | 'embedding';

/**
 * Track a CSS media query so we can render either the mobile or the desktop
 * layout — but never both at once. Mounting both layouts via `display: none`
 * would instantiate every panel (including the heavy EmbeddingSpace canvas)
 * twice, doubling subscriptions and animation work.
 */
function useMediaQuery(query: string): boolean {
  const getMatch = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState<boolean>(getMatch);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/**
 * URL hash format: `#<encoded-seed>|<paletteId>`. Backward-compatible — if no
 * `|` is present (old links) the whole hash is treated as the seed and the
 * default palette is used. Encoded seeds never contain a literal `|` because
 * encodeURIComponent escapes it, so splitting on the LAST `|` is unambiguous.
 */
function parseHash(raw: string): { seed: string | null; paletteId: string } {
  if (!raw) return { seed: null, paletteId: DEFAULT_PALETTE_ID };
  const lastPipe = raw.lastIndexOf('|');
  let seedPart: string;
  let paletteId = DEFAULT_PALETTE_ID;
  if (lastPipe >= 0) {
    seedPart = raw.slice(0, lastPipe);
    const candidate = raw.slice(lastPipe + 1);
    if (PALETTES.some(p => p.id === candidate)) {
      paletteId = candidate;
    }
  } else {
    seedPart = raw;
  }
  let seed: string;
  try {
    seed = decodeURIComponent(seedPart);
  } catch {
    seed = seedPart;
  }
  return { seed, paletteId };
}

export default function Dashboard() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [seed, setSeed] = useState('willziegler.com');
  const [seedData, setSeedData] = useState<SeedData | null>(null);
  const [paletteId, setPaletteId] = useState<string>(DEFAULT_PALETTE_ID);

  const palette = getPalette(paletteId);

  const [hideChrome, setHideChrome] = useState(false);

  // Per-panel flip state. Token Stream auto-flips after mount; manual user
  // interaction with any flip button cancels the schedule for the session.
  const [flipped, setFlipped] = useState<Record<PanelKey, boolean>>({
    token: false,
    weights: false,
    loss: false,
    probs: false,
    embedding: false,
  });
  const userFlippedRef = useRef(false);
  const autoFlipCleanupRef = useRef<(() => void) | null>(null);
  const handleFlip = (key: PanelKey) => {
    userFlippedRef.current = true;
    if (autoFlipCleanupRef.current) {
      autoFlipCleanupRef.current();
      autoFlipCleanupRef.current = null;
    }
    setFlipped(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Auto-flip schedule for Token Stream: 0.5s after first paint, then toggle
  // every 7s. Runs once per page load — cancelled by the first manual flip
  // and never re-armed.
  const autoFlipStartedRef = useRef(false);
  useEffect(() => {
    if (userFlippedRef.current || autoFlipStartedRef.current) return;
    autoFlipStartedRef.current = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = setTimeout(() => {
      if (userFlippedRef.current) return;
      setFlipped(prev => ({ ...prev, token: !prev.token }));
      interval = setInterval(() => {
        setFlipped(prev => ({ ...prev, token: !prev.token }));
      }, 7000);
    }, 500);
    const cleanup = () => {
      clearTimeout(start);
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    autoFlipCleanupRef.current = cleanup;
    return () => {
      cleanup();
      autoFlipCleanupRef.current = null;
    };
  }, []);

  // Restore seed + palette from URL hash; tolerate malformed %XX sequences.
  useEffect(() => {
    const raw = window.location.hash.slice(1);
    const parsed = parseHash(raw);
    if (parsed.seed !== null) setSeed(parsed.seed);
    setPaletteId(parsed.paletteId);
  }, []);

  // Apply palette as CSS custom properties on the documentElement so it
  // cascades to portals (picker popover) too.
  useEffect(() => {
    applyPaletteVars(document.documentElement, palette);
  }, [palette]);

  // Rehash on commit (Enter/blur). Guard against stale async digests.
  useEffect(() => {
    let cancelled = false;
    parseSeed(seed).then(data => {
      if (cancelled) return;
      setSeedData(data);
      window.location.hash = `${encodeURIComponent(seed)}|${paletteId}`;
    });
    return () => {
      cancelled = true;
    };
  }, [seed, paletteId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';

      if (!typing && e.key === 'h') {
        setHideChrome(prev => !prev);
        return;
      }

      if (!typing && e.key === 'f') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => {
            console.error(`Fullscreen failed: ${err.message}`);
          });
        } else {
          document.exitFullscreen();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!seedData) return null;

  const accent = pickAccent(palette, seedData.accentIndex);

  const embeddingPanel = (
    <FlipPanel
      flipped={flipped.embedding}
      onFlip={() => handleFlip('embedding')}
      palette={palette}
      label="flip to projects"
      front={
        <EmbeddingSpace
          seedData={seedData}
          palette={palette}
          accent={accent}
        />
      }
      back={<ProjectsBack palette={palette} />}
    />
  );

  const weightsPanel = (
    <FlipPanel
      flipped={flipped.weights}
      onFlip={() => handleFlip('weights')}
      palette={palette}
      label="flip to contact"
      front={<Weights seedData={seedData} palette={palette} />}
      back={<ContactBack palette={palette} />}
    />
  );

  const tokenPanel = (
    <FlipPanel
      flipped={flipped.token}
      onFlip={() => handleFlip('token')}
      palette={palette}
      label="flip to about"
      front={<TokenStream seedData={seedData} palette={palette} />}
      back={<AboutBack palette={palette} />}
    />
  );

  const lossPanel = (
    <FlipPanel
      flipped={flipped.loss}
      onFlip={() => handleFlip('loss')}
      palette={palette}
      label="flip to scratchpad"
      front={<Loss seedData={seedData} palette={palette} />}
      back={<ScratchpadBack palette={palette} />}
    />
  );

  const probsPanel = (
    <FlipPanel
      flipped={flipped.probs}
      onFlip={() => handleFlip('probs')}
      palette={palette}
      label="flip to uses"
      front={<Probabilities seedData={seedData} palette={palette} />}
      back={<UsesBack palette={palette} />}
    />
  );

  return (
    <div
      className="min-h-screen flex flex-col font-mono relative"
      style={{ background: 'var(--bg)', color: 'var(--ink)' }}
    >
      <TrainingCycleProvider resetKey={seedData.hash}>
        {/*
          Layout:
          - Mobile (<md): single full-width column, each panel at least
            ~70vh tall so both faces are legible. The page scrolls
            naturally.
          - Desktop (md+): the original 2-column layout, sized to the
            viewport minus the sticky footer.
        */}
        <div
          className="w-full p-4 pb-[88px] md:pb-[72px] flex flex-col gap-4
                     md:h-screen md:overflow-hidden"
        >
          {/*
            Render only one layout at a time so panel components (especially
            the heavy EmbeddingSpace canvas) mount exactly once. Toggling via
            CSS `display: none` would mount both trees and double the work.
          */}
          {isDesktop ? (
            // Desktop (md+): original 2-column layout.
            <div className="flex-1 min-h-0 w-full flex flex-row gap-4">
              <div className="flex-[2] w-[65%] min-w-0 h-full">
                {embeddingPanel}
              </div>

              <div className="flex-1 w-[35%] flex flex-col gap-4 min-w-0 h-full">
                <div className="flex flex-row gap-4 flex-1 min-h-0">
                  <div className="flex-1">{weightsPanel}</div>
                  <div className="flex-[1.5]">{tokenPanel}</div>
                </div>

                <div className="flex-[0.8] min-h-0">{lossPanel}</div>

                <div className="flex-1 min-h-0">{probsPanel}</div>
              </div>
            </div>
          ) : (
            // Mobile (<md): single column, custom panel order.
            <div className="flex-1 min-h-0 w-full flex flex-col gap-4">
              <div className="h-[60vh]">{tokenPanel}</div>
              <div className="h-[60vh]">{weightsPanel}</div>
              <div className="h-[70vh]">{embeddingPanel}</div>
              <div className="h-[50vh]">{lossPanel}</div>
              <div className="h-[60vh]">{probsPanel}</div>
            </div>
          )}
        </div>
      </TrainingCycleProvider>

      <div
        className={`transition-opacity duration-200 ${hideChrome ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      >
        <Footer
          seed={seed}
          setSeed={setSeed}
          seedData={seedData}
          palette={palette}
          setPalette={setPaletteId}
        />
      </div>
    </div>
  );
}
