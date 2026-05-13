import React from 'react';
import { Palette } from '../../lib/palettes';
import { content } from '../../lib/content';

export function ContactBack({ palette }: { palette: Palette }) {
  const { contact } = content;
  return (
    <div className="retro-panel h-full flex flex-col min-h-0">
      <div className="retro-label shrink-0">CONTACT</div>
      <div
        className="p-4 flex-1 flex flex-col font-mono text-sm overflow-auto gap-2"
        style={{ background: palette.bg, color: palette.ink }}
      >
        <div className="flex flex-col gap-1 leading-tight">
          <span
            className="px-1.5 py-0.5 font-bold self-start"
            style={{ background: palette.accent1, color: palette.bg, fontSize: 12 }}
          >
            EMAIL
          </span>
          <a
            href={`mailto:${contact.email}`}
            className="font-bold break-all"
            style={{ color: palette.ink, fontSize: 13 }}
          >
            {contact.email}
          </a>
        </div>
        {contact.links.map(link => (
          <div key={link.label} className="flex flex-col gap-1 leading-tight">
            <span
              className="px-1.5 py-0.5 font-bold self-start"
              style={{ background: palette.accent1, color: palette.bg, fontSize: 12 }}
            >
              {link.label}
            </span>
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="font-bold break-all"
              style={{ color: palette.ink, fontSize: 13 }}
            >
              {link.value}
            </a>
          </div>
        ))}
        <div
          className="mt-3 pt-3 border-t leading-snug"
          style={{ borderColor: palette.ink, fontSize: 12, opacity: 0.8 }}
        >
          {contact.availability}
        </div>
      </div>
    </div>
  );
}
