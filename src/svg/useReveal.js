import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * useReveal — the single motion contract for every SVG-primitive asset.
 *
 * The framework already hands each asset a timing window:
 *   timing = { durationInFrames, enterAtFrame, exitAtFrame }
 * (see resolve.js -> resolveScene). That window is the *only* animation
 * budget the primitive gets; nothing here invents its own. This hook turns
 * that window into a handful of frame-driven values every primitive reads,
 * so the drawing substrate stops re-implementing "a spring + opacity fade"
 * per asset (the thing that made the old flat-div outputs visually uniform).
 *
 * Returns:
 *   frame        - current composition frame (passed through)
 *   fps         - composition fps (passed through)
 *   duration     - timing.durationInFrames (the scene budget, for pacing)
 *   enter        - 0..1 spring progress into the window (settles ~early)
 *   exitOpacity  - 1..0 fade near the window tail (never >1, clamped)
 *   reveal       - min(enter, exitOpacity): the single value a primitive
 *                  should drive its draw/scale/opacity from. GUARANTEED to
 *                  reach ~1 before the exit blind starts (see EXIT_TAIL),
 *                  so "the figure finishes landing, then leaves" — not a
 *                  crawl that runs straight into the exit.
 *   localFrame   - frame - enterAtFrame: 0 at the asset's own start. Use
 *                  this for staggered children instead of recomputing.
 *
 * The easing spring comes from `easing` (a remotion spring config object OR
 * undefined for the framework default). Callers may pass an explicit
 * `enterFrame` to stagger children (e.g. each bar in a chart passes its own
 * start); without it, the asset's timing.enterAtFrame is used.
 */
export const EXIT_TAIL_FRACTION = 0.15;
export const DEFAULT_SPRING = { damping: 18, mass: 0.6, stiffness: 130 };

export function useReveal(timing, options = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const {
    durationInFrames = 1,
    enterAtFrame = 0,
    exitAtFrame = durationInFrames,
  } = timing ?? {};

  const enterFrame = options.enterFrame ?? enterAtFrame;
  const easing = options.easing ?? DEFAULT_SPRING;
  const windowLength = Math.max(1, exitAtFrame - enterFrame);

  const enter = spring({
    frame: frame - enterFrame,
    fps,
    config: easing,
  });

  // Exit fade lives in the last EXIT_TAIL_FRACTION of the window — clamped
  // tiny so a short-scene asset still gets a visible but quick tail.
  const exitTail = Math.min(15, windowLength * EXIT_TAIL_FRACTION);
  const framesUntilExit = exitAtFrame - frame;
  const exitOpacity = interpolate(framesUntilExit, [0, Math.max(1, exitTail)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const reveal = Math.min(enter, exitOpacity);

  return {
    frame,
    fps,
    duration: durationInFrames,
    enter,
    exitOpacity,
    reveal,
    localFrame: frame - enterFrame,
  };
}

export default useReveal;
