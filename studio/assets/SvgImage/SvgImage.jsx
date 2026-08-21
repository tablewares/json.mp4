import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate, staticFile } from "remotion";
import { BoundaryDrawer, useAlphaSilhouette } from "../_shared/boundaryDrawer.jsx";
import { SvgShaderFilter, SvgGlow, SvgShineSweep, useSvgShaderId } from "../_shared/svgShader.jsx";

/**
 * SvgImage — embeds one static SVG image (via `staticFile()`, same
 * convention `ImageReveal` uses for its media sources) and traces a
 * self-drawing dashed/dotted line around the image's actual opaque pixels —
 * NOT its rectangular bounding box — using the shared alpha-silhouette
 * tracer in `assets/_shared/boundaryDrawer.jsx`. Optionally applies an
 * SVG-native shader (tone/blur/tint/glow/metallic-texture/shine-sweep — see
 * `assets/_shared/svgShader.jsx`) via `styleOverride.shader`, a
 * literal-value object (no tokens — raw numbers/hex). No text, no
 * background panel — just the image, its optional shader, and its
 * boundary, so this stays the smallest possible example of the "SVG
 * content + BoundaryDrawer (+ optional shader)" pattern to copy from.
 *
 * Contract:
 * - resolvedPosition: anchor-resolved layout from the pipeline
 * - resolvedStyle: fully token-resolved style values plus width/height
 * - content: contentOverride merged with defaults (src = path under public/)
 * - timing: enterAtFrame/exitAtFrame and scene timing budget
 */
export function SvgImage({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  // ---- entrance / exit envelope (same math as every other asset) ---------
  const enterProgress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 14, mass: 0.6, stiffness: 120 },
  });
  const framesUntilExit = exitAtFrame - frame;
  const exitProgress = interpolate(framesUntilExit, [0, Math.min(15, durationInFrames * 0.15)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const envelope = Math.min(enterProgress, exitProgress);
  const translateY = interpolate(envelope, [0, 1], [24, 0]);

  const width = resolvedStyle.width ?? 250;
  const height = resolvedStyle.height ?? 250;
  const src = content.src ?? "svg/Bitcoin.svg";

  // ---- boundary style (opt-in, additive) ----------------------------------
  const showBoundary = resolvedStyle.showBoundary ?? true;
  const boundaryInset = resolvedStyle.boundaryInset ?? 10;
  // Delay: how long after the image itself starts entering before the
  // boundary line starts drawing, so the image visibly lands first and THEN
  // the outline traces around it. `boundaryDelayFrames` (absolute) wins when
  // set; otherwise `boundaryDelayFraction` (default 0.15) is applied against
  // the asset's own active window. Both are additive/opt-in — the previous
  // hardcoded 10%-of-window delay is now this default.
  const activeWindow = Math.max(1, exitAtFrame - enterAtFrame);
  const boundaryDelayFrames =
    resolvedStyle.boundaryDelayFrames ??
    Math.round(activeWindow * (resolvedStyle.boundaryDelayFraction ?? 0.15));
  const boundaryEnterAtFrame = enterAtFrame + boundaryDelayFrames;

  // ---- trace the real opaque pixels, not the rectangular image box -------
  const silhouette = useAlphaSilhouette(src, { width, height, inset: boundaryInset });

  // ---- optional SVG-native shader (literal values, no tokens) ------------
  // styleOverride.shader is a plain object; author it by hand OR via a
  // curated preset alias, e.g. { "$alias": "shader.goldTint" } — resolved
  // to a literal object by resolveAliasesDeep in pipeline2 before this
  // component ever runs. See assets/_shared/svgShader.jsx for the full
  // field list and the no-op contract.
  const shader = resolvedStyle.shader;
  const shaderId = useSvgShaderId(shader);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{
        ...resolvedPosition,
        opacity: envelope,
        transform: `translateY(${translateY}px)`,
        overflow: "visible",
      }}
    >
      <defs>
        <SvgShaderFilter id={shaderId.id} shader={shader} />
      </defs>

      {shader?.glowFill ? (
        <SvgGlow points={silhouette?.points} glowFill={shader.glowFill} glowStrength={shader.glowStrength} opacity={envelope} />
      ) : null}

      <image href={staticFile(src)} x={0} y={0} width={width} height={height} style={shaderId.style} />

      {shader?.shineFill ? (
        <SvgShineSweep
          points={silhouette?.points}
          frame={frame}
          enterAtFrame={enterAtFrame}
          exitAtFrame={exitAtFrame}
          durationInFrames={durationInFrames}
          shineFill={shader.shineFill}
          shineWidth={shader.shineWidth}
          shineAngleDeg={shader.shineAngleDeg}
          shineOpacity={shader.shineOpacity}
          loop={shader.shineLoop}
          periodFrames={shader.shinePeriodFrames}
          opacity={envelope}
        />
      ) : null}

      {showBoundary ? (
        <BoundaryDrawer
          points={silhouette?.points}
          frame={frame}
          enterAtFrame={boundaryEnterAtFrame}
          exitAtFrame={exitAtFrame}
          envelope={envelope}
          stroke={resolvedStyle.boundaryStrokeColorToken ?? "#ffffff"}
          strokeWidth={resolvedStyle.boundaryStrokeWidth ?? 2}
          dashArray={resolvedStyle.boundaryDashArray ?? 6}
          dashGap={resolvedStyle.boundaryDashGap ?? 6}
          drawDurationFraction={resolvedStyle.boundaryDrawDurationFraction ?? 0.6}
          rotateDashes={resolvedStyle.boundaryRotate ?? false}
        />
      ) : null}
    </svg>
  );
}

export default SvgImage;
