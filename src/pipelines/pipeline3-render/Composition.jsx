import React, { Suspense, lazy } from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { AudioOverlay } from "../../audio/overlay.jsx";

// ==========================================
// 1. WEBPACK DYNAMIC REGISTRY DISCOVERY
// ==========================================

// --- 1A. ASSET REGISTRY DISCOVERY (Code-split via React.lazy) ---
const assetManifestContext = require.context("../../assets", true, /\/manifest\.json$/);
const assetModuleContext = require.context("../../assets", true, /\.(jsx|tsx|js|ts)$/);

const ASSET_COMPONENTS = {};

assetManifestContext.keys().forEach((manifestKey) => {
  const manifest = assetManifestContext(manifestKey);
  // Extract folder name from key path (e.g., './TextBlock/manifest.json' -> 'TextBlock')
  const folderName = manifestKey.split("/")[1]; 
  const assetType = manifest.name || folderName;
  const entryFile = manifest.main || `${folderName}.jsx`;

  const componentRelativePath = `./${folderName}/${entryFile}`;

  ASSET_COMPONENTS[assetType] = lazy(() =>
    Promise.resolve(assetModuleContext(componentRelativePath)).then((m) => ({
      default: m[assetType] || m.default,
    }))
  );
});

// --- 1B. TRANSITION PRESENTATION REGISTRY DISCOVERY (Synchronous) ---
const transitionManifestContext = require.context("../../transitions", true, /\/manifest\.json$/);
const transitionModuleContext = require.context("../../transitions", true, /\.(jsx|tsx|js|ts)$/);

const TRANSITION_PRESENTATIONS = {};

transitionManifestContext.keys().forEach((manifestKey) => {
  const manifest = transitionManifestContext(manifestKey);
  // Extract folder name from key path (e.g., './slideContinuity/manifest.json' -> 'slideContinuity')
  const folderName = manifestKey.split("/")[1];
  const transitionType = manifest.name || folderName;

  // Derive default filename matching standard camelCase / PascalCase conventions
  const defaultFileName = folderName.charAt(0).toUpperCase() + folderName.slice(1) + ".jsx";
  const entryFile = manifest.main || defaultFileName;

  const transitionRelativePath = `./${folderName}/${entryFile}`;

  if (transitionModuleContext.keys().includes(transitionRelativePath)) {
    const mod = transitionModuleContext(transitionRelativePath);
    // Support named export matching transitionType, named export matching folderName, or default export
    TRANSITION_PRESENTATIONS[transitionType] = mod[transitionType] || mod[folderName] || mod.default;
  }
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