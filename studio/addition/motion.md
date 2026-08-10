Quick flag before the code: your memory notes `motion/motion.js` as an existing key pipeline file, but its contents weren't included in this context, so I can't confirm its current shape or reconcile with it. What follows is a fresh single-responsibility module designed to match the same two-phase pattern as `camera.js` (resolve-time normalization → render-time frame math). If a `motion.js` already exists with a different contract, treat this as a proposal to diff against it rather than a guaranteed-compatible drop-in.

Also: `validate.js` only loads schemas from `pipeline1-validate/schema/`, not `legacy/` — so only `schema/scene.schema.json` needs the update below. The `legacy/` copy appears dead/reference-only; flagging rather than touching it.

## New file: `src/motion/motion.js`

```js
/**
 * Owns entrance/exit motion math for scene assets — same split as
 * camera.js: resolveMotion() runs at pipeline2 (authoring-time, produces a
 * JSON-safe descriptor for resolved.json), computeMotionTransform() runs at
 * pipeline3 (Composition.jsx, pure per-frame math, no remotion import).
 *
 * No-op by default: an asset with no `motion` key resolves to null, and
 * computeMotionTransform(null, ...) returns the identity transform — every
 * pre-existing manifest renders byte-identical.
 */

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;

const DEFAULT_DISTANCE_PX = 80;
const DEFAULT_DURATION_IN_FRAMES = 18;

// direction -> unit offset (multiplied by distancePx). "up" means: for an
// entrance, the asset STARTS below its anchored position (positive Y) and
// rises to 0 — i.e. "fadeUp" fades the asset up into place. The same table
// is reused for exits; computeMotionTransform flips the sign so "fadeOutUp"
// travels upward and away as it leaves.
const DIRECTION_OFFSETS = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};

const IN_ALIASES = {
  none: { fade: false, direction: null },
  fade: { fade: true, direction: null },
  fadeUp: { fade: true, direction: "up" },
  fadeDown: { fade: true, direction: "down" },
  fadeLeft: { fade: true, direction: "left" },
  fadeRight: { fade: true, direction: "right" },
};

const OUT_ALIASES = {
  none: { fade: false, direction: null },
  fadeOut: { fade: true, direction: null },
  fadeOutUp: { fade: true, direction: "up" },
  fadeOutDown: { fade: true, direction: "down" },
  fadeOutLeft: { fade: true, direction: "left" },
  fadeOutRight: { fade: true, direction: "right" },
};

function normalizePhase(preset, overrides) {
  const distancePx = overrides.distancePx ?? DEFAULT_DISTANCE_PX;
  const durationInFrames = overrides.durationInFrames ?? DEFAULT_DURATION_IN_FRAMES;
  const dir = preset.direction ? DIRECTION_OFFSETS[preset.direction] : { x: 0, y: 0 };

  return {
    fade: preset.fade ?? true,
    translateXFrom: dir.x * distancePx,
    translateYFrom: dir.y * distancePx,
    rotateFromDeg: overrides.rotateFromDeg ?? 0,
    durationInFrames,
  };
}

function resolvePhase(raw, aliasTable, phaseLabel) {
  if (raw == null) return null; // no-op: phase not authored

  if (typeof raw === "string") {
    const preset = aliasTable[raw];
    if (!preset) {
      throw new Error(
        `Unknown motion.${phaseLabel} alias "${raw}". Available: ${Object.keys(aliasTable).join(", ")}`,
      );
    }
    return normalizePhase(preset, {});
  }

  if (typeof raw === "object") {
    const preset = raw.alias
      ? aliasTable[raw.alias]
      : { fade: raw.fade ?? true, direction: raw.direction ?? null };
    if (raw.alias && !preset) {
      throw new Error(
        `Unknown motion.${phaseLabel} alias "${raw.alias}". Available: ${Object.keys(aliasTable).join(", ")}`,
      );
    }
    return normalizePhase(preset, raw);
  }

  throw new Error(`motion.${phaseLabel} must be a string alias or an object, got ${typeof raw}`);
}

/**
 * Authoring-time resolver — called from resolveScene.js's per-asset map,
 * alongside resolveAnchor()/resolveAssetStyle()/resolveCamera().
 *
 * @param {{in?: string|object, out?: string|object, rotateDeg?: number}} motionSpec
 * @returns {object|null} null when nothing was authored (strict no-op)
 */
export function resolveMotion(motionSpec) {
  if (!motionSpec) return null;

  const inPhase = resolvePhase(motionSpec.in, IN_ALIASES, "in");
  const outPhase = resolvePhase(motionSpec.out, OUT_ALIASES, "out");
  const rotateDeg = typeof motionSpec.rotateDeg === "number" ? motionSpec.rotateDeg : 0;

  if (!inPhase && !outPhase && rotateDeg === 0) return null;
  return { in: inPhase, out: outPhase, rotateDeg };
}

/**
 * Render-time per-frame transform. `frame` is scene-local (same axis as
 * timing.enterAtFrame/exitAtFrame). Entrance animates over
 * in.durationInFrames starting at enterAtFrame; exit animates over
 * out.durationInFrames ENDING at exitAtFrame. Outside those windows the
 * asset sits at its resting pose (opacity 1, no translate, static
 * rotateDeg only).
 *
 * @param {object|null} resolvedMotion  output of resolveMotion()
 * @param {number} frame
 * @param {{enterAtFrame:number, exitAtFrame:number}} timing
 * @returns {{opacity:number, translateX:number, translateY:number, rotateDeg:number}}
 */
export function computeMotionTransform(resolvedMotion, frame, timing) {
  const identity = { opacity: 1, translateX: 0, translateY: 0, rotateDeg: 0 };
  if (!resolvedMotion) return identity;

  const { in: inPhase, out: outPhase, rotateDeg: staticRotateDeg } = resolvedMotion;
  const enterAtFrame = timing?.enterAtFrame ?? 0;
  const exitAtFrame = timing?.exitAtFrame ?? enterAtFrame;

  let opacity = 1;
  let translateX = 0;
  let translateY = 0;
  let rotateDeg = staticRotateDeg;

  if (inPhase) {
    if (frame < enterAtFrame) {
      // Pre-mount pose — holds the animation's start state so a
      // Sequence-mounted renderer doesn't pop mid-transition.
      opacity = inPhase.fade ? 0 : 1;
      translateX = inPhase.translateXFrom;
      translateY = inPhase.translateYFrom;
      rotateDeg = staticRotateDeg + inPhase.rotateFromDeg;
    } else {
      const t = clamp01((frame - enterAtFrame) / Math.max(inPhase.durationInFrames, 1));
      const eased = easeOutCubic(t);
      opacity = inPhase.fade ? eased : 1;
      translateX = inPhase.translateXFrom * (1 - eased);
      translateY = inPhase.translateYFrom * (1 - eased);
      rotateDeg = staticRotateDeg + inPhase.rotateFromDeg * (1 - eased);
    }
  }

  if (outPhase) {
    const outStart = exitAtFrame - outPhase.durationInFrames;
    if (frame >= outStart) {
      const t = clamp01((frame - outStart) / Math.max(outPhase.durationInFrames, 1));
      const eased = easeInCubic(t);
      opacity = Math.min(opacity, outPhase.fade ? 1 - eased : 1);
      translateX += outPhase.translateXFrom * eased * -1;
      translateY += outPhase.translateYFrom * eased * -1;
      rotateDeg += outPhase.rotateFromDeg * eased;
    }
  }

  return { opacity, translateX, translateY, rotateDeg };
}
```

