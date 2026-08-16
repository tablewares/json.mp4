## Architecture

Matter.js is a stepped, stateful simulation. Remotion needs every frame renderable **in isolation** (workers render frames out of order/in parallel), which rules out running Matter live inside `Composition.jsx`. So physics has to follow the exact same split as `camera.js`/`motion.js`:

- **`resolvePhysics.js`** (pipeline2, authoring-time): builds a Matter `World`, steps it once for the whole scene duration, and **bakes** every dynamic body's per-frame `{left, top, rotateDeg}` into plain JSON.
- **`computePhysicsTransform.js`** (pipeline3, render-time): a pure array lookup by frame. **Matter.js is never imported here** — it never even reaches the Remotion bundle.

Physics attaches to the *asset spec* (`physics: { bodyType: ... }`) and, optionally, the *scene* (`scene.physics: { gravity, startFrame }`), but the actual vocabulary lives in one standalone schema file, as you asked — `scene.schema.json`/existing schemas only gain two `$ref` pointers into it, nothing else changes shape.

---

## 1. New schema — `src/pipelines/pipeline1-validate/schema/physics.schema.json`

```json
{
  "$id": "physics.schema.json",
  "definitions": {
    "vector2": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" }
      }
    },
    "scenePhysicsSpec": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "gravity": {
          "$ref": "#/definitions/vector2",
          "description": "Default { x: 0, y: 1 } — Matter's own 'earth gravity' unit (scaled internally by engine.gravity.scale, default 0.001), tuned for pixel-space worlds out of the box."
        },
        "gravityScale": { "type": "number", "minimum": 0, "description": "Override for engine.gravity.scale. Leave unset to use Matter's default (0.001)." },
        "iterations": { "type": "integer", "minimum": 1, "description": "Matter constraint/position/velocity solver iterations. Default: Matter's own default (6)." },
        "startFrame": { "type": "integer", "minimum": 0, "default": 0, "description": "Scene-local frame the simulation begins stepping at. Every frame before this holds all dynamic bodies at their initial resolved position (pre-drop)." }
      }
    },
    "assetPhysicsSpec": {
      "type": "object",
      "required": ["bodyType"],
      "additionalProperties": false,
      "properties": {
        "bodyType": {
          "type": "string",
          "enum": ["dynamic", "static"],
          "description": "'dynamic': simulated — falls/bounces under gravity and collisions, and gets a baked resolvedPhysics.frames[] track. 'static': an immovable anchor other bodies can collide with (a ledge, floor, wall); never moves regardless of gravity, and gets NO resolvedPhysics track — it renders at its normal resolvedPosition, unchanged."
        },
        "shape": { "type": "string", "enum": ["rectangle", "circle"], "default": "rectangle" },
        "radius": { "type": "number", "minimum": 0, "description": "Circle radius in px. Only used when shape is 'circle'; defaults to min(width,height)/2." },
        "restitution": { "type": "number", "minimum": 0, "maximum": 2, "default": 0.6, "description": "Bounciness. 0 = no bounce, 1 = elastic." },
        "friction": { "type": "number", "minimum": 0, "default": 0.1 },
        "frictionAir": { "type": "number", "minimum": 0, "default": 0.01, "description": "Air resistance. 0 lets a dynamic body fall/slide forever without damping." },
        "density": { "type": "number", "minimum": 0.0001, "default": 0.001 },
        "initialVelocity": { "$ref": "#/definitions/vector2", "description": "px/frame at simulation start. Default { x: 0, y: 0 }." },
        "initialAngularVelocity": { "type": "number", "description": "Radians/frame at simulation start. Default 0." },
        "angle": { "type": "number", "description": "Starting rotation in degrees. Default 0." },
        "fixedRotation": { "type": "boolean", "default": false, "description": "Body never rotates (infinite inertia) — e.g. a card that should slide/bounce but stay upright." },
        "collidesWith": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Asset ids (same scene) this body may collide with. Omit to collide with every other physics body in the scene (default)."
        }
      }
    }
  }
}
```

