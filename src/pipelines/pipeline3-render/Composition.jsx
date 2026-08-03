import React, { Suspense, lazy } from "react";
import { AbsoluteFill, Sequence, Audio, staticFile } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { AudioOverlay } from "../../audio/overlay.jsx";
import registryManifest from "../../../studio/generated/registry.generated.json";

// ==========================================
// 1. COMPONENT MODULE LOADING
// ==========================================
//
// Everything about *which* assetTypes/transitionTypes exist, which folder
// and component file each maps to, and duplicate-name detection now lives
// in src/registry/assetRegistry.js and is baked into
// studio/generated/registry.generated.json by
// src/registry/generateRegistryManifest.js (run on prebuild/predev — see
// package.json). This file's only remaining job is bundling the actual
// .jsx modules, because Webpack's require.context() needs a literal
// directory per call and can't take that directory list as a variable —
// that's the one thing that still has to be declared here, not derived.
//
// The array order below MUST match DEFAULT_ASSET_ROOTS /
// DEFAULT_TRANSITION_ROOTS in assetRegistry.js — registryManifest.assetRoots
// records what Node actually scanned, so a mismatch is caught below instead
// of silently mapping an asset to the wrong directory.

const ASSET_ROOT_CONTEXTS = [
  require.context("../../../studio/assets", true, /\.(jsx|tsx|js|ts)$/),
  require.context("../../../studio/graphics", true, /\.(jsx|tsx|js|ts)$/),
];

const TRANSITION_ROOT_CONTEXTS = [
  require.context("../../../studio/transitions", true, /\.(jsx|tsx|js|ts)$/),
];

function assertRootsMatch(declaredRoots, generatedRoots, label) {
  if (declaredRoots.length !== generatedRoots.length) {
    throw new Error(
      `${label} root count mismatch: Composition.jsx declares ${declaredRoots.length} require.context root(s) ` +
        `but studio/generated/registry.generated.json recorded ${generatedRoots.length} (${generatedRoots.join(", ")}). ` +
        `Re-run \`node src/registry/generateRegistryManifest.js\` and check the ${label} require.context list ` +
        `here mirrors DEFAULT_${label.toUpperCase()}_ROOTS in src/registry/assetRegistry.js.`
    );
  }
}

assertRootsMatch(ASSET_ROOT_CONTEXTS, registryManifest.assetRoots, "asset");
assertRootsMatch(TRANSITION_ROOT_CONTEXTS, registryManifest.transitionRoots, "transition");

function resolveComponentModule(moduleCtx, entry, key, kind) {
  const componentRelativePath = `./${entry.folderName}/${entry.entryFile}`;
  if (!moduleCtx.keys().includes(componentRelativePath)) {
    throw new Error(
      `${kind} "${key}": component "${entry.entryFile}" not found under folder "${entry.folderName}" ` +
        `(root #${entry.rootIndex}). The generated registry may be stale — ` +
        `re-run \`node src/registry/generateRegistryManifest.js\`.`
    );
  }
  return moduleCtx(componentRelativePath);
}

const ASSET_COMPONENTS = {};
for (const [assetType, entry] of Object.entries(registryManifest.assets)) {
  const moduleCtx = ASSET_ROOT_CONTEXTS[entry.rootIndex];
  ASSET_COMPONENTS[assetType] = lazy(() =>
    Promise.resolve(resolveComponentModule(moduleCtx, entry, assetType, "Asset")).then((m) => ({
      default: m[assetType] || m.default,
    }))
  );
}

// Transition presentations are loaded synchronously — TransitionSeries needs
// the presentation function at first render, not lazily.
const TRANSITION_PRESENTATIONS = {};
for (const [transitionType, entry] of Object.entries(registryManifest.transitions)) {
  const moduleCtx = TRANSITION_ROOT_CONTEXTS[entry.rootIndex];
  const mod = resolveComponentModule(moduleCtx, entry, transitionType, "Transition");
  // The shipping convention: each transition .jsx exports a factory named after
  // the transition type (e.g. `shatterWipe`, `slideContinuity`). `mod[<type>]`
  // covers those. The `default` transition breaks the convention: its folder/
  // type is "default", but its exported factory is `defaultTransition` (matching
  // its file `DefaultTransition.jsx`), because `default` is a reserved ESM
  // export slot — `mod["default"]` / `mod.default` read the (absent) default
  // export, not the named factory. So also try a lookup key derived from the
  // component file's basename with a lowercased first character; that yields
  // the matching factory for every shipped transition including `default`.
  const fileExportName = entry.entryFile.replace(/\.(jsx|tsx|js|ts)$/, "");
  const fileExportNameLowerFirst = fileExportName.charAt(0).toLowerCase() + fileExportName.slice(1);
  const presentationFn =
    mod[transitionType] || mod[entry.folderName] || mod[fileExportNameLowerFirst] || mod.default;
  if (!presentationFn) {
    throw new Error(
      `Transition "${transitionType}": no exported factory found. Looked for named exports ` +
        `"${transitionType}", "${entry.folderName}", "${fileExportNameLowerFirst}" ` +
        `(derived from ${entry.entryFile}) and a default export in folder "${entry.folderName}".`
    );
  }
  TRANSITION_PRESENTATIONS[transitionType] = presentationFn;
}