## Schema: `src/pipelines/pipeline1-validate/schema/scene.schema.json`

Add `"motion": { "$ref": "#/definitions/motionSpec" }` to the asset item's `properties`:

```json
          "z": { "type": "number" },
          "motion": { "$ref": "#/definitions/motionSpec" }
```

Add a `definitions` block at the file's root level (this file currently has none of its own — `scene.schema.json` only `$ref`s siblings, so this is new):

```json
  "definitions": {
    "motionSpec": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "in": { "$ref": "#/definitions/motionInPhase" },
        "out": { "$ref": "#/definitions/motionOutPhase" },
        "rotateDeg": {
          "type": "number",
          "description": "Static rotation (degrees) held for the asset's full on-screen duration, independent of in/out."
        }
      }
    },
    "motionInPhase": {
      "oneOf": [
        {
          "type": "string",
          "enum": ["none", "fade", "fadeUp", "fadeDown", "fadeLeft", "fadeRight"]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "alias": { "type": "string", "enum": ["none", "fade", "fadeUp", "fadeDown", "fadeLeft", "fadeRight"] },
            "distancePx": { "type": "number", "minimum": 0, "description": "Travel distance in px. Default 80." },
            "durationInFrames": { "type": "number", "minimum": 1, "description": "Frames the phase animates over. Default 18." },
            "rotateFromDeg": { "type": "number", "description": "Extra rotation (degrees) that resolves to 0 as the phase completes." }
          }
        }
      ]
    },
    "motionOutPhase": {
      "oneOf": [
        {
          "type": "string",
          "enum": ["none", "fadeOut", "fadeOutUp", "fadeOutDown", "fadeOutLeft", "fadeOutRight"]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "alias": { "type": "string", "enum": ["none", "fadeOut", "fadeOutUp", "fadeOutDown", "fadeOutLeft", "fadeOutRight"] },
            "distancePx": { "type": "number", "minimum": 0, "description": "Travel distance in px. Default 80." },
            "durationInFrames": { "type": "number", "minimum": 1, "description": "Frames the phase animates over. Default 18." },
            "rotateFromDeg": { "type": "number", "description": "Extra rotation (degrees) applied as the phase completes." }
          }
        }
      ]
    }
  }
```

## `src/pipelines/pipeline2-resolve/resolveScene.js`

