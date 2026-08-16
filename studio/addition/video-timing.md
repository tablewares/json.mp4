Here's how I'd wire this up, following the existing two-phase resolver pattern (video duration has to be probed at resolve-time in Node — ffprobe isn't available in the Composition.jsx bundle).

## 1. New module: `src/timing/videoTiming.js`

Single-responsibility module, same style as `ttsTiming.js` / `postEffects.js` (shells out via `spawnSync`, fails loudly if the binary is missing):

```js
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
```

## 2. `src/pipelines/pipeline2-resolve/resolveScene.js`

```js
import { findSceneDurationVideoAsset, probeVideoDurationSeconds } from "../../timing/videoTiming.js";
```

and replace the `timing` computation:

```js
export function resolveScene(scene, { styles, assetRegistry, config, timingById, narrationTextById, hasNarration, isLastScene, publicDir }) {
  // TTS timing (or the flat default) still resolves first — this is what
  // feeds word-level KineticText sync below. useAsSceneDuration only
  // overrides the *boundary* (durationInFrames), so a narrated scene whose
  // video is the scene can still carry synced captions off the same
  // narration if the author wants that.
  let timing =
    hasNarration && scene.narrationRef
      ? sceneTimingBudget(scene.narrationRef, timingById)
      : { durationInFrames: config.defaultSceneDurationInFrames ?? 90 };

  // "The video is the scene": an asset opting into useAsSceneDuration
  // overrides TTS/default duration entirely with the video's own probed
  // length. Strict no-op when no asset authors the flag.
  const videoDurationAsset = findSceneDurationVideoAsset(scene);
  if (videoDurationAsset) {
    const src = videoDurationAsset.contentOverride?.src;
    if (!src) {
      throw new Error(
        `Scene "${scene.id}": asset "${videoDurationAsset.id ?? videoDurationAsset.assetType}" has ` +
          `contentOverride.useAsSceneDuration: true but no contentOverride.src to probe.`,
      );
    }
    const seconds = probeVideoDurationSeconds(src, publicDir);
    timing = { ...timing, durationInFrames: Math.round(seconds * config.fps) };
  }

  const transitionPadding = ...  // unchanged, reads timing.durationInFrames as before
```

Everything below (`sceneDurationInFrames`, per-asset `enterAt`/`exitAt` fractions, `timing.words` for KineticText) is untouched — it already reads off `timing.durationInFrames`/`timing.words`, so it picks up the override automatically.

## 3. `src/pipelines/pipeline2-resolve/resolve.js`

Pass `publicDir` through (add near the top, alongside the other `__dirname`-derived constants):

```js
const publicDir = path.join(__dirname, "../../../public");
```

and add it to the `resolveScene` call:

```js
const resolvedScenes = scenes.map((scene, i) =>
  resolveScene(scene, {
    styles,
    assetRegistry,
    config,
    timingById,
    narrationTextById,
    hasNarration,
    isLastScene: i === scenes.length - 1,
    publicDir,
  }),
);
```

## 4. `studio/assets/ImageReveal/manifest.json`

Add the flag to the content schema so `checkAgainstSchema` (in `addAsset`/`updateAsset`) and validate.js both know about it:

```json
"contentOverrideSchema": {
  "type": "object",
  "required": ["src"],
  "properties": {
    "src": { "type": "string" },
    "alt": { "type": "string" },
    "useAsSceneDuration": {
      "type": "boolean",
      "description": "When true and this asset holds a video, the scene's durationInFrames is overridden with this video's own probed length (via ffprobe) instead of TTS narration timing. At most one asset per scene may set this."
    }
  }
}
```

An agent would now author it as:

```json
{
  "assetType": "ImageReveal",
  "contentOverride": { "src": "assets/hero-clip.mp4", "useAsSceneDuration": true }
}
```

Want me to also add a `describeSceneEnvelope()`/`introspect.js` line surfacing this so the agent CLI documents it without opening the manifest?