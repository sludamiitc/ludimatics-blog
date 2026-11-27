import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'index.json');
const ARTICLES_DIR = path.join(ROOT, 'articles');
const DRAFTS_DIR = path.join(ROOT, 'drafts');

export type BoardId = 'list' | 'exploration';

/** 渲染期才存在的条目：由 resolveIndex 从文章声明里拼出来 */
export interface Entry {
  /** 列表内唯一标签，如 11-27 */
  id: string;
  /** 指向 articles/ 或 drafts/ 下的文件（不含扩展名） */
  article: string;
  /** 列表内的一句话注记 */
  note?: string;
  /** 排序主键，只参与排序，不渲染 */
  list_index?: number;
}

/** 文章 meta.lists 里的一条归属声明 */
export interface Placement {
  /** 列表 id，必须存在于 index.json，全站唯一 */
  list: string;
  /** 该列表内的子编号，自由字符串，只做标签 */
  id: string;
  /** 排序主键，升序，缺省 0 */
  list_index?: number;
  /** 列表内一句话注记 */
  note?: string;
}

/** index.json 里的列表：只写 id / title / max_preview_count，items 由 resolveIndex 填 */
export interface BoardList {
  id: string;
  title: string;
  /** 板块主页最多展示几条链接：0 或未定义 = 全部；决定方块高度 min(条目数, 这个值) */
  max_preview_count?: number;
  items: Entry[];
}

export interface Board {
  title: string;
  /** date = 由文章 date 编年；declared = 由文章 meta.lists 声明 */
  source: 'date' | 'declared';
  lists?: BoardList[];
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
  /** 文件在哪个目录。drafts/ 只在 dev 里被载入 */
  dir: 'articles' | 'drafts';
  title: string;
  date: string;
  updated?: string;
  /** 纯标签：是否上线只看文件在哪个目录，不看这个字段 */
  status?: string;
  /** 归属声明；缺省表示只进编年板块 */
  lists?: Placement[];
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

export function parseArticleMeta(
  slug: string,
  source: string,
  dir: 'articles' | 'drafts' = 'articles',
): ArticleMeta | null {
  const raw = extractMetaObject(source) as Partial<ArticleMeta> | null;
  if (!raw || !raw.title || !raw.date) return null;

  return {
    slug,
    dir,
    title: raw.title,
    date: raw.date,
    updated: raw.updated,
    status: raw.status,
    lists: Array.isArray(raw.lists) ? raw.lists : [],
  };
}

export function loadIndex(): SiteIndex {
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) as SiteIndex;
}

function scanDir(dir: 'articles' | 'drafts', into: Map<string, ArticleMeta>) {
  const abs = dir === 'articles' ? ARTICLES_DIR : DRAFTS_DIR;
  if (!fs.existsSync(abs)) return;
  for (const file of fs.readdirSync(abs)) {
    if (!file.endsWith('.astro') || file.startsWith('_')) continue;
    const slug = file.replace(/\.astro$/, '');
    const meta = parseArticleMeta(slug, fs.readFileSync(path.join(abs, file), 'utf8'), dir);
    if (meta) into.set(slug, meta);
  }
}

/**
 * 扫描文章。dev 时同时扫 drafts/，构建时只扫 articles/。
 *
 * 判断依据是 Vite 的 import.meta.env.DEV：
 *   pnpm dev / astro dev  → true，草稿和正式文章被完全同样地渲染、一样出现在列表里
 *   构建                  → false，drafts/ 里的一切不存在
 * 于是"发布"就是一次文件移动，没有第二次判断。
 */
export function loadArticles(includeDrafts: boolean = import.meta.env.DEV): Map<string, ArticleMeta> {
  const map = new Map<string, ArticleMeta>();
  if (includeDrafts) scanDir('drafts', map); // 先草稿，再让正式文章覆盖同名
  scanDir('articles', map);
  return map;
}

/** 板块里声明的列表；source=date 的板块此刻还没有列表，要等 resolveIndex 生成 */
export function boardLists(index: SiteIndex, board: BoardId): BoardList[] {
  return index.boards[board]?.lists ?? [];
}

const yearOf = (date: string) => date.slice(0, 4);
const dayOf = (date: string) => date.slice(5); // MM-DD

/** 中文按拼音比较；numeric 让 11 排在 2 之后 */
const zh = new Intl.Collator('zh-Hans-CN', { numeric: true });

