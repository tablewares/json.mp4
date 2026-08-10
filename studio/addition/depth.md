Good — here are the three changes. This wires up the depth-aware parallax mechanism I flagged, plus opt-in zoom easing, while keeping every existing manifest byte-identical in output (default depth = 1 reproduces the current single-plane transform exactly).

## 1. `studio/../src/templating/camera.js`

Replace `resolveCameraTransform` with a depth-aware version. Depth is optional and defaults to `1`, which is mathematically identical to the current formula — this is a strict no-op for every scene that doesn't author depth.

```javascript
/**
 * Resolves a scene's camera transform for a single render frame.
 *
 * `depth` (new, optional, default 1) makes this parallax-aware: it's a
 * multiplier on how much THIS plane responds to the camera's zoom/pan,
 * relative to the anchor plane (depth === 1, the pre-existing behavior).
 *   depth === 1   -> byte-identical to the original single-plane formula
 *   depth < 1     -> moves/zooms less than the anchor (background plane)
 *   depth === 0   -> completely pinned (scale stays 1, no translate at all
 *                    regardless of camera motion — e.g. a HUD/kicker layer)
 *   depth > 1     -> moves/zooms more than the anchor (foreground pop)
 *
 * Callers that never pass `depth` get exactly the old single-plane output;
 * this is what makes per-layer parallax additive rather than a breaking
 * change to every existing camera spec.
 */
export function resolveCameraTransform(cameraSpec, composition, frame, durationInFrames, ctx, depth = 1) {
  if (!cameraSpec) {
    return {
      translateX: 0,
      translateY: 0,
      scale: 1,
      transformOrigin: "50% 50%",
    };
  }

  const actions = normalizeCameraActions(cameraSpec);
  if (actions.length === 0) {
    return {
      translateX: 0,
      translateY: 0,
      scale: 1,
      transformOrigin: "50% 50%",
    };
  }

  const motionDuration = cameraSpec.durationInFrames ?? Math.max((durationInFrames ?? 1) / (cameraSpec.speed ?? 1), 1);
  const progress = motionDuration <= 1
    ? 0
    : Math.min(Math.max((frame ?? 0) / Math.max(motionDuration - 1, 1), 0), 1);

  let current = actions[0];
  let next = actions[actions.length - 1];

  for (let i = 0; i < actions.length; i += 1) {
    if (actions[i].at <= progress) {
      current = actions[i];
    }
    if (actions[i].at >= progress) {
      next = actions[i];
      break;
    }
  }

  const segmentProgress = current.at === next.at
    ? 0
    : Math.min(Math.max((progress - current.at) / (next.at - current.at), 0), 1);

  const anchor = interpolateAnchor(current.anchor, next.anchor, segmentProgress, composition, ctx);

  // Zoom: snaps instantly by default (unchanged legacy behavior — see the
  // original comment this replaces). Opt-in continuous easing across the
  // segment via cameraSpec.easeZoom: true. Every camera spec that doesn't
  // set easeZoom keeps the exact old snap behavior.
  const zoomPercent = cameraSpec.easeZoom
    ? current.zoomPercent + (next.zoomPercent - current.zoomPercent) * segmentProgress
    : current.zoomPercent;
  const baseScale = zoomPercent / 100;

  // Depth-scaled zoom around the SAME anchor point every plane shares.
  // depth=1 reduces to `scale = baseScale` exactly, so translateX/Y below
  // collapse to the original formula for the default case.
  const scale = 1 + (baseScale - 1) * depth;

  const translateX = (composition.width / 2 - anchor.x) * (scale - 1);
  const translateY = (composition.height / 2 - anchor.y) * (scale - 1);

  return {
    translateX,
    translateY,
    scale,
    transformOrigin: "50% 50%",
  };
}

/**
 * Reads a resolved asset's/effect's parallax depth. Looked up from
 * resolvedStyle.depth (an ordinary styleOverride passthrough — `depth`
 * contains no "color"/"typography"/"easing"/"texture" substring, so
 * resolveAssetStyle already carries it through untouched with no schema
 * change needed). Missing/invalid values default to 1 — the pre-existing
 * single-plane behavior.
 */
export function resolveAssetDepth(item) {
  const d = item?.resolvedStyle?.depth;
  return typeof d === "number" && Number.isFinite(d) ? d : 1;
}
```

## 2. `src/pipelines/pipeline2-resolve/resolve.js`

`resolveCamera` needs to carry the new `easeZoom` flag through into the persisted `scene.camera` object, since `resolveCameraTransform` reads it off the resolved graph, not the raw spec:

```javascript
export function resolveCamera(cameraSpec, ctx) {
  if (!cameraSpec) return null;

  const actions = normalizeCameraActions(cameraSpec);
  if (actions.length === 0) return null;

  return {
    actions,
    durationInFrames: cameraSpec.durationInFrames ?? null,
    speed: cameraSpec.speed ?? 1,
    // Additive, defaults false -> identical resolved output to before this
    // field existed. Only meaningful when cameraSpec.easeZoom is explicitly
    // authored true.
    easeZoom: Boolean(cameraSpec.easeZoom),
  };
}
```

