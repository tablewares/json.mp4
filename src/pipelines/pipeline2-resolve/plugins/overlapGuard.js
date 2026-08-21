/**
 * Composition plugin: flags per-scene layout problems — two assets visibly
 * overlapping on screen at the same time, an asset cut off by the frame
 * edges, an asset that's tiny relative to the composition, an asset whose
 * on-screen window is too short to read, and (narrated scenes only) a scene
 * with too little visual activity during the narration window.
 *
 * This is the plugin-system replacement for the old always-on
 * `overlap_warn.js` console.warn calls that used to fire unconditionally
 * from `resolveScene.js` on every resolve. Same detection math (rect
 * intersection + temporal overlap — see `rectIntersectionArea` /
 * `getRectFromAsset` in `overlap_warn.js`, reused here), but now:
 *
 *   1. Opt-in like every other composition plugin — silent unless a
 *      project's `config.compositionPlugins` array names it. No project
 *      pays the console-noise cost unless it asks for the check.
 *   2. Structured findings (`{plugin, severity, sceneIds, message}`)
 *      instead of raw `console.warn` strings, so severity is configurable
 *      per check and a breach can be promoted to `"error"` (blocks
 *      resolve/render) instead of being permanently advisory-only.
 *   3. Runs once over the whole resolved scene graph (post pass-2, same
 *      timing as `similarSceneGuard`) instead of once per scene mid-loop —
 *      consistent with the rest of the plugin system's contract.
 *
 * Each of the five checks below can be toggled and severity-tuned
 * independently, same shape as `similarSceneGuard`'s per-attribute options.
 */
import { rectIntersectionArea } from "../overlap_warn.js";

const DEFAULT_OPTIONS = {
  // --- which checks run ---------------------------------------------------
  checkOverlap: true,
  checkOffscreen: true,
  checkTinySize: true,
  checkShortDuration: true,
  checkLowActivity: true,

  // --- per-check severity ("warn" logs via console.warn and resolve
  // proceeds; "error" is collected and thrown by enforceCompositionPlugins,
  // aborting resolve/render). All default to "warn" — the exact behavior
  // the old overlap_warn.js had (console.warn only, never blocking) — so
  // opting a project into this plugin with no severity overrides is a
  // behavior-preserving move relative to the old always-on warnings. ---
  overlapSeverity: "warn",
  offscreenSeverity: "warn",
  tinySizeSeverity: "warn",
  shortDurationSeverity: "warn",
  lowActivitySeverity: "warn",

  // --- thresholds, same defaults overlap_warn.js used --------------------
  tinySizeFraction: 0.04,          // width or height below this fraction of composition size
  shortDurationMinFrames: 8,        // floor for the "too short" check
  shortDurationFraction: 0.08,      // ...as a fraction of scene duration (max of the two wins)
  lowActivityMinFrames: 15,
  lowActivityFraction: 0.25,
};

function getRectFromAsset(asset) {
  return {
    left: asset.resolvedPosition.left,
    top: asset.resolvedPosition.top,
    width: asset.resolvedStyle.width,
    height: asset.resolvedStyle.height,
  };
}

function overlapFindings(scene, options, compositionSize) {
  if (!options.checkOverlap) return [];
  const findings = [];
  const assets = scene.assets ?? [];

  for (let i = 0; i < assets.length; i += 1) {
    for (let j = i + 1; j < assets.length; j += 1) {
      const a = assets[i];
      const b = assets[j];

      const overlapStart = Math.max(a.timing.enterAtFrame, b.timing.enterAtFrame);
      const overlapEnd = Math.min(a.timing.exitAtFrame, b.timing.exitAtFrame);
      if (overlapStart >= overlapEnd) continue;

      const rectA = getRectFromAsset(a);
      const rectB = getRectFromAsset(b);
      const overlapArea = rectIntersectionArea(rectA, rectB);
      if (overlapArea <= 0) continue;

      const areaA = rectA.width * rectA.height;
      const areaB = rectB.width * rectB.height;
      const smallerArea = Math.min(areaA, areaB) || 1;
      const overlapPct = (overlapArea / smallerArea) * 100;

      findings.push({
        plugin: name,
        severity: options.overlapSeverity,
        sceneIds: [scene.id],
        message:
          `Scene "${scene.id}": asset "${a.id}" (${a.assetType}) and "${b.id}" (${b.assetType}) ` +
          `overlap by ${Math.round(overlapArea)}px² (${overlapPct.toFixed(1)}% of the smaller asset's ` +
          `area) during frames ${Math.round(overlapStart)}-${Math.round(overlapEnd)}.`,
      });
    }
  }
  return findings;
}

