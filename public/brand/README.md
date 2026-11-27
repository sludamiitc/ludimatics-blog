# 站标（手写 Lud 标）

## 来源

`source/logo-handwritten-2026-11-27.jpg` —— 手写原稿的照片，**这是唯一的原件**。
别删。所有图标都是从它派生出来的。

## 派生文件

| 文件 | 用途 |
|---|---|
| `logo.svg` | **站头用的就是它**。全分辨率描的矢量，`viewBox` 紧贴墨迹，暗色主题自动换色 |
| `logo-cream-1024.png` / `-512.png` | 位图主图（印刷、OG 图、需要 PNG 的场合） |
| `logo-ink-1024.png` / `-512.png` | 同上，亮底墨色版 |
| `favicon-dark-32.png` | 暗色主题标签页（SVG 不被支持时的兜底） |
| `favicon-light-32.png` | 亮色主题标签页 |
| `apple-touch-180.png` | iOS 主屏图标 |
| `../favicon.ico` | `/favicon.ico`，16/32/48 打包，老浏览器与爬虫的兜底 |
| `preview.png` | 两套配色的对照预览 |

站头与 `<head>` 的引用在 `src/layouts/Base.astro`；SVG 优先，PNG/ICO 兜底。

## 重新生成

```powershell
python tools/logo-extract.py        # 或者 pnpm logo
```

需要 Python 3 + numpy / scipy / Pillow。脚本做的事：

1. 局部背景归一化（邻域最亮值模糊成背景图），抵消照片上的光照与阴影；
2. 墨迹映射成 alpha，保留笔画边缘灰阶 —— 飞白和勾丝都在这一步保住；
3. 按连通块面积剔除纸面纤维造成的小墨点；
4. 只替换颜色，形状一个像素都不动。

三个可调参数在脚本顶部：`ALPHA_FLOOR`（门槛）、`SPECKS`（灰尘面积）、`LEVELS`（量化级数）。

## 注意

- 这张图是**位图**，没有矢量版本。16px 的 favicon 已经接近极限，笔锋细节在那个尺寸下没有位置。
  若要印刷或大幅放大，需要先用 potrace 之类转成 SVG。
- `public/` 下的文件会被原样发布到网站，所以 `source/logo-handwritten-2026-11-27.jpg`
  在线上也能访问（`/brand/source/...`）。想只存仓库不公开，得把它移到非 `public/` 的目录
  并在 `.gitignore` 白名单里放行。