function compareDeclared(x: Entry, y: Entry, articles: Map<string, ArticleMeta>): number {
  const ix = x.list_index ?? 0;
  const iy = y.list_index ?? 0;
  if (ix !== iy) return ix - iy; // 1) list_index 升序

  const a = articles.get(x.article);
  const b = articles.get(y.article);

  // 2) title 字典序（原来先看 subtitle，现在 meta 里没有 subtitle 了）
  const byTitle = zh.compare(a?.title ?? '', b?.title ?? '');
  if (byTitle !== 0) return byTitle;

  // 3) 兜底：同一份输入永远得到同一份输出
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
}

/**
 * 把「文章的声明」摊平成一棵可以直接渲染的索引。
 *   source: 'date'     的板块 —— 年份列表由 meta.date 生成，条目 id 取 MM-DD
 *   source: 'declared' 的板块 —— 条目由每篇的 meta.lists 塞进对应列表
 * 返回的索引里 items 已是最终顺序，页面不要再排序。
 */
export function resolveIndex(index: SiteIndex, articles: Map<string, ArticleMeta>): SiteIndex {
  const out = structuredClone(index) as SiteIndex;
  const boardIds = Object.keys(out.boards) as BoardId[];

  // 日期倒序；同日用 slug 兜底，保证两次构建结果一致
  const live = [...articles.values()].sort((x, y) =>
    x.date === y.date ? (x.slug < y.slug ? 1 : -1) : x.date < y.date ? 1 : -1,
  );

  // 1) 编年板块：按年份分组
  for (const boardId of boardIds) {
    const board = out.boards[boardId];
    if (board.source !== 'date') continue;

    const years = new Map<string, BoardList>();
    for (const a of live) {
      const y = yearOf(a.date);
      let list = years.get(y);
      if (!list) {
        list = { id: y, title: y, items: [] };
        years.set(y, list);
      }
      list.items.push({ id: dayOf(a.date), article: a.slug });
    }
    board.lists = [...years.values()].sort((x, y) => (x.id < y.id ? 1 : -1));
  }

  // 2) 声明式板块：清空容器，按 list id 建索引
  const byListId = new Map<string, BoardList>();
  for (const boardId of boardIds) {
    if (out.boards[boardId].source === 'date') continue;
    for (const list of boardLists(out, boardId)) {
      list.items = [];
      byListId.set(list.id, list);
    }
  }

  // 3) 摊平每篇的声明
  for (const a of live) {
    for (const p of a.lists ?? []) {
      const list = byListId.get(p.list);
      if (!list) continue; // 拼错由 tools/build.mjs 报错，这里不兜底
      list.items.push({ id: p.id, article: a.slug, note: p.note, list_index: p.list_index });
    }
  }

  // 4) 编年板块：构造时已是日期倒序，这里只做确定性兜底
  for (const boardId of boardIds) {
    if (out.boards[boardId].source !== 'date') continue;
    for (const list of boardLists(out, boardId)) {
      list.items.sort((x, y) => {
        const dx = articles.get(x.article)?.date ?? '';
        const dy = articles.get(y.article)?.date ?? '';
        if (dx !== dy) return dx < dy ? 1 : -1;
        return x.id < y.id ? 1 : x.id > y.id ? -1 : 0;
      });
    }
  }

  // 5) 声明式板块：list_index → title → id
  for (const boardId of boardIds) {
    if (out.boards[boardId].source !== 'declared') continue;
    for (const list of boardLists(out, boardId)) {
      list.items.sort((x, y) => compareDeclared(x, y, articles));
    }
  }

  return out;
}

/** 反查：某个文章出现在哪些列表里（传入 resolveIndex 之后的索引） */
export function listsContaining(
  index: SiteIndex,
  slug: string,
): { board: BoardId; list: BoardList; entry: Entry }[] {
  const out: { board: BoardId; list: BoardList; entry: Entry }[] = [];
  for (const board of Object.keys(index.boards) as BoardId[]) {
    for (const list of boardLists(index, board)) {
      const entry = (list.items ?? []).find((i) => i.article === slug);
      if (entry) out.push({ board, list, entry });
    }
  }
  return out;
}

export function latestArticles(articles: Map<string, ArticleMeta>, n = 6): ArticleMeta[] {
  return [...articles.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, n);
}