`validate.js`'s `buildAjv()` already `ajv.addSchema()`s every file in the schema dir, so this needs no wiring — dropping the file in is enough.

---

## 2. Additive hooks into `scene.schema.json`

Two new optional properties, nothing else touched (existing manifests with no `physics` key parse identically):

```jsonc
// top-level scene properties, alongside "camera":
"physics": { "$ref": "physics.schema.json#/definitions/scenePhysicsSpec" },
```

```jsonc
// inside assets[].items.properties, alongside "motion":
"physics": { "$ref": "physics.schema.json#/definitions/assetPhysicsSpec" },
```

---

## 3. Authoring-time resolver — `src/physics/resolvePhysics.js`

```js
import Matter from "matter-js";

/**
 * Authoring-time physics resolver — the physics twin of camera.js/motion.js's
 * resolveXxx() half. Runs Matter.js ONCE, synchronously, for the full scene
 * duration, and bakes every dynamic body's per-frame {left, top, rotateDeg}
 * into resolvedAsset.resolvedPhysics.frames — a plain JSON-safe array.
 *
 * This is the ONLY place matter-js is imported anywhere in the framework.
 * Composition.jsx / computePhysicsTransform.js never import it: at render
 * time a physics-driven asset is just an array-index lookup for the current
 * frame, exactly like resolveMotion() -> computeMotionTransform(). This
 * isn't just tidy — Remotion must be able to render any frame in isolation
 * (parallel/out-of-order rendering across worker processes), which rules
 * out a stateful, iteratively-stepped simulation living in the render path.
 * Baking the whole simulation ahead of time at resolve is what makes a
 * physics-driven scene compatible with that model at all.
 *
 * No-op by default: a scene where no asset carries a `physics` block never
 * touches Matter — resolveScenePhysics returns immediately and no
 * resolvedAsset gains a resolvedPhysics field. Every pre-existing manifest
 * renders byte-identical.
 */

const DEFAULT_GRAVITY = { x: 0, y: 1 };
const MAX_PHYSICS_BODIES = 32; // Matter's collisionFilter category/mask is a 32-bit field

function boxOf(resolvedAsset) {
  const { left, top } = resolvedAsset.resolvedPosition;
  const { width, height } = resolvedAsset.resolvedStyle;
  return { cx: left + width / 2, cy: top + height / 2, width, height };
}

function makeBody(resolvedAsset, spec, categoryBit) {
  const { cx, cy, width, height } = boxOf(resolvedAsset);
  const isStatic = spec.bodyType === "static";
  const shape = spec.shape ?? "rectangle";

  const options = {
    isStatic,
    restitution: spec.restitution ?? 0.6,
    friction: spec.friction ?? 0.1,
    frictionAir: spec.frictionAir ?? 0.01,
    density: spec.density ?? 0.001,
    angle: ((spec.angle ?? 0) * Math.PI) / 180,
    collisionFilter: { category: categoryBit, mask: 0xffffffff, group: 0 },
  };
  if (spec.fixedRotation) options.inertia = Infinity;

  const body =
    shape === "circle"
      ? Matter.Bodies.circle(cx, cy, spec.radius ?? Math.min(width, height) / 2, options)
      : Matter.Bodies.rectangle(cx, cy, width, height, options);

  if (!isStatic) {
    const v = spec.initialVelocity ?? { x: 0, y: 0 };
    Matter.Body.setVelocity(body, { x: v.x, y: v.y });
    Matter.Body.setAngularVelocity(body, spec.initialAngularVelocity ?? 0);
  }
  return body;
}

/**
 * @param {Array} resolvedAssets  pass-1 resolved assets (mutated in place —
 *   each dynamic body gains `.resolvedPhysics = { frames: [{left,top,rotateDeg}] }`,
 *   one entry per scene frame; static bodies are left untouched)
 * @param {Record<string, object>} physicsSpecsById  assetId -> assetPhysicsSpec,
 *   only present for assets that authored a `physics` block
 * @param {object|null|undefined} scenePhysicsSpec  scene.physics
 * @param {number} sceneDurationInFrames
 * @param {number} fps
 */
export function resolveScenePhysics(resolvedAssets, physicsSpecsById, scenePhysicsSpec, sceneDurationInFrames, fps) {
  const ids = Object.keys(physicsSpecsById ?? {});
  if (ids.length === 0) return; // strict no-op: nobody authored physics

  if (ids.length > MAX_PHYSICS_BODIES) {
    throw new Error(
      `Scene has ${ids.length} physics bodies but the collision mask supports at most ${MAX_PHYSICS_BODIES}. ` +
        `Split into multiple scenes or drop unused collidesWith constraints.`,
    );
  }

  const engine = Matter.Engine.create();
  const gravity = scenePhysicsSpec?.gravity ?? DEFAULT_GRAVITY;
  engine.gravity.x = gravity.x;
  engine.gravity.y = gravity.y;
  if (scenePhysicsSpec?.gravityScale != null) engine.gravity.scale = scenePhysicsSpec.gravityScale;
  if (scenePhysicsSpec?.iterations != null) {
    engine.constraintIterations = scenePhysicsSpec.iterations;
    engine.positionIterations = scenePhysicsSpec.iterations;
    engine.velocityIterations = scenePhysicsSpec.iterations;
  }

  const byId = Object.fromEntries(resolvedAssets.map((a) => [a.id, a]));

  // One collision-category bit per physics body, assigned in author order —
  // this is what collidesWith masks resolve against below.
  const categoryBitById = {};
  ids.forEach((id, i) => { categoryBitById[id] = 1 << i; });

  const bodiesById = {};
  const halfSizeById = {};
  for (const id of ids) {
    const resolvedAsset = byId[id];
    if (!resolvedAsset) {
      throw new Error(`scene physics references asset id "${id}" which was not found among resolved assets.`);
    }
    const spec = physicsSpecsById[id];
    const body = makeBody(resolvedAsset, spec, categoryBitById[id]);
    bodiesById[id] = body;
    halfSizeById[id] = { w: resolvedAsset.resolvedStyle.width / 2, h: resolvedAsset.resolvedStyle.height / 2 };
    Matter.World.add(engine.world, body);
  }

  // Second pass: collidesWith masks, now that every category bit exists.
  for (const id of ids) {
    const spec = physicsSpecsById[id];
    if (!Array.isArray(spec.collidesWith)) continue; // default: collide with everything
    let mask = 0;
    for (const otherId of spec.collidesWith) {
      const bit = categoryBitById[otherId];
      if (bit == null) {
        throw new Error(`Asset "${id}" physics.collidesWith references unknown asset id "${otherId}" in this scene.`);
      }
      mask |= bit;
    }
    bodiesById[id].collisionFilter.mask = mask;
  }

  const startFrame = Math.max(0, Math.round(scenePhysicsSpec?.startFrame ?? 0));
  const deltaMs = 1000 / fps;

  const dynamicIds = ids.filter((id) => physicsSpecsById[id].bodyType !== "static");
  const framesById = Object.fromEntries(dynamicIds.map((id) => [id, []]));

  const snapshot = (id) => {
    const b = bodiesById[id];
    const half = halfSizeById[id];
    return {
      left: b.position.x - half.w,
      top: b.position.y - half.h,
      rotateDeg: (b.angle * 180) / Math.PI,
    };
  };

  for (let frame = 0; frame < sceneDurationInFrames; frame += 1) {
    if (frame >= startFrame) Matter.Engine.update(engine, deltaMs);
    for (const id of dynamicIds) framesById[id].push(snapshot(id));
  }

  for (const id of dynamicIds) {
    byId[id].resolvedPhysics = { frames: framesById[id] };
  }
}
```

