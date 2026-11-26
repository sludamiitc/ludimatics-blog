// @ts-check
import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// https://astro.build/config
export default defineConfig({
  site: 'https://ludimatics.com',
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
