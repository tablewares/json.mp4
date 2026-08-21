import { resolveAnchorPoint } from "./anchor.js";
import { resolveTimingAnchor } from "../timing/effectTiming.js";

function clamp01(value) {
  if (value == null || Number.isNaN(Number(value))) return 0;
  return Math.min(Math.max(Number(value), 0), 1);
}

// Same curve shapes as motion.js's EASINGS (kept as an independent copy —
// camera.js and motion.js are deliberately decoupled modules, same split
// rationale as the rest of this file). Governs how a segment's progress is
// shaped before it's used to interpolate anchor position and (when
// cameraSpec.easeZoom is true) zoom — this is what makes a "swoosh" zoom
// (fast start/settle, e.g. easeOut) possible instead of only linear.
const EASINGS = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

function resolveEasing(name) {
  const easingName = name ?? "linear";
  if (!EASINGS[easingName]) {
    throw new Error(`Unknown camera action easing "${easingName}". Available: ${Object.keys(EASINGS).join(", ")}`);
  }
  return easingName;
}

function normalizeAnchor(anchor) {
  const next = anchor?.anchor ?? anchor ?? { position: "center", offsetXPercent: 0, offsetYPercent: 0 };
  return {
    position: next.position ?? "center",
    offsetXPercent: next.offsetXPercent ?? 0,
    offsetYPercent: next.offsetYPercent ?? 0,
    followAssetId: next.followAssetId ?? null,
    edge: next.edge ?? "enter",
  };
}

// "followAssetId → asset center" resolution now lives in the shared
// `resolveAnchorPoint` (anchor.js): both camera anchors and WavyLine-style
// templated endpoints author in the same "named corner + nudge" or
// "follow asset + nudge" vocabulary and deserve one resolver. The
// composition-space point math is byte-identical to the private resolver
// that used to live here; `edge` is read only for *timing* (effectTiming.js),
// not for the spatial point, so resolveAnchorPoint ignores it.

function interpolateAnchor(startAnchor, endAnchor, progress, composition, ctx) {
  const start = resolveAnchorPoint(startAnchor, composition, ctx);
  const end = resolveAnchorPoint(endAnchor, composition, ctx);
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}

/**
 * Resolves a camera action's `at` into a fraction [0,1] of the camera's own
 * motion duration. `at` is exact-first: a bare number is used as-is
 * (legacy, unchanged). An object form uses the shared timingAnchor
 * vocabulary (shared.schema.json#/definitions/timingAnchor) — but only the
 * `relativeToWord` and `offsetPercent` branches are reachable here.
 * `relativeToAsset`/`relativeToCameraAction` are rejected with a clear
 * error: camera resolves BEFORE the asset loop in resolveScene.js (so
 * asset enterAt/exitAt can anchor to a camera action's frame), which means
 * no resolvedAssetsById exists yet for a camera action to anchor back to an
 * asset, and camera actions have no stable frame of their own to
 * cross-reference each other by, until this very function runs.
 *
 * `motionDuration` mirrors the formula resolveCameraTransform uses at
 * render time (cameraSpec.durationInFrames, else sceneDurationInFrames /
 * speed) so an authored word/percent anchor lands on the same frame at
 * normalize time and at render time.
 */
function resolveActionAt(raw, cameraSpec, ctx) {
  if (typeof raw === "number" || raw == null) return clamp01(raw ?? 0);

  if (raw.relativeToAsset !== undefined || raw.relativeToCameraAction !== undefined) {
    throw new Error(
      `Camera action "at" cannot use relativeToAsset/relativeToCameraAction — camera resolves before ` +
        `the asset loop (so assets can anchor enterAt/exitAt to a camera action), so no resolved asset ` +
        `positions or sibling camera-action frames exist yet to anchor back to. Use relativeToWord or ` +
        `offsetPercent instead (scene "${ctx?.sceneId ?? "?"}").`,
    );
  }

  const sceneDurationInFrames = ctx?.sceneDurationInFrames ?? 1;
  const motionDuration =
    cameraSpec?.durationInFrames ?? Math.max(sceneDurationInFrames / (cameraSpec?.speed ?? 1), 1);

  const frame = resolveTimingAnchor(raw, {
    sceneDurationInFrames,
    words: ctx?.words,
    sceneId: ctx?.sceneId,
  });

  return motionDuration <= 1 ? 0 : clamp01(frame / (motionDuration - 1));
}