Add the import:

```js
import { resolveMotion } from "../../motion/motion.js";
```

Add `resolvedMotion` to the per-asset resolved object (inside the `.map()`, alongside `resolvedPosition`/`resolvedStyle`):

```js
    return {
      id: assetSpec.id ?? `${assetSpec.assetType}-${Math.random().toString(36).slice(2, 8)}`,
      assetType: assetSpec.assetType,
      componentPath: assetRegistry[assetSpec.assetType].componentPath,
      content: assetSpec.contentOverride ?? {},
      resolvedPosition,
      resolvedStyle,
      resolvedMotion: resolveMotion(assetSpec.motion),
      timing: {
        durationInFrames: sceneDurationInFrames,
        enterAtFrame,
        exitAtFrame,
        words: wordTimings,
      },
    };
```

## `src/pipelines/pipeline3-render/Composition.jsx`

Add to the import from `camera.js`:

```js
import { resolveAssetDepth, resolveCameraTransform } from "../../templating/camera.js";
import { computeMotionTransform } from "../../motion/motion.js";
```

Replace the asset-rendering branch inside `SceneLayer`'s `items.map`:

```jsx
              if (item.kind === "effect") {
                return <SceneEffectLayer key={item.effect.id} effect={item.effect} />;
              }
              const asset = item.asset;
              const AssetComponent = ASSET_COMPONENTS[asset.assetType];
              if (!AssetComponent) {
                throw new Error(`No renderer registered for assetType "${asset.assetType}"`);
              }
              const motionTransform = computeMotionTransform(asset.resolvedMotion, frame, asset.timing);
              const { left, top, ...restPosition } = asset.resolvedPosition;
              return (
                <div
                  key={asset.id}
                  style={{
                    position: "absolute",
                    left,
                    top,
                    width: asset.resolvedStyle.width,
                    height: asset.resolvedStyle.height,
                    opacity: motionTransform.opacity,
                    transform: `translate(${motionTransform.translateX}px, ${motionTransform.translateY}px) rotate(${motionTransform.rotateDeg}deg)`,
                    transformOrigin: restPosition.transformOrigin ?? "50% 50%",
                  }}
                >
                  <Suspense fallback={null}>
                    <AssetComponent
                      resolvedPosition={{ ...restPosition, left: 0, top: 0 }}
                      resolvedStyle={asset.resolvedStyle}
                      content={asset.content}
                      timing={asset.timing}
                    />
                  </Suspense>
                </div>
              );
```

The wrapper reproduces the exact same `left/top/width/height` box the asset already rendered at, so when `resolvedMotion` is `null` (`opacity:1`, `translate(0px,0px)`, `rotate(0deg)`) the output is pixel-identical to before — the wrapper div is inert. `transformOrigin` now lives on the wrapper (so rotation pivots around the asset's own box, not the composition), and the child receives the same `resolvedPosition` object minus `left/top` (zeroed, since the wrapper now carries that offset) — no asset component needs to change.

Note: this only wires motion onto `scene.assets`, not `transitionOut.effects[]` visuals — left out of scope since you asked specifically about assets; say the word if you want effects to carry motion too.

## `src/agent/introspect.js` — one-line doc addition

In `describeSceneEnvelope()`'s `asset` block:

```js
      motion: "optional: { in?, out?, rotateDeg? } — in: 'fade'|'fadeUp'|'fadeDown'|'fadeLeft'|'fadeRight' (or object with alias/distancePx/durationInFrames/rotateFromDeg); out: 'fadeOut'|'fadeOutUp'|'fadeOutDown'|'fadeOutLeft'|'fadeOutRight' (same object shape); rotateDeg: static rotation held for the whole on-screen duration",
```

---

**Alias cheat sheet** (agent-facing):

| alias | effect |
|---|---|
| `fadeUp` | fades in while rising into its anchored position |
| `fadeDown` | fades in while dropping into position |
| `fadeLeft` | fades in while sliding in from the right |
| `fadeRight` | fades in while sliding in from the left |
| `fade` | pure opacity fade, no movement |
| `fadeOutUp` / `fadeOutDown` / `fadeOutLeft` / `fadeOutRight` | fades out while exiting in that direction |
| `fadeOut` | pure opacity fade out |
| `none` | explicit no-op for that phase |

Custom object form (either phase): `{ alias?, distancePx?, durationInFrames?, rotateFromDeg? }` — e.g. `{ "in": { "alias": "fadeUp", "distancePx": 140, "rotateFromDeg": -6 } }` for a bigger rise with a slight counter-rotation settling to 0.

**Not yet implemented, flagging as out-of-scope for this pass:** `ProjectBuilder` doesn't yet have a `checkMotionSpec`-style validator (mirroring `checkCameraSpec`) for early feedback in `addAsset`/`updateAsset` — right now a bad `motion` alias only surfaces at `resolve` time via the thrown error in `resolveMotion`. Say if you want that added to `ProjectBuilder.js` too.