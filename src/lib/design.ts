/**
 * 设计层的唯一真源。
 *
 * 方块的宽度要"精确等于文本长度"，就必须知道字号和字距 ——
 * 这些数字如果 CSS 写一份、页面脚本再写一份，早晚会漂。
 * 所以：
 *
 *   这里是唯一的数字；
 *   layouts/Base.astro 用 designVars() 把同一批数字注入成 CSS 变量；
 *   global.css 只引用 var(--blk-*)，不再出现任何字面量；
 *   exploration/index.astro 调 blockSpan() / blockHeight()，也不写数字。
 *
 * 于是"改字号"只需要改这一个文件。
 */

export const DESIGN = {
  /** .blk-head 的字号（rem）与字距（em）；一个字实际占 headSize + headTracking */
  headSize: 0.69,
  headTracking: 0.16,
  /** .blk-list a 的字号（rem） */
  linkSize: 0.78,
  /** .blk-mark 的 flex-basis（rem）与列表项 gap（rem） */
  markBasis: 2.6,
  listGap: 0.55,
  /** .blk 的右内边距（em），同时充当列间距 */
  padRight: 1.5,
  /** 方块最小跨度（格）与每行高度（rem） */
  minSpan: 9,
  rowUnit: 2.15,
} as const;

/**
 * 视觉长度：全角字符算 1，半角算 0.55，空格 0.32。
 * 单位是"字号"，不是像素 —— 换算成实际宽度要看下面各自的字号。
 */
export function vlen(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === ' ') n += 0.32;
    else if (/[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch)) n += 1;
    else n += 0.55;
  }
  return n;
}

/**
 * 一个列表方块占几格（1 格 = 1em = 一个汉字包围盒）。
 * 取「标题」与「最宽的预览链接（含日期列）」中较宽的那个，向上取整。
 */
export function blockSpan(title: string, linkTitles: string[]): number {
  const head = vlen(title) * (DESIGN.headSize + DESIGN.headTracking);
  const links = linkTitles.map(
    (t) => vlen(t) * DESIGN.linkSize + DESIGN.markBasis + DESIGN.listGap,
  );
  const need = Math.max(head, 0, ...links);
  return Math.max(DESIGN.minSpan, Math.ceil(need + DESIGN.padRight));
}

/** 方块的最小高度：标题 + 每条链接 1 行 + 底部「项目页 →」 */
export function blockHeight(shownCount: number): string {
  return `calc(${2 + shownCount} * ${DESIGN.rowUnit}rem)`;
}

/** 注入到 :root 的 CSS 变量，与 global.css 里的 var(--blk-*) 一一对应 */
export function designVars(): string {
  return [
    `--blk-head:${DESIGN.headSize}rem`,
    `--blk-head-track:${DESIGN.headTracking}em`,
    `--blk-link:${DESIGN.linkSize}rem`,
    `--blk-mark:${DESIGN.markBasis}rem`,
    `--blk-gap:${DESIGN.listGap}rem`,
    `--blk-pad:${DESIGN.padRight}em`,
  ].join(';');
}
