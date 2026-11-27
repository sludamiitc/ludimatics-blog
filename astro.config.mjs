// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { writeRegistry } from './tools/registry.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * dev 专用插件：让 src/lib/articles.registry.ts 跟着文件变化重写。
 *
 *   dev  → 扫 articles/ + drafts/，草稿和正式文章被完全同样地渲染
 *   构建 → 由 tools/build.mjs 重写成只含 articles/
 *
 * 有了它，"新建一篇文章"不需要任何手工命令，直接访问 /posts/<slug>/ 就能看效果；
 * "发布"就只是把文件从 drafts/ 移到 articles/。
 */
function devRegistry() {
  return {
    name: 'ld-dev-registry',
    apply: 'serve',
    configureServer(server) {
      const rewrite = (why) => {
        const n = writeRegistry(true);
        console.log(`[registry] ${why} → ${n} 篇（含 drafts/）`);
      };
      rewrite('启动');

      const onChange = (file) => {
        const norm = String(file).split(path.sep).join('/');
        if (!/\/(articles|drafts)\/[^/]+\.astro$/.test(norm)) return;
        rewrite(path.basename(norm));
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);

      // 自救：pnpm gen / check 会把注册表改写成"仅 articles/"，那会让正在运行的
      // dev 丢掉所有草稿。这里监听注册表自身，被外部改过就立刻按 dev 的口径重写。
      // writeRegistry 内容相同就不落盘，所以不会互相触发出死循环。
      const REG = path.join(ROOT, 'src', 'lib', 'articles.registry.ts');
      server.watcher.on('change', (file) => {
        if (path.resolve(file) === REG) rewrite('注册表被外部改写');
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://ludimatics.com',
  vite: {
    plugins: [devRegistry()],
  },
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [[rehypeKatex, { strict: false, trust: true }]],
    shikiConfig: {
      themes: { light: 'github-light', dark: 'vitesse-dark' },
      defaultColor: 'light',
      wrap: true,
    },
  },
});
