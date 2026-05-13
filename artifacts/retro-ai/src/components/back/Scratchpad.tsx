import React from 'react';
import { Palette } from '../../lib/palettes';
import { content, scratchpadPosts } from '../../lib/content';

export function ScratchpadBack({ palette }: { palette: Palette }) {
  return (
    <div className="retro-panel h-full flex flex-col min-h-0">
      <div className="retro-label shrink-0 flex justify-between items-center">
        <span>SCRATCHPAD</span>
        <span className="font-mono text-[10px] opacity-60" style={{ color: palette.bg }}>
          {scratchpadPosts.length.toString().padStart(3, '0')} notes
        </span>
      </div>
      <div
        className="flex-1 overflow-auto"
        style={{ background: palette.bg, color: palette.ink }}
      >
        {content.scratchpad?.intro && (
          <div
            className="px-4 pt-3 font-mono"
            style={{ fontSize: 12, opacity: 0.75 }}
          >
            {content.scratchpad.intro}
          </div>
        )}
        {scratchpadPosts.length === 0 && (
          <div className="p-4 font-mono text-sm opacity-60">No notes yet.</div>
        )}
        {scratchpadPosts.map((post, i) => (
          <article
            key={post.slug}
            className="px-4 py-3 font-mono"
            style={{
              borderBottom:
                i === scratchpadPosts.length - 1
                  ? 'none'
                  : `1px dashed ${palette.ink}`,
            }}
          >
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span
                className="font-bold uppercase truncate"
                style={{ fontSize: 13 }}
              >
                {post.title}
              </span>
              <span
                className="tabular-nums shrink-0"
                style={{ fontSize: 11, color: palette.accent2 }}
              >
                {post.date}
              </span>
            </div>
            <p
              className="leading-snug"
              style={{ fontSize: 12, opacity: 0.9 }}
            >
              {post.body.split('\n').slice(0, 4).join(' ')}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
