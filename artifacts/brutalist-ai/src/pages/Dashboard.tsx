import React, { useEffect, useRef, useState } from 'react';
import * as htmlToImage from 'html-to-image';
import { Header } from '../components/Header';
import { EmbeddingSpace } from '../components/EmbeddingSpace';
import { Weights } from '../components/Weights';
import { TokenStream } from '../components/TokenStream';
import { Loss } from '../components/Loss';
import { Probabilities } from '../components/Probabilities';
import { ExportModal } from '../components/ExportModal';
import { Sticker } from '../components/Sticker';
import { parseSeed, SeedData } from '../lib/hash';

interface ExportState {
  active: boolean;
  w: number;
  h: number;
}

export default function Dashboard() {
  const [seed, setSeed] = useState('hello world');
  const [seedData, setSeedData] = useState<SeedData | null>(null);

  const [hideChrome, setHideChrome] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({ active: false, w: 0, h: 0 });
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Global frame step counter for export mode. Each panel watches it and
  // applies the delta against its own snapshot history: positive delta ticks
  // forward (snapshotting prior state + PRNG), negative delta pops snapshots
  // and restores. This gives true bidirectional frame stepping where
  // forward → back → forward returns to the exact same state.
  const [stepFrame, setStepFrame] = useState(0);
  // Bumped on entering export mode to force panel remount + history reset.
  const [resetKey, setResetKey] = useState(0);

  const dashboardRef = useRef<HTMLDivElement>(null);

  // Init seed from URL hash if present. Wrap decode in try/catch so a
  // malformed `%XX` sequence in the URL bar can't crash the app.
  useEffect(() => {
    const raw = window.location.hash.slice(1);
    if (!raw) return;
    try {
      setSeed(decodeURIComponent(raw));
    } catch {
      setSeed(raw);
    }
  }, []);

  // Rehash when seed changes (committed via Enter / blur, not per keystroke).
  // Guard against stale async commits if `seed` changes again before the
  // previous SHA-256 digest resolves.
  useEffect(() => {
    let cancelled = false;
    parseSeed(seed).then(data => {
      if (cancelled) return;
      setSeedData(data);
      window.location.hash = encodeURIComponent(seed);
    });
    return () => {
      cancelled = true;
    };
  }, [seed]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger global shortcuts while typing in an input
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
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setStepFrame(f => f + 1);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setStepFrame(f => Math.max(0, f - 1));
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
    setExportState({ active: true, w, h });
  };

  const downloadImage = async () => {
    if (!dashboardRef.current) return;
    const instructionBar = document.getElementById('export-instruction-bar');

    try {
      if (instructionBar) instructionBar.style.display = 'none';

      const dataUrl = await htmlToImage.toPng(dashboardRef.current, {
        width: exportState.w,
        height: exportState.h,
        pixelRatio: 2,
        style: { transform: 'none', position: 'static' },
      });

      const link = document.createElement('a');
      link.download = `brutalist-banner-${seedData?.hash?.substring(0, 8) || 'export'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export image', err);
    } finally {
      if (instructionBar) instructionBar.style.display = 'flex';
    }
  };

  if (!seedData) return null;

  const paused = exportState.active;

  return (
    <div className="min-h-screen bg-cream flex flex-col font-mono relative overflow-hidden">
      {!hideChrome && !exportState.active && (
        <Header
          seed={seed}
          setSeed={setSeed}
          seedData={seedData}
          onExport={() => setIsModalOpen(true)}
        />
      )}

      <ExportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPresetSelect={handleExportPreset}
      />

      <div className={`flex-1 ${exportState.active ? 'flex items-center justify-center bg-ink/90 overflow-auto p-8' : ''}`}>
        <div
          ref={dashboardRef}
          className={`bg-cream relative ${exportState.active ? 'shrink-0' : 'h-[calc(100vh-56px)] w-full p-4'}`}
          style={
            exportState.active
              ? {
                  width: exportState.w,
                  height: exportState.h,
                  transform: `scale(min(1, ${(window.innerWidth - 64) / exportState.w}, ${(window.innerHeight - 120) / exportState.h}))`,
                  transformOrigin: 'center center',
                }
              : {}
          }
        >
          {exportState.active && (
            <div
              id="export-instruction-bar"
              className="absolute -top-12 left-0 right-0 flex items-center justify-between bg-ph-yellow border-[3px] border-ink px-4 py-2 font-bold z-50 text-ink shadow-[4px_4px_0_0_#000]"
              style={{ transform: 'none', borderRadius: 0 }}
            >
              <span>Exporting: {exportState.w} × {exportState.h} · frame {stepFrame}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs">← Step Back | → Step Forward | ESC Exit</span>
                <button
                  onClick={downloadImage}
                  className="bg-ink text-cream px-3 py-1 text-sm font-bold border-[3px] border-ink shadow-[4px_4px_0_0_#000] hover:bg-ph-red hover:text-cream transition-colors duration-0"
                  style={{ borderRadius: 0 }}
                >
                  ↓ DOWNLOAD PNG
                </button>
              </div>
            </div>
          )}

          {exportState.active && (
            <div className="absolute top-4 left-4 z-50 bg-ink text-cream px-2 py-1 text-xs font-bold font-mono border-b-[3px] border-ink">
              SEED:{seedData.hash.substring(0, 8)}
            </div>
          )}

          <div className="w-full h-full flex flex-col md:flex-row gap-4">
            <div className="flex-[2] md:w-[65%] min-w-0 h-1/2 md:h-full">
              <EmbeddingSpace key={`emb-${resetKey}`} seedData={seedData} paused={paused} stepFrame={stepFrame} />
            </div>

            <div className="flex-1 md:w-[35%] flex flex-col gap-4 min-w-0 h-1/2 md:h-full">
              <div className="flex-1 flex gap-4 min-h-0">
                <div className="flex-1">
                  <Weights key={`w-${resetKey}`} seedData={seedData} paused={paused} stepFrame={stepFrame} />
                </div>
                <div className="flex-[1.5]">
                  <TokenStream key={`t-${resetKey}`} seedData={seedData} paused={paused} stepFrame={stepFrame} />
                </div>
              </div>

              <div className="flex-[0.8] min-h-0">
                <Loss key={`l-${resetKey}`} seedData={seedData} paused={paused} stepFrame={stepFrame} />
              </div>

              <div className="flex-1 min-h-0">
                <Probabilities key={`p-${resetKey}`} seedData={seedData} paused={paused} stepFrame={stepFrame} />
              </div>
            </div>
          </div>

          {!hideChrome && <Sticker />}
        </div>
      </div>
    </div>
  );
}