No other change is needed in resolve.js — an asset's `styleOverride.depth` already flows into `resolvedStyle.depth` through the existing `resolveAssetStyle` merge in `resolveScene` and `resolveTransitionEffects`, since `depth` doesn't match any of the token-resolution key patterns (`color`/`typography`/`easing`/`texture`) and falls through to the passthrough branch untouched.

## 3. `src/pipelines/pipeline3-render/Composition.jsx`

Import stays the same (`resolveCameraTransform` already imported). Add a grouping helper and replace `SceneLayer`:

```javascript
/**
 * Groups scene assets (and transitionOut visual effects) into ordered
 * "depth planes" for parallax camera rendering. Each item is tagged with
 * its resolvedStyle.depth (default 1). Groups are emitted in the order
 * their depth value is FIRST encountered while walking the already
 * z-sorted asset list followed by effects — so the default case (nobody
 * authors depth) produces exactly one group, in exactly the original
 * assets-then-effects order, which is what makes this change a no-op for
 * every existing scene.
 */
function groupPaintablesByDepth(sortedAssets, visualEffects) {
  const order = [];
  const byDepth = new Map();

  const push = (depth, item) => {
    if (!byDepth.has(depth)) {
      byDepth.set(depth, []);
      order.push(depth);
    }
    byDepth.get(depth).push(item);
  };

  for (const asset of sortedAssets) {
    push(resolveAssetDepth(asset), { kind: "asset", asset });
  }
  for (const effect of visualEffects) {
    push(resolveAssetDepth(effect), { kind: "effect", effect });
  }

  return order.map((depth) => ({ depth, items: byDepth.get(depth) }));
}

function SceneLayer({ scene, compositionSize }) {
  const frame = useCurrentFrame();
  const { durationInFrames: compositionDurationInFrames } = useVideoConfig();
  const sceneDuration = Math.max(scene.durationInFrames, 1);
  const clampedFrame = Math.min(Math.max(frame, 0), sceneDuration - 1);
  const frameForCamera = compositionDurationInFrames > 0 ? clampedFrame : frame;
  const resolvedAssetsById = Object.fromEntries(
    (scene.assets ?? []).map((a) => [a.id, a]).filter(([id]) => id != null),
  );

  // Z-ordering unchanged: lower z paints first, stable sort preserves
  // authored order among assets sharing a z.
  const layeredAssets = [...scene.assets].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const visualEffects = (scene.effects ?? []).filter((effect) => effect.kind !== "sfx");
  const depthGroups = groupPaintablesByDepth(layeredAssets, visualEffects);

  return (
    <AbsoluteFill style={{ background: scene.background ?? "#000" }}>
      {depthGroups.map(({ depth, items }) => {
        const cameraTransform = resolveCameraTransform(
          scene.camera,
          compositionSize,
          frameForCamera,
          sceneDuration,
          { resolvedAssetsById, sceneId: scene.id },
          depth,
        );

        return (
          <AbsoluteFill
            key={`depth-${depth}`}
            style={{
              transform: `translate(${cameraTransform.translateX}px, ${cameraTransform.translateY}px) scale(${cameraTransform.scale})`,
              transformOrigin: cameraTransform.transformOrigin,
              width: `${compositionSize.width}px`,
              height: `${compositionSize.height}px`,
              overflow: "hidden",
            }}
          >
            {items.map((item) => {
              if (item.kind === "effect") {
                return <SceneEffectLayer key={item.effect.id} effect={item.effect} />;
              }
              const asset = item.asset;
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
      })}
    </AbsoluteFill>
  );
}
```

And update the import line to pull in the new helper:

```javascript
import { resolveCameraTransform, resolveAssetDepth } from "../../templating/camera.js";
```

## What this actually unlocks for the Vox style

- Author a background photo/map layer at `styleOverride.depth: 0.35` and a cutout subject at the default `depth: 1` (or `1.4` for an exaggerated pop) — a camera push-in now genuinely separates them, which is the mechanic that sells "2.5D collage."
- `depth: 0` pins a layer completely (kicker text, lower-third, a highlighter overlay) so it stays locked to frame while everything else pushes/pans — useful for the "highlighter effect" staying legible during a camera move.
- `easeZoom: true` on a camera spec gives the continuous topography push Vox maps need, without touching any camera spec that relies on the existing snap behavior.

## One thing I deliberately did NOT touch, flagged per the "surface unresolved assumptions" convention

`scene.schema.json`'s `cameraSpec` definition has `"additionalProperties": false`. As-is, `setCamera`/`update-camera` in `ProjectBuilder.js` will **reject** `easeZoom` at the CLI layer (Ajv throws) even though `resolve.js`/`camera.js` now support it correctly for hand-resolved graphs. You asked me to scope this to camera.js/resolve.js/Composition.jsx, so I left the schema alone — but for `easeZoom` to be usable through `agent-cli.mjs`, `scene.schema.json#/definitions/cameraSpec/properties` needs one added line: `"easeZoom": { "type": "boolean" }`. `depth` needed no schema change since `styleOverride` is already an unconstrained object.