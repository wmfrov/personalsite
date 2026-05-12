import React, { useEffect, useRef, useState } from 'react';

interface Shortcut {
  keys: string;
  description: string;
}

interface PanelBlurb {
  name: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: 'H', description: 'Hide / show all chrome (footer + this button)' },
  { keys: 'F', description: 'Toggle fullscreen' },
  { keys: 'Enter', description: 'Commit the seed input (when focused)' },
  { keys: '↑ / ↓', description: 'Move through palettes (when picker is open)' },
  { keys: 'Esc', description: 'Close this modal or the palette picker' },
];

const PANEL_BLURBS: PanelBlurb[] = [
  {
    name: 'Token Stream',
    description:
      'A scrolling stream of "tokens" — chunks of text the way a language model would chew them up. Stylized; nothing is actually being tokenized.',
  },
  {
    name: 'Embedding Space',
    description:
      'A 2D projection of points meant to evoke a high-dimensional embedding space. Positions and clusters are seeded pseudo-randomly, not learned.',
  },
  {
    name: 'Weights',
    description:
      'A grid of values pretending to be a weight matrix. The pattern is derived from the seed; no training is happening.',
  },
  {
    name: 'Loss',
    description:
      'A noisy curve that wanders downward like a training loss. It is generated from the seed, not from any optimizer.',
  },
  {
    name: 'Probabilities',
    description:
      'A bar chart resembling next-token probabilities. The distribution is deterministic from the seed, not from a real model.',
  },
  {
    name: 'Scratchpad',
    description:
      'A flippable side that shows short notes and half-formed thoughts. Click any panel\'s flip handle to see the matching back-of-card content.',
  },
];

const TECH = [
  'React + Vite',
  'TypeScript',
  'Tailwind CSS',
  'HTML Canvas + SVG',
  'Deterministic seeded hashing (Web Crypto)',
  'Hosted on GitHub Pages',
];

const REPO_URL = 'https://github.com/wmfrov/personalsite';
const SITE_URL = 'https://willziegler.com';

function Modal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Move focus into the dialog and return it to the previously-focused
  // element on close (typically the button that opened the dialog).
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    if (!node) return;
    const focusable = node.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (focusable ?? node).focus();
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  // ESC + focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = dialogRef.current;
      if (!node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        tabIndex={-1}
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col font-mono outline-none"
        style={{
          background: 'var(--bg)',
          color: 'var(--ink)',
          border: '3px solid var(--ink)',
          boxShadow: 'var(--shadow-brutal)',
        }}
      >
        <div
          className="shrink-0 flex items-center justify-between px-3 py-2"
          style={{
            background: 'var(--ink)',
            color: 'var(--bg)',
            borderBottom: '3px solid var(--ink)',
          }}
        >
          <h2
            id="about-modal-title"
            className="font-bold uppercase tracking-widest text-xs"
          >
            About this site
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close about dialog"
            className="font-bold uppercase tracking-widest text-xs px-2 py-0.5 cursor-pointer"
            style={{
              background: 'var(--bg)',
              color: 'var(--ink)',
              border: '2px solid var(--bg)',
            }}
          >
            ✕ CLOSE
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 text-sm leading-relaxed">
          <Section title="What this is">
            <p>
              A personal site by <strong>Will Ziegler</strong> dressed up as a
              fake "AI dashboard." The panels look like a model training in
              real time — they're really just deterministic, seed-driven
              graphics. Type a new seed at the bottom of the page to redraw
              everything, or pick a different palette.
            </p>
          </Section>

          <Section title="What you're looking at">
            <ul className="flex flex-col gap-2">
              {PANEL_BLURBS.map((p) => (
                <li key={p.name}>
                  <span
                    className="inline-block px-1.5 py-0.5 mr-2 font-bold uppercase tracking-widest text-[10px]"
                    style={{ background: 'var(--ink)', color: 'var(--bg)' }}
                  >
                    {p.name}
                  </span>
                  <span style={{ opacity: 0.9 }}>{p.description}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2" style={{ opacity: 0.7, fontSize: 12 }}>
              Each panel has a "flip" handle in its header — flip it to read
              about me, my projects, contact info, and more.
            </p>
          </Section>

          <Section title="Keyboard shortcuts">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.keys}>
                    <td
                      className="py-1 pr-3 align-top whitespace-nowrap"
                      style={{ width: '1%' }}
                    >
                      <kbd
                        className="inline-block px-2 py-0.5 font-bold text-xs"
                        style={{
                          border: '2px solid var(--ink)',
                          background: 'var(--bg)',
                          color: 'var(--ink)',
                          boxShadow: '2px 2px 0 0 var(--ink)',
                        }}
                      >
                        {s.keys}
                      </kbd>
                    </td>
                    <td className="py-1" style={{ opacity: 0.9 }}>
                      {s.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Built with">
            <ul className="flex flex-wrap gap-1.5">
              {TECH.map((t) => (
                <li
                  key={t}
                  className="px-2 py-0.5 text-xs font-bold"
                  style={{
                    border: '2px solid var(--ink)',
                    background: 'var(--bg)',
                    color: 'var(--ink)',
                  }}
                >
                  {t}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Links">
            <ul className="flex flex-col gap-1">
              <li>
                <LinkRow label="REPO" href={REPO_URL}>
                  github.com/wmfrov/personalsite
                </LinkRow>
              </li>
              <li>
                <LinkRow label="SITE" href={SITE_URL}>
                  willziegler.com
                </LinkRow>
              </li>
              <li>
                <LinkRow label="LICENSE" href={`${REPO_URL}/blob/main/LICENSE`}>
                  MIT (see repo)
                </LinkRow>
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3
        className="mb-2 pb-1 font-bold uppercase tracking-widest text-xs"
        style={{ borderBottom: '2px solid var(--ink)' }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function LinkRow({
  label,
  href,
  children,
}: {
  label: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 flex-wrap">
      <span
        className="px-1.5 py-0.5 font-bold uppercase tracking-widest text-[10px]"
        style={{ background: 'var(--ink)', color: 'var(--bg)' }}
      >
        {label}
      </span>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-bold underline break-all"
        style={{ color: 'var(--ink)' }}
      >
        {children}
      </a>
    </span>
  );
}

export function AboutButton({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="About this site"
      aria-haspopup="dialog"
      aria-expanded={open}
      className="flex items-center gap-1 px-2 py-1 font-bold uppercase tracking-widest text-xs cursor-pointer shrink-0"
      style={{
        border: '3px solid var(--ink)',
        background: 'var(--bg)',
        color: 'var(--ink)',
        boxShadow: 'var(--shadow-brutal)',
      }}
    >
      <span aria-hidden>?</span>
      <span>ABOUT</span>
    </button>
  );
}

export function AboutModal({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  if (!open) return null;
  return <Modal onClose={() => setOpen(false)} />;
}
