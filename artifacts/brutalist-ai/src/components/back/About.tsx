import React from 'react';
import { Palette, accentOnInk } from '../../lib/palettes';
import { content } from '../../lib/content';

export function AboutBack({ palette }: { palette: Palette }) {
  const { name, tagline, about } = content;
  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0 flex justify-between">
        <span>ABOUT</span>
        <span style={{ color: accentOnInk(palette, 2) }}>● HELLO</span>
      </div>
      <div
        className="p-4 flex-1 font-mono text-sm leading-relaxed overflow-auto"
        style={{ background: palette.bg, color: palette.ink }}
      >
        <div
          className="font-bold uppercase tracking-wider mb-1"
          style={{ fontSize: 13 }}
        >
          {name}
        </div>
        <div
          className="mb-3"
          style={{ color: palette.ink, opacity: 0.7, fontSize: 11 }}
        >
          {tagline} · {about.location}
        </div>
        <p className="mb-2" style={{ fontSize: 12 }}>{about.intro}</p>
        {about.paragraphs.map((p, i) => (
          <p key={i} className="mb-2" style={{ fontSize: 12, opacity: 0.85 }}>
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}