function normalizeCameraActions(cameraSpec, ctx) {
  if (!cameraSpec) return [];

  if (Array.isArray(cameraSpec)) {
    return cameraSpec
      .map((entry) => ({
        at: resolveActionAt(entry.at, cameraSpec, ctx),
        anchor: normalizeAnchor(entry.anchor ?? entry),
        zoomPercent: entry.zoomPercent ?? entry.zoomEndPercent ?? entry.zoomStartPercent ?? 100,
        easing: resolveEasing(entry.easing),
        ...(entry.id != null ? { id: entry.id } : {}),
      }))
      .sort((a, b) => a.at - b.at);
  }

  if (Array.isArray(cameraSpec.actions) && cameraSpec.actions.length > 0) {
    return cameraSpec.actions
      .map((entry) => ({
        at: resolveActionAt(entry.at, cameraSpec, ctx),
        anchor: normalizeAnchor(entry.anchor ?? entry),
        zoomPercent: entry.zoomPercent ?? entry.zoomEndPercent ?? entry.zoomStartPercent ?? 100,
        easing: resolveEasing(entry.easing),
        ...(entry.id != null ? { id: entry.id } : {}),
      }))
      .sort((a, b) => a.at - b.at);
  }

  const start = cameraSpec.start ?? { position: "center", offsetXPercent: 0, offsetYPercent: 0 };
  const end = cameraSpec.end ?? start;
  const zoomStartPercent = cameraSpec.zoomStartPercent ?? cameraSpec.zoomPercent ?? 100;
  const zoomEndPercent = cameraSpec.zoomEndPercent ?? cameraSpec.zoomPercent ?? 100;

  return [
    { at: 0, anchor: normalizeAnchor(start), zoomPercent: zoomStartPercent, easing: resolveEasing(cameraSpec.easing) },
    { at: 1, anchor: normalizeAnchor(end), zoomPercent: zoomEndPercent, easing: resolveEasing(cameraSpec.easing) },
  ];
}

/**
 * @typedef {object} ResolveCameraCtx
 * @property {Record<string, object>=} resolvedAssetsById  pass-1 asset map; needed for `followAssetId` anchors
 * @property {number=} sceneDurationInFrames  needed to resolve relativeToWord/offsetPercent `at` anchors
 * @property {Array=} words  scene-level narration word timing; needed for relativeToWord `at` anchors
 * @property {string=} sceneId  for error messages
 */

/**
 * Resolves a raw camera spec into the persisted `camera` block on a resolved
 * scene (`scene.camera`). The returned object is what `resolveCameraTransform`
 * consumes at render time. Pass-through (no ctx) preserves the legacy shape.
 *
 * @param {object} cameraSpec
 * @param {ResolveCameraCtx=} ctx
 */
export function resolveCamera(cameraSpec, ctx) {
  if (!cameraSpec) return null;

  const actions = normalizeCameraActions(cameraSpec, ctx);
  if (actions.length === 0) return null;

  return {
    actions,
    durationInFrames: cameraSpec.durationInFrames ?? null,
    speed: cameraSpec.speed ?? 1,
    // Additive, defaults false -> identical resolved output to before this
    // field existed. Only meaningful when cameraSpec.easeZoom is explicitly
    // authored true.
    easeZoom: Boolean(cameraSpec.easeZoom),
  };
}
/**
 * Resolves a scene's camera transform for a single render frame.
 *
 * `depth` (new, optional, default 1) makes this parallax-aware: it's a
 * multiplier on how much THIS plane responds to the camera's zoom/pan,
 * relative to the anchor plane (depth === 1, the pre-existing behavior).
 *   depth === 1   -> byte-identical to the original single-plane formula
 *   depth < 1     -> moves/zooms less than the anchor (background plane)
 *   depth === 0   -> completely pinned (scale stays 1, no translate at all
 *                    regardless of camera motion — e.g. a HUD/kicker layer)
 *   depth > 1     -> moves/zooms more than the anchor (foreground pop)
 *
 * Callers that never pass `depth` get exactly the old single-plane output;
 * this is what makes per-layer parallax additive rather than a breaking
 * change to every existing camera spec.
 */
