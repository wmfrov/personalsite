import React, { useEffect, useRef, useState } from 'react';
import { Palette, PALETTES } from '../lib/palettes';

interface PalettePickerProps {
  palette: Palette;
  setPalette: (id: string) => void;
}

function Swatches({ p, size = 12 }: { p: Palette; size?: number }) {
  return (
    <span
      className="inline-flex border-[2px]"
      style={{ borderColor: p.ink, background: p.bg }}
      aria-hidden
    >
      {[p.accent1, p.accent2, p.accent3].map((c, i) => (
        <span key={i} style={{ width: size, height: size, background: c, display: 'block' }} />
      ))}
    </span>
  );
}

export function PalettePicker({ palette, setPalette }: PalettePickerProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setFocusIdx(Math.max(0, PALETTES.findIndex(p => p.id === palette.id)));
  }, [palette.id, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx(i => Math.min(PALETTES.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx(i => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = PALETTES[focusIdx];
      if (chosen) {
        setPalette(chosen.id);
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
  };

  return (
    <div ref={wrapperRef} className="relative" onKeyDown={handleKey}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2 py-1 border-[3px] text-xs font-bold font-mono uppercase tracking-widest cursor-pointer"
        style={{
          borderColor: 'var(--ink)',
          background: 'var(--bg)',
          color: 'var(--ink)',
          boxShadow: 'var(--shadow-brutal)',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Palette: ${palette.name}`}
      >
        <span>{palette.name}</span>
        <Swatches p={palette} />
        <span className="text-[10px] opacity-60">▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Choose palette"
          className="absolute left-0 top-full mt-1 z-50 border-[3px] py-1"
          style={{
            borderColor: 'var(--ink)',
            background: 'var(--bg)',
            color: 'var(--ink)',
            boxShadow: 'var(--shadow-brutal)',
            minWidth: 220,
          }}
        >
          {PALETTES.map((p, i) => {
            const active = p.id === palette.id;
            const focused = i === focusIdx;
            return (
              <button
                key={p.id}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setFocusIdx(i)}
                onClick={() => {
                  setPalette(p.id);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                className="w-full flex items-center justify-between gap-3 px-2 py-1.5 cursor-pointer text-xs font-bold font-mono uppercase tracking-widest"
                style={{
                  background: focused ? p.ink : 'transparent',
                  color: focused ? p.bg : 'var(--ink)',
                }}
              >
                <span className="flex items-center gap-1">
                  <span style={{ width: 14, display: 'inline-block' }}>{active ? '●' : ' '}</span>
                  {p.name}
                </span>
                <Swatches p={p} size={14} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
