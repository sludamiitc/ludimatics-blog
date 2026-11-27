/**
 * 发布 / 撤回
 *
 *   node tools/publish.mjs status
 *   node tools/publish.mjs publish <slug>
 *   node tools/publish.mjs unpublish <slug>
 *
 * 约定：
 *   articles/  = 公开区（会进构建、会进仓库）
 *   drafts/    = 私有区（.gitignore 掉，永不提交、永不构建）
 *
 * 发布 = 把文件从 drafts/ 移到 articles/、把 meta.status 改成 published。
 * 归属（进哪几个列表、列表内编号）写在文章自己的 meta.lists 里；
 * 本工具不再读写 index.json —— 索引只描述骨架。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLES = path.join(ROOT, 'articles');
const DRAFTS = path.join(ROOT, 'drafts');

const args = process.argv.slice(2);
const cmd = args[0];

const setStatus = (source, status) => source.replace(/status:\s*'(published|draft)'/, `status: '${status}'`);

function listAstro(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.astro') && !f.startsWith('_'))
    .map((f) => f.replace(/\.astro$/, ''));
}

function status() {
  const pub = listAstro(ARTICLES);
  const dra = listAstro(DRAFTS);
  console.log(`公开：${pub.length} 篇  ${pub.join(', ')}`);
  console.log(`私有：${dra.length} 篇  ${dra.join(', ')}`);
}

function publish(slug) {
  const src = path.join(DRAFTS, `${slug}.astro`);
  const dst = path.join(ARTICLES, `${slug}.astro`);

  if (!fs.existsSync(src)) {
    if (fs.existsSync(dst)) {
      console.log(`已经在公开区：articles/${slug}.astro`);
      return;
    }
    console.error(`找不到 drafts/${slug}.astro`);
    process.exit(1);
  }

  fs.mkdirSync(ARTICLES, { recursive: true });
  fs.writeFileSync(dst, setStatus(fs.readFileSync(src, 'utf8'), 'published'), 'utf8');
  fs.unlinkSync(src);

  console.log(`已发布：drafts/${slug}.astro → articles/${slug}.astro`);
  console.log('归属：由文章 meta.lists 决定；没写就只出现在 LIST');
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

  console.log(`已撤回：articles/${slug}.astro → drafts/${slug}.astro`);
  console.log('下一步：pnpm gen 校验 + 构建');
}

if (cmd === 'status') status();
else if (cmd === 'publish' && args[1]) publish(args[1]);
else if (cmd === 'unpublish' && args[1]) unpublish(args[1]);
else {
  console.log('用法：');
  console.log('  node tools/publish.mjs status');
  console.log('  node tools/publish.mjs publish <slug>');
  console.log('  node tools/publish.mjs unpublish <slug>');
}
