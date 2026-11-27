# -*- coding: utf-8 -*-
"""把手写标描成矢量（全分辨率）

与旧版的区别：
  1. 轮廓在**原始分辨率**上取（1773×2364），不先缩到 1024 —— 少了重采样这道损失；
  2. 连通块按**相对面积**过滤（≥ 最大块的 1%），而不是绝对像素数 ——
     降采样后残留的墨点碎片不会再被当成笔画，bbox 不会被顶歪；
  3. 谐波阶数 K 由**容差自动选**（默认 max 偏差 ≤ 1.5px），不拍脑袋；
  4. SVG 用字形自身的 bbox 作 viewBox，不塞进正方形画布 —— 不留空白。

    python tools/logo-vector.py
输出：public/brand/logo.svg、test/logo-vector.png
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "brand", "source", "logo-handwritten-2026-11-27.jpg")
SVG_OUT = os.path.join(ROOT, "public", "brand", "logo.svg")
PNG_OUT = os.path.join(os.path.dirname(ROOT), "test", "logo-vector.png")

LEVEL = 0.5            # 等值线阈值
KEEP_REL = 0.01        # 连通块保留阈值：最大块面积的 1%
TOLERANCE = 1.5        # 允许的轮廓偏差（原始像素）
N_SAMPLE = 4096        # 每条轮廓的重采样点数


# ---------------- alpha ----------------
def base_alpha():
    a = np.asarray(Image.open(SRC).convert("L")).astype(np.float32) / 255.0
    # 局部背景：邻域最亮（纸张）再模糊，抵消光照与阴影
    paper = ndi.gaussian_filter(ndi.maximum_filter(a, size=31), 24)
    al = np.clip((paper - a) / 0.40, 0, 1)
    al = ndi.gaussian_filter(al, 1.0)                 # 只做轻度去噪
    al = np.clip((al - 0.15) / 0.85, 0, 1)
    return al


def main_components(al, rel=KEEP_REL):
    """只看"够大"的连通块：墨点、纸纤维一律不算笔画"""
    mask = al > 0.45
    lab, n = ndi.label(mask)
    areas = ndi.sum(mask, lab, range(1, n + 1))
    biggest = areas.max()
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = areas >= biggest * rel
    kept = keep[lab]
    return np.where(kept, al, 0.0), int(keep.sum()), [(int(a)) for a in sorted(areas[keep[1:]], reverse=True)]


def crop_to(alpha, pad_ratio=0.015):
    ys, xs = np.where(alpha > LEVEL)
    p = int(max(xs.max() - xs.min(), ys.max() - ys.min()) * pad_ratio)
    H, W = alpha.shape
    x0, y0 = max(0, xs.min() - p), max(0, ys.min() - p)
    x1, y1 = min(W, xs.max() + p + 1), min(H, ys.max() + p + 1)
    return alpha[y0:y1, x0:x1]


# ---------------- 轮廓 ----------------
def contour_segments(a, level=LEVEL):
    H, W = a.shape
    p = np.pad(a, 1)
    tl, tr = p[:-1, :-1], p[:-1, 1:]
    br, bl = p[1:, 1:], p[1:, :-1]
    idx = (
        (tl > level).astype(np.uint8) * 8
        + (tr > level).astype(np.uint8) * 4
        + (br > level).astype(np.uint8) * 2
        + (bl > level).astype(np.uint8)
    )
    ys, xs = np.nonzero((idx != 0) & (idx != 15))
    segs = []
    for y, x in zip(ys, xs):
        t, r_, b_, l_ = tl[y, x], tr[y, x], br[y, x], bl[y, x]

        def edge(a1, a2):
            if (a1 > level) == (a2 > level):
                return None
            return float((level - a1) / (a2 - a1))

        et, er, eb, el = edge(t, r_), edge(r_, b_), edge(l_, b_), edge(t, l_)
        pts = []
        if et is not None:
            pts.append((x + et, y))
        if er is not None:
            pts.append((x + 1, y + er))
        if eb is not None:
            pts.append((x + eb, y + 1))
        if el is not None:
            pts.append((x, y + el))
        if len(pts) == 2:
            segs.append((pts[0], pts[1]))
        elif len(pts) == 4:
            c = (t + r_ + b_ + l_) / 4
            top, right, bottom, left = pts if pts[0][1] == y else pts[::-1]
            if c > level:
                segs += [(top, left), (right, bottom)]
            else:
                segs += [(top, right), (left, bottom)]
    return [((a_[0] - 1, a_[1] - 1), (b_[0] - 1, b_[1] - 1)) for a_, b_ in segs]


def link(segs, tol=1e-3):
    from collections import defaultdict

    def key(p):
        return (round(p[0] / tol), round(p[1] / tol))

    adj = defaultdict(list)
    for i, (u, v) in enumerate(segs):
        adj[key(u)].append((i, v))
        adj[key(v)].append((i, u))

    used = [False] * len(segs)
    loops = []
    for i, (u, v) in enumerate(segs):
        if used[i]:
            continue
        used[i] = True
        path = [u, v]
        cur = v
        while True:
            nxt = None
            for j, other in adj[key(cur)]:
                if not used[j]:
                    nxt = (j, other)
                    break
            if nxt is None:
                break
            used[nxt[0]] = True
            cur = nxt[1]
            path.append(cur)
            if key(cur) == key(path[0]):
                break
        if len(path) > 30 and key(path[-1]) == key(path[0]):
            loops.append(np.array(path[:-1], float))
    return loops


# ---------------- 频域 ----------------
def resample(loop, n=N_SAMPLE):
    closed = np.vstack([loop, loop[:1]])
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(closed, axis=0), axis=1))]
    t = np.linspace(0, d[-1], n, endpoint=False)
    return np.interp(t, d, closed[:, 0]) + 1j * np.interp(t, d, closed[:, 1])


def fourier(z, keep):
    Z = np.fft.fft(z)
    n = len(Z)
    m = np.zeros(n, bool)
    m[:keep] = True
    m[-keep + 1 :] = True
    return np.fft.ifft(Z * m)


def auto_keep(z, tol=TOLERANCE, cands=(40, 60, 90, 120, 160, 220, 300, 420, 600)):
    """选最小的 K，使最大偏差 ≤ tol（像素）"""
    best = cands[-1]
    for k in cands:
        if np.abs(fourier(z, k) - z).max() <= tol:
            best = k
            break
    return best


# ---------------- SVG ----------------
def to_path(z, step=8):
    n = len(z)
    d = [f"M{z[0].real:.1f} {z[0].imag:.1f}"]
    for i in range(0, n, step):
        p0, p1 = z[(i - step) % n], z[i]
        p2, p3 = z[(i + step) % n], z[(i + 2 * step) % n]
        c1 = p1 + (p2 - p0) / 6.0
        c2 = p2 - (p3 - p1) / 6.0
        d.append(f"C{c1.real:.1f} {c1.imag:.1f} {c2.real:.1f} {c2.imag:.1f} {p2.real:.1f} {p2.imag:.1f}")
    d.append("Z")
    return "".join(d)


def signed_area(xy):
    x, y = xy[:, 0], xy[:, 1]
    return 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)


def main():
    al = base_alpha()
    al, kept_n, kept_areas = main_components(al)
    print(f"连通块：保留 {kept_n} 个，面积 {kept_areas}")

    crop = crop_to(al)
    h, w = crop.shape
    print(f"字形 bbox：{w} × {h}（原始分辨率）")

    loops = link(contour_segments(crop))
    loops.sort(key=lambda l: -abs(signed_area(l)))
    print("轮廓点数：", [len(l) for l in loops])

    smooth, picks = [], []
    for l in loops:
        z = resample(l)
        k = auto_keep(z)
        picks.append(k)
        smooth.append(fourier(z, k))
        print(f"  轮廓 {len(l):6d} 点 → K={k:3d}，最大偏差 {np.abs(fourier(z, k) - z).max():.2f}px")

    paths = "".join(f'<path d="{to_path(z)}"/>' for z in smooth)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'role="img" aria-label="Ludimatics">'
        f"<style>path{{fill:currentColor}}"
        f"@media (prefers-color-scheme:dark){{path{{fill:#e3e7da}}}}</style>"
        f'<g fill-rule="evenodd">{paths}</g></svg>'
    )
    with open(SVG_OUT, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"svg: {SVG_OUT}  {len(svg)} bytes  {len(smooth)} paths  K={picks}")

    # ---- 预览：把矢量轮廓栅格化，跟原图并排看 ----
    def raster(size, color):
        S = 6
        canvas = Image.new("L", (size * S, size * S), 0)
        dr = ImageDraw.Draw(canvas)
        sx, sy = size * S / w, size * S / h
        polys = [[(p.real * sx, p.imag * sy) for p in z] for z in smooth]

        def inside(pt, poly):
            x, y = pt
            c = False
            for i in range(len(poly)):
                x1, y1 = poly[i]
                x2, y2 = poly[(i + 1) % len(poly)]
                if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                    c = not c
            return c

        for i, poly in enumerate(polys):
            depth = sum(inside(poly[0], q) for j, q in enumerate(polys) if j != i)
            dr.polygon(poly, fill=255 if depth % 2 == 0 else 0)
        small = canvas.resize((size, size), Image.LANCZOS)
        out = Image.new("RGBA", (size, size), color + (0,))
        out.putalpha(small)
        return out

    W, H = 1100, 560
    img = Image.new("RGB", (W, H), (12, 17, 13))
    d = ImageDraw.Draw(img)
    try:
        f_ = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 14)
    except Exception:
        f_ = ImageFont.load_default()
    x = 30
    for s in (16, 32, 48, 64, 96):
        ic = raster(s, (227, 231, 218))
        big = ic.resize((max(s, 48), max(s, 48)), Image.NEAREST)
        img.paste(big, (x, 80), big)
        d.text((x, 44), f"{s}px", font=f_, fill=(150, 154, 144))
        x += max(s, 48) + 26
    big = raster(320, (227, 231, 218))
    img.paste(big.resize((320, 320), Image.LANCZOS), (30, 200), big.resize((320, 320), Image.LANCZOS))
    d.text((370, 210), f"矢量 320px：K={'/'.join(map(str, picks))}，偏差 ≤ {TOLERANCE}px", font=f_, fill=(150, 154, 144))
    img.save(PNG_OUT)
    print("preview:", PNG_OUT)


if __name__ == "__main__":
    main()
