/**
 * 发布 / 撤回
 *
 *   node tools/publish.mjs status
 *   node tools/publish.mjs publish <slug> [--board list|exploration] [--list <id>] [--id <条目id>]
 *   node tools/publish.mjs unpublish <slug>
 *
 * 约定：
 *   articles/  = 公开区（会进构建、会进仓库）
 *   drafts/    = 私有区（.gitignore 掉，永不提交、永不构建）
 * 发布 = 把文件从 drafts/ 移到 articles/、把 meta.status 改成 published、并写入索引。
 * 撤回 = 反向操作，索引里的条目一并删除。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLES = path.join(ROOT, 'articles');
const DRAFTS = path.join(ROOT, 'drafts');
const INDEX = path.join(ROOT, 'index.json');
const BOARDS = ['list', 'exploration'];

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};

const readIndex = () => JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const writeIndex = (d) => fs.writeFileSync(INDEX, `${JSON.stringify(d, null, 2)}\n`, 'utf8');

function metaDate(source) {
  const m = source.match(/date:\s*'([\d-]+)'/);
  return m ? m[1] : new Date().toISOString().slice(0, 10);
}

function setStatus(source, status) {
  return source.replace(/status:\s*'(published|draft)'/, `status: '${status}'`);
}

function removeFromIndex(index, slug) {
  let removed = 0;
  for (const board of BOARDS) {
    for (const list of index.boards[board]?.lists ?? []) {
      const before = list.items.length;
      list.items = list.items.filter((it) => it.article !== slug);
      removed += before - list.items.length;
    }
  }
  return removed;
}

function ensureList(index, board, listId) {
  const lists = (index.boards[board] ??= { title: board.toUpperCase(), lists: [] }).lists;
  let list = lists.find((l) => l.id === listId);
  if (!list) {
    list = { id: listId, title: listId, desc: '', items: [] };
    lists.push(list);
  }
  list.items ??= [];
  return list;
}

function status() {
  const pub = fs.existsSync(ARTICLES)
    ? fs.readdirSync(ARTICLES).filter((f) => f.endsWith('.astro') && !f.startsWith('_'))
    : [];
  const dra = fs.existsSync(DRAFTS)
    ? fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.astro') && !f.startsWith('_'))
    : [];
  console.log(`公开：${pub.length} 篇  ${pub.map((f) => f.replace(/\.astro$/, '')).join(', ')}`);
  console.log(`私有：${dra.length} 篇  ${dra.map((f) => f.replace(/\.astro$/, '')).join(', ')}`);
}

function publish(slug) {
  const src = path.join(DRAFTS, `${slug}.astro`);
  const dst = path.join(ARTICLES, `${slug}.astro`);

  let source;
  if (fs.existsSync(src)) {
    source = fs.readFileSync(src, 'utf8');
  } else if (fs.existsSync(dst)) {
    console.log(`已经在公开区：articles/${slug}.astro`);
    return;
  } else {
    console.error(`找不到 drafts/${slug}.astro`);
    process.exit(1);
  }

  fs.mkdirSync(ARTICLES, { recursive: true });
  fs.writeFileSync(dst, setStatus(source, 'published'), 'utf8');
  fs.unlinkSync(src);

  const index = readIndex();
  removeFromIndex(index, slug);

  const board = flag('board', 'list');
  if (!BOARDS.includes(board)) {
    console.error(`--board 只能是 ${BOARDS.join(' / ')}`);
    process.exit(1);
  }
  const listId = flag('list', metaDate(source).slice(0, 4));
  const entryId = flag('id', metaDate(source).slice(5));
  const list = ensureList(index, board, listId);

  list.items.push({ id: entryId, article: slug });
  writeIndex(index);

  console.log(`已发布：drafts/${slug}.astro → articles/${slug}.astro`);
  console.log(`索引：${board} / ${listId} / 条目 ${entryId}`);
  console.log('下一步：pnpm gen 校验 + 构建');
}

function unpublish(slug) {
  const src = path.join(ARTICLES, `${slug}.astro`);
  const dst = path.join(DRAFTS, `${slug}.astro`);

  if (!fs.existsSync(src)) {
    console.error(`公开区没有 articles/${slug}.astro`);
    process.exit(1);
  }

  fs.mkdirSync(DRAFTS, { recursive: true });
  fs.writeFileSync(dst, setStatus(fs.readFileSync(src, 'utf8'), 'draft'), 'utf8');
  fs.unlinkSync(src);

  const index = readIndex();
  const removed = removeFromIndex(index, slug);
  writeIndex(index);

  console.log(`已撤回：articles/${slug}.astro → drafts/${slug}.astro`);
  console.log(`索引：删除 ${removed} 条引用`);
  console.log('下一步：pnpm gen 校验 + 构建');
}

if (cmd === 'status') status();
else if (cmd === 'publish' && args[1]) publish(args[1]);
else if (cmd === 'unpublish' && args[1]) unpublish(args[1]);
else {
  console.log('用法：');
  console.log('  node tools/publish.mjs status');
  console.log('  node tools/publish.mjs publish <slug> [--board list|exploration] [--list 2026] [--id 11-25]');
  console.log('  node tools/publish.mjs unpublish <slug>');
}
