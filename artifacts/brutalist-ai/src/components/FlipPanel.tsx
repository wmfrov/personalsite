import React from 'react';
import { Palette } from '../lib/palettes';

interface FlipPanelProps {
  flipped: boolean;
  onFlip: () => void;
  palette: Palette;
  front: React.ReactNode;
  back: React.ReactNode;
  /** Optional aria/title for the flip button. */
  label?: string;
}

export function FlipPanel({
  flipped,
  onFlip,
  palette,
  front,
  back,
  label = 'flip panel',
}: FlipPanelProps) {
  return (
    <div
      className="relative h-full w-full"
      style={{ perspective: 1400 }}
    >
      <div
        className="relative h-full w-full"
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 600ms cubic-bezier(.2,.8,.2,1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        <Face hidden={flipped}>
          {front}
          <FlipButton onClick={onFlip} palette={palette} label={label} />
        </Face>
        <Face hidden={!flipped} back>
          {back}
          <FlipButton onClick={onFlip} palette={palette} label={label} />
        </Face>
      </div>
    </div>
  );
}

function Face({
  children,
  back = false,
  hidden,
}: {
  children: React.ReactNode;
  back?: boolean;
  hidden: boolean;
}) {
  return (
    <div
      className="absolute inset-0"
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: back ? 'rotateY(180deg)' : 'none',
        pointerEvents: hidden ? 'none' : 'auto',
      }}
      aria-hidden={hidden}
    >
      {children}
    </div>
  );
}

function FlipButton({
  onClick,
  palette,
  label,
}: {
  onClick: () => void;
  palette: Palette;
  label: string;
}) {
  // Mobile (<md): full-width strip across the bottom of the panel — large,
  // unmistakable tap target. Desktop (md+): small corner badge so it
  // doesn't crowd the visualization.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="absolute font-mono font-bold cursor-pointer flex items-center justify-center
                 bottom-0 left-0 right-0 py-2 text-sm tracking-widest
                 md:bottom-1 md:right-1 md:left-auto md:top-auto md:py-[3px] md:px-[7px] md:text-[10px]"
      style={{
        background: palette.bg,
        color: palette.ink,
        border: `3px solid ${palette.ink}`,
        boxShadow: `4px 4px 0 0 ${palette.ink}`,
        lineHeight: 1,
        letterSpacing: '0.05em',
        zIndex: 5,
      }}
    >
      ⇋ FLIP
    </button>
  );
}