// Renders a single VISUAL transition effect (kind: "visual") inside the
// scene's TransitionSeries.Sequence — visual effects are part of the scene's
// rasterized image, so they composite fine here. SFX effects (kind: "sfx")
// are NOT handled here — Composition renders those at the composition root
// (see the SFX block below the TransitionSeries in VideoComposition) because
// <Audio> nested inside <TransitionSeries.Sequence> is silently dropped:
// TransitionSeries rasterizes each Sequence's visual children to an offscreen
// image and composites only that image, bypassing the live DOM tree that
// <Audio> needs to be discovered in.
function SceneEffectLayer({ effect }) {
  const AssetComponent = ASSET_COMPONENTS[effect.assetType];
  if (!AssetComponent) {
    throw new Error(`No renderer registered for effect assetType "${effect.assetType}"`);
  }
  return (
    <Suspense fallback={null}>
      <AssetComponent
        resolvedPosition={effect.resolvedPosition}
        resolvedStyle={effect.resolvedStyle}
        content={effect.content}
        timing={effect.timing}
      />
    </Suspense>
  );
}

// ==========================================
// 2. SCENE LAYER & COMPOSITION
// ==========================================

function SceneLayer({ scene }) {
  return (
    <AbsoluteFill style={{ background: scene.background ?? "#000" }}>
      {scene.assets.map((asset) => {
        const AssetComponent = ASSET_COMPONENTS[asset.assetType];
        if (!AssetComponent) {
          throw new Error(`No renderer registered for assetType "${asset.assetType}"`);
        }
        return (
          <Suspense key={asset.id} fallback={null}>
            <AssetComponent
              resolvedPosition={asset.resolvedPosition}
              resolvedStyle={asset.resolvedStyle}
              content={asset.content}
              timing={asset.timing}
            />
          </Suspense>
        );
      })}
      {(scene.effects ?? [])
        .filter((effect) => effect.kind !== "sfx")
        .map((effect) => (
          <SceneEffectLayer key={effect.id} effect={effect} />
        ))}
    </AbsoluteFill>
  );
}

export function VideoComposition({ resolvedGraph }) {
  const { scenes, audioOverlay, config } = resolvedGraph;
  // Only mount <AudioOverlay> when the resolved graph actually has tracks.
  // pipeline2 returns audioOverlay: [] for projects with no narration and no
  // manifest audioOverlay (e.g. packet-journey) — in that case we render no
  // audio container at all, so there is no risk of a stray hardcoded voice
  // bleeding into a silent project. <AudioOverlay> also independently no-ops
  // on an empty array, but skipping it here keeps the component tree honest
  // and lets the rest of the tree short-circuit one <Sequence> probe.
  const hasAudioOverlay = Array.isArray(audioOverlay) && audioOverlay.length > 0;

  // Absolute composition-frame at which each scene starts. TransitionSeries
  // lays scenes out end-to-end but eats each transition's durationInFrames as
  // overlap between adjacent scenes, so scene[i]'s start =
  //   sum(durations[0..i-1]) - sum(transitionOut.durationInFrames[0..i-1]).
  // This mirrors totalDurationInFrames in src/index.jsx and is needed to place
  // root-level SFX <Sequence>s (see comment below the TransitionSeries) at the
  // composition frame that lines up with the effect's scene-local frame.
  const sceneStartFrames = {};
  {
    let acc = 0;
    for (const scene of scenes) {
      sceneStartFrames[scene.id] = acc;
      const overlap = scene.transitionOut?.durationInFrames ?? 0;
      acc += scene.durationInFrames - overlap;
    }
  }
  return (
    <AbsoluteFill>
      <TransitionSeries>
        {scenes.map((scene, i) => {
          const outTransition = scene.transitionOut;
          const presentationFn = outTransition ? TRANSITION_PRESENTATIONS[outTransition.type] : null;

          if (outTransition && !presentationFn) {
            throw new Error(`No transition presentation registered for type "${outTransition.type}"`);
          }

          return (
            <React.Fragment key={scene.id}>
              <TransitionSeries.Sequence durationInFrames={scene.durationInFrames}>
                <SceneLayer scene={scene} />
              </TransitionSeries.Sequence>
              {outTransition && presentationFn && (
                <TransitionSeries.Transition
                  presentation={presentationFn(outTransition.props)}
                  timing={linearTiming({ durationInFrames: outTransition.durationInFrames })}
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>
      {hasAudioOverlay && <AudioOverlay tracks={audioOverlay} fps={config.fps} />}
      {/* SFX effects must live at the composition ROOT, not inside
          <TransitionSeries.Sequence>. TransitionSeries rasterizes each
          Sequence's visual children to an offscreen image and composites
          only that image across the cut — audio nested inside the Sequence
          is dropped because <Audio> is processed by walking the live DOM
          tree, which TransitionSeries bypasses for non-active scenes. So we
          lift every `kind: "sfx"` effect out of SceneLayer, compute its
          absolute composition-frame start (scene start frame + effect's
          scene-local frame), and render it as a top-level <Sequence><Audio>.
          Visual effects stay inside SceneLayer — they ARE part of the
          rasterized image, so they render fine there. */}
      {scenes.flatMap((scene) =>
        (scene.effects ?? [])
          .filter((e) => e.kind === "sfx")
          .map((effect) => (
            <Sequence
              key={`sfx-${scene.id}-${effect.id}`}
              from={sceneStartFrames[scene.id] + effect.frame}
              durationInFrames={effect.durationInFrames ?? undefined}
              name={`sfx-${effect.id}`}
            >
              <Audio src={staticFile(effect.path)} volume={effect.volume ?? 1} />
            </Sequence>
          )),
      )}
    </AbsoluteFill>
  );
}