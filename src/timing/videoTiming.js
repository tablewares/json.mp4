import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Resolves a video src to a probeable path/URL. Mirrors ImageReveal.jsx's
 * toStaticPath: an absolute http(s) URL passes straight to ffprobe (which
 * can read network streams directly); a path containing "public/" is
 * normalized to be relative to publicDir; anything else is treated as
 * already relative to publicDir.
 */
function resolveProbeTarget(src, publicDir) {
  if (src.startsWith("http")) return src;
  const idx = src.indexOf("public/");
  const relative = idx >= 0 ? src.slice(idx + "public/".length) : src;
  return path.join(publicDir, relative);
}

/**
 * Probes a video file's real duration via ffprobe. Used when a scene's
 * duration should be driven by a video asset's own length instead of TTS
 * narration timing — see resolveScene.js's video-duration override.
 *
 * @param {string} src           contentOverride.src, as authored
 * @param {string} publicDir     absolute path to the project's public/ dir
 * @returns {number} duration in seconds
 */
export function probeVideoDurationSeconds(src, publicDir) {
  const target = resolveProbeTarget(src, publicDir);
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", target],
    { encoding: "utf-8" },
  );
  if (result.error?.code === "ENOENT") {
    throw new Error(
      "contentOverride.useAsSceneDuration is set but ffprobe is not on PATH. Install ffmpeg/ffprobe or remove useAsSceneDuration.",
    );
  }
  if (result.status !== 0) {
    throw new Error(`ffprobe failed to read duration for "${target}":\n${result.stderr}`);
  }
  const seconds = parseFloat(result.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe returned an invalid duration for "${target}": "${result.stdout.trim()}"`);
  }
  return seconds;
}

/**
 * Finds the scene's designated "duration source" asset, if any — an asset
 * whose contentOverride carries `useAsSceneDuration: true`, meaning "this
 * video IS the scene; the scene's length is this video's length, not TTS's."
 * At most one per scene (ambiguity is an authoring error, not something to
 * silently pick a winner for).
 *
 * Strict no-op: a scene with no asset carrying this flag returns null and
 * resolveScene's TTS/default duration logic is untouched.
 *
 * @param {{id?: string, assets?: Array}} sceneSpec  raw (pre-resolve) scene
 * @returns {object|null}
 */
export function findSceneDurationVideoAsset(sceneSpec) {
  const matches = (sceneSpec.assets ?? []).filter((a) => a.contentOverride?.useAsSceneDuration === true);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Scene "${sceneSpec.id}" has ${matches.length} assets with contentOverride.useAsSceneDuration: true ` +
        `(${matches.map((a) => a.id ?? a.assetType).join(", ")}). Only one asset may drive scene duration.`,
    );
  }
  return matches[0];
}
