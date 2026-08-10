import React from "react";
import { interpolate } from "remotion";

/**
 * Shared highlighter-stroke renderer used by KineticText (and any text asset
 * that wants an inline marker). Mirrors the math in the standalone TextHighlight
 * asset (so an author's mental model carries over), but packaged as an inline
 * overlay that paints over the text glyphs of whichever text asset hosts it —
 * no separate anchored asset, no manual anchor alignment needed.
 *
 * OFF by default (no `highlighter` block on the resolved style, or
 * `highlighter.enabled` is falsy) → returns `null` and the host component
 * renders exactly as before. Strict additive opt-in per the no-op rule —
 * existing manifests with no `highlighter` key resolve byte-for-byte.
 *
 * The block:
 *   styleOverride: {
 *     highlighter: {
 *       enabled: true,                       // presence alone does NOT enable
 *       color: "#FFE600" | colorToken: "...", // raw hex OR theme color token
 *       mode: "band" | "underline",          // filled band (default) or thin stroke under text
 *       height: 32,                           // band height in px (band). Omit → auto-fit to the measured line height.
 *       barThickness: 4,                      // underline thickness in px (underline mode)
 *       opacity: 0.75,                        // 0..1
 *       blur: 4,                              // gaussian blur in px (band mode only)
 *       direction: "left" | "right",          // sweep direction (default right)
 *       sweepStartFraction: 0,                // where in the active window the sweep begins (0..1)
 *       sweepDurationFraction: 0.7            // sweep length as a fraction of the active window (0..1)
 *     }
 *   }
 *
 * === Multi-line / wrapping behaviour ===
 * When the host passes `lineBoxes` (one rect per word in the wrapper's local
 * coordinate space, measured from the live DOM), the highlighter groups words
 * into the lines the browser actually wrapped to and drags the marker across
 * those lines in reading order:
 *   - band mode paints one band per wrapped line; each band's height defaults
 *     to that line's measured glyph-box height, so the marker auto-fits over
 *     the entire text (every line, not just the first). Each band fills left
 *     →right (or right→left) only as the sweep reaches it, so a line that the
 *     text breaks onto is only marked once the sweep has crossed onto it.
 *   - underline mode draws one thin bar per line at the line's baseline; the
 *     underline follows the sweep onto each new line as it breaks.
 * When `lineBoxes` is absent (e.g. on the very first paint before the host's
 * layout effect runs, or for hosts that only pass `size`), it falls back to a
 * single band sized to `size` — the original behaviour.
 *
 * Pipeline2 runs `resolveColorToken` on every string color field inside the
 * `highlighter` block (color, colorToken, markerColor, markerColorToken, …),
 * so by the time this component runs every color-ish field is already a hex
 * literal. Two naming conventions are supported: `color`/`colorToken` (primary)
 * and `markerColor`/`markerColorToken` (standalone TextHighlight-compatible).
 * Preference: `*Token` field ⇒ matching plain field ⇒ built-in default.
 */

const DEFAULTS = {
  enabled: false,
  color: "#FFE600",
  colorToken: null,
  mode: "band",
  height: null, // null ⇒ auto-fit to measured line height
  barThickness: 4,
  opacity: 0.75,
  blur: 4,
  direction: "right",
  sweepStartFraction: 0,
  sweepDurationFraction: 0.7,
};

/**
 * Group per-word rects (in wrapper-local coords) into wrapped lines, in
 * reading order. Words sharing the same `top` (within a tolerance) are one
 * line; the line spans from the leftmost word left to the rightmost
 * word right and takes the max height seen on that line.
 *
 * Returns null when the input is unusable so the caller can fall back.
 */
function groupLines(wordBoxes) {
  if (!Array.isArray(wordBoxes) || wordBoxes.length === 0) return null;
  const ROUND = 2; // px tolerance for "same line" (sub-pixel wrap jitter)
  const lines = [];
  for (const b of wordBoxes) {
    const top = Math.round(b.top / ROUND) * ROUND;
    let line = lines.find((l) => l.top === top);
    if (!line) {
      line = { top, left: b.left, right: b.left + b.width, height: b.height };
      lines.push(line);
    } else {
      line.left = Math.min(line.left, b.left);
      line.right = Math.max(line.right, b.left + b.width);
      line.height = Math.max(line.height, b.height);
    }
  }
  lines.sort((a, b) => a.top - b.top || a.left - b.left);
  return lines.map((l) => ({ ...l, width: Math.max(0, l.right - l.left) }));
}

/**
 * @param {object} props
 * @param {number} props.frame  current scene-local frame from useCurrentFrame()
 * @param {number} props.enterAtFrame  host asset's enterAtFrame
 * @param {number} props.exitAtFrame  host asset's exitAtFrame
 * @param {number} props.durationInFrames  host's `timing.durationInFrames`
 * @param {number} props.envelope  host's already-computed {enter,exit} opacity (0..1).
 *        The highlighter multiplies on top of this so the stroke fades in/out
 *        with its parent rather than independently.
 * @param {{width:number, height:number}} [props.size] fallback single-box the
 *        highlighter sweeps across when `lineBoxes` is unavailable.
 * @param {Array<{top:number,left:number,width:number,height:number}>} [props.lineBoxes]
 *        per-word rects in the wrapper's local coordinate space; grouped into
 *        wrapped lines so the marker tracks real line breaks.
 * @param {object} [props.highlighter] the resolved `styleOverride.highlighter`
 *        block from pipeline2
 * @returns {import('react').ReactElement|null}
 */
