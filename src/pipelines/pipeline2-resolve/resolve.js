import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { validateProject } from "../pipeline1-validate/validate.js";
import { loadAssetRegistry, loadTransitionRegistry, getAsset } from "../../registry/assetRegistry.js";
import { resolveColorToken, resolveAssetStyle } from "../../registry/styleRegistry.js";
import { resolveAnchor } from "../../templating/anchor.js";
import { resolveNarrationTiming, sceneTimingBudget } from "../../timing/ttsTiming.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Turns a validated (but raw) project into a fully-resolved scene graph:
 * every style token resolved to a real value, every anchor resolved to
 * pixel {left, top}, every scene's duration attached from TTS timing, and
 * every transition bundled with exactly the carried-asset info it asked for.
 *
 * The output is a plain JSON-serializable object — pipeline3 does not open
 * a manifest, style file, or registry again.
 */
export async function resolveProject(manifestPath) {
  const { manifest, config, styles, scenes } = validateProject(manifestPath);
  const assetRegistry = loadAssetRegistry();
  const transitionRegistry = loadTransitionRegistry();

  const timingById = manifest.narration
    ? await resolveNarrationTiming(manifest.narration.entries, manifest.narration.fullTranscript, config.fps)
    : {};

  // Pass 1: resolve each scene's own assets independently (position, style, content).
  const resolvedScenes = scenes.map((scene) => resolveScene(scene, { styles, assetRegistry, config, timingById }));

  // Pass 2: now that every scene's assets are resolved, bundle transition
  // context that needs *both* the outgoing and incoming scene (continuity).
  for (let i = 0; i < resolvedScenes.length; i++) {
    const outgoing = resolvedScenes[i];
    const incoming = resolvedScenes[i + 1];
    if (!incoming) continue;
    outgoing.transitionOut = buildTransitionBundle(
      scenes[i].transitionOut,
      outgoing,
      incoming,
      transitionRegistry
    );
    incoming.transitionIn = outgoing.transitionOut;
  }

  return {
    projectId: manifest.projectId,
    config,
    audioOverlay: manifest.audioOverlay ?? [],
    scenes: resolvedScenes,
  };
}

function resolveScene(scene, { styles, assetRegistry, config, timingById }) {
  const timing = Object.keys(timingById).length
    ? sceneTimingBudget(scene.narrationRef, timingById)
    : { durationInFrames: config.defaultSceneDurationInFrames ?? 90, startFrame: 0 };

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

    return {
      id: assetSpec.id ?? `${assetSpec.assetType}-${Math.random().toString(36).slice(2, 8)}`,
      assetType: assetSpec.assetType,
      componentPath: assetRegistry[assetSpec.assetType].componentPath,
      content: assetSpec.contentOverride ?? {},
      resolvedPosition,
      resolvedStyle,
      timing: {
        durationInFrames: timing.durationInFrames,
        enterAtFrame: Math.round((assetSpec.enterAt ?? 0) * timing.durationInFrames),
        exitAtFrame: Math.round((assetSpec.exitAt ?? 1) * timing.durationInFrames),
      },
    };
  });

  return {
    id: scene.id,
    durationInFrames: timing.durationInFrames,
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
          `but it wasn't found in both the outgoing and incoming scene.`
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
  console.log("resolved", resolved)
  fs.writeFileSync(outPath, JSON.stringify(resolved, null, 2));
  console.log(`Resolved scene graph written to ${outPath}`);
}
