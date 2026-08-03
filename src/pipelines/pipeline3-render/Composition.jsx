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


function SceneEffectLayer({ effect }) {
  if (effect.kind === "sfx") {
    return (
      <Sequence
        from={effect.frame}
        durationInFrames={effect.durationInFrames ?? undefined}
        name={`sfx-${effect.id}`}
      >
        <Audio src={staticFile(effect.path)} volume={effect.volume ?? 1} />
      </Sequence>
    );
  }

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
      {(scene.effects ?? []).map((effect) => (
        <SceneEffectLayer key={effect.id} effect={effect} />
      ))}
    </AbsoluteFill>
  );
}

export function VideoComposition({ resolvedGraph }) {
  const { scenes, audioOverlay, config } = resolvedGraph;
  
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
      <AudioOverlay tracks={audioOverlay} fps={config.fps} />
    </AbsoluteFill>
  );
}