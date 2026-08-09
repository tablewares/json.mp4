import { resolveAnchor } from "./anchor.js";
import { getAsset } from "../registry/assetRegistry.js";
import { resolveAssetStyle, resolveColorToken } from "../registry/styleRegistry.js";

/**
 * Compound-asset twin of anchor.js: re-roots authored sub-asset (layer)
 * specs to a container box instead of the composition frame, then applies
 * the same token + style resolution scene assets get. Each resolved layer
 * ends up shaped like a resolved scene asset so the Compound renderer stays
 * trivial.
 *
 * NOTE: This is the minimal implementation that satisfies the
 * `resolveLayers(layers, ctx)` contract documented in
 * docs/agent-guide/recipes/compound-layers.md. It is intentionally a
 * placeholder while the compound-layers feature is still mid-build (the
 * Compound renderer + Compound studio asset are not yet on disk). Behavior:
 * layers resolve their anchor/style/timing against the container box and
 * are returned in authored order.
 *
 * @param {Array} layers  authored sub-asset specs (contentOverride.layers)
 * @param {object} ctx     { assetRegistry, styles, containerSize,
 *                          containerDurationInFrames, enterAtFrame, exitAtFrame }
 */
export function resolveLayers(layers, ctx) {
  if (!Array.isArray(layers) || layers.length === 0) return [];
  const { assetRegistry, styles } = ctx;
  const containerSize = ctx.containerSize ?? { width: 0, height: 0 };
  const containerDurationInFrames = ctx.containerDurationInFrames ?? 1;
  const enterAtFrame = ctx.enterAtFrame ?? 0;
  const exitAtFrame = ctx.exitAtFrame ?? containerDurationInFrames;

  return layers.map((spec, i) => {
    const { manifest: assetManifest } = getAsset(assetRegistry, spec.assetType);
    const size = {
      width: spec.styleOverride?.width ?? assetManifest.defaultSize.width,
      height: spec.styleOverride?.height ?? assetManifest.defaultSize.height,
    };
    const resolvedPosition = resolveAnchor(spec.anchor, containerSize, size);
    const resolvedStyle = {
      ...resolveAssetStyle(styles, assetManifest, spec.styleOverride),
      ...size,
      backgroundColor: spec.styleOverride?.backgroundColorToken
        ? resolveColorToken(styles, spec.styleOverride.backgroundColorToken)
        : undefined,
    };
    const layerEnter = Math.round((spec.enterAt ?? 0) * containerDurationInFrames) + enterAtFrame;
    const layerExit = Math.min(
      Math.round((spec.exitAt ?? 1) * containerDurationInFrames) + enterAtFrame,
      exitAtFrame,
    );
    return {
      id: spec.id ?? `layer-${i}-${Math.random().toString(36).slice(2, 8)}`,
      assetType: spec.assetType,
      content: spec.contentOverride ?? {},
      resolvedPosition,
      resolvedStyle,
      timing: {
        durationInFrames: Math.max(layerExit - layerEnter, 1),
        enterAtFrame: layerEnter,
        exitAtFrame: layerExit,
      },
      z: spec.z ?? 0,
    };
  });
}
