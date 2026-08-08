import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { validateProject } from "../pipeline1-validate/validate.js";
import { loadAssetRegistry, loadTransitionRegistry, getAsset } from "../../registry/assetRegistry.js";
import { resolveColorToken, resolveAssetStyle } from "../../registry/styleRegistry.js";
import { resolveAnchor } from "../../templating/anchor.js";
import { resolveCamera } from "../../templating/camera.js";
import { resolveNarrationTiming, sceneTimingBudget } from "../../timing/ttsTiming.js";
import { resolveEffectFrame } from "../../timing/effectTiming.js";
import  { warnOnAssetOverlaps } from "./overlap_warn.js"
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Turns a validated (but raw) project into a fully-resolved scene graph:
 * every style token resolved to a real value, every anchor resolved to
 * pixel {left, top}, every scene's duration forced to its TTS narration
 * window, and every transition bundled with exactly the carried-asset info
 * it asked for.
 *
 * TTS is the single source of truth for timing. When the manifest has
 * `narration`, each scene's frame budget is taken directly from its
 * narration entry's real TTS window — never a calculated or guessed number
 * — and the `audioOverlay` is built from the synthesized audio's real
 * duration + path, overriding anything hand-authored in the manifest. With
 * no `narration`, scenes fall back to `config.defaultSceneDurationInFrames`.
 *
 * The output is a plain JSON-serializable object — pipeline3 does not open
 * a manifest, style file, or registry again.
 */
