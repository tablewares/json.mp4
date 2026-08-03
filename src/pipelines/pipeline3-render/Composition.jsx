import React, { Suspense, lazy } from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { AudioOverlay } from "../../audio/overlay.jsx";

// ==========================================
// 1. WEBPACK DYNAMIC REGISTRY DISCOVERY
// ==========================================
//
// The renderer discovers every asset + transition the same way pipeline2 does
// on the Node side (src/registry/assetRegistry.js): scan one or more root
// directories, and each immediate subfolder carrying a manifest.json becomes a
// registry entry keyed by the folder name. Webpack's require.context needs a
// literal base directory at compile time, so each asset/transition root gets
// its own pair of require.context calls below (arrayed in ASSET_ROOT_CONTEXTS
// / TRANSITION_ROOT_CONTEXTS). To add a new root, add one
// [manifestCtx, moduleCtx, label] triple whose two require.context calls use
// the new literal base directory. A folder name (assetType / transitionType)
// must be unique across every root or the duplicate throws at module load.
//
// Manifest field contract (kept identical to the Node registry):
//   assetType / transitionType — registry key (falls back to folder name)
//   component                  — entry filename, e.g. "TextBlock.jsx"
//
// NOTE: prior versions used manifest.name / manifest.main, which never existed
// on the shipped manifests; both are now corrected to the real fields.

const ASSET_ROOT_CONTEXTS = [
  // [manifestContext, moduleContext, rootLabel]
  [require.context("../../../studio/assets", true, /\/manifest\.json$/), require.context("../../../studio/assets", true, /\.(jsx|tsx|js|ts)$/), "studio/assets"],
  // `studio/graphics/` is the second shipped asset root — the Node-side
  // registry (assetRegistry.js DEFAULT_ASSET_ROOTS) already unions it in,
  // so the webpack side must mirror that root or resolve and render disagree
  // (an assetType resolved from graphics on the Node side would throw
  // "No renderer registered for assetType" at render). Same shape as assets:
  // <Name>/manifest.json + <Name>.jsx, keyed by folder name.
  [require.context("../../../studio/graphics", true, /\/manifest\.json$/), require.context("../../../studio/graphics", true, /\.(jsx|tsx|js|ts)$/), "studio/graphics"],
];

const TRANSITION_ROOT_CONTEXTS = [
  [require.context("../../../studio/transitions", true, /\/manifest\.json$/), require.context("../../../studio/transitions", true, /\.(jsx|tsx|js|ts)$/), "studio/transitions"],
];

const ASSET_COMPONENTS = {};

ASSET_ROOT_CONTEXTS.forEach(([manifestCtx, moduleCtx, rootLabel]) => {
  manifestCtx.keys().forEach((manifestKey) => {
    const manifest = manifestCtx(manifestKey);
    const folderName = manifestKey.split("/")[1];
    const assetType = manifest.assetType || folderName;
    // manifest.component is the real field — fall back to "<Folder>.jsx" only
    // if an old manifest is missing it.
    const entryFile = manifest.component || `${folderName}.jsx`;
    const componentRelativePath = `./${folderName}/${entryFile}`;

    if (!moduleCtx.keys().includes(componentRelativePath)) {
      throw new Error(
        `Asset "${assetType}" (${rootLabel}): manifest.component "${entryFile}" not found under ${rootLabel}/${folderName}`
      );
    }
    if (Object.prototype.hasOwnProperty.call(ASSET_COMPONENTS, assetType)) {
      throw new Error(
        `Duplicate assetType "${assetType}" — already registered from another root. ` +
          `Folder names must be unique across all asset roots.`
      );
    }
    ASSET_COMPONENTS[assetType] = lazy(() =>
      Promise.resolve(moduleCtx(componentRelativePath)).then((m) => ({
        default: m[assetType] || m.default,
      }))
    );
  });
});

// --- 1B. TRANSITION PRESENTATION REGISTRY DISCOVERY (Synchronous) ---
// Same multi-root pattern as assets above. A transition presentation module is
// loaded synchronously (not lazy) because TransitionSeries needs the
// presentation function at first render.
const TRANSITION_PRESENTATIONS = {};

TRANSITION_ROOT_CONTEXTS.forEach(([manifestCtx, moduleCtx, rootLabel]) => {
  manifestCtx.keys().forEach((manifestKey) => {
    const manifest = manifestCtx(manifestKey);
    const folderName = manifestKey.split("/")[1];
    const transitionType = manifest.transitionType || folderName;
    // manifest.component is the real field — ucfirst folder name only as fallback.
    const defaultFileName =
      folderName.charAt(0).toUpperCase() + folderName.slice(1) + ".jsx";
    const entryFile = manifest.component || defaultFileName;
    const transitionRelativePath = `./${folderName}/${entryFile}`;

    if (!moduleCtx.keys().includes(transitionRelativePath)) {
      throw new Error(
        `Transition "${transitionType}" (${rootLabel}): manifest.component "${entryFile}" not found under ${rootLabel}/${folderName}`
      );
    }
    if (Object.prototype.hasOwnProperty.call(TRANSITION_PRESENTATIONS, transitionType)) {
      throw new Error(
        `Duplicate transitionType "${transitionType}" — already registered from another root. ` +
          `Folder names must be unique across all transition roots.`
      );
    }
    const mod = moduleCtx(transitionRelativePath);
    // Support named export matching transitionType, named export matching folderName, or default export.
    TRANSITION_PRESENTATIONS[transitionType] = mod[transitionType] || mod[folderName] || mod.default;
  });
});

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