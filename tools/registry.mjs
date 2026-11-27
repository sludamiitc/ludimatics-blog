/**
 * 注册表生成器 —— src/lib/articles.registry.ts
 *
 *   node tools/registry.mjs                只扫 articles/（构建用）
 *   node tools/registry.mjs --with-drafts  扫 articles/ + drafts/（dev 用）
 *
 * 为什么要有这个文件：文章的路由用显式 import，不用 import.meta.glob
 * （约定式发现会让"哪篇文章存在"变成一个推断出来的事实）。
 * 代价是这份清单必须跟着文件走，所以它在 dev 里由 astro.config.mjs 的
 * 插件自动重写、在构建前由 tools/build.mjs 重写。
 *
 * 生成物不进仓库：.gitignore 里挡掉了，否则 dev 生成的 drafts/ 路径
 * 会被提交上去，CI 上找不到 drafts/ 直接构建失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'lib', 'articles.registry.ts');

/** 收集 slug；同名时 articles/ 覆盖 drafts/ */
export function collectSlugs(withDrafts) {
  const found = new Map();
  const add = (dir) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const file of fs.readdirSync(abs)) {
      if (!file.endsWith('.astro') || file.startsWith('_')) continue;
      found.set(file.replace(/\.astro$/, ''), { slug: file.replace(/\.astro$/, ''), dir });
    }
  };
  if (withDrafts) add('drafts'); // 先草稿，再让正式文章覆盖
  add('articles');
  return [...found.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/** 重写注册表，返回条目数；内容没变就不写盘（避免无意义的热更新） */
export function writeRegistry(withDrafts) {
  const entries = collectSlugs(withDrafts);
  const source = [
    '// 由 tools/registry.mjs 自动生成，不要手改，也不进仓库。',
    `// 本次生成：${withDrafts ? 'articles/ + drafts/' : '仅 articles/'}`,
    'export const registry: Record<string, () => Promise<{ default: unknown }>> = {',
    ...entries.map((e) => `  ${JSON.stringify(e.slug)}: () => import('../../${e.dir}/${e.slug}.astro'),`),
    '};',
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (prev !== source) fs.writeFileSync(OUT, source, 'utf8');
  return entries.length;
}

// 直接 node tools/registry.mjs 时当作命令行
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const withDrafts = process.argv.includes('--with-drafts');
  const n = writeRegistry(withDrafts);
  console.log(`注册表：${n} 个条目（${withDrafts ? '含 drafts/' : '仅 articles/'}）→ src/lib/articles.registry.ts`);
}
