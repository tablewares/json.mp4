import { Easing, interpolate, spring } from "remotion";

/**
 * motion.js
 * ----------
 * Single-responsibility module: owns reusable animation math (spring
 * presets, enter/exit progress curves, narration-aware stagger, pulse
 * loops, and clip-path reveal generators) so new assets/transitions don't
 * re-derive the same spring/interpolate boilerplate that already lives
 * inline in KineticText.jsx, AssetBoilerplate.jsx, and ImageReveal.jsx.
 *
 * Every export here is a plain function of (frame, fps, ...) — no hooks,
 * no JSX. Components still call useCurrentFrame()/useVideoConfig()
 * themselves and pass the results in, exactly like they already do with
 * remotion's own spring()/interpolate(). This module is purely additive:
 * existing components (KineticText, AssetBoilerplate, ImageReveal, the
 * default transition) are untouched and keep their own inline math.
 */

// ---------------------------------------------------------------------
// Spring presets
// ---------------------------------------------------------------------

/** Named spring configs, keyed the same way style tokens already show up
 * in manifests ("gentleSpring", "snappySpring"). New components can look
 * these up by name instead of hardcoding a config object inline. */
export const SPRING_PRESETS = {
  gentleSpring: { damping: 16, mass: 0.7, stiffness: 100 },
  snappySpring: { damping: 15, mass: 0.2, stiffness: 300 },
  bouncySpring: { damping: 10, mass: 0.5, stiffness: 180 },
  subtleSpring: { damping: 20, mass: 1, stiffness: 80 },
};

/** Resolves a spring config from either a preset name, an already-built
 * config object, or nothing (falls back to snappySpring). Lets a
 * component accept resolvedStyle.easing as either shape without caring
 * which the author used. */
export function resolveSpringConfig(nameOrConfig, fallback = SPRING_PRESETS.snappySpring) {
  if (!nameOrConfig) return fallback;
  if (typeof nameOrConfig === "string") return SPRING_PRESETS[nameOrConfig] ?? fallback;
  return nameOrConfig;
}

// ---------------------------------------------------------------------
// Enter / exit progress
// ---------------------------------------------------------------------

/**
 * Standard "pop in on enter, fade on exit" progress used by
 * AssetBoilerplate today, generalized. Returns a single 0-1 value that's
 * the min of the enter spring and the exit fade, so an asset never
 * finishes entering after it's already supposed to be leaving.
 */
export function enterExitProgress({ frame, fps, enterAtFrame = 0, exitAtFrame, durationInFrames, config }) {
  const enterProgress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolveSpringConfig(config),
  });

  const exitWindow = Math.min(15, durationInFrames * 0.15);
  const framesUntilExit = exitAtFrame - frame;
  const exitProgress = interpolate(framesUntilExit, [0, exitWindow], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return Math.min(enterProgress, exitProgress);
}

/**
 * Just the exit half of the above, isolated — for components (like
 * KineticText) that want independent control over enter (e.g. per-word
 * springs) but still want the same "fade out before exitAtFrame" curve
 * applied to the overall container.
 */
