import React from 'react';
import { Palette } from '../../lib/palettes';
import { content } from '../../lib/content';

export function ContactBack({ palette }: { palette: Palette }) {
  const { contact } = content;
  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">CONTACT</div>
      <div
        className="px-2 py-2 flex-1 flex flex-col font-mono text-[11px] overflow-auto gap-1"
        style={{ background: palette.bg, color: palette.ink }}
      >
        <div className="flex items-center gap-1 leading-none">
          <span
            className="px-1 font-bold shrink-0"
            style={{ background: palette.accent1, color: palette.bg, fontSize: 10 }}
          >
            EMAIL
          </span>
          <a
            href={`mailto:${contact.email}`}
            className="font-bold ml-auto truncate"
            style={{ color: palette.ink }}
          >
            {contact.email}
          </a>
        </div>
        {contact.links.map(link => (
          <div key={link.label} className="flex items-center gap-1 leading-none">
            <span
              className="px-1 font-bold shrink-0"
              style={{ background: palette.accent1, color: palette.bg, fontSize: 10 }}
            >
              {link.label}
            </span>
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="font-bold ml-auto truncate"
              style={{ color: palette.ink }}
            >
              {link.value}
            </a>
          </div>
        ))}
        <div
          className="mt-2 pt-2 border-t leading-snug"
          style={{ borderColor: palette.ink, fontSize: 10, opacity: 0.75 }}
        >
          {contact.availability}
        </div>
      </div>
    </div>
  );
}
