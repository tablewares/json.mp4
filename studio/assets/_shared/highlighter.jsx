import React from "react";
import { interpolate } from "remotion";

/**
 * Shared highlighter-stroke renderer used by KineticText and TextBlock when
 * their `styleOverride.highlighter` block is enabled. Mirrors the math in
 * the standalone `TextHighlight` asset (so an author's mental model carries
 * over between all three), but packaged as an inline overlay that paints
 * over the text glyphs of whichever text asset hosts it — no separate
 * anchored asset, no manual anchor alignment needed.
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
 *       height: 32,                           // band height in px (band mode)
 *       barThickness: 4,                      // underline thickness in px (underline mode)
 *       opacity: 0.75,                        // 0..1
 *       blur: 4,                              // gaussian blur in px (band mode only)
 *       direction: "left" | "right",          // sweep direction (default right)
 *       sweepStartFraction: 0,                // where in the active window the sweep begins (0..1)
 *       sweepDurationFraction: 0.7            // sweep length as a fraction of the active window (0..1)
 *     }
 *   }
 *
 * Pipeline2 runs `resolveColorToken` on the `color` field (because the key
 * contains "color" and styleRegistry treats such keys as token-or-literal).
 * But when the author uses `colorToken`, pipeline2 never sees that key — it
 * only resolves `color`/`markerColor`/etc., and the host component itself
 * chose this two-field shape deliberately to support raw hex alongside
 * tokens. The helper therefore prefers `colorToken` when set; otherwise
 * falls back to `color` (which pipeline2 already turned into a hex literal
 * resolving the style).
 */

const DEFAULTS = {
  enabled: false,
  color: "#FFE600",
  colorToken: null,
  mode: "band",
  height: 32,
  barThickness: 4,
  opacity: 0.75,
  blur: 4,
  direction: "right",
  sweepStartFraction: 0,
  sweepDurationFraction: 0.7,
};

/**
 * @param {object} props
 * @param {number} props.frame  current scene-local frame from useCurrentFrame()
 * @param {number} props.enterAtFrame  host asset's enterAtFrame
 * @param {number} props.exitAtFrame  host asset's exitAtFrame
 * @param {number} props.durationInFrames  host's `timing.durationInFrames`
 * @param {number} props.envelope  host's already-computed {enter,exit} opacity (0..1).
 *        The highlighter multiplies on top of this so the stroke fades in/out
 *        with its parent rather than independently.
 * @param {{width:number, height:number}} [props.size] inner content box the
 *        highlighter sweeps across (e.g. the rendered text wrapper)
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
  highlighter,
}) {
  const h = highlighter;
  if (!h || h.enabled !== true) return null;

  const cfg = { ...DEFAULTS, ...h };
  const color = cfg.colorToken ?? cfg.color ?? DEFAULTS.color;
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

  const baseStyle = {
    position: "absolute",
    background: color,
    borderRadius: 2,
    opacity: bandOpacity,
  };

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
    style = {
      ...baseStyle,
      left: reverse ? `${100 - sweep * 100}%` : 0,
      top: "50%",
      transform: "translateY(-50%)",
      width: `${sweep * 100}%`,
      height: Math.max(2, cfg.height ?? DEFAULTS.height),
      filter: cfg.blur > 0 ? `blur(${cfg.blur}px)` : undefined,
      mixBlendMode: "multiply",
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
