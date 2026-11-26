import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'index.json');
const ARTICLES_DIR = path.join(ROOT, 'articles');

export type BoardId = 'list' | 'exploration';

export interface Entry {
  /** 列表内唯一锚点，如 11-25 */
  id: string;
  /** 指向 articles/<slug>.astro */
  article: string;
  /** 列表内的一句话注记 */
  note?: string;
}

export interface BoardList {
  /** 板块内唯一，即 URL 段 */
  id: string;
  title: string;
  desc?: string;
  /** exploration 专用：进行中 / 已完成 / 搁置 */
  status?: string;
  /** exploration 专用：时间跨度描述 */
  period?: string;
  items: Entry[];
}

export interface Board {
  title: string;
  note?: string;
  lists: BoardList[];
}

export interface SiteIndex {
  site: {
    title: string;
    tagline: string;
    description: string;
    email?: string;
    url: string;
  };
  boards: Record<BoardId, Board>;
}

export interface ArticleMeta {
  slug: string;
  title: string;
  subtitle?: string;
  date: string;
  updated?: string;
  tags: string[];
  summary?: string;
  status: 'published' | 'draft' | 'unlisted';
}

/** 从 .astro 里抠出 `export const meta = {...}` 并求值 */
function extractMetaObject(source: string): unknown | null {
  const anchor = source.indexOf('export const meta');
  if (anchor < 0) return null;

  const start = source.indexOf('{', anchor);
  if (start < 0) return null;

  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const literal = source.slice(start, i + 1);
        try {
          // 构建期可信源码，可以求值
          return new Function(`return (${literal})`)();
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseArticleMeta(slug: string, source: string): ArticleMeta | null {
  const raw = extractMetaObject(source) as Partial<ArticleMeta> | null;
  if (!raw || !raw.title || !raw.date) return null;

  return {
    slug,
    title: raw.title,
    subtitle: raw.subtitle,
    date: raw.date,
    updated: raw.updated,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    summary: raw.summary,
    status: raw.status ?? 'published',
  };
}

export function loadIndex(): SiteIndex {
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) as SiteIndex;
}

/** 扫描 articles/，得到 slug → 元数据 */
export function loadArticles(): Map<string, ArticleMeta> {
  const map = new Map<string, ArticleMeta>();
  if (!fs.existsSync(ARTICLES_DIR)) return map;

  for (const file of fs.readdirSync(ARTICLES_DIR)) {
    if (!file.endsWith('.astro') || file.startsWith('_')) continue;
    const slug = file.replace(/\.astro$/, '');
    const meta = parseArticleMeta(slug, fs.readFileSync(path.join(ARTICLES_DIR, file), 'utf8'));
    if (meta) map.set(slug, meta);
  }
  return map;
}

export function boardLists(index: SiteIndex, board: BoardId): BoardList[] {
  return index.boards[board]?.lists ?? [];
}

/** 反查：某个文章出现在哪些列表里 */
export function listsContaining(
  index: SiteIndex,
  slug: string,
): { board: BoardId; list: BoardList; entry: Entry }[] {
  const out: { board: BoardId; list: BoardList; entry: Entry }[] = [];
  for (const board of Object.keys(index.boards) as BoardId[]) {
    for (const list of boardLists(index, board)) {
      const entry = list.items.find((i) => i.article === slug);
      if (entry) out.push({ board, list, entry });
    }
  }
  return out;
}

/** LIST 板块按条目 id（MM-DD）倒序；其它板块保持索引里的顺序 */
export function orderedItems(list: BoardList, board: BoardId): Entry[] {
  if (board === 'list') return [...list.items].sort((a, b) => (a.id < b.id ? 1 : -1));
  return list.items;
}

export function latestArticles(articles: Map<string, ArticleMeta>, n = 6): ArticleMeta[] {
  return [...articles.values()]
    .filter((a) => a.status === 'published')
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, n);
}

/** 某个板块里最新的 n 篇（跨列表去重），用于方块/卡片上的直达链接 */
export function boardTopArticles(
  index: SiteIndex,
  board: BoardId,
  articles: Map<string, ArticleMeta>,
  n = 3,
): ArticleMeta[] {
  const seen = new Set<string>();
  const out: ArticleMeta[] = [];

  for (const list of boardLists(index, board)) {
    for (const item of list.items) {
      if (seen.has(item.article)) continue;
      const a = articles.get(item.article);
      if (!a || a.status !== 'published') continue;
      seen.add(item.article);
      out.push(a);
    }
  }

  return out.sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, n);
}
