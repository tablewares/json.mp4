import React, { Suspense, lazy } from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { defaultTransition } from "../../transitions/default/DefaultTransition.jsx";
import { slideContinuity } from "../../transitions/slideContinuity/SlideContinuity.jsx";
import { AudioOverlay } from "../../audio/overlay.jsx";

// Known transition presentation factories. Custom transitions register here
// by folder name (matches transitionRegistry keys from pipeline2).
const TRANSITION_PRESENTATIONS = {
  default: defaultTransition,
  slideContinuity: slideContinuity,
};

// Statically known asset components. Remotion bundles at build time, so
// dynamic import-by-path (from componentPath) is resolved through this map
// rather than a runtime `import()` of an arbitrary string.
const ASSET_COMPONENTS = {
  TextBlock: lazy(() => import("../../assets/TextBlock/TextBlock.jsx").then((m) => ({ default: m.TextBlock }))),
  ImageReveal: lazy(() =>
    import("../../assets/ImageReveal/ImageReveal.jsx").then((m) => ({ default: m.ImageReveal }))
  ),
};

function SceneLayer({ scene }) {
  return (
    <AbsoluteFill style={{ background: scene.background ?? "#000" }}>
      {scene.assets.map((asset) => {
        const AssetComponent = ASSET_COMPONENTS[asset.assetType];
        if (!AssetComponent) throw new Error(`No renderer registered for assetType "${asset.assetType}"`);
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

/**
 * Top-level composition. `resolvedGraph` is exactly pipeline2's output —
 * nothing here does a lookup against a manifest, style registry, or asset
 * registry; every value needed is already sitting on the object.
 */
export function VideoComposition({ resolvedGraph }) {
  const { scenes, audioOverlay, config } = resolvedGraph;
  
  return (
    <AbsoluteFill>
      <TransitionSeries>
        {scenes.map((scene, i) => {
          const outTransition = scene.transitionOut;
          return (
            <React.Fragment key={scene.id}>
              <TransitionSeries.Sequence durationInFrames={scene.durationInFrames}>
                <SceneLayer scene={scene} />
              </TransitionSeries.Sequence>
              {outTransition && (
                <TransitionSeries.Transition
                  presentation={TRANSITION_PRESENTATIONS[outTransition.type](outTransition.props)}
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
