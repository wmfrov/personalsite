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
  /** Optional aria-label for the surrounding region. */
  regionLabel?: string;
}

// Match the CSS transition duration on `.flip-inner` (kept here so the
// visibility-hide timing stays in lockstep with the animation).
// `prefers-reduced-motion` collapses the CSS transition to ~0ms; the
// visibility hide still fires after this delay, which is harmless (the
// inactive face is invisible behind the active one, just lingers in the
// DOM a beat longer).
const FLIP_DURATION_MS = 600;

export function FlipPanel({
  flipped,
  onFlip,
  palette,
  front,
  back,
  label = 'flip panel',
  regionLabel,
}: FlipPanelProps) {
  return (
    <section
      className="relative h-full w-full"
      style={{ perspective: 1400, WebkitPerspective: 1400 }}
      aria-label={regionLabel}
    >
      <div
        className="flip-inner relative h-full w-full"
        style={{
          // React inline styles do NOT auto-prefix transformStyle, and iOS
          // Safari needs the prefixed variant or it silently drops the
          // preserve-3d hint and renders both faces flat-stacked.
          // Note: transition is set on the .flip-inner class in index.css
          // so prefers-reduced-motion can collapse it. Keep it there.
          transformStyle: 'preserve-3d',
          WebkitTransformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          WebkitTransform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
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
    </section>
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
  // iOS Safari fix: when a flipped face contains heavy animated SVG/canvas
  // content (the Embedding Space panel), `backface-visibility: hidden`
  // intermittently fails and the back-of-front shows through, ghosting
  // behind the active face. Two-pronged defense:
  //
  // 1. Force each face onto its own GPU compositing layer with
  //    `translate3d(0,0,0)` and explicit WebKit prefixes on backface +
  //    transform. This alone resolves it on most iOS versions.
  //
  // 2. After the flip transition completes, set `visibility: hidden` on
  //    the inactive face. This is the bulletproof fallback — even if the
  //    backface-visibility rule still leaks on a given iOS version, the
  //    inactive face is genuinely removed from the render tree once the
  //    animation settles. We delay the hide until the flip finishes so
  //    the rotation animation itself is unaffected.
  const [reallyHidden, setReallyHidden] = React.useState(hidden);
  React.useEffect(() => {
    if (hidden) {
      const t = setTimeout(() => setReallyHidden(true), FLIP_DURATION_MS);
      return () => clearTimeout(t);
    }
    setReallyHidden(false);
    return undefined;
  }, [hidden]);

  const baseTransform = back ? 'rotateY(180deg) translate3d(0,0,0)' : 'translate3d(0,0,0)';
  return (
    <div
      className="absolute inset-0"
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: baseTransform,
        WebkitTransform: baseTransform,
        pointerEvents: hidden ? 'none' : 'auto',
        visibility: reallyHidden ? 'hidden' : 'visible',
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
