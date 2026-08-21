/**
 * Shared rect-intersection math for composition checks. Historically this
 * file also owned the always-on `console.warn` overlap/composition checks
 * that fired unconditionally from `resolveScene.js` on every resolve; that
 * behavior has moved to the opt-in composition-plugin seam
 * (`plugins/overlapGuard.js`, enabled via a project's
 * `config.compositionPlugins`) so a project pays zero cost/noise unless it
 * explicitly asks for the check. This file now only exports the pure
 * geometry helper both the plugin and any future consumer can reuse.
 */
export function rectIntersectionArea(a, b) {
  const ax2 = a.left + a.width;
  const ay2 = a.top + a.height;
  const bx2 = b.left + b.width;
  const by2 = b.top + b.height;
  const xOverlap = Math.max(0, Math.min(ax2, bx2) - Math.max(a.left, b.left));
  const yOverlap = Math.max(0, Math.min(ay2, by2) - Math.max(a.top, b.top));
  return xOverlap * yOverlap;
}