export function computeExitOpacity({ frame, exitAtFrame, durationInFrames, exitWindowFrames }) {
  const exitWindow = exitWindowFrames ?? Math.min(15, durationInFrames * 0.15);
  const framesUntilExit = exitAtFrame - frame;
  return interpolate(framesUntilExit, [0, exitWindow], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/**
 * A single spring "pop": starts at fromScale, snaps to toScale. Returns
 * both the raw 0-1 progress (for opacity/other derived values) and the
 * scale, matching the pattern used per-word in KineticText.
 */
export function popIn({ frame, fps, startFrame = 0, config, fromScale = 1.15, toScale = 1 }) {
  const progress = spring({ frame: frame - startFrame, fps, config: resolveSpringConfig(config) });
  const scale = interpolate(progress, [0, 1], [fromScale, toScale], { extrapolateRight: "clamp" });
  return { progress, scale };
}

// ---------------------------------------------------------------------
// Narration-aware stagger
// ---------------------------------------------------------------------

/**
 * Extracted from KineticText's per-word timing logic so any future
 * word/item-based asset can reuse it instead of re-deriving. Given N
 * items, returns an array of start frames — one per item — either from
 * real WhisperX word timings (when provided and the right length) or an
 * even stagger auto-compressed to fit the enter/exit budget.
 */
export function narrationAwareStagger({
  itemCount,
  requestedStagger = 6,
  enterAtFrame = 0,
  exitAtFrame,
  wordTimings,
  budgetFraction = 0.6,
}) {
  const hasWordTimings = Array.isArray(wordTimings) && wordTimings.length === itemCount;

  if (hasWordTimings) {
    return wordTimings.map((w) => Math.max(enterAtFrame, Math.min(w.startFrame, exitAtFrame)));
  }

  const revealBudgetFrames = Math.max(1, (exitAtFrame - enterAtFrame) * budgetFraction);
  const effectiveStagger =
    itemCount > 1 ? Math.min(requestedStagger, revealBudgetFrames / (itemCount - 1)) : 0;

  return Array.from({ length: itemCount }, (_, i) => enterAtFrame + i * effectiveStagger);
}

// ---------------------------------------------------------------------
// Looping pulse (for badges, live indicators, glow rings)
// ---------------------------------------------------------------------

/**
 * A continuous 0-1 sine oscillation, not tied to enter/exit — for glow
 * rings, "LIVE" dots, or any looping accent. periodFrames is a full
 * cycle's length; phase (0-1) offsets the start of the cycle.
 */
export function pulse({ frame, periodFrames = 40, phase = 0 }) {
  const t = (frame / periodFrames + phase) % 1;
  return (Math.sin(t * Math.PI * 2 - Math.PI / 2) + 1) / 2; // 0 -> 1 -> 0, starts at 0
}

/** Maps pulse()'s 0-1 into a [min, max] range — the common case of
 * "pulse this opacity/scale between two bounds". */
export function pulseBetween({ frame, periodFrames = 40, phase = 0, min = 0, max = 1 }) {
  const p = pulse({ frame, periodFrames, phase });
  return min + p * (max - min);
}

// ---------------------------------------------------------------------
// Clip-path reveal generators
// ---------------------------------------------------------------------

/**
 * A small library of clip-path generators keyed by direction, parallel
 * to (but independent from) ImageReveal's local CLIP_PATHS — new
 * components can pull from here instead of redefining their own map.
 * Adds "iris" (circular reveal from center, sized to cover a widescreen
 * frame at progress 1) on top of the directions ImageReveal already
 * supports.
 */
export const CLIP_REVEALS = {
  "left-to-right": (p) => `inset(0 ${100 - p * 100}% 0 0)`,
  "top-to-bottom": (p) => `inset(0 0 ${100 - p * 100}% 0)`,
  "center-out": (p) => `inset(${50 - p * 50}% ${50 - p * 50}%)`,
  iris: (p) => `circle(${p * 150}% at 50% 50%)`,
};

export function clipReveal(direction, progress) {
  const fn = CLIP_REVEALS[direction] ?? CLIP_REVEALS["left-to-right"];
  return fn(Math.min(Math.max(progress, 0), 1));
}

// ---------------------------------------------------------------------
// Named easing curves for transitions
// ---------------------------------------------------------------------

/**
 * Curve presets built on Remotion's Easing, for transitions that want a
 * shaped (non-linear, non-spring) progress — irisWipe uses "easeOutBack"
 * so the iris slightly overshoots before settling.
 */
export const EASE_CURVES = {
  linear: Easing.linear,
  easeInOutCubic: Easing.bezier(0.65, 0, 0.35, 1),
  easeOutBack: Easing.bezier(0.34, 1.56, 0.64, 1),
  easeOutExpo: Easing.bezier(0.16, 1, 0.3, 1),
};

export function easeCurve(name) {
  return EASE_CURVES[name] ?? EASE_CURVES.easeInOutCubic;
}

/** Shapes a raw 0-1 progress value through a named curve. */
export function shapeProgress(progress, curveName) {
  return easeCurve(curveName)(Math.min(Math.max(progress, 0), 1));
}
