import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate, staticFile } from "remotion";

const CLIP_PATHS = {
  "left-to-right": (p) => `inset(0 ${100 - p * 100}% 0 0)`,
  "top-to-bottom": (p) => `inset(0 0 ${100 - p * 100}% 0)`,
  "center-out": (p) => `inset(${50 - p * 50}% ${50 - p * 50}%)`,
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

export function ImageReveal({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { enterAtFrame = 0 } = timing;

  const progress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 100 },
  });

  const clipFn = CLIP_PATHS[resolvedStyle.revealDirection] ?? CLIP_PATHS["left-to-right"];
  const scale = interpolate(progress, [0, 1], [0.96, 1]);

  const resolvedSrc = (() => {
    const p = toStaticPath(content.src);
    return p.startsWith("http") ? p : staticFile(p);
  })();

  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 640,
        height: resolvedStyle.height ?? 640,
        overflow: "hidden",
        borderRadius: resolvedStyle.borderRadius ?? 24,
        clipPath: clipFn(Math.min(progress, 1)),
        transform: `scale(${scale})`,
      }}
    >
      <img
        src={resolvedSrc}
        alt={content.alt ?? ""}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
