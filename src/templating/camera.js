import { ANCHOR_ALIGN } from "./anchor.js";

function clamp01(value) {
  if (value == null || Number.isNaN(Number(value))) return 0;
  return Math.min(Math.max(Number(value), 0), 1);
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

// Maps a resolved asset's geometry to a camera anchor point — the same
// "corner + nudge → pixel point" math `resolveAnchorPoint` does against
// the composition frame, but rooted at an asset's resolved box instead.
// Returned point is in composition-space pixels (the asset already holds
// composition-space left/top/width/height from pass 1), so the rest of
// resolveCameraTransform's translate/scale math needs no changes.
function assetAnchorPoint(asset, edge) {
  const pos = asset?.resolvedPosition ?? { left: 0, top: 0 };
  const w = asset?.resolvedStyle?.width ?? 0;
  const h = asset?.resolvedStyle?.height ?? 0;
  const useExit = edge === "exit";
  const ax = pos.left + w / 2;
  const ay = pos.top + h / 2;
  // The camera anchor lives at the asset's center; for an "exit"-edge
  // anchor we still resolve to the same center today (the asset doesn't
  // yet expose a separate exit geometry) — the `enter`/`exit` distinction
  // matters for *timing* (effectTiming.js), not for the spatial point,
  // so this returns the single shared center. Kept as its own function so
  // the edge edge case can grow spatially later without touching the
  // composition-frame resolver.
  if (useExit) return { x: ax, y: ay };
  return { x: ax, y: ay };
}

function resolveAnchorPoint(anchor, composition, ctx) {
  const { position, offsetXPercent = 0, offsetYPercent = 0, followAssetId, edge } = normalizeAnchor(anchor);

  // followAssetId: resolve the anchor to the target asset's center instead
  // of a composition-frame corner. Falls back to the composition-frame
  // resolver when no ctx is supplied (e.g. legacy `resolveCamera` with no
  // resolved-scene context) so the function is still callable in isolation.
  if (followAssetId) {
    const target = ctx?.resolvedAssetsById?.[followAssetId];
    if (!target) {
      throw new Error(
        `Camera anchor follows asset "${followAssetId}" but no such asset was resolved ` +
          `in scene "${ctx?.sceneId ?? "?"}". Known: ${
            Object.keys(ctx?.resolvedAssetsById ?? {}).join(", ") || "(none)"
          }. A camera-followed asset must appear earlier in scene.assets than the camera spec.`,
      );
    }
    const point = assetAnchorPoint(target, edge);
    // Allow the percent offsets to nudge off the asset's center in
    // composition-space pixels so an author can frame *around* the asset,
    // not just on it. Consistent with the composition-frame branch below:
    // offsets are a % of the composition size, not the asset.
    return {
      x: point.x + (offsetXPercent / 100) * composition.width,
      y: point.y + (offsetYPercent / 100) * composition.height,
    };
  }

  const align = ANCHOR_ALIGN[position ?? "center"];
  if (!align) {
    throw new Error(`Unknown camera anchor position "${position}". Valid: ${Object.keys(ANCHOR_ALIGN).join(", ")}`);
  }

  const x = align.x * composition.width + (offsetXPercent / 100) * composition.width;
  const y = align.y * composition.height + (offsetYPercent / 100) * composition.height;

  return { x, y };
}

function interpolateAnchor(startAnchor, endAnchor, progress, composition, ctx) {
  const start = resolveAnchorPoint(startAnchor, composition, ctx);
  const end = resolveAnchorPoint(endAnchor, composition, ctx);
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}

function normalizeCameraActions(cameraSpec) {
  if (!cameraSpec) return [];

  if (Array.isArray(cameraSpec)) {
    return cameraSpec
      .map((entry) => ({
        at: clamp01(entry.at ?? 0),
        anchor: normalizeAnchor(entry.anchor ?? entry),
        zoomPercent: entry.zoomPercent ?? entry.zoomEndPercent ?? entry.zoomStartPercent ?? 100,
        ...(entry.id != null ? { id: entry.id } : {}),
      }))
      .sort((a, b) => a.at - b.at);
  }

  if (Array.isArray(cameraSpec.actions) && cameraSpec.actions.length > 0) {
    return cameraSpec.actions
      .map((entry) => ({
        at: clamp01(entry.at ?? 0),
        anchor: normalizeAnchor(entry.anchor ?? entry),
        zoomPercent: entry.zoomPercent ?? entry.zoomEndPercent ?? entry.zoomStartPercent ?? 100,
        ...(entry.id != null ? { id: entry.id } : {}),
      }))
      .sort((a, b) => a.at - b.at);
  }

  const start = cameraSpec.start ?? { position: "center", offsetXPercent: 0, offsetYPercent: 0 };
  const end = cameraSpec.end ?? start;
  const zoomStartPercent = cameraSpec.zoomStartPercent ?? cameraSpec.zoomPercent ?? 100;
  const zoomEndPercent = cameraSpec.zoomEndPercent ?? cameraSpec.zoomPercent ?? 100;

  return [
    { at: 0, anchor: normalizeAnchor(start), zoomPercent: zoomStartPercent },
    { at: 1, anchor: normalizeAnchor(end), zoomPercent: zoomEndPercent },
  ];
}

/**
 * @typedef {object} ResolveCameraCtx
 * @property {Record<string, object>=} resolvedAssetsById  pass-1 asset map; needed for `followAssetId` anchors
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

  const actions = normalizeCameraActions(cameraSpec);
  if (actions.length === 0) return null;

  return {
    actions,
    durationInFrames: cameraSpec.durationInFrames ?? null,
    speed: cameraSpec.speed ?? 1,
  };
}

export function resolveCameraTransform(cameraSpec, composition, frame, durationInFrames, ctx) {
  if (!cameraSpec) {
    return {
      translateX: 0,
      translateY: 0,
      scale: 1,
      transformOrigin: "50% 50%",
    };
  }

  const actions = normalizeCameraActions(cameraSpec);
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

  const anchor = interpolateAnchor(current.anchor, next.anchor, segmentProgress, composition, ctx);
  // Zoom snaps instantly to the current action's level instead of easing
  // into the next one, so the camera reaches its zoomed position immediately
  // rather than spending frames interpolating between zoom levels.
  const scale = current.zoomPercent / 100;

  const translateX = (composition.width / 2 - anchor.x) * (scale - 1);
  const translateY = (composition.height / 2 - anchor.y) * (scale - 1);

  return {
    translateX,
    translateY,
    scale,
    transformOrigin: "50% 50%",
  };
}
