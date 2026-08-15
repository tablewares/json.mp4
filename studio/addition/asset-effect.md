## Short answer: no — not currently

Looking at how effects flow through the pipeline today, there are exactly two effect surfaces, and neither is "apply a filter to one existing asset's own box":

1. **`postEffects.js`** — runs as an ffmpeg pass *after* Remotion renders the whole video. Vignette/grain/color-grade/letterbox apply to the entire frame, every asset, all scenes. No per-asset scoping possible here at all.
2. **`scene.effects` / `transitionOut.effects`** — these spawn a *new*, freestanding asset positioned by `anchor` (center, top-left, etc.) at a computed timing frame. They're not bound to an existing asset's resolved position/size — `SceneEffectLayer` in `Composition.jsx` just renders another `AssetComponent` at its own `resolvedPosition`. There's no mechanism that says "wrap asset `kicker-1` in a grain filter."

`resolvedStyle` (via `resolveAssetStyle`) passes through arbitrary style keys, but nothing on the render side (`Composition.jsx`) currently reads a "grain"/"filter" key and does anything with it — so even if you stuffed it into `styleOverride`, it'd be silently ignored.

So: implementing it.

## Design

Same two-phase pattern as `camera.js`/`motion.js` — new module, no remotion import in the pure math half, strict no-op when `effects` is absent.

### 1. Schema — `scene.schema.json`

Add to the asset item's `properties`:

```json
"effects": {
  "type": "array",
  "items": { "$ref": "#/definitions/assetEffect" }
}
```

And a new definition:

```json
"assetEffect": {
  "type": "object",
  "required": ["type"],
  "additionalProperties": false,
  "properties": {
    "type": { "type": "string", "enum": ["grain", "scanlines", "filter"] },
    "intensity": { "type": "number", "minimum": 0, "maximum": 1 },
    "monochrome": { "type": "boolean" },
    "opacity": { "type": "number", "minimum": 0, "maximum": 1 },
    "lineHeight": { "type": "number", "minimum": 1 },
    "grayscale": { "type": "number", "minimum": 0, "maximum": 1 },
    "contrast": { "type": "number", "minimum": 0 },
    "brightness": { "type": "number", "minimum": 0 },
    "sepia": { "type": "number", "minimum": 0, "maximum": 1 },
    "blur": { "type": "number", "minimum": 0 }
  }
}
```

### 2. New module — `src/effects/assetEffects.js`

