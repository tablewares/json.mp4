import { spawnSync } from "node:child_process";

/**
 * Post-render cinematography effects — runs strictly AFTER Remotion's own
 * render, on the finished mp4. Never touches manifest/style/asset-registry
 * logic. Every key is optional and independently no-op when omitted, so a
 * project that doesn't author config.postEffects is completely unaffected.
 *
 *   vignette:   { strength?: 0-1, default 0.35 }
 *   grain:      { strength?: 0-100, default 20 }
 *   colorGrade: { contrast?: number (1=neutral), brightness?: number (0=neutral, -1..1),
 *                 saturation?: number (1=neutral), gamma?: number (1=neutral) }
 *   letterbox:  { aspectRatio?: number, default 2.35 }
 */
export function buildPostEffectsFilterGraph(postEffects, videoSize) {
  const filters = [];

  if (postEffects.colorGrade) {
    const { contrast = 1, brightness = 0, saturation = 1, gamma = 1 } = postEffects.colorGrade;
    filters.push(`eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}:gamma=${gamma}`);
  }

  if (postEffects.vignette) {
    const strength = postEffects.vignette.strength ?? 0.35;
    // ffmpeg's vignette `angle` is radians; PI/5 (~0.63) is mild, interpolate
    // up to PI/2.5 (~1.26) at strength=1 for a heavier falloff.
    const angle = Math.PI / 5 + strength * (Math.PI / 2.5 - Math.PI / 5);
    filters.push(`vignette=angle=${angle.toFixed(4)}`);
  }

  if (postEffects.grain) {
    const strength = postEffects.grain.strength ?? 20;
    filters.push(`noise=alls=${strength}:allf=t+u`);
  }

  if (postEffects.letterbox) {
    const aspectRatio = postEffects.letterbox.aspectRatio ?? 2.35;
    const { width, height } = videoSize;
    const barHeight = Math.max(0, Math.round((height - width / aspectRatio) / 2));
    if (barHeight > 0) filters.push(`pad=${width}:${height + barHeight * 2}:0:${barHeight}:black`);
  }

  return filters.join(",");
}

/**
 * Shells out to ffmpeg — the one place in the pipeline that depends on a
 * system binary rather than an npm package, so it fails loudly and
 * specifically if ffmpeg isn't on PATH rather than surfacing a raw ENOENT.
 */
export function applyPostEffects(inputPath, outputPath, postEffects, videoSize = { width: 1920, height: 1080 }) {
  const filterGraph = buildPostEffectsFilterGraph(postEffects, videoSize);
  if (!filterGraph) return; // every key omitted/falsy — strict no-op

  const result = spawnSync("ffmpeg", ["-y", "-i", inputPath, "-vf", filterGraph, "-c:a", "copy", outputPath], {
    encoding: "utf-8",
  });
  if (result.error?.code === "ENOENT") {
    throw new Error("config.postEffects is set but ffmpeg is not on PATH. Install ffmpeg or remove postEffects.");
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg post-effects pass failed:\n${result.stderr}`);
  }
}