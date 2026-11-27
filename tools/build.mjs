/**
 * 索引生成器 —— 读 index.json 骨架 + articles/*.astro 的声明，校验后调用 astro build
 *
 *   pnpm gen            校验 + 构建
 *   pnpm gen --check    只校验，不构建
 *
 * index.json 只描述骨架：板块的 source、列表的 id / title / desc，不含任何条目。
 * 归属来自每篇文章的 meta.lists；source=date 的板块由 meta.date 编年。
 *
 * 校验项：source 合法 / 列表 id 全站唯一 / 声明指向存在的列表 / 列表内条目 id 不重复
 * 报告项：没有声明任何列表的文章（只会出现在编年板块）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'index.json');
const ARTICLES_DIR = path.join(ROOT, 'articles');
const BOARD_IDS = ['list', 'exploration'];

const errors = [];
const warnings = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ---------- 防呆：UTF-8 BOM ----------
// Windows PowerShell 5.1 的 Set-Content -Encoding utf8 会写 BOM，
// Vite 读 package.json 时会报 "Unexpected token ''"。这里提前拦住。
const BOM = [0xef, 0xbb, 0xbf];
const TEXT_EXT = new Set(['.json', '.mjs', '.js', '.ts', '.astro', '.css', '.md', '.txt', '.yml', '.yaml']);
const SKIP_DIR = new Set(['node_modules', 'dist', '.astro', '.git', '.wrangler', 'drafts']);

function checkBom(dir, depth = 0) {
  if (depth > 6) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkBom(full, depth + 1);
    } else if (TEXT_EXT.has(path.extname(entry.name))) {
      const fd = fs.openSync(full, 'r');
      const head = Buffer.alloc(3);
      fs.readSync(fd, head, 0, 3, 0);
      fs.closeSync(fd);
      if (head[0] === BOM[0] && head[1] === BOM[1] && head[2] === BOM[2]) {
        fail(`文件开头有 UTF-8 BOM：${path.relative(ROOT, full)}（用无 BOM 的 UTF-8 重写）`);
      }
    }
  }
}

try {
  checkBom(ROOT);
} catch (err) {
  warn(`BOM 检查跳过：${err.message}`);
}

// BOM 会让后面的 JSON.parse 直接崩，所以先单独拦一次
if (errors.length) {
  console.error('');
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\n先修掉上面的问题，再跑一次。');
  process.exit(1);
}

function extractMeta(source) {
  const anchor = source.indexOf('export const meta');
  if (anchor < 0) return null;
  const start = source.indexOf('{', anchor);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return new Function(`return (${source.slice(start, i + 1)})`)();
        } catch (err) {
          fail(`meta 对象无法求值：${err.message}`);
          return null;
        }
      }
    }
  }
  return null;
}

const articles = new Map();
if (!fs.existsSync(ARTICLES_DIR)) {
  fail('缺少 articles/ 目录');
} else {
  for (const file of fs.readdirSync(ARTICLES_DIR)) {
    if (!file.endsWith('.astro') || file.startsWith('_')) continue;
    const slug = file.replace(/\.astro$/, '');
    const meta = extractMeta(fs.readFileSync(path.join(ARTICLES_DIR, file), 'utf8'));
    if (!meta) {
      fail(`articles/${file} 缺少 export const meta = { ... }`);
      continue;
    }
    if (!meta.title) fail(`articles/${file} 的 meta 缺 title`);
    if (!meta.date || !/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) fail(`articles/${file} 的 meta.date 不是 YYYY-MM-DD`);
    articles.set(slug, meta);
  }
}

// ---------- 生成显式注册表（取代 import.meta.glob 的约定式发现） ----------
const registryPath = path.join(ROOT, 'src', 'lib', 'articles.registry.ts');
const registrySource = [
  '// 由 tools/build.mjs 自动生成；不要手改。',
  '// 作用：把 slug → 文章组件 的映射写成显式代码，避免约定式发现。',
  'export const registry: Record<string, () => Promise<{ default: unknown }>> = {',
  ...[...articles.keys()].map((slug) => `  ${JSON.stringify(slug)}: () => import('../../articles/${slug}.astro'),`),
  '};',
  '',
].join('\n');
fs.mkdirSync(path.dirname(registryPath), { recursive: true });
fs.writeFileSync(registryPath, registrySource, 'utf8');
console.log(`注册表：${articles.size} 个条目 → src/lib/articles.registry.ts`);
const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));

// ---------- 骨架：source 决定列表从哪来 ----------
const listOwner = new Map(); // list id → board id，全站唯一
for (const board of BOARD_IDS) {
  const b = index.boards?.[board];
  if (!b) {
    fail(`index.json 缺少 boards.${board}`);
    continue;
  }
  if (!b.title) fail(`boards.${board} 缺 title`);

  if (b.source !== 'date' && b.source !== 'declared') {
    fail(`boards.${board}.source 必须是 "date" 或 "declared"`);
    continue;
  }

  if (b.source === 'date') {
    if (b.lists?.length) fail(`boards.${board} 是 source=date，不要写 lists（年份由文章 date 生成）`);
    for (const y of Object.keys(b.yearNotes ?? {})) {
      if (!/^\d{4}$/.test(y)) fail(`boards.${board}.yearNotes 的键不是四位年份：${y}`);
    }
    continue;
  }

  if (!Array.isArray(b.lists)) {
    fail(`boards.${board} 缺少 lists 数组`);
    continue;
  }

  const seenListIds = new Set();
  for (const list of b.lists) {
    if (!list.id) {
      fail(`boards.${board} 有列表缺 id`);
      continue;
    }
    if (seenListIds.has(list.id)) fail(`boards.${board} 列表 id 重复：${list.id}`);
    seenListIds.add(list.id);
    if (!list.title) fail(`boards.${board}.${list.id} 缺 title`);
    if ('items' in list) fail(`boards.${board}.${list.id} 不该有 items —— 归属写在文章的 meta.lists 里`);
    if (listOwner.has(list.id)) fail(`列表 id 全站唯一，重复：${list.id}`);
    else listOwner.set(list.id, board);
  }
}

// ---------- 文章声明 ----------
const placed = new Map(); // `${list}/${id}` → slug
let placedCount = 0;

for (const [slug, meta] of articles) {
  if (meta.status !== 'published') continue;
  if (meta.lists === undefined) continue;
  if (!Array.isArray(meta.lists)) {
    fail(`${slug} 的 meta.lists 必须是数组`);
    continue;
  }

  for (const p of meta.lists) {
    if (!p || typeof p !== 'object') {
      fail(`${slug} 的 meta.lists 有非对象元素`);
      continue;
    }
    if (!p.list) {
      fail(`${slug} 的 meta.lists 有条目缺 list`);
      continue;
    }
    if (!p.id) {
      fail(`${slug} 的 meta.lists 有条目缺 id`);
      continue;
    }
    if (p.list_index !== undefined && !Number.isFinite(p.list_index)) {
      fail(`${slug} 的 meta.lists（${p.list}）的 list_index 必须是数字`);
    }
    if (!listOwner.has(p.list)) {
      fail(`${slug} 声明进了不存在的列表：${p.list}`);
      continue;
    }

    const key = `${p.list}/${p.id}`;
    if (placed.has(key)) fail(`列表 ${p.list} 内条目 id 重复：${p.id}（${placed.get(key)} / ${slug}）`);
    else placed.set(key, slug);
    placedCount++;
  }
}

// ---------- 报告 ----------
for (const [slug, meta] of articles) {
  if (meta.status === 'published' && !meta.lists?.length) {
    warn(`只进编年板块（未声明列表）：${slug}`);
  }
}

const years = new Set(
  [...articles.values()]
    .filter((a) => a.status === 'published')
    .map((a) => a.date.slice(0, 4)),
);

console.log('');
console.log(`板块：${BOARD_IDS.map((b) => `${b}(${index.boards?.[b]?.source ?? '?'})`).join('  ')}`);
console.log(`文章：${articles.size} 个组件，${placedCount} 条声明，编年 ${years.size} 个年份`);
for (const w of warnings) console.log(`  ! ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log('');

if (errors.length) {
  console.error(`校验失败：${errors.length} 个错误`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  console.log('校验通过（未构建）');
  process.exit(0);
}

console.log('构建中…');
execSync('pnpm exec astro build', { cwd: ROOT, stdio: 'inherit', shell: true });
