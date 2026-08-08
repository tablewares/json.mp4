import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate, Img, staticFile } from "remotion";

/**
 * Background-plate image anchored to a corner of the composition. Designed to
 * sit in `layer: "background"` so it never occludes foreground content; it
 * works at any layer.
 *
 * Entrance is a clip-path wipe (left-to-right / top-to-bottom / center-out)
 * or a plain fade, driven by the asset's `enterAtFrame`. A dark overlay sits
 * over the image at `resolvedStyle.dim` opacity so foreground typography
 * stays legible against the plate.
 *
 * `staticFile()` accepts paths relative to public/; we normalise absolute and
 * `public/`-prefixed paths through the same `toStaticPath` helper ImageReveal
 * uses, for parity with that asset's behavior.
 */
const CLIP_PATHS = {
  "left-to-right": (p) => `inset(0 ${100 - p * 100}% 0 0)`,
  "top-to-bottom": (p) => `inset(0 0 ${100 - p * 100}% 0)`,
  "center-out": (p) => `inset(${50 - p * 50}% ${50 - p * 50}%)`,
};

function toStaticPath(raw) {
  if (raw == null) return raw;
  if (raw.startsWith("http")) return raw;
  const idx = raw.indexOf("public/");
  if (idx >= 0) return raw.slice(idx + "public/".length);
  return raw;
}

export function BackdropImage({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const easingConfig = resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 110 };
  const enterProgress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: easingConfig,
  });
  const framesUntilExit = exitAtFrame - frame;
  const exitProgress = interpolate(
    framesUntilExit,
    [0, Math.min(15, durationInFrames * 0.15)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const envelope = Math.min(enterProgress, exitProgress);

  const width = resolvedStyle.width ?? 700;
  const height = resolvedStyle.height ?? 700;
  const revealDirection = resolvedStyle.revealDirection ?? "left-to-right";
  const borderRadius = resolvedStyle.borderRadius ?? 18;
  const dim = resolvedStyle.dim ?? 0.35;
  const blurPx = resolvedStyle.blurPx ?? 0;

  const useClip = CLIP_PATHS[revealDirection];
  const revealProg = Math.min(enterProgress, 1);
  const clip = useClip ? useClip(revealProg) : undefined;
  const fadeOpacity = revealDirection === "fade" ? envelope : 1;

  const resolvedSrc = (() => {
    const p = toStaticPath(content.src);
    return p && p.startsWith("http") ? p : staticFile(p);
  })();

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        opacity: fadeOpacity,
        overflow: "hidden",
        borderRadius,
        clipPath: clip,
      }}
    >
      <Img
        src={resolvedSrc}
        alt={content.alt ?? ""}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
        }}
      />
      {dim > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            opacity: dim,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}
