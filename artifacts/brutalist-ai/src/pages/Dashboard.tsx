import React, { useEffect, useState, useRef } from 'react';
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

export default function Dashboard() {
  const [seed, setSeed] = useState('hello world');
  const [seedData, setSeedData] = useState<SeedData | null>(null);
  
  // View states
  const [hideChrome, setHideChrome] = useState(false);
  const [exportMode, setExportMode] = useState<{active: boolean, w: number, h: number, paused: boolean}>({
    active: false, w: 0, h: 0, paused: false
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const dashboardRef = useRef<HTMLDivElement>(null);

  // Init seed from URL hash or default
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      setSeed(decodeURIComponent(hash));
    }
  }, []);

  // Update seed data when seed changes
  useEffect(() => {
    // Debounce slightly to avoid thrashing
    const timer = setTimeout(() => {
      parseSeed(seed).then(data => {
        setSeedData(data);
        window.location.hash = encodeURIComponent(seed);
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [seed]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in input
      if (document.activeElement?.tagName === 'INPUT') return;
      
      if (e.key === 'h') {
        setHideChrome(prev => !prev);
      }
      
      if (e.key === 'f') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
          });
        } else {
          document.exitFullscreen();
        }
      }
      
      // Export mode controls
      if (exportMode.active) {
        if (e.key === 'Escape') {
          setExportMode({ active: false, w: 0, h: 0, paused: false });
        }
        
        if (e.key === 'ArrowDown') {
          downloadImage();
        }
        
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          // In a real app we'd tightly couple the frame tick to these inputs.
          // For now, we briefly unpause to step
          setExportMode(prev => ({ ...prev, paused: false }));
          setTimeout(() => {
            setExportMode(prev => ({ ...prev, paused: true }));
          }, 16); // One frame roughly
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [exportMode.active]);

  const handleExportPreset = (w: number, h: number) => {
    setIsModalOpen(false);
    setExportMode({
      active: true,
      w,
      h,
      paused: true
    });
  };

  const downloadImage = async () => {
    if (!dashboardRef.current) return;
    
    try {
      // Hide the instruction bar temporarily for the screenshot
      const instructionBar = document.getElementById('export-instruction-bar');
      if (instructionBar) instructionBar.style.display = 'none';
      
      const dataUrl = await htmlToImage.toPng(dashboardRef.current, {
        width: exportMode.w,
        height: exportMode.h,
        style: {
          transform: 'none',
          position: 'static'
        }
      });
      
      if (instructionBar) instructionBar.style.display = 'flex';
      
      const link = document.createElement('a');
      link.download = `brutalist-banner-${seedData?.hash?.substring(0, 8) || 'export'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export image', err);
      // Ensure bar comes back
      const instructionBar = document.getElementById('export-instruction-bar');
      if (instructionBar) instructionBar.style.display = 'flex';
    }
  };

  if (!seedData) return null;

  return (
    <div className="min-h-screen bg-cream flex flex-col font-mono relative overflow-hidden">
      {!hideChrome && !exportMode.active && (
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
      
      {/* Wrapper to center the export container if active */}
      <div className={`flex-1 ${exportMode.active ? 'flex items-center justify-center bg-ink/90 overflow-auto p-8' : ''}`}>
        
        {/* Main Dashboard Container */}
        <div 
          ref={dashboardRef}
          className={`bg-cream relative ${exportMode.active ? 'shrink-0' : 'h-[calc(100vh-56px)] w-full p-4'}`}
          style={exportMode.active ? {
            width: exportMode.w,
            height: exportMode.h,
            // Scale down with CSS transform if it's too big for the viewport (just visual, actual export is full res)
            transform: `scale(min(1, ${(window.innerWidth - 64) / exportMode.w}, ${(window.innerHeight - 120) / exportMode.h}))`,
            transformOrigin: 'center center'
          } : {}}
        >
          {/* Export Instruction Bar overlay */}
          {exportMode.active && (
            <div 
              id="export-instruction-bar"
              className="absolute -top-12 left-0 right-0 flex justify-between bg-ph-yellow border-[3px] border-ink px-4 py-2 font-bold z-50 text-ink shadow-[4px_4px_0_0_#000]"
              style={{ transform: 'none' }} // Negate parent scale
            >
              <span>Exporting: {exportMode.w} × {exportMode.h}</span>
              <span>←/→ Step Frame | ↓ Download PNG | ESC Exit</span>
            </div>
          )}

          {/* Seed label rendered inside banner only during export */}
          {exportMode.active && (
            <div className="absolute top-4 left-4 z-50 bg-ink text-cream px-2 py-1 text-xs font-bold font-mono border-b-[3px] border-ink">
              SEED:{seedData.hash.substring(0, 8)}
            </div>
          )}

          <div className="w-full h-full flex flex-col md:flex-row gap-4">
            {/* Centerpiece */}
            <div className="flex-[2] md:w-[65%] min-w-0 h-1/2 md:h-full">
              <EmbeddingSpace seedData={seedData} paused={exportMode.paused} />
            </div>
            
            {/* Supporting Panels Grid */}
            <div className="flex-1 md:w-[35%] flex flex-col gap-4 min-w-0 h-1/2 md:h-full">
              <div className="flex-1 flex gap-4 min-h-0">
                <div className="flex-1">
                  <Weights seedData={seedData} paused={exportMode.paused} />
                </div>
                <div className="flex-[1.5]">
                  <TokenStream seedData={seedData} paused={exportMode.paused} />
                </div>
              </div>
              
              <div className="flex-[0.8] min-h-0">
                <Loss seedData={seedData} paused={exportMode.paused} />
              </div>
              
              <div className="flex-1 min-h-0">
                <Probabilities seedData={seedData} paused={exportMode.paused} />
              </div>
            </div>
          </div>
          
          <Sticker />
        </div>
      </div>
    </div>
  );
}
