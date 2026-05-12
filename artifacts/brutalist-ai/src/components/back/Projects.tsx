import React from 'react';
import { Palette } from '../../lib/palettes';
import { content, Project } from '../../lib/content';

export function ProjectsBack({ palette }: { palette: Palette }) {
  const { projects } = content;
  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0 flex justify-between items-center">
        <span>PROJECTS</span>
        <span className="font-mono text-[10px] opacity-60" style={{ color: palette.bg }}>
          {projects.length.toString().padStart(2, '0')} entries
        </span>
      </div>
      <div
        className="flex-1 overflow-auto p-4"
        style={{ background: palette.bg, color: palette.ink }}
      >
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
        >
          {projects.map((p, i) => {
            const accent =
              i % 3 === 0
                ? palette.accent1
                : i % 3 === 1
                  ? palette.accent2
                  : palette.accent3;
            return <ProjectCard key={p.title} project={p} accent={accent} palette={palette} />;
          })}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({
  project: p,
  accent,
  palette,
}: {
  project: Project;
  accent: string;
  palette: Palette;
}) {
  const links: { kind: 'repo' | 'site'; href: string; label: string }[] = [];
  if (p.repo) links.push({ kind: 'repo', href: p.repo, label: 'REPO' });
  if (p.site) links.push({ kind: 'site', href: p.site, label: 'SITE' });

  return (
    <div
      className="font-mono flex flex-col"
      style={{
        border: `3px solid ${palette.ink}`,
        background: palette.bg,
        color: palette.ink,
        boxShadow: `4px 4px 0 0 ${palette.ink}`,
        padding: '10px 12px',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="font-bold px-1.5 py-0.5"
          style={{ background: accent, color: palette.bg, fontSize: 11 }}
        >
          {p.tag}
        </span>
        <span className="tabular-nums" style={{ fontSize: 12, opacity: 0.65 }}>
          {p.year}
        </span>
      </div>
      {p.image && (
        <img
          src={p.image}
          alt=""
          width={240}
          height={80}
          loading="lazy"
          decoding="async"
          className="block w-full mb-2"
          style={{
            height: 80,
            objectFit: 'cover',
            border: `2px solid ${palette.ink}`,
            imageRendering: 'pixelated',
          }}
        />
      )}
      <div className="font-bold uppercase mb-1" style={{ fontSize: 14 }}>
        {p.title}
      </div>
      <div className="leading-snug" style={{ fontSize: 12, opacity: 0.85 }}>
        {p.blurb}
      </div>
      {links.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {links.map((l) => (
            <ProjectLink
              key={l.kind}
              href={l.href}
              label={l.label}
              ariaLabel={`${p.title} ${l.kind === 'repo' ? 'source repository' : 'live site'}`}
              accent={accent}
              palette={palette}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectLink({
  href,
  label,
  ariaLabel,
  accent,
  palette,
}: {
  href: string;
  label: string;
  ariaLabel: string;
  accent: string;
  palette: Palette;
}) {
  const [hover, setHover] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  // Press-in (accent fill, shadow collapses) on hover OR keyboard focus.
  const pressed = hover || focused;
  // Keyboard focus also gets an explicit outer ring so it's distinguishable
  // from a mouse hover and meets the brutalist focus-visibility bar.
  const focusRing = focused ? `0 0 0 2px ${palette.bg}, 0 0 0 4px ${palette.ink}` : '';
  const restShadow = `2px 2px 0 0 ${palette.ink}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={ariaLabel}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="font-bold uppercase tracking-widest no-underline focus:outline-none"
      style={{
        fontSize: 10,
        padding: '4px 8px',
        border: `2px solid ${palette.ink}`,
        background: pressed ? accent : palette.bg,
        color: pressed ? palette.bg : palette.ink,
        boxShadow: focused
          ? focusRing
          : pressed
            ? 'none'
            : restShadow,
        transform: pressed && !focused ? 'translate(2px, 2px)' : 'none',
        transition: 'transform 80ms, box-shadow 80ms, background 80ms, color 80ms',
      }}
    >
      {label} ↗
    </a>
  );
}
