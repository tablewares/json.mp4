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
  };
}

function resolveAnchorPoint(anchor, composition) {
  const { position, offsetXPercent = 0, offsetYPercent = 0 } = normalizeAnchor(anchor);
  const align = ANCHOR_ALIGN[position ?? "center"];
  if (!align) {
    throw new Error(`Unknown camera anchor position "${position}". Valid: ${Object.keys(ANCHOR_ALIGN).join(", ")}`);
  }

  const x = align.x * composition.width + (offsetXPercent / 100) * composition.width;
  const y = align.y * composition.height + (offsetYPercent / 100) * composition.height;

  return { x, y };
}

function interpolateAnchor(startAnchor, endAnchor, progress, composition) {
  const start = resolveAnchorPoint(startAnchor, composition);
  const end = resolveAnchorPoint(endAnchor, composition);
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
      }))
      .sort((a, b) => a.at - b.at);
  }

  if (Array.isArray(cameraSpec.actions) && cameraSpec.actions.length > 0) {
    return cameraSpec.actions
      .map((entry) => ({
        at: clamp01(entry.at ?? 0),
        anchor: normalizeAnchor(entry.anchor ?? entry),
        zoomPercent: entry.zoomPercent ?? entry.zoomEndPercent ?? entry.zoomStartPercent ?? 100,
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

export function resolveCamera(cameraSpec) {
  if (!cameraSpec) return null;

  const actions = normalizeCameraActions(cameraSpec);
  if (actions.length === 0) return null;

  return {
    actions,
    durationInFrames: cameraSpec.durationInFrames ?? null,
    speed: cameraSpec.speed ?? 1,
  };
}

export function resolveCameraTransform(cameraSpec, composition, frame, durationInFrames) {
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

  const anchor = interpolateAnchor(current.anchor, next.anchor, segmentProgress, composition);
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