function perAssetFindings(scene, options, compositionSize) {
  const findings = [];
  for (const asset of scene.assets ?? []) {
    const rect = getRectFromAsset(asset);

    if (options.checkOffscreen) {
      const offScreenSides = [];
      if (rect.left < 0) offScreenSides.push("left");
      if (rect.top < 0) offScreenSides.push("top");
      if (rect.left + rect.width > compositionSize.width) offScreenSides.push("right");
      if (rect.top + rect.height > compositionSize.height) offScreenSides.push("bottom");
      if (offScreenSides.length > 0) {
        findings.push({
          plugin: name,
          severity: options.offscreenSeverity,
          sceneIds: [scene.id],
          message:
            `Scene "${scene.id}": asset "${asset.id}" (${asset.assetType}) is cut off by the composition ` +
            `bounds on the ${offScreenSides.join(", ")} side${offScreenSides.length > 1 ? "s" : ""}.`,
        });
      }
    }

    if (options.checkTinySize) {
      const isExtremelySmall =
        rect.width < compositionSize.width * options.tinySizeFraction ||
        rect.height < compositionSize.height * options.tinySizeFraction;
      if (isExtremelySmall) {
        findings.push({
          plugin: name,
          severity: options.tinySizeSeverity,
          sceneIds: [scene.id],
          message:
            `Scene "${scene.id}": asset "${asset.id}" (${asset.assetType}) is extremely small ` +
            `(${Math.round(rect.width)}x${Math.round(rect.height)}px) relative to the composition.`,
        });
      }
    }

    if (options.checkShortDuration) {
      const durationInFrames = Math.max(0, asset.timing.exitAtFrame - asset.timing.enterAtFrame);
      const shortDurationThreshold = Math.max(
        options.shortDurationMinFrames,
        Math.round(scene.durationInFrames * options.shortDurationFraction),
      );
      if (durationInFrames <= shortDurationThreshold) {
        findings.push({
          plugin: name,
          severity: options.shortDurationSeverity,
          sceneIds: [scene.id],
          message:
            `Scene "${scene.id}": asset "${asset.id}" (${asset.assetType}) lasts too short ` +
            `(${durationInFrames} frames) for the scene duration.`,
        });
      }
    }
  }
  return findings;
}

function lowActivityFindings(scene, options) {
  if (!options.checkLowActivity) return [];
  const hasNarration = scene.ttsWindow != null;
  if (!hasNarration) return [];

  const assets = scene.assets ?? [];
  const totalVisibleFrameTime = assets.reduce(
    (sum, asset) => sum + Math.max(0, asset.timing.exitAtFrame - asset.timing.enterAtFrame),
    0,
  );
  const activityThreshold = Math.max(
    options.lowActivityMinFrames,
    Math.round(scene.durationInFrames * options.lowActivityFraction),
  );
  if (totalVisibleFrameTime >= activityThreshold) return [];

  return [
    {
      plugin: name,
      severity: options.lowActivitySeverity,
      sceneIds: [scene.id],
      message:
        `Scene "${scene.id}": the composition has little visual activity during the narration window ` +
        `(${totalVisibleFrameTime}/${scene.durationInFrames} frames of asset presence).`,
    },
  ];
}

export const name = "overlapGuard";

/**
 * @param {Array} resolvedScenes  fully pass-2-resolved scenes
 * @param {{compositionSize?: {width:number, height:number}}} ctx
 * @param {Partial<typeof DEFAULT_OPTIONS>} rawOptions
 * @returns {Array<{plugin:string, severity:string, sceneIds:string[], message:string}>}
 */
export function run(resolvedScenes, ctx = {}, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const compositionSize = ctx.compositionSize ?? { width: 1920, height: 1080 };

  const findings = [];
  for (const scene of resolvedScenes) {
    findings.push(...overlapFindings(scene, options, compositionSize));
    findings.push(...perAssetFindings(scene, options, compositionSize));
    findings.push(...lowActivityFindings(scene, options));
  }
  return findings;
}

// exported for tests / ProjectBuilder introspection.
export const DEFAULTS = DEFAULT_OPTIONS;
export const _internals = {
  getRectFromAsset,
  overlapFindings,
  perAssetFindings,
  lowActivityFindings,
};
