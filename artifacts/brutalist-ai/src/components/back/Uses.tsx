import React from 'react';
import { Palette } from '../../lib/palettes';
import { content } from '../../lib/content';

export function UsesBack({ palette }: { palette: Palette }) {
  const { uses } = content;
  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">USES</div>
      <div
        className="p-4 flex-1 flex flex-col font-mono text-sm overflow-auto gap-3"
        style={{ background: palette.bg, color: palette.ink }}
      >
        <div style={{ fontSize: 12, opacity: 0.8 }}>{uses.intro}</div>
        {uses.groups.map(group => (
          <div key={group.title} className="flex flex-col gap-1">
            <div
              className="font-bold inline-block self-start px-1.5 py-0.5"
              style={{
                background: palette.accent1,
                color: palette.bg,
                fontSize: 12,
              }}
            >
              {group.title}
            </div>
            {group.items.map(item => (
              <div
                key={item.name}
                className="flex items-baseline gap-2 leading-snug"
              >
                <span
                  className="font-bold shrink-0"
                  style={{ fontSize: 13 }}
                >
                  {item.name}
                </span>
                <span
                  className="truncate"
                  style={{ fontSize: 12, opacity: 0.75 }}
                >
                  {item.note}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
