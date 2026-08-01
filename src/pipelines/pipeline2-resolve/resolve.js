import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { validateProject } from "../pipeline1-validate/validate.js";
import { loadAssetRegistry, loadTransitionRegistry, getAsset } from "../../registry/assetRegistry.js";
import { resolveColorToken, resolveAssetStyle } from "../../registry/styleRegistry.js";
import { resolveAnchor } from "../../templating/anchor.js";
import { resolveNarrationTiming, sceneTimingBudget } from "../../timing/ttsTiming.js";
import { createLogger } from "../../util/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger("resolve");

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

  // TTS is the timing source of truth. When narration is present we resolve
  // the real per-entry window + synthesized audio duration/path; scenes are
  // then FORCED into their TTS window. Without narration we fall back to the
  // config default and trust whatever audioOverlay the manifest declared.
  const hasNarration = Boolean(manifest.narration);
  let timingById = {};
  let ttsTotalDuration = null;

  if (hasNarration) {
    const tts = await resolveNarrationTiming(
      manifest.narration.entries,
      manifest.narration.fullTranscript,
      config.fps,
    );
    timingById = tts.byId;
    ttsTotalDuration = tts.totalDuration;
    log.info(
      `TTS timing resolved: ${Object.keys(timingById).length} entries, ` +
        `totalDuration=${ttsTotalDuration}`,
    );
  } else {
    log.info("No narration — scenes fall back to config.defaultSceneDurationInFrames");
  }

  // Pass 1: resolve each scene's own assets independently, forcing the scene
  // timeline into its TTS window. A scene that hands off to a successor has
  // its Sequence length padded by its outgoing transition's duration so that
  // TransitionSeries' overlap consumes that padding — NOT the next scene's
  // narration window — keeping every scene's start aligned with its TTS
  // start frame and the composition total equal to the voiceover length.
  const resolvedScenes = scenes.map((scene, i) =>
    resolveScene(scene, {
      styles,
      assetRegistry,
      config,
      timingById,
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
  }

  // audioOverlay: TTS is the source of truth. When narration produced a real
  // audio file + duration, that overrides any hand-authored manifest entry —
  // the manifest's start/end was always just a placeholder for exactly this.
  const audioOverlay = hasNarration && ttsTotalDuration != null
    ? [
        {
          id: "voiceover",
          start: 0,
          end: ttsTotalDuration,
        },
      ]
    : manifest.audioOverlay ?? [];

  return {
    projectId: manifest.projectId,
    config,
    audioOverlay,
    scenes: resolvedScenes,
  };
}

function resolveScene(scene, { styles, assetRegistry, config, timingById, hasNarration, isLastScene }) {
  // Force this scene's timeline into its TTS narration window. When narration
  // is the source of truth the entry MUST exist — falling back to a guessed
  // default would silently desync the video from the voiceover.
  const timing =
    hasNarration && scene.narrationRef
      ? sceneTimingBudget(scene.narrationRef, timingById)
      : { durationInFrames: config.defaultSceneDurationInFrames ?? 90 };
  console.log("timing", timing)
  // The Sequence length Remotion plays for this scene. Asset animations are
  // budgeted to the TTS window (`timing.durationInFrames`), but a scene that
  // hands off to a successor is padded by its outgoing transition's duration
  // so the transition cross-fade consumes that padding — not the next scene's
  // narration window. This keeps scene2's start frame == its TTS startFrame
  // and the rendered total == the synthesized audio length.
  const transitionPadding =
    !isLastScene && hasNarration && scene.narrationRef
      ? scene.transitionOut?.durationInFrames ?? 0
      : 0;
  const sceneDurationInFrames = timing.durationInFrames + transitionPadding;

  const compositionSize = { width: config.width, height: config.height };

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

    // enterAt/exitAt are fractions of THIS scene's TTS window. They must
    // resolve within [0, durationInFrames] — the TTS scene timeframe, not a
    // calculated one. Clamp exit at the window so an asset never runs past
    // the narration that defines the scene.
    const enterAtFrame = Math.round((assetSpec.enterAt ?? 0) * timing.durationInFrames);
    const exitAtFrame = Math.min(
      Math.round((assetSpec.exitAt ?? 1) * timing.durationInFrames),
      timing.durationInFrames,
    );

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
      },
    };
  });

  return {
    id: scene.id,
    durationInFrames: sceneDurationInFrames,
    // Carry the TTS window that owns this scene so it's traceable downstream
    // (timeline report, debugging) without re-deriving it.
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
    // transitionIn/transitionOut filled in during pass 2
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
  const manifestPath = process.argv[2] ?? path.join(__dirname, "../../manifest/example-project/manifest.json");
  const outPath = process.argv[3] ?? path.join(__dirname, "../../../resolved.json");
  const resolved = await resolveProject(manifestPath);
  fs.writeFileSync(outPath, JSON.stringify(resolved, null, 2));
  log.info(`Resolved scene graph written to ${outPath}`);
}
