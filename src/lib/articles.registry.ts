// 由 tools/build.mjs 自动生成；不要手改。
// 作用：把 slug → 文章组件 的映射写成显式代码，避免约定式发现。
export const registry: Record<string, () => Promise<{ default: unknown }>> = {
  "devlog-first-renderer": () => import('../../articles/devlog-first-renderer.astro'),
  "note-brdf-importance-sampling": () => import('../../articles/note-brdf-importance-sampling.astro'),
};