---

## 4. Render-time consumer — `src/physics/computePhysicsTransform.js`

```js
/**
 * Render-time lookup — the physics twin of motion.js's
 * computeMotionTransform(). Pure, no side effects, no matter-js import:
 * resolvedPhysics.frames was fully baked at resolve time (see
 * resolvePhysics.js), so "running" physics at render time is just reading
 * one array index for the current frame — safe for Remotion's
 * out-of-order/parallel frame rendering.
 *
 * @param {{frames: {left:number, top:number, rotateDeg:number}[]}|null|undefined} resolvedPhysics
 * @param {number} frame  scene-local frame (same axis as timing.enterAtFrame)
 * @returns {{left:number, top:number, rotateDeg:number}|null}  null when the
 *   asset has no physics — caller falls back to its static resolvedPosition
 */
export function computePhysicsTransform(resolvedPhysics, frame) {
  if (!resolvedPhysics || !Array.isArray(resolvedPhysics.frames) || resolvedPhysics.frames.length === 0) {
    return null;
  }
  const idx = Math.min(Math.max(Math.round(frame), 0), resolvedPhysics.frames.length - 1);
  return resolvedPhysics.frames[idx];
}
```

---

## 5. Wiring into `resolveScene.js`

```js
import { resolveScenePhysics } from "../../physics/resolvePhysics.js";
```

