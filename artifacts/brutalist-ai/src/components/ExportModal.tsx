import React, { useEffect, useState } from 'react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPresetSelect: (width: number, height: number) => void;
}

export function ExportModal({ isOpen, onClose, onPresetSelect }: ExportModalProps) {
  const [customW, setCustomW] = useState('1200');
  const [customH, setCustomH] = useState('630');

  const MIN_DIM = 100;
  const MAX_DIM = 4096;
  const parsedW = parseInt(customW);
  const parsedH = parseInt(customH);
  const wValid = Number.isFinite(parsedW) && parsedW >= MIN_DIM && parsedW <= MAX_DIM;
  const hValid = Number.isFinite(parsedH) && parsedH >= MIN_DIM && parsedH <= MAX_DIM;
  const customValid = wValid && hValid;
  
  // Handle ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/70">
      <div className="brutalist-panel max-w-md w-full bg-cream animate-in fade-in zoom-in duration-100" style={{ borderRadius: 0 }}>
        <div className="brutalist-label flex justify-between">
          <span>EXPORT BANNER</span>
          <button onClick={onClose} className="hover:text-ph-red cursor-pointer px-1">X</button>
        </div>
        
        <div className="p-6 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="font-bold text-sm border-b-[3px] border-ink pb-1 mb-2">PRESETS</h3>
            
            <button 
              onClick={() => onPresetSelect(1584, 396)}
              className="brutalist-button w-full flex justify-between items-center bg-ph-blue text-cream border-ink"
            >
              <span>LINKEDIN COVER</span>
              <span className="text-xs font-normal">1584 × 396</span>
            </button>
            
            <button 
              onClick={() => onPresetSelect(1500, 500)}
              className="brutalist-button w-full flex justify-between items-center"
            >
              <span>X HEADER</span>
              <span className="text-xs font-normal">1500 × 500</span>
            </button>
          </div>
          
          <div className="flex flex-col gap-2">
            <h3 className="font-bold text-sm border-b-[3px] border-ink pb-1 mb-2">CUSTOM</h3>
            
            <div className="flex gap-4 items-end">
              <div className="flex flex-col flex-1 gap-1">
                <label className="text-xs font-bold">WIDTH</label>
                <input 
                  type="number" 
                  value={customW}
                  onChange={e => setCustomW(e.target.value)}
                  className="border-[3px] border-ink px-3 py-2 focus:outline-none focus:bg-ph-yellow focus:text-ink font-mono"
                  style={{ borderRadius: 0 }}
                />
              </div>
              <div className="flex flex-col flex-1 gap-1">
                <label className="text-xs font-bold">HEIGHT</label>
                <input 
                  type="number" 
                  value={customH}
                  onChange={e => setCustomH(e.target.value)}
                  className="border-[3px] border-ink px-3 py-2 focus:outline-none focus:bg-ph-yellow focus:text-ink font-mono"
                  style={{ borderRadius: 0 }}
                />
              </div>
              <button 
                onClick={() => customValid && onPresetSelect(parsedW, parsedH)}
                disabled={!customValid}
                className="brutalist-button shrink-0 h-[46px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                GO
              </button>
            </div>
            {!customValid && (customW !== '' || customH !== '') && (
              <p className="text-xs text-ph-red font-mono mt-1 font-bold">
                ! width &amp; height must be {MIN_DIM}–{MAX_DIM} px
              </p>
            )}
          </div>

          <p className="text-xs text-ink/70 font-mono mt-4 leading-tight">
            Selecting a preset will freeze the dashboard and resize it to exact pixel dimensions. Use arrow keys to find the perfect frame.
          </p>
        </div>
      </div>
    </div>
  );
}
