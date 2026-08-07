import React from "react";
import { AbsoluteFill, interpolate, Easing } from "remotion";

/**
 * Unit vectors describing which way content "travels" for each direction.
 * Convention (matches the anchor system in src/templating/anchor.js):
 *   exiting:  0 -> vec * distance   (scene moves off screen along vec)
 *   entering: -vec * distance -> 0  (scene arrives from the opposite side)
 * Sharing one vector for both halves is what makes the cut read as a single
 * continuous gesture instead of two independent animations.
 */
const DIRECTION_VECTORS = {
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  "top-left": { dx: -0.7071, dy: -0.7071 },
  "top-right": { dx: 0.7071, dy: -0.7071 },
  "bottom-left": { dx: -0.7071, dy: 0.7071 },
  "bottom-right": { dx: 0.7071, dy: 0.7071 },
};

// Standard "material-ish" ease by default. `overshoot` swaps in a back-ease
// pair (anticipation on exit, overshoot-then-settle on entry) for a more
// physical, spring-like feel — still symmetric across the cut.
const DEFAULT_CURVE = [0.4, 0, 0.2, 1];
const OVERSHOOT_ENTER_CURVE = [0.34, 1.56, 0.64, 1]; // easeOutBack
const OVERSHOOT_EXIT_CURVE = [0.36, 0, 0.66, -0.56]; // easeInBack

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/**
 * Expressive starter transition: translate + scale + rotate + motion blur +
 * fade, all driven off one shared eased progress value, with an optional
 * pivot point borrowed from a carried asset so scale/rotate happen around a
 * real point of continuity instead of the frame's dead center.
 *
 * All axes are opt-in and additive — leave scale/rotateDeg/blurPx at their
 * defaults (1 / 0 / 0) to get a plain directional slide+fade, or combine
 * them (e.g. distance + scale + a carried asset) for a "zoom through" cut
 * anchored on a specific element.
 */
function TransitionBoilerplateComponent({
  children,
  presentationProgress,
  presentationDirection,
  direction = "left",
  distance = 48,
  scale = 1,
  rotateDeg = 0,
  blurPx = 0,
  fade = true,
  curve = DEFAULT_CURVE,
  overshoot = false,
  anchorOrigin = "50% 50%",
  // Populated automatically by resolve.js when transitionOut.params.carryAssetId
  // names an asset present in both the outgoing and incoming scene (see
  // manifest.json's consumes.carriedAssets + buildTransitionBundle in
  // src/pipelines/pipeline2-resolve/resolve.js). Each is
  // { left, top, width, height, ...resolvedStyle }.
  carryFrom,
  carryTo,
}) {
  const isEntering = presentationDirection === "entering";

  const activeCurve = overshoot
    ? isEntering
      ? OVERSHOOT_ENTER_CURVE
      : OVERSHOOT_EXIT_CURVE
    : curve;
  const eased = Easing.bezier(...activeCurve)(presentationProgress);

  // --- translate -----------------------------------------------------
  const vec = DIRECTION_VECTORS[direction] ?? DIRECTION_VECTORS.left;
  const translateX = isEntering
    ? interpolate(eased, [0, 1], [-vec.dx * distance, 0])
    : interpolate(eased, [0, 1], [0, vec.dx * distance]);
  const translateY = isEntering
    ? interpolate(eased, [0, 1], [-vec.dy * distance, 0])
    : interpolate(eased, [0, 1], [0, vec.dy * distance]);

  // --- scale -----------------------------------------------------------
  // `scale` is the "far" value both sides pass through: entering grows from
  // it to 1, exiting shrinks from 1 to it. scale < 1 reads as depth (push
  // back / arrive from distance); scale > 1 reads as a push-forward zoom.
  const scaleValue = isEntering
    ? interpolate(eased, [0, 1], [scale, 1])
    : interpolate(eased, [0, 1], [1, scale]);

  // --- rotate ------------------------------------------------------------
  // Same sign convention as translate: exiting spins 0 -> rotateDeg, entering
  // arrives from -rotateDeg -> 0, so the spin direction is continuous across
  // the cut rather than resetting.
  const rotateValue = isEntering
    ? interpolate(eased, [0, 1], [-rotateDeg, 0])
    : interpolate(eased, [0, 1], [0, rotateDeg]);

  // --- motion blur ---------------------------------------------------
  // Peaks at the temporal midpoint (using raw, un-eased progress so it
  // tracks wall-clock time, not the shaped curve) and resolves to 0 at both
  // ends — cheap way to sell fast motion without any real motion-blur pass.
  const blurValue = blurPx > 0 ? interpolate(presentationProgress, [0, 0.5, 1], [0, blurPx, 0]) : 0;

  // --- fade ------------------------------------------------------------
  const opacity = fade
    ? isEntering
      ? clamp01(interpolate(eased, [0, 1], [0, 1]))
      : clamp01(interpolate(eased, [0, 1], [1, 0]))
    : 1;

  // --- pivot -------------------------------------------------------------
  // If a carried asset is available, scale/rotate pivot around ITS center
  // (in its own side's resolved position) instead of the frame center, so a
  // zoom/spin reads as continuing from that specific element.
  const pivotAsset = isEntering ? carryTo : carryFrom;
  const transformOrigin = pivotAsset
    ? `${pivotAsset.left + pivotAsset.width / 2}px ${pivotAsset.top + pivotAsset.height / 2}px`
    : anchorOrigin;

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translate(${translateX}px, ${translateY}px) scale(${scaleValue}) rotate(${rotateValue}deg)`,
        transformOrigin,
        filter: blurValue > 0 ? `blur(${blurValue}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/** Factory: `<TransitionSeries.Transition presentation={TransitionBoilerplate({...})} .../>` */
export function TransitionBoilerplate(props = {}) {
  return { component: TransitionBoilerplateComponent, props };
}