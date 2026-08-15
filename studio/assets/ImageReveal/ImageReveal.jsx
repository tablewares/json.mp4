import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate, staticFile, OffthreadVideo } from "remotion";

const CLIP_PATHS = {
  "left-to-right": (p) => `inset(0 ${100 - p * 100}% 0 0)`,
  "top-to-bottom": (p) => `inset(0 0 ${100 - p * 100}% 0)`,
  "center-out": (p) => `inset(${50 - p * 50}% ${50 - p * 50}%)`,
  "none": () => "none", // Returns standard unclipped path
};

// Remotion's staticFile() only accepts paths relative to public/ (e.g.
// "assets/foo.png"). Manifest authors sometimes paste an absolute filesystem
// path that happens to live under public/; normalise that to the relative form
// so the asset never crashes at render with staticFile's "does not support
// absolute paths" error. Absolute http(s) URLs and already-relative paths
// pass through untouched.
function toStaticPath(raw) {
  if (raw == null) return raw;
  if (raw.startsWith("http")) return raw;
  const idx = raw.indexOf("public/");
  if (idx >= 0) return raw.slice(idx + "public/".length);
  return raw;
}

// mp4 (and a few other common containers) render as <OffthreadVideo>
// instead of <img>. Detected from the file extension by default; an author
// can force it either way with content.mediaType: "image" | "video" if the
// URL doesn't carry a useful extension (e.g. a signed CDN link).
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

function resolveMediaType(content) {
  if (content.mediaType === "video" || content.mediaType === "image") return content.mediaType;
  return VIDEO_EXTENSIONS.test(content.src ?? "") ? "video" : "image";
}

export function ImageReveal({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { enterAtFrame = 0 } = timing;

  // Check if animation is explicitly disabled via revealDirection, a boolean flag, or direct prop
  const isNoAnimation = 
    resolvedStyle.revealDirection === "none" || 
    resolvedStyle.noAnimation === true ||
    timing.disableAnimation === true;

  // Compute progress: jump directly to 1 if animated feature is disabled
  const rawProgress = isNoAnimation
    ? frame >= enterAtFrame ? 1 : 0
    : spring({
        frame: frame - enterAtFrame,
        fps,
        config: resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 100 },
      });

  const progress = Math.min(rawProgress, 1);

  // If no animation, keep scale at 1 when visible instead of scaling up from 0.96
  const scale = isNoAnimation 
    ? (frame >= enterAtFrame ? 1 : 0) 
    : interpolate(progress, [0, 1], [0.96, 1]);

  const clipFn = CLIP_PATHS[resolvedStyle.revealDirection] ?? CLIP_PATHS["left-to-right"];

  const resolvedSrc = (() => {
    const p = toStaticPath(content.src);
    return p.startsWith("http") ? p : staticFile(p);
  })();

  const mediaType = resolveMediaType(content);

  // Hide element entirely before its enterAtFrame if animation is disabled
  if (isNoAnimation && frame < enterAtFrame) {
    return null;
  }

  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 640,
        height: resolvedStyle.height ?? 640,
        overflow: "hidden",
        borderRadius: resolvedStyle.borderRadius ?? 24,
        clipPath: isNoAnimation ? "none" : clipFn(progress),
        transform: `scale(${scale})`,
      }}
    >
      {mediaType === "video" ? (
        <OffthreadVideo
          src={resolvedSrc}
          muted={content.muted ?? true}
          loop={content.loop ?? true}
          volume={content.muted === false ? content.volume ?? 1 : 0}
          startFrom={content.startFromFrame ?? 0}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <img
          src={resolvedSrc}
          alt={content.alt ?? ""}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </div>
  );
}