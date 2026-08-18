import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { validateProject } from "../pipeline1-validate/validate.js";
import { loadAssetRegistry, loadTransitionRegistry } from "../../registry/assetRegistry.js";
import { resolveAliasesDeep } from "../../registry/aliasRegistry.js";
import { loadAliasLibrary } from "../../registry/aliasLibrary.js";
import { resolveNarrationTiming } from "../../timing/ttsTiming.js";

// Extracted modules
import { resolveScene } from "./resolveScene.js";
import { resolveTransitionEffects, resolveSceneEffects, buildTransitionBundle } from "./resolveTransitions.js";
// `resolveTransitionEffects` above is a back-compat alias for `resolveSceneEffects`
// (the post-refactor name) — kept exported so any stale consumer keeps resolving.
// Pass-2 below reads scene.effects (the detached, frame-based effects surface) via
// the renamed symbol.
import { enforceCompositionPlugins } from "./plugins/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../../../public");

function computeTotalDurationSeconds(resolvedScenes, fps) {
  let acc = 0;
  for (const scene of resolvedScenes) {
    const overlap = scene.transitionOut?.durationInFrames ?? 0;
    acc += scene.durationInFrames - overlap;
  }
  return acc / fps;
}

/**
 * Turns a validated (but raw) project into a fully-resolved scene graph:
 * every style token resolved to a real value, every anchor resolved to
 * pixel {left, top}, every scene's duration forced to its TTS narration
 * window, and every transition bundled with exactly the carried-asset info
 * it asked for.
 */
export async function resolveProject(manifestPath) {
  const { manifest, config, styles, scenes } = validateProject(manifestPath);
  const assetRegistry = loadAssetRegistry();
  const transitionRegistry = loadTransitionRegistry();
  
  const hasNarration = Boolean(manifest.narration);
  let timingById = {};
  let ttsTotalDuration = null;
  let ttsAudioPath = null;
  const narrationTextById = {};
  
  
  if (hasNarration) {
    const ttsProvider = manifest.ttsProvider ?? config.ttsProvider ?? config.tts?.provider ?? null;
    const tts = await resolveNarrationTiming(
      manifest.narration.entries,
      manifest.narration.fullTranscript,
      config.fps,
      { provider: ttsProvider, humanize: config.ttsHumanize },
    );
    timingById = tts.byId;
    ttsTotalDuration = tts.totalDuration;
    ttsAudioPath = tts.audioPath;
    for (const entry of manifest.narration.entries) {
      narrationTextById[entry.id] = entry.text;
    }
  }

  // Expand aliases once across all scenes — covers transitionOut (which
  // resolve.js's pass-2 reads directly from `scenes[i].transitionOut` via
  // resolveTransitionEffects / buildTransitionBundle), plus every
  // per-asset alias in each scene's body. Returns new objects; the
  // original `scenes` array is untouched. No-op when no \"$alias\" key is
  // present anywhere.
  //
  // loadAliasLibrary() registers studio/library/aliases/*.json into the
  // SAME registry the built-ins live in, before resolveAliasesDeep looks
  // anything up — so a hand-authored "$alias": "custom.name" resolves
  // exactly like a built-in. Cheap + idempotent (cached after first call
  // per process); called here rather than at module load so a project
  // resolved via a different repoRoot / test harness still finds its
  // own library.
  loadAliasLibrary();
  const expandedScenes = scenes.map((s) => resolveAliasesDeep(s));

  // Sequential (not .map()) so carryFromScene can reference an EARLIER
  // scene's already-baked physics — each iteration's resolveScene call
  // gets everything resolved so far via resolvedScenesById.
  const resolvedScenes = [];
  const resolvedScenesById = {};
  for (let i = 0; i < expandedScenes.length; i += 1) {
    const resolved = resolveScene(expandedScenes[i], {
      styles,
      assetRegistry,
      config,
      timingById,
      narrationTextById,
      hasNarration,
      isLastScene: i === expandedScenes.length - 1,
      publicDir,
      resolvedScenesById,
    });
    resolvedScenes.push(resolved);
    resolvedScenesById[resolved.id] = resolved;
  }

  // Pass 2: Bundle transition context
  for (let i = 0; i < resolvedScenes.length; i += 1) {
    const outgoing = resolvedScenes[i];
    const incoming = resolvedScenes[i + 1];

    if (!incoming) {
      // Last scene: no transitionOut bundle (no incoming scene to cut to),
      // but still honor any authored effects on its own outgoing boundary
      // so inject-effects / hand-authored effects on the final scene render
      // instead of being silently dropped.
      
      // FIX: If we have TTS narration, ensure the final scene's duration 
      // stretches to cover the full synthesized audio length to prevent 
      // premature cut-off.
      if (hasNarration && ttsTotalDuration != null) {
        const totalFrames = Math.round(ttsTotalDuration * config.fps);
        const currentTotal = computeTotalDurationSeconds(resolvedScenes, config.fps) * config.fps;
        const padding = totalFrames - currentTotal;
        if (padding > 0) {
          outgoing.durationInFrames += padding;
        }
      }

      outgoing.effects = resolveSceneEffects(
        expandedScenes[i].effects,
        outgoing,
        styles,
        assetRegistry,
        { width: config.width, height: config.height },
      );
      continue;
    }


    outgoing.transitionOut = buildTransitionBundle(
      expandedScenes[i].transitionOut,
      outgoing,
      incoming,
      transitionRegistry,
    );
    incoming.transitionIn = outgoing.transitionOut;

    outgoing.effects = resolveSceneEffects(
      expandedScenes[i].effects,
      outgoing,
      styles,
      assetRegistry,
      { width: config.width, height: config.height },
    );
  }

  // Opt-in, config-driven composition checks (e.g. similarSceneGuard).
  // config.compositionPlugins is absent on every existing project, so
  // this is a strict no-op — runCompositionPlugins short-circuits on an
  // empty/missing array and enforceCompositionPlugins never throws.
  // enforceCompositionPlugins(resolvedScenes, config.compositionPlugins);

  const musicTracks = (manifest.music ?? []).map((m) => ({
    id: m.id,
    start: m.start ?? 0,
    end: m.end ?? computeTotalDurationSeconds(resolvedScenes, config.fps),
    path: m.path,
    volume: m.volume ?? 0.25,
    loop: m.loop ?? true,
    fadeInSeconds: m.fadeInSeconds ?? 0,
    fadeOutSeconds: m.fadeOutSeconds ?? 0,
  }));

  const audioOverlay = [
    ...(hasNarration && ttsTotalDuration != null && ttsAudioPath
      ? [{ id: "voiceover", start: 0, end: ttsTotalDuration, path: ttsAudioPath, volume: 1 }]
      : (manifest.audioOverlay ?? []).map((t) => ({ id: t.id, start: t.start, end: t.end, path: t.path, volume: t.volume ?? 1 }))),
    ...musicTracks,
  ];

  return {
    projectId: manifest.projectId,
    config,
    audioOverlay,
    scenes: resolvedScenes,
  };
}

// CLI usage: node resolveProject.js path/to/manifest.json [output.json]
if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = process.argv[2] ?? path.join(__dirname, "../../../studio/manifest/example-project/manifest.toon");
  const outPath = process.argv[3] ?? path.join(__dirname, "../../../studio/resolved.json");
  const resolved = await resolveProject(manifestPath);
  fs.writeFileSync(outPath, JSON.stringify(resolved, null, 2));
  console.log("done");
}
