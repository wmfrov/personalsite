import React from 'react';
import { Palette } from '../../lib/palettes';
import { content } from '../../lib/content';

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
            return (
              <a
                key={p.title}
                href={p.href}
                target="_blank"
                rel="noreferrer"
                className="block font-mono no-underline"
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
                  <span
                    className="tabular-nums"
                    style={{ fontSize: 12, opacity: 0.65 }}
                  >
                    {p.year}
                  </span>
                </div>
                {p.image && (
                  <img
                    src={p.image}
                    alt=""
                    className="block w-full mb-2"
                    style={{
                      height: 80,
                      objectFit: 'cover',
                      border: `2px solid ${palette.ink}`,
                      imageRendering: 'pixelated',
                    }}
                  />
                )}
                <div
                  className="font-bold uppercase mb-1"
                  style={{ fontSize: 14 }}
                >
                  {p.title}
                </div>
                <div
                  className="leading-snug"
                  style={{ fontSize: 12, opacity: 0.85 }}
                >
                  {p.blurb}
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
