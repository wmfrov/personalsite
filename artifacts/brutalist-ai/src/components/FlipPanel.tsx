import React from 'react';
import { Palette } from '../lib/palettes';

interface FlipPanelProps {
  flipped: boolean;
  onFlip: () => void;
  palette: Palette;
  front: React.ReactNode;
  back: React.ReactNode;
  /** Forces the front face to show and hides the flip button (used during PNG export). */
  disabled?: boolean;
  /** Optional aria/title for the flip button. */
  label?: string;
}

export function FlipPanel({
  flipped,
  onFlip,
  palette,
  front,
  back,
  disabled = false,
  label = 'flip panel',
}: FlipPanelProps) {
  const showBack = !disabled && flipped;
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
          transform: showBack ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        <Face hidden={showBack}>
          {front}
          {!disabled && (
            <FlipButton onClick={onFlip} palette={palette} label={label} />
          )}
        </Face>
        <Face hidden={!showBack} back>
          {back}
          {!disabled && (
            <FlipButton onClick={onFlip} palette={palette} label={label} />
          )}
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
  return (
    <button
      type="button"
      onClick={onClick}
      data-export-skip="true"
      aria-label={label}
      title={label}
      className="absolute bottom-1 right-1 font-mono font-bold cursor-pointer"
      style={{
        background: palette.bg,
        color: palette.ink,
        border: `3px solid ${palette.ink}`,
        boxShadow: `4px 4px 0 0 ${palette.ink}`,
        padding: '3px 7px',
        fontSize: 10,
        lineHeight: 1,
        letterSpacing: '0.05em',
        zIndex: 5,
      }}
    >
      ⇋ FLIP
    </button>
  );
}
