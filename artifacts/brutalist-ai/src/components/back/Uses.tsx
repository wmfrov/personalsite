import React from 'react';
import { Palette } from '../../lib/palettes';
import { content } from '../../lib/content';

export function UsesBack({ palette }: { palette: Palette }) {
  const { uses } = content;
  return (
    <div className="brutalist-panel h-full flex flex-col min-h-0">
      <div className="brutalist-label shrink-0">USES</div>
      <div
        className="px-3 py-2 flex-1 flex flex-col font-mono text-xs overflow-auto gap-2"
        style={{ background: palette.bg, color: palette.ink }}
      >
        <div style={{ fontSize: 10.5, opacity: 0.7 }}>{uses.intro}</div>
        {uses.groups.map(group => (
          <div key={group.title} className="flex flex-col gap-0.5">
            <div
              className="font-bold inline-block self-start px-1"
              style={{
                background: palette.accent1,
                color: palette.bg,
                fontSize: 10,
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
                  style={{ fontSize: 11 }}
                >
                  {item.name}
                </span>
                <span
                  className="truncate"
                  style={{ fontSize: 10, opacity: 0.7 }}
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
