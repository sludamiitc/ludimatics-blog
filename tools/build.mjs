/**
 * 索引生成器 —— 读 index.json + articles/*.astro，校验后调用 astro build
 *
 *   pnpm gen            校验 + 构建
 *   pnpm gen --check    只校验，不构建
 *
 * 校验项：列表 id 唯一 / 条目 id 在列表内唯一 / article 指向的文件存在且能解析 meta
 * 报告项：孤儿文章（在 articles 里但没进任何列表）、缺失文章（索引引用了不存在的文件）
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
const referenced = new Set();

for (const board of BOARD_IDS) {
  const lists = index.boards?.[board]?.lists;
  if (!Array.isArray(lists)) {
    fail(`index.json 缺少 boards.${board}.lists`);
    continue;
  }

  const seenListIds = new Set();
  for (const list of lists) {
    if (!list.id) fail(`boards.${board} 有列表缺 id`);
    if (seenListIds.has(list.id)) fail(`boards.${board} 列表 id 重复：${list.id}`);
    seenListIds.add(list.id);
    if (!list.title) fail(`boards.${board}.${list.id} 缺 title`);
    if (!Array.isArray(list.items)) {
      fail(`boards.${board}.${list.id} 缺 items 数组`);
      continue;
    }

    const seenEntryIds = new Set();
    for (const item of list.items) {
      if (!item.id) fail(`boards.${board}.${list.id} 有条目缺 id`);
      if (seenEntryIds.has(item.id)) fail(`boards.${board}.${list.id} 条目 id 重复：${item.id}`);
      seenEntryIds.add(item.id);

      if (!item.article) {
        fail(`boards.${board}.${list.id}/${item.id} 缺 article`);
        continue;
      }
      if (!articles.has(item.article)) {
        fail(`boards.${board}.${list.id}/${item.id} 指向不存在的文章：${item.article}`);
      } else {
        referenced.add(item.article);
      }
    }
  }
}

for (const slug of articles.keys()) {
  if (!referenced.has(slug)) warn(`文章没进任何列表：${slug}`);
}

// ---------- 报告 ----------
const total = BOARD_IDS.reduce(
  (n, b) => n + (index.boards?.[b]?.lists ?? []).reduce((m, l) => m + (l.items?.length ?? 0), 0),
  0,
);

console.log('');
console.log(`索引：${BOARD_IDS.map((b) => `${b}=${index.boards?.[b]?.lists?.length ?? 0} 列表`).join('  ')}`);
console.log(`文章：${articles.size} 个组件，${total} 条索引引用`);
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
