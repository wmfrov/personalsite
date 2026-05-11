import contentJson from '../../content.json';

export interface ContactLink {
  label: string;
  value: string;
  href: string;
}

export interface UsesItem {
  name: string;
  note: string;
}

export interface UsesGroup {
  title: string;
  items: UsesItem[];
}

export interface Project {
  title: string;
  blurb: string;
  tag: string;
  year: string;
  href: string;
}

export interface SiteContent {
  name: string;
  tagline: string;
  about: {
    intro: string;
    paragraphs: string[];
    location: string;
  };
  contact: {
    email: string;
    links: ContactLink[];
    availability: string;
  };
  uses: {
    intro: string;
    groups: UsesGroup[];
  };
  scratchpad: {
    intro: string;
  };
  projects: Project[];
}

export const content: SiteContent = contentJson as SiteContent;

export interface ScratchpadPost {
  slug: string;
  title: string;
  date: string;
  body: string;
}

const rawPosts = import.meta.glob('../../content/scratchpad/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  if (!raw.startsWith('---')) return { meta, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, '');
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (m) meta[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return { meta, body };
}

export const scratchpadPosts: ScratchpadPost[] = Object.entries(rawPosts)
  .map(([path, raw]) => {
    const slug = path.split('/').pop()!.replace(/\.md$/, '');
    const { meta, body } = parseFrontmatter(raw);
    return {
      slug,
      title: meta.title ?? slug,
      date: meta.date ?? '',
      body: body.trim(),
    };
  })
  .sort((a, b) => (a.date < b.date ? 1 : -1));