Inside the per-asset loop, collect specs alongside the existing push:

```js
const physicsSpecsById = {}; // declare once, before the loop

for (const assetSpec of scene.assets ?? []) {
  // ...unchanged...
  resolvedAssets.push(resolvedAsset);
  if (resolvedAsset.id != null) resolvedAssetsById[resolvedAsset.id] = resolvedAsset;
  if (assetSpec.physics) physicsSpecsById[resolvedAsset.id] = assetSpec.physics;
}
```

And right before `resolveSceneRefs(...)` (needs final resolvedPosition/resolvedStyle, both already set in pass 1):

```js
resolveScenePhysics(resolvedAssets, physicsSpecsById, scene.physics, sceneDurationInFrames, config.fps);
```

**Caveat to flag**: `overlap_warn.js` still checks each asset's static `resolvedPosition`, not its baked physics track — a dynamic body's *rest* position may legitimately overlap its target (that's the point), so expect false-positive overlap warnings on physics scenes. Worth revisiting if that gets noisy; not fixed here.

---

## 6. Wiring into `Composition.jsx`

```js
import { computePhysicsTransform } from "../../physics/computePhysicsTransform.js";
```

In the asset-render branch of `SceneLayer`:

```jsx
const motionTransform = computeMotionTransform(asset.resolvedMotion, frame, asset.timing);
const physicsFrame = computePhysicsTransform(asset.resolvedPhysics, frame);
const { left, top, ...restPosition } = asset.resolvedPosition;
const renderLeft = physicsFrame ? physicsFrame.left : left;
const renderTop = physicsFrame ? physicsFrame.top : top;
const physicsRotateDeg = physicsFrame ? physicsFrame.rotateDeg : 0;

return (
  <div
    key={asset.id}
    style={{
      position: "absolute",
      left: renderLeft,
      top: renderTop,
      width: asset.resolvedStyle.width,
      height: asset.resolvedStyle.height,
      opacity: motionTransform.opacity,
      transform: `translate(${motionTransform.translateX}px, ${motionTransform.translateY}px) rotate(${motionTransform.rotateDeg + physicsRotateDeg}deg)`,
      transformOrigin: physicsFrame ? "50% 50%" : (restPosition.transformOrigin ?? "50% 50%"),
    }}
  >
    {/* ...unchanged... */}
  </div>
);
```

A physics body dropping below the composition bounds is naturally clipped by the depth-plane `AbsoluteFill`'s `overflow: "hidden"` — "drops out of frame" falls out for free, no extra code.

---

## 7. Example asset — assets stay purely graphical, physics is a bolt-on

`studio/assets/PhysicsShape/manifest.json`:

```json
{
  "assetType": "PhysicsShape",
  "component": "PhysicsShape.jsx",
  "description": "A minimal SVG circle/rect. Has no physics logic itself — pairing it with a `physics` block on the asset spec is what makes it fall/bounce; any other asset type works identically since resolvePhysics.js only ever reads/writes an asset's box (resolvedPosition + width/height).",
  "defaultSize": { "width": 120, "height": 120 },
  "defaultStyle": { "shape": "circle", "fillColorToken": "accentBg" },
  "contentOverrideSchema": { "type": "object", "properties": {} },
  "styleOverrideSchema": {
    "type": "object",
    "properties": {
      "shape": { "type": "string", "enum": ["circle", "rectangle"] },
      "fillColorToken": { "type": "string" },
      "strokeColorToken": { "type": "string" },
      "strokeWidth": { "type": "number" },
      "borderRadius": { "type": "number" },
      "width": { "type": "number" },
      "height": { "type": "number" }
    }
  }
}
```

`studio/assets/PhysicsShape/PhysicsShape.jsx`:

```jsx
import React from "react";

export function PhysicsShape({ resolvedPosition, resolvedStyle }) {
  const { width, height } = resolvedStyle;
  const shape = resolvedStyle.shape ?? "circle";
  const fill = resolvedStyle.fillColorToken ?? "#3D7BFD";
  const stroke = resolvedStyle.strokeColorToken ?? "transparent";
  const strokeWidth = resolvedStyle.strokeWidth ?? 0;

  return (
    <div style={{ ...resolvedPosition, left: 0, top: 0, width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {shape === "circle" ? (
          <circle
            cx={width / 2}
            cy={height / 2}
            r={Math.min(width, height) / 2 - strokeWidth / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        ) : (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={width - strokeWidth}
            height={height - strokeWidth}
            rx={resolvedStyle.borderRadius ?? 0}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        )}
      </svg>
    </div>
  );
}
```

---

## 8. Demo scene — drop + bounce off an anchored ledge

```json
{
  "id": "physics-demo",
  "background": "shade1",
  "physics": { "gravity": { "x": 0, "y": 1 } },
  "assets": [
    {
      "id": "ledge",
      "assetType": "PhysicsShape",
      "anchor": { "position": "bottom", "offsetYPercent": -18 },
      "styleOverride": { "shape": "rectangle", "width": 500, "height": 32, "fillColorToken": "main2" },
      "physics": { "bodyType": "static", "shape": "rectangle", "restitution": 0.6, "friction": 0.2 }
    },
    {
      "id": "ball",
      "assetType": "PhysicsShape",
      "anchor": { "position": "top", "offsetYPercent": 6, "offsetXPercent": -8 },
      "styleOverride": { "shape": "circle", "width": 100, "height": 100, "fillColorToken": "accentRed" },
      "physics": {
        "bodyType": "dynamic",
        "shape": "circle",
        "restitution": 0.75,
        "friction": 0.05,
        "frictionAir": 0
      },
      "enterAt": 0,
      "exitAt": 1
    }
  ]
}
```

`ledge` is `static` — an immovable anchor. `ball` is `dynamic`, starts near the top, and Matter free-falls it under earth gravity until it hits the ledge, bounces (restitution 0.75), and — since there are no side walls or floor beyond the ledge — eventually drifts off the ledge's edge and continues falling out of frame.

Note: `enterAt`/`exitAt` still gate opacity/entrance motion as before, but **not** the physics track — `resolvedPhysics.frames` is indexed by absolute scene-local frame regardless of the asset's own enter/exit window.

---

## Dependency + follow-ups

`npm install matter-js` — used only inside `src/physics/resolvePhysics.js`, so it never touches the Remotion webpack bundle.

Left as follow-up work, not done here: `checkPhysicsSpec` in `validators.js` (mirroring `checkCameraSpec`/`checkMotionSpec`) so `ProjectBuilder.addAsset` surfaces physics schema warnings at write time; a `physics` entry in `introspect.js`'s `describeSceneEnvelope()`; and the `overlap_warn.js` false-positive caveat above.