export function resolveCameraTransform(cameraSpec, composition, frame, durationInFrames, ctx, depth = 1) {
  if (!cameraSpec) {
    return {
      translateX: 0,
      translateY: 0,
      scale: 1,
      transformOrigin: "50% 50%",
    };
  }

  const actions = normalizeCameraActions(cameraSpec, ctx);
  if (actions.length === 0) {
    return {
      translateX: 0,
      translateY: 0,
      scale: 1,
      transformOrigin: "50% 50%",
    };
  }

  const motionDuration = cameraSpec.durationInFrames ?? Math.max((durationInFrames ?? 1) / (cameraSpec.speed ?? 1), 1);
  const progress = motionDuration <= 1
    ? 0
    : Math.min(Math.max((frame ?? 0) / Math.max(motionDuration - 1, 1), 0), 1);

  let current = actions[0];
  let next = actions[actions.length - 1];

  for (let i = 0; i < actions.length; i += 1) {
    if (actions[i].at <= progress) {
      current = actions[i];
    }
    if (actions[i].at >= progress) {
      next = actions[i];
      break;
    }
  }

  const segmentProgress = current.at === next.at
    ? 0
    : Math.min(Math.max((progress - current.at) / (next.at - current.at), 0), 1);

  // Per-action `easing` (default "linear", byte-identical to the pre-easing
  // formula) shapes the pace FROM `current` TO `next` — the same "timing
  // function describes the leg leaving this keyframe" convention CSS
  // keyframes use. This is what makes a "swoosh" possible: e.g. `easeOut`
  // on the start action gives a fast launch that settles into the next
  // keyframe, instead of a constant-speed pan/zoom.
  const easedProgress = EASINGS[current.easing](segmentProgress);

  const anchor = interpolateAnchor(current.anchor, next.anchor, easedProgress, composition, ctx);

  // Zoom: snaps instantly by default (unchanged legacy behavior — see the
  // original comment this replaces). Opt-in continuous easing across the
  // segment via cameraSpec.easeZoom: true, shaped by the same per-action
  // `easing` as the anchor above. Every camera spec that doesn't set
  // easeZoom keeps the exact old snap behavior.
  const zoomPercent = cameraSpec.easeZoom
    ? current.zoomPercent + (next.zoomPercent - current.zoomPercent) * easedProgress
    : current.zoomPercent;
  const baseScale = zoomPercent / 100;

  // Depth-scaled zoom around the SAME anchor point every plane shares.
  // depth=1 reduces to `scale = baseScale` exactly, so translateX/Y below
  // collapse to the original formula for the default case.
  const scale = 1 + (baseScale - 1) * depth;

  const translateX = (composition.width / 2 - anchor.x) * (scale - 1);
  const translateY = (composition.height / 2 - anchor.y) * (scale - 1);

  return {
    translateX,
    translateY,
    scale,
    transformOrigin: "50% 50%",
  };
}

/**
 * Reads a resolved asset's/effect's parallax depth. Looked up from
 * resolvedStyle.depth (an ordinary styleOverride passthrough — `depth`
 * contains no "color"/"typography"/"easing"/"texture" substring, so
 * resolveAssetStyle already carries it through untouched with no schema
 * change needed). Missing/invalid values default to 1 — the pre-existing
 * single-plane behavior.
 */
export function resolveAssetDepth(item) {
  const d = item?.resolvedStyle?.depth;
  return typeof d === "number" && Number.isFinite(d) ? d : 1;
}