# 上线步骤

站点是纯静态产物，托管在 Cloudflare Pages。仓库根目录是 `blog/`——**不要把 `Paper/` 整个目录放进仓库**（里面有 20 多 GB 论文库）。

---

## 0. 改域名（如果买到的不是 ludimatics.com）

两个地方，必须一致：

| 文件 | 字段 |
|---|---|
| `astro.config.mjs` | `site: 'https://你的域名'` |
| `index.json` | `site.url` |

---

## 1. 建仓库并推上去

```powershell
cd C:\Users\GroupTheory\Paper\blog
git init -b main
pnpm stage
git commit -m "init: blog skeleton"
```

在 GitHub 新建**空仓库**（不要勾 README / .gitignore / license），然后：

```powershell
git remote add origin https://github.com/<你的账号>/ludimatics-blog.git
git push -u origin main
```

---

## 2. 连 Cloudflare Pages

控制台 → Workers & Pages → Create → Pages → **Connect to Git** → 选这个仓库。

构建配置：

| 项 | 值 |
|---|---|
| Framework preset | Astro |
| Build command | **`pnpm gen`** |
| Build output directory | `dist` |
| 环境变量 | `NODE_VERSION` = `22` |

> 为什么是 `pnpm gen` 而不是 `pnpm build`：`gen` 会先跑索引校验（重复 slug、指向不存在的文章、孤儿文件），通过后再调用 `astro build`，并重新生成 `src/lib/articles.registry.ts`。校验不过就不会部署，等于每次上线都过一遍检查。

第一次构建完成后会拿到 `xxxx.pages.dev`，可以直接访问。

---

## 3. 域名接进来

**3.1 把域名交给 Cloudflare 管 DNS**

1. Cloudflare 控制台 → Add a site → 输入裸域 → 选 Free
2. 拿到两条 NS（形如 `xxx.ns.cloudflare.com`）
3. 回注册商后台改 NS（Porkbun：Authoritative Nameservers；阿里云：DNS 修改）
4. 等 CF 显示 **Active**（5 分钟–24 小时）

自己验：

```powershell
Resolve-DnsName -Name 你的域名 -Type NS -Server 1.1.1.1
```

**3.2 绑定**

Pages 项目 → **Custom domains** → Set up a domain → 填裸域 → Continue。
但**不要**手动在 DNS 里加指向 `xxx.pages.dev` 的 CNAME，会 522。

再加一次 `www.你的域名`。

---

## 4. 绑定后五项设置

| 设置 | 位置 | 值 |
|---|---|---|
| SSL/TLS 模式 | SSL/TLS → Overview | **Full (strict)** |
| 强制 HTTPS | SSL/TLS → Edge Certificates | Always Use HTTPS 开 |
| www → 裸域 | Rules → Redirect Rules | `www.域名/*` → `https://域名/$1`，301 |
| 字体长缓存 | Caching → Cache Rules | `/fonts/*` 边缘缓存 1 年 |
| 邮箱 | Email Routing | `hi@域名` → 你的常用邮箱（免费） |

`/ → /site/` 的 301 已经写在 `public/_redirects`，不用手配。

---

## 5. 公开区与私有区

```
blog/
├── articles/     公开区：会进构建、会进仓库、会出现在线上
├── drafts/       私有区：被 .gitignore 排除，不提交、不构建、不上线
├── index.json    索引（只包含公开区的条目）
└── src/
```

**一篇新文章默认是私有的**：写进 `drafts/`，它既不在仓库里，也不在任何页面上。

发布 / 撤回：

```powershell
pnpm ls                       # 看哪些在公开区、哪些在私有区
pnpm pub <slug>               # drafts/<slug>.astro → articles/，写进 index.json（默认 list 板块、当年）
pnpm pub <slug> --board exploration --list softraster
pnpm pub <slug> --board list --list 2026 --id 11-25
pnpm unpub <slug>             # 反向：移回 drafts/，并删掉索引里的所有引用
```

`pub` 会顺手把文章 `meta.status` 改成 `published`，`unpub` 改回 `draft`。

> 为什么用「移动文件」而不是「加一个布尔字段」：只靠字段，文件仍在公开仓库里，源码照样能被读到。移动文件之后，**未发布的内容在服务器上根本不存在**，这是唯一真正的"不发布"。

## 6. 发布白名单：为什么不用 git add -A

`.gitignore` 是**白名单**模式：第一行 `/*` 忽略一切，之后用 `!` 逐个放行。所以：

- `drafts/`、`node_modules/`、`dist/`、`.astro/`、`AGENTS.md` 永远进不了仓库
- 新出现的、没被放行的文件，默认也不会被提交

`pnpm stage` 只做一件事：读出 `.gitignore` 里所有 `!` 开头的路径，执行 `git add -- <这些路径>`。**清单只有一份**，就在 `.gitignore` 里，不会漂移。

```powershell
pnpm stage --dry    # 只打印清单和被排除的顶层条目
pnpm stage          # 真正暂存
```

要放行新东西（比如以后加 `assets/`），只在 `.gitignore` 里加一行 `!assets/`。

## 7. 日常发布流程

```powershell
pnpm edit        # 浏览器里改索引（板块 / 列表 / 条目）
pnpm pub <slug>  # 如果这篇是新写的
pnpm gen         # 本地校验 + 构建，先确认不报错
pnpm stage       # 只暂存白名单里的路径
git status --short
git commit -m "post: 标题"
git push         # Cloudflare 自动构建上线
```

---

## 排查

| 现象 | 原因 |
|---|---|
| 构建失败，报 registry 缺文章 | `index.json` 里的 `article` 与 `articles/` 文件名不一致，本地 `pnpm check` 会直接指出来 |
| 域名 522 | DNS 里手加了 CNAME 指向 pages.dev，删掉，走 Custom domains |
| 证书一直 pending | 域上有 CAA 记录，需允许 `letsencrypt.org`、`pki.goog`、`ssl.com` |
| 打开是空白或 404 | 构建输出目录填错，必须是 `dist` |
