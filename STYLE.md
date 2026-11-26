# 怎么改这个站

三层：**改变量 → 改组件 → 改结构**。先看你要改的东西属于哪一层，别一上来就动 `src/`。

---

## 0. 改之前先起本地服务

```powershell
pnpm dev          # http://localhost:4321/site/
```

改 CSS 会即时刷新。改完满意了再 `pnpm gen` 验证 + 推送。

---

## 1. 只改外观 → 一个文件：`src/styles/global.css`

### 字号（整体缩放）

```css
html { font-size: 16px; }                          /* 手机 */
@media (min-width: 900px)  { html { font-size: 18px; } }
@media (min-width: 1200px) { html { font-size: 19px; } }
@media (min-width: 1700px) { html { font-size: 21px; } }
```

**改这四个数，整站等比缩放**（栏宽、行高、边距全跟着变），因为所有尺寸都用 `rem`。

单独调某处（比如标题太大）：

| 元素 | 选择器 |
|---|---|
| 文章标题 | `.post h1` |
| 板块页大标题 | `.page-title` |
| 首页引言标题 | `.thesis h1` / `.portal h1` |
| 正文 | `.prose`（`font-size: 1rem`） |
| 方块标题/条目 | `.blk-head` / `.blk-list a` |

### 颜色

深色在 `:root:not([data-theme="light"])` 和 `:root[data-theme="dark"]` **两处**（系统偏好 / 手动切换），改的时候两处都要改。

```css
--paper: #0c110d;    /* 纸：黑中带绿 */
--paper-2: #131a14;  /* 次级底色：代码块、微标 */
--ink: #e3e7da;      /* 正文 */
--ink-soft: #b4b8ac;  /* 次级文字 */
--ink-faint: #7f847a; /* 日期、计数这类 */
--rule: #222b23;     /* 分隔线 */
--accent: #d08d80;   /* 强调（<strong>、状态徽章） */
--link: #a6c8b2;     /* 链接 */
```

浅色在文件顶部的 `:root` 里，同一套变量名。

### 三栏宽度（文章页）

```css
@media (min-width: 1200px) {
  :root {
    --measure: 34rem;   /* 正文栏 */
    --toc-col: 12rem;   /* 左侧目录 */
    --rail-col: 15rem;  /* 右边注 */
    --gutter: 1.8rem;
  }
}
```

### 方块布局（三个板块页）

```css
.blk-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 1000px) { .blk-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px)  { .blk-grid { grid-template-columns: 1fr; } }
```

改列数就改这三个 `repeat()`。首页那两栏是 `.cols`，同理。

### 方块卡片本身

```css
.blk { padding: .75rem .85rem .85rem; border: 1px solid var(--rule); border-radius: 2px; }
```

想要无边框的纯文字方块，删掉 `border` 和 `padding` 两行即可。

---

## 2. 改内容和结构 → `src/`

| 想改 | 文件 |
|---|---|
| 首页/SITE 的引言、导航句 | `src/pages/site/index.astro` |
| LIST 板块（时间线） | `src/pages/list/index.astro` |
| EXPLORATION 板块（项目卡） | `src/pages/exploration/index.astro` |
| 单个列表页 | `src/pages/{site,list,exploration}/[list].astro` |
| 文章页模板（标题、面包屑、目录） | `src/layouts/Article.astro` |
| 全站页头页脚（导航、阅读控件） | `src/layouts/Base.astro` |
| 方块组件 | `src/components/Block.astro` |
| 边注 `<Note>` | `src/components/Note.astro` |
| 公式 `<Math>`、代码 `<Code>` | `src/components/*.astro` |
| 关于页 | `src/pages/about.astro` |
| 站名、域名、邮箱 | `index.json` 的 `site` 段 + `astro.config.mjs` 的 `site` |

---

## 3. 新增一个板块（比如 TOPIC）

四处，缺一不可：

```
① index.json          "boards" 里加 "topic": { title, note, lists: [] }
② src/lib/index.ts    BoardId 类型加上 'topic'
③ src/pages/topic/index.astro        照抄 exploration/index.astro 改文案
   src/pages/topic/[list].astro      照抄单列表页
④ src/layouts/Base.astro  nav 里加一行 <a href="/topic/">TOPIC</a>
   tools/build.mjs         BOARD_IDS 常量加上 'topic'
   tools/publish.mjs       BOARDS 常量加上 'topic'
```

`BOARD_IDS` 不是可有可无的：校验器和发布器都靠它枚举板块，漏了就检查不到。

---

## 4. 写作和发布流程

```powershell
# 新建草稿（进 drafts/，不进仓库、不上线）
#   方式一：pnpm edit → 底部「新建文章」
#   方式二：直接在 drafts/ 里写一个 .astro

pnpm ls                  # 看哪些在公开区、哪些在私有区
pnpm pub <slug>          # drafts/x.astro → articles/y，写进索引
pnpm gen                 # 校验（BOM、索引、文章引用）+ 构建
pnpm stage               # 只暂存白名单里的路径
git commit -m "post: …"
git push                 # Cloudflare 自动构建，1–2 分钟上线
```

---

## 5. 三个常踩的坑

**① 别用 PowerShell 的 `Set-Content -Encoding utf8` 改文件**

PowerShell 5.1 会写 BOM，Vite 读 `package.json` 直接崩。`pnpm gen` 现在会拦住并报出文件名。要改就用编辑器，或者用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`。

**② 文章里的 LaTeX 必须用 `String.raw`**

```astro
<Math tex={String.raw`\frac{a}{b}`} />     ← 对
<Math tex="\frac{a}{b}" />                 ← 错：\f 会被当转义符
```

**③ 索引里引用的 slug 必须等于 `articles/` 下的文件名**

`pnpm gen` 会直接指出来是哪个对不上。

---

## 6. 排查

| 现象 | 先看哪 |
|---|---|
| 构建失败 | `pnpm gen` 的输出，它比 Cloudflare 日志早一步告诉你 |
| 页面 404 | `index.json` 里有没有这条；`articles/` 里文件在不在 |
| 线上没更新 | Cloudflare → Deployments 看最新一次构建是不是 Success |
| 字体不对 | `curl -I https://你的域名/fonts/XCharter-Regular.woff2` |