export async function resolveProject(manifestPath) {
  const { manifest, config, styles, scenes } = validateProject(manifestPath);
  const assetRegistry = loadAssetRegistry();
  const transitionRegistry = loadTransitionRegistry();
  const hasNarration = Boolean(manifest.narration);
  let timingById = {};
  let ttsTotalDuration = null;
  let ttsAudioPath = null;
  // Narration entry text, keyed by id — needed so pipeline2 can check
  // whether a KineticText asset's own content.text is word-for-word the
  // scene's narration before trusting real word timestamps for it.
  const narrationTextById = {};
  console.log("hasnarration", hasNarration)
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

  const resolvedScenes = scenes.map((scene, i) =>
    resolveScene(scene, {
      styles,
      assetRegistry,
      config,
      timingById,
      narrationTextById,
      hasNarration,
      isLastScene: i === scenes.length - 1,
    }),
  );


  // Pass 2: now that every scene's assets are resolved, bundle transition
  // context that needs *both* the outgoing and incoming scene (continuity).
  for (let i = 0; i < resolvedScenes.length; i += 1) {
    const outgoing = resolvedScenes[i];
    const incoming = resolvedScenes[i + 1];
    if (!incoming) continue;
    outgoing.transitionOut = buildTransitionBundle(
      scenes[i].transitionOut,
      outgoing,
      incoming,
      transitionRegistry,
    );
    incoming.transitionIn = outgoing.transitionOut;
        outgoing.effects = resolveTransitionEffects(
      scenes[i].transitionOut?.effects,
      outgoing,
      styles,
      assetRegistry,
      { width: config.width, height: config.height },
    );
  }

  // audioOverlay: TTS is the source of truth. When narration produced a real
  // audio file + duration, that overrides any hand-authored manifest entry —
  // the manifest's start/end was always just a placeholder for exactly this.
  // The TTS provider returns audioPath relative to public/ (so Remotion's
  // staticFile() accepts it) and totalDuration as the synthesized audio's
  // real length in seconds. Without narration we just pass the manifest's
  // audioOverlay through verbatim — each entry already carries its own path
  // (required by manifest.schema.json), so AudioOverlay has a real source
  // per track. Empty/missing audioOverlay resolves to [] — the renderer
  // then skips mounting <AudioOverlay> entirely (see Composition.jsx).
// after resolvedScenes + pass-2 transition bundling, before building audioOverlay:
function computeTotalDurationSeconds(resolvedScenes, fps) {
  let acc = 0;
  for (const scene of resolvedScenes) {
    const overlap = scene.transitionOut?.durationInFrames ?? 0;
    acc += scene.durationInFrames - overlap;
  }
  return acc / fps;
}

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

/**
 * Resolves a scene's transitionOut.effects into render-ready entries.
 * Entirely optional — returns [] when the scene has no authored effects, so
 * pre-existing manifests need no changes.
 *
 * `kind: "sfx"` carries a frame + path/volume for an <Audio> Sequence.
 * `kind: "visual"` is resolved through the same asset registry/anchor/style
 * pipeline every scene asset uses, so any existing asset type can be dropped
 * in as a boundary effect with no new rendering code.
 */
function resolveTransitionEffects(effectsSpec, outgoingScene, styles, assetRegistry, compositionSize) {
  if (!Array.isArray(effectsSpec) || effectsSpec.length === 0) return [];

  return effectsSpec.map((effect, i) => {
    const transitionOverlapInFrames = outgoingScene.transitionOut?.durationInFrames ?? 0;
    const frame = resolveEffectFrame(effect.offsetPercent ?? 0, outgoingScene.durationInFrames, transitionOverlapInFrames);

    if (effect.kind === "sfx") {
      return {
        id: effect.id ?? `sfx-${i}`,
        kind: "sfx",
        frame,
        durationInFrames: effect.durationInFrames ?? null,
        path: effect.path,
        volume: effect.volume ?? 1,
      };
    }

    const { manifest: assetManifest } = getAsset(assetRegistry, effect.assetType);
    const size = {
      width: effect.styleOverride?.width ?? assetManifest.defaultSize.width,
      height: effect.styleOverride?.height ?? assetManifest.defaultSize.height,
    };
    const anchor = effect.anchor ?? { position: "center", offsetXPercent: 0, offsetYPercent: 0 };
    const resolvedPosition = resolveAnchor(anchor, compositionSize, size);
    const resolvedStyle = {
      ...resolveAssetStyle(styles, assetManifest, effect.styleOverride),
      ...size,
    };
    const durationInFrames = effect.durationInFrames ?? 30;

    return {
      id: effect.id ?? `fx-${i}`,
      kind: "visual",
      assetType: effect.assetType,
      content: effect.contentOverride ?? {},
      resolvedPosition,
      resolvedStyle,
      timing: {
        durationInFrames,
        enterAtFrame: frame,
        exitAtFrame: Math.min(frame + durationInFrames, outgoingScene.durationInFrames),
      },
    };
  });
}

function resolveKineticWordTimings(assetSpec, assetManifest, sceneWords, narrationText) {
  if (assetSpec.assetType !== "KineticText" || !sceneWords?.length || !narrationText) return null;
  
  const useNarrationTiming =
    assetSpec.styleOverride?.useNarrationTiming ?? assetManifest.defaultStyle?.useNarrationTiming ?? true;
  if (!useNarrationTiming) return null;

  const assetText = (assetSpec.contentOverride?.text ?? "").trim();
  if (assetText !== narrationText.trim()) return null;

  const assetWordCount = assetText.split(/\s+/).filter(Boolean).length;
  if (assetWordCount !== sceneWords.length) return null;

  return sceneWords.map((w) => ({ word: w.word, startFrame: w.startFrame, endFrame: w.endFrame }));
}




function resolveScene(scene, { styles, assetRegistry, config, timingById, narrationTextById, hasNarration, isLastScene }) {
  const timing =
    hasNarration && scene.narrationRef
      ? sceneTimingBudget(scene.narrationRef, timingById)
      : { durationInFrames: config.defaultSceneDurationInFrames ?? 90 };

  const transitionPadding =
    !isLastScene && hasNarration && scene.narrationRef
      ? scene.transitionOut?.durationInFrames ?? 0
      : 0;
  const sceneDurationInFrames = timing.durationInFrames + transitionPadding;

  const compositionSize = { width: config.width, height: config.height };
  const narrationText = scene.narrationRef ? narrationTextById[scene.narrationRef] : null;

  const resolvedAssets = (scene.assets ?? []).map((assetSpec) => {
    const { manifest: assetManifest } = getAsset(assetRegistry, assetSpec.assetType);
    const size = {
      width: assetSpec.styleOverride?.width ?? assetManifest.defaultSize.width,
      height: assetSpec.styleOverride?.height ?? assetManifest.defaultSize.height,
    };
    const resolvedPosition = resolveAnchor(assetSpec.anchor, compositionSize, size);
    const resolvedStyle = {
      ...resolveAssetStyle(styles, assetManifest, assetSpec.styleOverride),
      ...size,
      backgroundColor: assetSpec.styleOverride?.backgroundColorToken
        ? resolveColorToken(styles, assetSpec.styleOverride.backgroundColorToken)
        : undefined,
    };

    const enterAtFrame = Math.round((assetSpec.enterAt ?? 0) * timing.durationInFrames);
    const exitAtFrame = Math.min(
      Math.round((assetSpec.exitAt ?? 1) * timing.durationInFrames),
      timing.durationInFrames,
    );

    const wordTimings = resolveKineticWordTimings(assetSpec, assetManifest, timing.words, narrationText);
   return {
      id: assetSpec.id ?? `${assetSpec.assetType}-${Math.random().toString(36).slice(2, 8)}`,
      assetType: assetSpec.assetType,
      componentPath: assetRegistry[assetSpec.assetType].componentPath,
      content: assetSpec.contentOverride ?? {},
      resolvedPosition,
      resolvedStyle,
      timing: {
        durationInFrames: sceneDurationInFrames,
        enterAtFrame,
        exitAtFrame,
        words: wordTimings,
      },
    };
  });
  
  warnOnAssetOverlaps(scene.id, resolvedAssets, sceneDurationInFrames, {
    compositionSize: { width: config.width, height: config.height },
    hasNarration,
  });

  const camera = resolveCamera(scene.camera);

  return {
    id: scene.id,
    durationInFrames: sceneDurationInFrames,
    effects: [],
    camera,
    ttsWindow: hasNarration
      ? {
          narrationRef: scene.narrationRef,
          startSeconds: timing.startSeconds,
          endSeconds: timing.endSeconds,
          startFrame: timing.startFrame,
          endFrame: timing.endFrame,
        }
      : null,
    background: scene.background ? resolveColorToken(styles, scene.background) : undefined,
    assets: resolvedAssets,
    transitionIn: null,
    transitionOut: null,
  };
}

function buildTransitionBundle(transitionSpec, outgoingScene, incomingScene, transitionRegistry) {
  const type = transitionSpec?.type ?? "default";
  const { manifest: transitionManifest } = transitionRegistry[type] ?? transitionRegistry["default"];
  const durationInFrames = transitionSpec?.durationInFrames ?? transitionManifest.defaultDurationInFrames;

  const bundle = {
    type,
    durationInFrames,
    componentPath: (transitionRegistry[type] ?? transitionRegistry["default"]).componentPath,
    props: { ...(transitionSpec?.params ?? {}) },
  };

  if (transitionManifest.consumes?.carriedAssets && transitionSpec?.params?.carryAssetId) {
    const carryId = transitionSpec.params.carryAssetId;
    const carryFrom = outgoingScene.assets.find((a) => a.id === carryId);
    const carryTo = incomingScene.assets.find((a) => a.id === carryId);
    if (!carryFrom || !carryTo) {
      throw new Error(
        `Transition "${type}" on scene "${outgoingScene.id}" requested carryAssetId "${carryId}" ` +
          `but it wasn't found in both the outgoing and incoming scene.`,
      );
    }
    bundle.props.carryFrom = { ...carryFrom.resolvedPosition, ...carryFrom.resolvedStyle };
    bundle.props.carryTo = { ...carryTo.resolvedPosition, ...carryTo.resolvedStyle };
  }

  return bundle;
}



// CLI usage: node resolve.js path/to/manifest.json [output.json]
if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = process.argv[2] ?? path.join(__dirname, "../../../studio/manifest/example-project/manifest.toon");
  const outPath = process.argv[3] ?? path.join(__dirname, "../../../studio/resolved.json");
  const resolved = await resolveProject(manifestPath);
  fs.writeFileSync(outPath, JSON.stringify(resolved, null, 2));
  console.log("done")
  // log.info(`Resolved scene graph written to ${outPath}`);
}
