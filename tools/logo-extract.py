# -*- coding: utf-8 -*-
"""把手写 Logo 的照片转成图标素材

    python tools/logo-extract.py

输入：public/brand/source/logo-handwritten-2026-11-27.jpg
输出：public/brand/*.png（透明底，两套配色 + favicon 尺寸）+ preview.png

做法：
1. 局部背景归一化 —— 抵消照片上的光照渐变（阴影会让全局阈值法失效）；
2. 墨迹 → alpha，保留笔画边缘的灰阶（飞白、勾丝都在这里）；
3. 剔除纸面纤维造成的小墨点（按连通块面积），再取外框；
4. 只换颜色，不动形状；输出多尺寸 PNG。
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "brand", "source", "logo-handwritten-2026-11-27.jpg")
OUT_DIR = os.path.join(ROOT, "public", "brand")
PREVIEW = os.path.join(OUT_DIR, "preview.png")

INK_DARK = (18, 22, 16, 255)      # #121610 亮底用
INK_CREAM = (227, 231, 218, 255)  # #e3e7da 暗底用（站点 --ink）

ALPHA_FLOOR = 0.15   # 低于此值视为纸面噪声；调低会吃笔画，调高会带回阴影
SPECKS = 260         # 小于这么多像素的连通块当灰尘丢掉
LEVELS = 19          # alpha 量化级数：越小文件越小、边缘越硬
SRC_BOLD = 1         # 源级加粗（1024 画布上的 px）：让笔力更足、去毛边
SRC_SMOOTH = 1.6     # 源级平滑（σ）：磨掉纸纹造成的锯齿


def refine(alpha):
    """源级处理：加粗 + 平滑，但保持硬边（平滑后重新拉对比）"""
    if SRC_BOLD > 0:
        alpha = ndi.grey_dilation(alpha, size=SRC_BOLD * 2 + 1)
    if SRC_SMOOTH > 0:
        b = ndi.gaussian_filter(alpha, SRC_SMOOTH)
        alpha = np.clip((b - 0.42) / 0.30, 0.0, 1.0)
    return alpha


def treat_small(a, size):
    """目标级处理：缩小之后才能救小图。

    1024 上把笔画加粗 2px，缩到 32px 只剩 0.06px —— 加粗必须在目标尺寸上做。
    size 越小，对比提得越多、笔画补得越厚；大图不动，避免变成一团粗绳。
    """
    if size > 96:
        return a
    k = 1.0 + (96 - size) / 96 * 1.15      # 64→1.38  48→1.58  32→1.77  16→1.96
    a = np.clip(a * k, 0.0, 1.0)
    a = ndi.grey_dilation(a, size=3)       # 补 1px，保证笔画至少 2px 宽
    return ndi.gaussian_filter(a, 0.35)    # 收一下硬边，避免锯齿


def drop_specks(alpha, min_area=SPECKS):
    mask = alpha > 0.35
    lab, n = ndi.label(mask)
    if n == 0:
        return alpha
    areas = ndi.sum(mask, lab, range(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = areas >= min_area
    kept = ndi.binary_dilation(keep[lab], iterations=2)  # 外扩 2px，保住笔画边缘
    return np.where(kept, alpha, 0.0)


def load_alpha():
    a = np.asarray(Image.open(SRC).convert("L")).astype(np.float32) / 255.0
    # 局部背景：邻域最亮（纸张）再模糊；阴影是低频，墨迹是高频
    paper = ndi.gaussian_filter(ndi.maximum_filter(a, size=31), 24)
    alpha = np.clip((paper - a) / 0.40, 0.0, 1.0)
    alpha = ndi.gaussian_filter(alpha, 1.0)                  # 抗锯齿
    alpha = np.clip((alpha - ALPHA_FLOOR) / (1 - ALPHA_FLOOR), 0.0, 1.0)
    alpha = drop_specks(alpha)
    return np.round(alpha * LEVELS) / LEVELS


def main_bbox(alpha, keep_ratio=0.05, x_min_ratio=0.15):
    mask = alpha > 0.5
    mask[:, : int(alpha.shape[1] * x_min_ratio)] = False
    lab, n = ndi.label(mask)
    if n == 0:
        raise SystemExit("没找到墨迹")
    areas = ndi.sum(mask, lab, range(1, n + 1))
    order = np.argsort(areas)[::-1]
    floor = max(SPECKS, areas[order[0]] * keep_ratio)
    keep = [i + 1 for i in order if areas[i] >= floor]
    ys, xs = np.where(np.isin(lab, keep))
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def cut(alpha, box, pad_ratio=0.08):
    x0, y0, x1, y1 = box
    p = int(max(x1 - x0, y1 - y0) * pad_ratio)
    H, W = alpha.shape
    return alpha[max(0, y0 - p) : min(H, y1 + p), max(0, x0 - p) : min(W, x1 + p)]


def to_image(alpha_crop, color, size):
    """等比放进正方形透明画布，内容居中；小尺寸会自动加料（见 treat_small）"""
    h, w = alpha_crop.shape
    scale = size / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    a_img = Image.fromarray((alpha_crop * 255).astype(np.uint8), "L").resize((nw, nh), Image.LANCZOS)

    a = np.asarray(a_img).astype(np.float32) / 255.0
    a = treat_small(a, size)
    a_img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), "L")

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer = Image.new("RGBA", (nw, nh), color[:3] + (0,))
    layer.putalpha(a_img)
    canvas.paste(layer, ((size - nw) // 2, (size - nh) // 2), layer)
    return canvas


def font(size):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def preview(cream_big, ink_big):
    W, H = 1200, 620
    img = Image.new("RGB", (W, H), (12, 17, 13))
    d = ImageDraw.Draw(img)
    f, f2 = font(15), font(12)
    d.rectangle([W // 2, 0, W, H], fill=(247, 244, 236))

    big = cream_big.resize((330, 330), Image.LANCZOS)
    img.paste(big, (W // 4 - 165, 90), big)
    d.text((24, 24), "暗底 #0c110d · ink #e3e7da", font=f, fill=(180, 184, 172))

    big2 = ink_big.resize((330, 330), Image.LANCZOS)
    img.paste(big2, (W // 2 + W // 4 - 165, 90), big2)
    d.text((W // 2 + 24, 24), "亮底 #f7f4ec · ink #121610", font=f, fill=(80, 84, 78))

    y = 470
    d.text((24, y - 26), "favicon 实际尺寸：16 / 32 / 64", font=f2, fill=(140, 144, 134))
    for base_x, src_img, tone in ((24, cream_big, (140, 144, 134)), (W // 2 + 24, ink_big, (120, 124, 114))):
        x = base_x
        for s in (16, 32, 64):
            ic = src_img.resize((s, s), Image.LANCZOS)
            img.paste(ic, (x, y), ic)
            x += s + 24
    img.save(PREVIEW)
    print("preview:", PREVIEW)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    alpha = load_alpha()
    crop = cut(alpha, main_bbox(alpha))
    crop = refine(crop)

    cream = to_image(crop, INK_CREAM, 1024)
    ink = to_image(crop, INK_DARK, 1024)

    out = {
        "logo-cream-1024.png": cream,          # 主图：印刷 / OG 图 / 任意尺寸来源
        "logo-ink-1024.png": ink,
        "logo-cream-512.png": to_image(crop, INK_CREAM, 512),
        "logo-ink-512.png": to_image(crop, INK_DARK, 512),
        "apple-touch-180.png": to_image(crop, INK_CREAM, 180),
        "favicon-dark-32.png": to_image(crop, INK_CREAM, 32),
        "favicon-light-32.png": to_image(crop, INK_DARK, 32),
    }

    for name, im in out.items():
        im.save(os.path.join(OUT_DIR, name), optimize=True)

    # 老浏览器/爬虫直接请求 /favicon.ico，多尺寸打包一份
    to_image(crop, INK_DARK, 256).save(
        os.path.join(ROOT, "public", "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)]
    )
    print(f"{len(out)} 个文件 → {OUT_DIR}")
    preview(cream, ink)


if __name__ == "__main__":
    main()
