/**
 * 索引编辑器 —— 本地网页版
 *
 *   pnpm edit        然后打开 http://127.0.0.1:7777
 *
 * 三级维护：板块（SITE / LIST / EXPLORATION）→ 列表 → 条目（指向 articles/<slug>.astro）
 * 只读写 index.json；文章的标题、日期、标签在文章自己的 meta 里，这里只读不写。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'index.json');
const ARTICLES_DIR = path.join(ROOT, 'articles');
const DRAFTS_DIR = path.join(ROOT, 'drafts');
const EDITOR_HTML = path.join(ROOT, 'tools', 'editor.html');
const PORT = Number(process.env.PORT ?? 7777);

const BOARDS = ['list', 'exploration'];

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
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function articlePool() {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  return fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith('.astro') && !f.startsWith('_'))
    .map((file) => {
      const slug = file.replace(/\.astro$/, '');
      const meta = extractMeta(fs.readFileSync(path.join(ARTICLES_DIR, file), 'utf8')) ?? {};
      return { slug, title: meta.title ?? slug, date: meta.date ?? '', tags: meta.tags ?? [] };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

const readIndex = () => JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));

function writeIndex(data) {
  fs.copyFileSync(INDEX_PATH, `${INDEX_PATH}.bak`);
  fs.writeFileSync(INDEX_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 4 * 1024 * 1024) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const TEMPLATE = (title) => `---
import Math from '../src/components/Math.astro';
import Code from '../src/components/Code.astro';
import Note from '../src/components/Note.astro';

export const meta = {
  title: '${title}',
  subtitle: '',
  date: '${new Date().toISOString().slice(0, 10)}',
  tags: [],
  summary: '',
  status: 'draft',
};
---

<p>开头第一段。</p>

<h2>第一节</h2>

<p>正文。行内公式用 <Math tex="a^2 + b^2 = c^2" />。</p>

<Note n="1">这条会出现在右侧留白里（宽屏）。</Note>
`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(EDITOR_HTML));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/index') {
      json(res, 200, { index: readIndex(), pool: articlePool(), boards: BOARDS });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      const body = await readBody(req);
      if (!body.index?.boards) {
        json(res, 400, { error: '缺少 index.boards' });
        return;
      }
      writeIndex(body.index);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/new') {
      const { slug, title } = await readBody(req);
      if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        json(res, 400, { error: 'slug 只能用小写字母、数字、连字符' });
        return;
      }
      const file = `${slug}.astro`;
      const target = path.join(DRAFTS_DIR, file);
      if (fs.existsSync(target)) {
        json(res, 409, { error: `已存在 drafts/${file}` });
        return;
      }
      fs.mkdirSync(DRAFTS_DIR, { recursive: true });
      fs.writeFileSync(target, TEMPLATE(title || slug), 'utf8');
      json(res, 200, { ok: true, file, slug });
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`索引编辑器： http://127.0.0.1:${PORT}`);
  console.log(`索引文件：   ${INDEX_PATH}`);
});
