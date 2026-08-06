import { ANCHOR_ALIGN } from "./anchor.js";

function resolveAnchorPoint(anchor, composition) {
  const { position, offsetXPercent = 0, offsetYPercent = 0 } = anchor ?? {};
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

export function resolveCamera(cameraSpec) {
  if (!cameraSpec) return null;

  const start = cameraSpec.start ?? {
    position: "center",
    offsetXPercent: 0,
    offsetYPercent: 0,
  };
  const end = cameraSpec.end ?? start;

  return {
    start,
    end,
    zoomStartPercent: cameraSpec.zoomStartPercent ?? cameraSpec.zoomPercent ?? 100,
    zoomEndPercent: cameraSpec.zoomEndPercent ?? cameraSpec.zoomPercent ?? 100,
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

  const progress = durationInFrames <= 1
    ? 0
    : Math.min(Math.max((frame ?? 0) / Math.max(durationInFrames - 1, 1), 0), 1);

  const anchor = interpolateAnchor(cameraSpec.start, cameraSpec.end, progress, composition);
  const zoomStartPercent = cameraSpec.zoomStartPercent ?? 100;
  const zoomEndPercent = cameraSpec.zoomEndPercent ?? zoomStartPercent;
  const zoomPercent = zoomStartPercent + (zoomEndPercent - zoomStartPercent) * progress;
  const scale = zoomPercent / 100;

  const translateX = (composition.width / 2 - anchor.x) * (scale - 1);
  const translateY = (composition.height / 2 - anchor.y) * (scale - 1);

  return {
    translateX,
    translateY,
    scale,
    transformOrigin: "50% 50%",
  };
}
