import React, { useEffect, useRef, useState } from 'react';
import * as htmlToImage from 'html-to-image';
import { Header } from '../components/Header';
import { EmbeddingSpace } from '../components/EmbeddingSpace';
import { Weights } from '../components/Weights';
import { TokenStream } from '../components/TokenStream';
import { Loss } from '../components/Loss';
import { Probabilities } from '../components/Probabilities';
import { ExportModal } from '../components/ExportModal';
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

interface ExportState {
  active: boolean;
  w: number;
  h: number;
}

const BANNER_ZOOM_PRESETS = [1, 1.25, 1.5, 2] as const;
type BannerZoom = (typeof BANNER_ZOOM_PRESETS)[number];

/**
 * Wait for IBM Plex Mono in the weights/sizes the dashboard renders to
 * be fully ready before rasterizing. `document.fonts.ready` resolves
 * once the in-flight font loads complete; the explicit `.load(...)`
 * calls force any not-yet-requested faces (e.g. bold) to be fetched so
 * the very first export after a hard reload doesn't fall back to the
 * browser's default monospace.
 */
async function ensurePlexMonoReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const sizes = ['10px', '11px', '12px', '14px', '16px', '24px'];
  const weights = [400, 500, 700];
  const specs: string[] = [];
  for (const w of weights) {
    for (const s of sizes) {
      specs.push(`${w} ${s} "IBM Plex Mono"`);
    }
  }
  try {
    await Promise.all(specs.map(s => document.fonts.load(s)));
  } catch {
    /* per-spec failures are non-fatal — fall through to fonts.ready */
  }
  await document.fonts.ready;
}

/**
 * URL hash format: `#<encoded-seed>|<paletteId>`. Backward-compatible — if no
 * `|` is present (old links) the whole hash is treated as the seed and the
 * default palette is used. Encoded seeds never contain a literal `|` because
 * encodeURIComponent escapes it, so splitting on the LAST `|` is unambiguous.
 */