export function HighlighterOverlay({
  frame,
  enterAtFrame,
  exitAtFrame,
  durationInFrames,
  envelope,
  size,
  lineBoxes,
  highlighter,
}) {
  const h = highlighter;
  if (!h || h.enabled !== true) return null;

  const cfg = { ...DEFAULTS, ...h };
  const color =
    cfg.colorToken ?? cfg.color ?? cfg.markerColorToken ?? cfg.markerColor ?? DEFAULTS.color;
  const direction = cfg.direction === "left" ? "left" : "right";
  const reverse = direction === "left";

  const activeFrames = Math.max(1, (exitAtFrame ?? durationInFrames) - enterAtFrame);
  const sweepStartFraction = Math.max(0, Math.min(1, cfg.sweepStartFraction ?? 0));
  const sweepDurationFraction = Math.max(0.01, Math.min(1, cfg.sweepDurationFraction ?? 0.7));
  const sweepStartFrame = enterAtFrame + Math.round(activeFrames * sweepStartFraction);
  const sweepDurationFrames = Math.max(1, Math.round(activeFrames * sweepDurationFraction));
  const sweepEndFrame = sweepStartFrame + sweepDurationFrames;
  const sweep = interpolate(
    frame,
    [sweepStartFrame, sweepEndFrame],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const bandOpacity = Math.max(0, Math.min(1, envelope)) * Math.max(0, Math.min(1, cfg.opacity));
  const authorHeight = typeof cfg.height === "number" ? Math.max(2, cfg.height) : null;
  const blur = cfg.blur > 0 ? `blur(${cfg.blur}px)` : undefined;

  const baseStyle = {
    position: "absolute",
    background: color,
    borderRadius: 2,
    opacity: bandOpacity,
  };

  const lines = groupLines(lineBoxes);

  // ---- multi-line path: one marker per wrapped line -----------------------
  if (lines && lines.length > 0) {
    // Map global sweep [0,1] onto the concatenated line widths so the sweep
    // reads continuously across line breaks in reading order. totalW is the
    // drag distance of the conceptual highlighter pen across all lines.
    // Reverse direction sweeps the same band, just right→left, so we render
    // lines in reverse order and invert each line's local fill direction.
    const ordered = reverse ? [...lines].reverse() : lines;
    const totalW = ordered.reduce((sum, l) => sum + l.width, 0) || 1;
    let acc = 0; // running start offset of the current line within totalW
    const markers = ordered.map((line, i) => {
      const startFrac = acc / totalW;
      const lineFrac = line.width / totalW;
      acc += line.width;
      // local sub-progress of the sweep WITHIN this line, 0..1, clamped so a
      // line only starts filling once the sweep has reached it and stays full
      // once the sweep has passed it.
      let local = (sweep - startFrac) / lineFrac;
      local = Math.max(0, Math.min(1, local));
      // For reverse direction we want the band to grow from the line's right
      // edge leftward; flip the local fill so width still represents the
      // painted span but anchored on the right.
      const fillW = local * line.width;
      const lineTop = line.top;
      // Band height auto-fits the measured line height unless the author
      // pinned one — "fit over the entire text".
      const bandH = authorHeight ?? Math.max(2, line.height);

      if (cfg.mode === "underline") {
        // Thin underline at the line's baseline that grows as the sweep
        // crosses it. Underline sits just beneath the glyphs of THIS line,
        // so as the text breaks onto a new line the bar moves down to it.
        const uw = Math.max(0, fillW);
        const underlineStyle = {
          ...baseStyle,
          top: lineTop + bandH - Math.max(2, cfg.barThickness ?? DEFAULTS.barThickness),
          left: reverse ? line.right - uw : line.left,
          width: uw,
          height: Math.max(2, cfg.barThickness ?? DEFAULTS.barThickness),
        };
        return <div key={`u-${i}`} style={{ ...underlineStyle, zIndex: 0 }} />;
      }

      // band
      const bw = Math.max(0, fillW);
      const bandStyle = reverse
        ? { ...baseStyle, top: lineTop, left: line.right - bw, width: bw, height: bandH, filter: blur, mixBlendMode: "multiply" }
        : { ...baseStyle, top: lineTop, left: line.left, width: bw, height: bandH, filter: blur, mixBlendMode: "multiply" };
      return <div key={`b-${i}`} style={{ ...bandStyle, zIndex: 1 }} />;
    });

    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        {markers}
      </div>
    );
  }

  // ---- legacy single-band fallback (pre-measurement / size-only hosts) ----
  let style;
  let zIndex;
  if (cfg.mode === "underline") {
    style = {
      ...baseStyle,
      left: reverse ? `${100 - sweep * 100}%` : 0,
      bottom: "8%",
      width: `${sweep * 100}%`,
      height: Math.max(2, cfg.barThickness ?? DEFAULTS.barThickness),
    };
    zIndex = 0; // underline beneath the text
  } else {
    const verticalCentered = cfg.centerVertical === true;
    style = {
      ...baseStyle,
      left: reverse ? `${100 - sweep * 100}%` : 0,
      width: `${sweep * 100}%`,
      height: authorHeight ?? Math.max(2, size?.height ?? DEFAULTS.height ?? 32),
      filter: blur,
      mixBlendMode: "multiply",
      ...(verticalCentered
        ? { top: "50%", transform: "translateY(-50%)" }
        : { top: 0 }),
    };
    zIndex = 1; // band over the text
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      <div style={{ ...style, zIndex }} />
    </div>
  );
}

export default HighlighterOverlay;
