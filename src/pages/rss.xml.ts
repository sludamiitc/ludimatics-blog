import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { loadIndex, loadArticles, latestArticles } from '../lib/index';

export async function GET(context: APIContext) {
  const index = loadIndex();
  const articles = loadArticles();

  return rss({
    title: index.site.title,
    description: index.site.description,
    site: context.site ?? index.site.url,
    items: latestArticles(articles, 100).map((a) => ({
      title: a.title,
      pubDate: new Date(a.date),
      description: a.summary ?? '',
      link: `/posts/${a.slug}/`,
    })),
    customData: '<language>zh-cn</language>',
  });
}