```javascript
/**
 * Per-asset visual effects — filters/overlays scoped to ONE asset's own box.
 * Distinct from:
 *   - postEffects.js: composition-wide ffmpeg pass, after Remotion renders
 *   - scene.effects (transitionOut effects): freestanding assets positioned
 *     by anchor, not bound to an existing asset's box
 *
 * Same two-phase split as camera.js / motion.js:
 *   resolveAssetEffects()      — pipeline2, authoring-time, JSON-safe descriptor
 *   computeAssetEffectStyle()  — pipeline3, pure render-time CSS/overlay math,
 *                                 no remotion import
 *
 * No-op by default: an asset with no `effects` key resolves to null, and
 * computeAssetEffectStyle(null) returns { filter: undefined, overlays: [] } —
 * every pre-existing manifest renders byte-identical.
 */

const KNOWN_TYPES = new Set(["grain", "scanlines", "filter"]);

function resolveOne(spec, i) {
  if (!spec || typeof spec !== "object") {
    throw new Error(`asset.effects[${i}] must be an object`);
  }
  if (!KNOWN_TYPES.has(spec.type)) {
    throw new Error(
      `Unknown asset effect type "${spec.type}" at effects[${i}]. Available: ${[...KNOWN_TYPES].join(", ")}`,
    );
  }
  switch (spec.type) {
    case "grain":
      return { type: "grain", intensity: spec.intensity ?? 0.35, monochrome: spec.monochrome ?? true };
    case "scanlines":
      return { type: "scanlines", opacity: spec.opacity ?? 0.25, lineHeight: spec.lineHeight ?? 2 };
    case "filter":
      return {
        type: "filter",
        grayscale: spec.grayscale ?? 0,
        contrast: spec.contrast ?? 1,
        brightness: spec.brightness ?? 1,
        sepia: spec.sepia ?? 0,
        blur: spec.blur ?? 0,
      };
    default:
      return spec;
  }
}

/**
 * @param {Array<object>=} effectsSpec  asset.effects from scene.schema.json
 * @returns {Array<object>|null}  null when nothing was authored (strict no-op)
 */
export function resolveAssetEffects(effectsSpec) {
  if (!Array.isArray(effectsSpec) || effectsSpec.length === 0) return null;
  return effectsSpec.map(resolveOne);
}

/**
 * Convenience preset: the "grainy old computer" look — desaturated, slightly
 * high-contrast, dim, visible grain, CRT scanlines. Expands to the same
 * three effect entries a hand-authored `effects: [...]` array would use, so
 * it's just sugar over resolveAssetEffects, not a separate code path.
 *
 *   asset.effects = oldComputerEffectsSpec()   // author-time helper
 */
export function oldComputerEffectsSpec(overrides = {}) {
  return [
    {
      type: "filter",
      grayscale: overrides.grayscale ?? 0.85,
      contrast: overrides.contrast ?? 1.15,
      brightness: overrides.brightness ?? 0.85,
      sepia: overrides.sepia ?? 0.15,
    },
    { type: "grain", intensity: overrides.grainIntensity ?? 0.45, monochrome: true },
    { type: "scanlines", opacity: overrides.scanlineOpacity ?? 0.2, lineHeight: overrides.scanlineHeight ?? 2 },
  ];
}

function buildCssFilter(resolvedEffects) {
  const f = resolvedEffects.find((e) => e.type === "filter");
  if (!f) return undefined;
  const parts = [];
  if (f.grayscale) parts.push(`grayscale(${f.grayscale})`);
  if (f.sepia) parts.push(`sepia(${f.sepia})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
  if (f.blur) parts.push(`blur(${f.blur}px)`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Render-time (pure, no remotion import). Returns a CSS `filter` string for
 * the asset's own wrapper, plus overlay descriptors the renderer paints as
 * absolutely-positioned children INSIDE that same wrapper — so grain/
 * scanlines are clipped to exactly that asset's box, never bleeding onto
 * neighboring assets.
 *
 * @param {Array|null} resolvedEffects  output of resolveAssetEffects()
 */
export function computeAssetEffectStyle(resolvedEffects) {
  if (!resolvedEffects || resolvedEffects.length === 0) {
    return { filter: undefined, overlays: [] };
  }
  return {
    filter: buildCssFilter(resolvedEffects),
    overlays: resolvedEffects.filter((e) => e.type === "grain" || e.type === "scanlines"),
  };
}
```

### 3. Wire into `resolveScene.js`

Import, then add one field to `resolvedAsset`:

```javascript
import { resolveAssetEffects } from "../../effects/assetEffects.js";
```

```javascript
resolvedMotion: resolveMotion(assetSpec.motion),
resolvedEffects: resolveAssetEffects(assetSpec.effects),
```

### 4. Wire into `Composition.jsx`

Import, add a small overlay component, and apply at the per-asset render site:

```javascript
import { computeAssetEffectStyle } from "../../effects/assetEffects.js";
```

```jsx
function AssetEffectOverlay({ overlay, uid }) {
  if (overlay.type === "grain") {
    const filterId = `${uid}-grain`;
    return (
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: overlay.intensity, mixBlendMode: "overlay", pointerEvents: "none" }}
      >
        <filter id={filterId}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          {overlay.monochrome && <feColorMatrix type="saturate" values="0" />}
        </filter>
        <rect width="100%" height="100%" filter={`url(#${filterId})`} />
      </svg>
    );
  }
  if (overlay.type === "scanlines") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: overlay.opacity,
          pointerEvents: "none",
          backgroundImage: `repeating-linear-gradient(to bottom, rgba(0,0,0,0.9) 0px, rgba(0,0,0,0.9) 1px, transparent 1px, transparent ${overlay.lineHeight}px)`,
        }}
      />
    );
  }
  return null;
}
```

Then in the asset-mapping block inside `SceneLayer` (replacing the existing `motionTransform`/`return` block):

```jsx
const motionTransform = computeMotionTransform(asset.resolvedMotion, frame, asset.timing);
const assetEffectStyle = computeAssetEffectStyle(asset.resolvedEffects);
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
      filter: assetEffectStyle.filter,
      overflow: assetEffectStyle.overlays.length > 0 ? "hidden" : undefined,
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
    {assetEffectStyle.overlays.map((overlay, idx) => (
      <AssetEffectOverlay key={`${asset.id}-fx-${idx}`} overlay={overlay} uid={`${asset.id}-fx-${idx}`} />
    ))}
  </div>
);
```

`overflow: hidden` is only ever applied when overlays are present, so assets that intentionally overflow their box (nothing in this codebase seems to rely on that, but being careful) are unaffected when `effects` is omitted — no-op preserved.

### 5. Agent-facing wiring — `validators.js` + `ProjectBuilder.js`

`validators.js`:

```javascript
import { resolveAssetEffects } from "../effects/assetEffects.js";
```

```javascript
export function checkAssetEffects(effectsSpec) {
  if (effectsSpec == null) return [];
  try {
    resolveAssetEffects(effectsSpec);
    return [];
  } catch (e) {
    return [e.message];
  }
}
```

`ProjectBuilder.js` — import `checkAssetEffects`, then in `addAsset`:

```javascript
if (spec.effects !== undefined) asset.effects = spec.effects;
```

```javascript
const warnings = [
  ...checkAgainstSchema(entry.manifest.contentOverrideSchema, asset.contentOverride),
  ...checkMotionSpec(asset.motion),
  ...checkMotionAliases(asset.motion),
  ...checkAssetEffects(asset.effects),
  ...checkTimingAnchor(asset.enterAt),
  ...checkTimingAnchor(asset.exitAt),
];
```

And in `updateAsset` (effects is an array → wholesale replace, same rule as `actions`/`effects` elsewhere in this file):

```javascript
if (patch.effects) asset.effects = patch.effects;
```

plus the same `...checkAssetEffects(asset.effects)` line added to that method's `warnings` array.

## Usage

```javascript
projectBuilder.addAsset("my-project", "scene-1", {
  assetType: "KineticText",
  contentOverride: { text: "SYSTEM BREACH DETECTED" },
  effects: [
    { type: "filter", grayscale: 0.85, contrast: 1.15, brightness: 0.85, sepia: 0.15 },
    { type: "grain", intensity: 0.45, monochrome: true },
    { type: "scanlines", opacity: 0.2, lineHeight: 2 },
  ],
});
```

or with the preset helper:

```javascript
import { oldComputerEffectsSpec } from "../effects/assetEffects.js";
projectBuilder.addAsset("my-project", "scene-1", {
  assetType: "ImageReveal",
  contentOverride: { src: "assets/terminal.png" },
  effects: oldComputerEffectsSpec(),
});
```

**Not yet covered, flagging explicitly:** I haven't wired this into `resolveOneRef`/`resolveRefs.js` (effects don't participate in intra-scene referencing) or into `transitionOut.effects` (those are freestanding, separate render path via `SceneEffectLayer` — if you want the same grain/scanlines look on a *boundary* effect asset too, that's a small follow-up to thread `computeAssetEffectStyle` through `SceneEffectLayer` as well). I also haven't touched `describeSceneEnvelope()` in `introspect.js` — worth a one-line addition there so the agent CLI surfaces the new `effects` field without reading schema by hand.