function parseHash(raw: string): { seed: string | null; paletteId: string } {
  if (!raw) return { seed: null, paletteId: DEFAULT_PALETTE_ID };
  // Always split on the LAST literal `|`. Encoded seeds never contain a raw
  // pipe (encodeURIComponent escapes it), so this split is unambiguous. A
  // missing pipe = legacy single-segment hash → whole string is the seed.
  const lastPipe = raw.lastIndexOf('|');
  let seedPart: string;
  let paletteId = DEFAULT_PALETTE_ID;
  if (lastPipe >= 0) {
    seedPart = raw.slice(0, lastPipe);
    const candidate = raw.slice(lastPipe + 1);
    if (PALETTES.some(p => p.id === candidate)) {
      paletteId = candidate;
    }
    // else: unknown palette id → keep default; the seed is still the left part
    // so we don't pollute it with the bad suffix.
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
  const [seed, setSeed] = useState('hello world');
  const [seedData, setSeedData] = useState<SeedData | null>(null);
  const [paletteId, setPaletteId] = useState<string>(DEFAULT_PALETTE_ID);

  const palette = getPalette(paletteId);

  const [hideChrome, setHideChrome] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({ active: false, w: 0, h: 0 });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [bannerZoom, setBannerZoom] = useState<BannerZoom>(1);
  // Set true for the duration of htmlToImage rasterization so the
  // viewport-fit transform is dropped and the dashboard renders at its
  // native banner pixel dimensions while the snapshot is taken.
  const [capturing, setCapturing] = useState(false);

  // Shared frame counter; panels apply +/- deltas against their snapshot history.
  const [stepFrame, setStepFrame] = useState(0);
  // Buffered text for the frame input so the user can type freely without each
  // keystroke immediately driving the (expensive) frame jump. Committed on
  // Enter / blur. Kept in sync with `stepFrame` whenever the frame changes
  // through any other path (slider, buttons, keyboard).
  const [frameInputText, setFrameInputText] = useState('0');
  useEffect(() => {
    setFrameInputText(String(stepFrame));
  }, [stepFrame]);
  // Bumped on entering export mode to remount panels + reset history.
  const [resetKey, setResetKey] = useState(0);

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
  // Holds a cleanup function for the active auto-flip schedule so the very
  // first manual flip can tear it down immediately, instead of waiting for
  // the next 7s tick.
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
  // and never re-armed (including after exiting export mode).
  const autoFlipStartedRef = useRef(false);
  useEffect(() => {
    if (exportState.active || userFlippedRef.current || autoFlipStartedRef.current) return;
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
  }, [exportState.active]);

  // Scrubber range. The slider covers a useful 10-second window at 60fps;
  // the number input lets users go beyond when they want a really late frame.
  const SCRUB_MAX = 600;
  const FRAMES_PER_SECOND = 60;

  const jumpFrame = (delta: number) => {
    setStepFrame(f => Math.max(0, f + delta));
  };
  const setFrameClamped = (n: number) => {
    if (!Number.isFinite(n)) return;
    setStepFrame(Math.max(0, Math.floor(n)));
  };

  const dashboardRef = useRef<HTMLDivElement>(null);

  // Restore seed + palette from URL hash; tolerate malformed %XX sequences.
  useEffect(() => {
    const raw = window.location.hash.slice(1);
    const parsed = parseHash(raw);
    if (parsed.seed !== null) setSeed(parsed.seed);
    setPaletteId(parsed.paletteId);
  }, []);

  // Apply palette as CSS custom properties on the documentElement so it
  // cascades to portals (modal, picker popover) too.
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

      if (exportState.active) {
        if (e.key === 'Escape') {
          setExportState({ active: false, w: 0, h: 0 });
          return;
        }
        // Skip frame-stepping shortcuts while focus is in an input/textarea
        // so the frame number field and any future text inputs work normally.
        if (typing) return;
        // Arrow keys: ±1 frame, with Shift for ±10 (faster fine-tuning).
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          jumpFrame(e.shiftKey ? 10 : 1);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          jumpFrame(e.shiftKey ? -10 : -1);
          return;
        }
        // Page Up / Page Down: ±1 second jumps for fast travel.
        if (e.key === 'PageDown') {
          e.preventDefault();
          jumpFrame(FRAMES_PER_SECOND);
          return;
        }
        if (e.key === 'PageUp') {
          e.preventDefault();
          jumpFrame(-FRAMES_PER_SECOND);
          return;
        }
        // Home / End: jump to start / end of the slider range.
        if (e.key === 'Home') {
          e.preventDefault();
          setFrameClamped(0);
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          setFrameClamped(SCRUB_MAX);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          downloadImage();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportState.active]);

  const handleExportPreset = (w: number, h: number) => {
    setIsModalOpen(false);
    setStepFrame(0);
    setResetKey(k => k + 1);
    setBannerZoom(1);
    // Reset every panel to its front face so the exported PNG always
    // shows the LLM visualizations, never the personal-site backs.
    setFlipped({
      token: false,
      weights: false,
      loss: false,
      probs: false,
      embedding: false,
    });
    setExportState({ active: true, w, h });
  };

  const downloadImage = async () => {
    if (!dashboardRef.current) return;

    // 1. Make sure IBM Plex Mono is loaded so the rasterizer doesn't
    //    fall back to the browser's default monospace.
    // 2. Drop the viewport-fit `transform: scale(...)` for the duration
    //    of the snapshot so html-to-image captures the dashboard at
    //    native banner pixel dimensions instead of the on-screen scale.
    // 3. Filter the instruction-bar / scrubber chrome out of the cloned
    //    tree so only the dashboard panels make it into the PNG.
    setCapturing(true);
    try {
      await ensurePlexMonoReady();
      // One paint frame so React's `transform: none` is applied before
      // the rasterizer reads computed styles from the live node.
      await new Promise(requestAnimationFrame);

      const dataUrl = await htmlToImage.toPng(dashboardRef.current, {
        width: exportState.w,
        height: exportState.h,
        // hi-DPI output keeps text crisp on retina/4K feeds; the file is
        // 4× the byte size but each banner is still well under typical
        // social-media upload limits.
        pixelRatio: 2,
        cacheBust: false,
        filter: (node: HTMLElement) =>
          !(node instanceof Element && node.hasAttribute('data-export-skip')),
        style: {
          transform: 'none',
          position: 'static',
        },
      });

      const link = document.createElement('a');
      const zoomTag = `${bannerZoom}x`.replace('.', '_');
      link.download = `brutalist-banner-${seedData?.hash?.substring(0, 8) || 'export'}-${paletteId}-${exportState.w}x${exportState.h}-${zoomTag}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export image', err);
    } finally {
      setCapturing(false);
    }
  };

  // Re-scale preview on resize; declared above early return to keep hook order.
  const [viewport, setViewport] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 720,
  });
  useEffect(() => {
    if (!exportState.active) return;
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [exportState.active]);

  if (!seedData) return null;

  const paused = exportState.active;
  const accent = pickAccent(palette, seedData.accentIndex);

  return (
    <div
      className="min-h-screen flex flex-col font-mono relative overflow-hidden"
      style={{ background: 'var(--bg)', color: 'var(--ink)' }}
    >
      <div
        className={`transition-opacity duration-200 ${(!hideChrome && !exportState.active) ? 'opacity-100' : 'opacity-0 pointer-events-none h-0 overflow-hidden'}`}
      >
        <Header
          seed={seed}
          setSeed={setSeed}
          seedData={seedData}
          palette={palette}
          setPalette={setPaletteId}
          onExport={() => setIsModalOpen(true)}
        />
      </div>

      <ExportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPresetSelect={handleExportPreset}
      />

      <div
        className={`flex-1 ${exportState.active ? 'flex items-center justify-center overflow-auto p-8' : ''}`}
        style={exportState.active ? { background: 'rgba(10,10,10,0.92)' } : undefined}
      >
        <div
          ref={dashboardRef}
          className={`relative ${exportState.active ? 'shrink-0' : 'h-[calc(100vh-56px)] w-full p-4'}`}
          style={
            exportState.active
              ? {
                  background: 'var(--bg)',
                  width: exportState.w,
                  height: exportState.h,
                  // Drop the viewport-fit scale during rasterization so the
                  // PNG captures the dashboard at native banner pixels.
                  transform: capturing
                    ? 'none'
                    : `scale(min(1, ${(viewport.w - 64) / exportState.w}, ${(viewport.h - 120) / exportState.h}))`,
                  transformOrigin: 'center center',
                }
              : { background: 'var(--bg)' }
          }
        >
          {exportState.active && (() => {
            const seconds = (stepFrame / FRAMES_PER_SECOND).toFixed(1);
            const jumpBtnStyle = {
              background: palette.bg,
              color: palette.ink,
              border: `3px solid ${palette.ink}`,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              minWidth: 36,
            } as React.CSSProperties;
            return (
              <div
                id="export-instruction-bar"
                data-export-skip="true"
                className="absolute -top-32 left-0 right-0 flex flex-col gap-2 px-4 py-2 font-bold z-50"
                style={{
                  background: palette.accent3,
                  color: palette.ink,
                  border: `3px solid ${palette.ink}`,
                  boxShadow: `4px 4px 0 0 ${palette.ink}`,
                  transform: 'none',
                }}
              >
                {/* Row 1: status + download */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">
                    Exporting: {exportState.w} × {exportState.h} · palette {palette.name}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] opacity-80 font-normal">
                      ← / → step · Shift+← / → ×10 · PgUp / PgDn ±1s · Home / End · ↓ download · ESC exit
                    </span>
                    <button
                      onClick={downloadImage}
                      className="px-3 py-1 text-sm font-bold cursor-pointer"
                      style={{
                        background: palette.ink,
                        color: palette.bg,
                        border: `3px solid ${palette.ink}`,
                        boxShadow: `4px 4px 0 0 ${palette.ink}`,
                      }}
                    >
                      ↓ DOWNLOAD PNG
                    </button>
                  </div>
                </div>

                {/* Row 2: BANNER ZOOM segmented control */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-normal opacity-80">BANNER ZOOM</span>
                  <div className="flex" role="group" aria-label="Banner zoom multiplier">
                    {BANNER_ZOOM_PRESETS.map((z, i) => {
                      const active = bannerZoom === z;
                      return (
                        <button
                          key={z}
                          type="button"
                          onClick={() => setBannerZoom(z)}
                          aria-pressed={active}
                          style={{
                            background: active ? palette.ink : palette.bg,
                            color: active ? palette.bg : palette.ink,
                            border: `3px solid ${palette.ink}`,
                            borderLeftWidth: i === 0 ? 3 : 0,
                            padding: '2px 10px',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            minWidth: 48,
                          }}
                        >
                          {z}×
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-[11px] font-normal opacity-70 ml-2">
                    Output {exportState.w} × {exportState.h} px · panels laid out at{' '}
                    {Math.round(exportState.w / bannerZoom)} × {Math.round(exportState.h / bannerZoom)}
                  </span>
                </div>

                {/* Row 3: scrubber + jump buttons + frame input */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => jumpFrame(-10 * FRAMES_PER_SECOND)}
                    style={jumpBtnStyle}
                    title="Back 10 seconds (600 frames)"
                  >
                    ⏮ −10s
                  </button>
                  <button
                    onClick={() => jumpFrame(-FRAMES_PER_SECOND)}
                    style={jumpBtnStyle}
                    title="Back 1 second (60 frames) — PgUp"
                  >
                    ⏪ −1s
                  </button>
                  <button
                    onClick={() => jumpFrame(-1)}
                    style={jumpBtnStyle}
                    title="Back 1 frame — ←"
                  >
                    ◀
                  </button>

                  <input
                    type="range"
                    min={0}
                    max={SCRUB_MAX}
                    step={1}
                    value={Math.min(stepFrame, SCRUB_MAX)}
                    onChange={e => setFrameClamped(parseInt(e.target.value, 10))}
                    className="flex-1 cursor-pointer"
                    style={{ accentColor: palette.ink }}
                    aria-label="Frame scrubber"
                  />

                  <button
                    onClick={() => jumpFrame(1)}
                    style={jumpBtnStyle}
                    title="Forward 1 frame — →"
                  >
                    ▶
                  </button>
                  <button
                    onClick={() => jumpFrame(FRAMES_PER_SECOND)}
                    style={jumpBtnStyle}
                    title="Forward 1 second (60 frames) — PgDn"
                  >
                    +1s ⏩
                  </button>
                  <button
                    onClick={() => jumpFrame(10 * FRAMES_PER_SECOND)}
                    style={jumpBtnStyle}
                    title="Forward 10 seconds (600 frames)"
                  >
                    +10s ⏭
                  </button>

                  <span className="text-[11px] font-normal opacity-80 ml-2">FRAME</span>
                  <input
                    type="number"
                    min={0}
                    value={frameInputText}
                    onChange={e => setFrameInputText(e.target.value)}
                    onBlur={() => {
                      const n = parseInt(frameInputText, 10);
                      if (Number.isFinite(n)) setFrameClamped(n);
                      else setFrameInputText(String(stepFrame));
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const n = parseInt(frameInputText, 10);
                        if (Number.isFinite(n)) setFrameClamped(n);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="px-2 py-0.5 text-sm font-mono font-bold w-20 text-right"
                    style={{
                      background: palette.bg,
                      color: palette.ink,
                      border: `3px solid ${palette.ink}`,
                    }}
                    aria-label="Frame number"
                  />
                  <span className="text-[11px] font-normal opacity-80 tabular-nums">
                    / {SCRUB_MAX}+ · {seconds}s
                  </span>
                </div>
              </div>
            );
          })()}

          <TrainingCycleProvider
            paused={paused}
            stepFrame={stepFrame}
            resetKey={`${seedData.hash}|${resetKey}`}
          >
            {/*
              BANNER ZOOM wrapper: in export mode the inner panels are
              laid out into a smaller box (banner dims ÷ zoom), then the
              browser's native CSS `zoom` scales the rendered result back
              up to the full banner dimensions. Net effect: every panel
              element (text, dots, axis ticks, weights, loss curve, bars,
              chip) reads as `zoom×` larger relative to the crop, with no
              `transform: scale` blurring on the output (zoom rescales the
              layout itself rather than rasterizing-then-stretching). The
              wrapper is a no-op in non-export mode.
            */}
            <div
              className={exportState.active ? '' : 'w-full h-full'}
              style={
                exportState.active
                  ? ({
                      width: exportState.w / bannerZoom,
                      height: exportState.h / bannerZoom,
                      zoom: bannerZoom,
                    } as React.CSSProperties)
                  : undefined
              }
            >
            <div className="w-full h-full flex flex-col md:flex-row gap-4">
              <div className="flex-[2] md:w-[65%] min-w-0 h-1/2 md:h-full">
                <FlipPanel
                  flipped={flipped.embedding}
                  onFlip={() => handleFlip('embedding')}
                  palette={palette}
                  disabled={exportState.active}
                  label="flip to projects"
                  front={
                    <EmbeddingSpace
                      key={`emb-${resetKey}`}
                      seedData={seedData}
                      palette={palette}
                      accent={accent}
                      paused={paused}
                      stepFrame={stepFrame}
                    />
                  }
                  back={<ProjectsBack palette={palette} />}
                />
              </div>

              <div className="flex-1 md:w-[35%] flex flex-col gap-4 min-w-0 h-1/2 md:h-full">
                <div className="flex-1 flex gap-4 min-h-0">
                  <div className="flex-1">
                    <FlipPanel
                      flipped={flipped.weights}
                      onFlip={() => handleFlip('weights')}
                      palette={palette}
                      disabled={exportState.active}
                      label="flip to contact"
                      front={<Weights key={`w-${resetKey}`} seedData={seedData} palette={palette} paused={paused} stepFrame={stepFrame} />}
                      back={<ContactBack palette={palette} />}
                    />
                  </div>
                  <div className="flex-[1.5]">
                    <FlipPanel
                      flipped={flipped.token}
                      onFlip={() => handleFlip('token')}
                      palette={palette}
                      disabled={exportState.active}
                      label="flip to about"
                      front={<TokenStream key={`t-${resetKey}`} seedData={seedData} palette={palette} paused={paused} stepFrame={stepFrame} />}
                      back={<AboutBack palette={palette} />}
                    />
                  </div>
                </div>

                <div className="flex-[0.8] min-h-0">
                  <FlipPanel
                    flipped={flipped.loss}
                    onFlip={() => handleFlip('loss')}
                    palette={palette}
                    disabled={exportState.active}
                    label="flip to scratchpad"
                    front={<Loss key={`l-${resetKey}`} seedData={seedData} palette={palette} paused={paused} stepFrame={stepFrame} />}
                    back={<ScratchpadBack palette={palette} />}
                  />
                </div>

                <div className="flex-1 min-h-0">
                  <FlipPanel
                    flipped={flipped.probs}
                    onFlip={() => handleFlip('probs')}
                    palette={palette}
                    disabled={exportState.active}
                    label="flip to uses"
                    front={<Probabilities key={`p-${resetKey}`} seedData={seedData} palette={palette} paused={paused} stepFrame={stepFrame} />}
                    back={<UsesBack palette={palette} />}
                  />
                </div>
              </div>
            </div>
            </div>
          </TrainingCycleProvider>

        </div>
      </div>
    </div>
  );
}
