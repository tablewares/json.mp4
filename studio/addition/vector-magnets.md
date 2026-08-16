Good end-goal to design against — it forces two real primitives (directional push, point attraction) plus something the framework didn't have yet: **carrying a body's *simulated* final state across a scene cut**, which is a different thing from the existing `carryAssetId` transition mechanism (that one just hands `resolvedPosition`/`resolvedStyle` to the transition component for a visual crossfade during the cut — it never touches Matter). I'll keep both, but they're solving different problems, and I'll flag that explicitly so it's not confused for the same feature.

One physics note worth stating up front: **gravity + friction alone cannot make the coin roll back uphill** — that requires energy input. That's exactly what the magnet is for in this design: it's what powers the "then rolls upward" phase.

## 1. Schema additions — `physics.schema.json`

Add three new properties to `assetPhysicsSpec` (all optional, all no-op when absent):

```jsonc
"force": {
  "type": "object",
  "required": ["vector"],
  "additionalProperties": false,
  "properties": {
    "vector": {
      "$ref": "#/definitions/vector2",
      "description": "Acceleration in px/frame² — the SAME units as initialVelocity, deliberately NOT Matter's mass-scaled applyForce() API, so this stays predictable and composes cleanly with gravity/initialVelocity instead of needing a separate mental model."
    },
    "oneShot": {
      "type": "boolean",
      "default": false,
      "description": "true: applied once, as an instantaneous velocity kick, at startFrame — a shove. false (default): applied every simulated frame within [startFrame, endFrame) — a sustained push, e.g. wind."
    },
    "startFrame": { "type": "integer", "minimum": 0, "default": 0 },
    "endFrame": { "type": "integer", "minimum": 0, "description": "Scene-local frame the continuous force stops (exclusive). Omit to apply for the rest of the simulation. Ignored when oneShot is true." }
  }
},
"magnet": {
  "type": "object",
  "required": ["targetAssetId"],
  "additionalProperties": false,
  "properties": {
    "targetAssetId": {
      "type": "string",
      "description": "Another asset id in this scene that ALSO carries a `physics` block (dynamic or static — a static anchor is the common case, e.g. an invisible marker placed where you want the body to climb toward). This body accelerates toward that target's live simulated position every step."
    },
    "strength": { "type": "number", "minimum": 0, "default": 0.001, "description": "Attraction acceleration, px/frame². This is the energy source that can make a body climb — gravity+friction alone never will." },
    "falloff": { "type": "string", "enum": ["none", "linear", "quadratic"], "default": "none", "description": "'none': constant pull regardless of distance (predictable, recommended for a deliberate 'climb to this point' effect). 'linear'/'quadratic': weaker the farther away." },
    "maxDistance": { "type": "number", "minimum": 0, "description": "Only pulls within this px distance of the target. Omit for unlimited range." },
    "startFrame": { "type": "integer", "minimum": 0, "default": 0 },
    "endFrame": { "type": "integer", "minimum": 0, "description": "Scene-local frame the pull stops (exclusive). Omit to pull for the rest of the simulation." }
  }
},
"carryFromScene": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "sceneId": {
      "type": "string",
      "description": "An EARLIER scene (in manifest.scenes order) whose matching physics asset's FINAL baked frame — position, angle, and finite-differenced velocity — seeds this asset's initial simulation state, instead of starting from anchor/initialVelocity at rest. This is a resolve-time simulation-state carry, distinct from transitionOut.params.carryAssetId (which only passes resolvedPosition/resolvedStyle to the transition component for a visual crossfade during the cut, and never touches physics)."
    },
    "assetId": { "type": "string", "description": "Asset id within sceneId to carry from. Defaults to this asset's own id — the common case: same logical coin, same id, in both scenes." }
  }
}
```

## 2. `src/physics/resolvePhysics.js` — full updated module

```js
import Matter from "matter-js";
import { sampleWavyPath } from "../templating/wavyPath.js";

/**
 * Authoring-time physics resolver. See prior header doc for the core
 * split rationale (this is the only file that imports matter-js; Matter
 * never reaches the render path). This revision adds:
 *
 *   - physics.force   — a directional acceleration (vector), continuous
 *     or one-shot. Units are px/frame², matching initialVelocity, applied
 *     by directly incrementing body.velocity each simulated step rather
 *     than going through Matter's mass-scaled applyForce() — keeps the
 *     unit story predictable and composable with gravity.
 *   - physics.magnet   — a per-step acceleration toward another physics
 *     body's LIVE simulated position. This is the only primitive here
 *     that can make a body climb against gravity — a constant downhill
 *     force (gravity+friction) can never produce an uphill roll on its
 *     own; the magnet is the energy source for that.
 *   - physics.carryFromScene — resolved OUTSIDE this module (in
 *     resolveScene.js, which has access to already-resolved earlier
 *     scenes) into an `initialOverridesById` map passed in here. This
 *     module only needs to know how to seed a body's initial
 *     position/angle/velocity from an override when one is given —
 *     it doesn't know or care where the override came from.
 */

const DEFAULT_GRAVITY = { x: 0, y: 1 };
const MAX_PHYSICS_BODIES = 32; // Matter's collisionFilter category/mask is a 32-bit field

function boxOf(resolvedAsset) {
  const { left, top } = resolvedAsset.resolvedPosition;
  const { width, height } = resolvedAsset.resolvedStyle;
  return { cx: left + width / 2, cy: top + height / 2, width, height };
}

function makePathBody(resolvedAsset, spec, categoryBit) {
  if (spec.bodyType !== "static") {
    throw new Error(
      `Asset "${resolvedAsset.id}" physics.shape "path" requires bodyType "static" — ` +
        `a curved surface can anchor other bodies but isn't itself simulated as a rigid body.`,
    );
  }
  const resolvedPath = resolvedAsset.content?._path;
  if (!resolvedPath) {
    throw new Error(
      `Asset "${resolvedAsset.id}" physics.shape "path" requires a resolved curve surface ` +
        `(content._path) — only assets following WavyLine's { points, curveAmount } contract ` +
        `qualify, and resolveScenePhysics must run AFTER resolveSceneRefs for this scene.`,
    );
  }
  const samples = sampleWavyPath(resolvedPath, spec.pathSegments ?? 12);
  const strokeWidth = resolvedAsset.resolvedStyle?.strokeWidth ?? 6;

  const segmentBodies = [];
  for (let i = 0; i < samples.length - 1; i += 1) {
    const p0 = samples[i];
    const p1 = samples[i + 1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    segmentBodies.push(
      Matter.Bodies.rectangle(midX, midY, segLen, Math.max(strokeWidth, 4), {
        angle: (p0.angleDeg * Math.PI) / 180,
      }),
    );
  }

  return Matter.Body.create({
    parts: segmentBodies,
    isStatic: true,
    restitution: spec.restitution ?? 0.6,
    friction: spec.friction ?? 0.1,
    collisionFilter: { category: categoryBit, mask: 0xffffffff, group: 0 },
  });
}

/**
 * @param {object} resolvedAsset
 * @param {object} spec  assetPhysicsSpec
 * @param {number} categoryBit
 * @param {{cx:number, cy:number, vx:number, vy:number, angleDeg:number, angularVelocityDeg:number}=} override
 *   from carryFromScene — when present, wins over the asset's own
 *   anchor-resolved position and spec.initialVelocity/angle entirely.
 */
function makeBody(resolvedAsset, spec, categoryBit, override) {
  if (spec.shape === "path") return makePathBody(resolvedAsset, spec, categoryBit);

  const { cx: boxCx, cy: boxCy, width, height } = boxOf(resolvedAsset);
  const isStatic = spec.bodyType === "static";
  const shape = spec.shape ?? "rectangle";
  const cx = override?.cx ?? boxCx;
  const cy = override?.cy ?? boxCy;

  const options = {
    isStatic,
    restitution: spec.restitution ?? 0.6,
    friction: spec.friction ?? 0.1,
    frictionAir: spec.frictionAir ?? 0.01,
    density: spec.density ?? 0.001,
    angle: ((override?.angleDeg ?? spec.angle ?? 0) * Math.PI) / 180,
    collisionFilter: { category: categoryBit, mask: 0xffffffff, group: 0 },
  };
  if (spec.fixedRotation) options.inertia = Infinity;

  const body =
    shape === "circle"
      ? Matter.Bodies.circle(cx, cy, spec.radius ?? Math.min(width, height) / 2, options)
      : Matter.Bodies.rectangle(cx, cy, width, height, options);

  if (!isStatic) {
    const v = override ? { x: override.vx, y: override.vy } : spec.initialVelocity ?? { x: 0, y: 0 };
    Matter.Body.setVelocity(body, { x: v.x, y: v.y });
    const av = override
      ? (override.angularVelocityDeg * Math.PI) / 180
      : spec.initialAngularVelocity ?? 0;
    Matter.Body.setAngularVelocity(body, av);
  }
  return body;
}

function applyForce(body, spec, frame) {
  const f = spec.force;
  if (!f) return;
  const start = f.startFrame ?? 0;
  const end = f.endFrame ?? Infinity;
  if (f.oneShot) {
    if (frame === start) {
      Matter.Body.setVelocity(body, { x: body.velocity.x + f.vector.x, y: body.velocity.y + f.vector.y });
    }
    return;
  }
  if (frame >= start && frame < end) {
    Matter.Body.setVelocity(body, { x: body.velocity.x + f.vector.x, y: body.velocity.y + f.vector.y });
  }
}

function applyMagnet(body, spec, bodiesById, frame, assetId) {
  const m = spec.magnet;
  if (!m) return;
  const start = m.startFrame ?? 0;
  const end = m.endFrame ?? Infinity;
  if (frame < start || frame >= end) return;

  const targetBody = bodiesById[m.targetAssetId];
  if (!targetBody) {
    throw new Error(
      `Asset "${assetId}" physics.magnet.targetAssetId "${m.targetAssetId}" was not found among ` +
        `this scene's physics bodies. The target must also carry a "physics" block (dynamic or static).`,
    );
  }

  const dx = targetBody.position.x - body.position.x;
  const dy = targetBody.position.y - body.position.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (m.maxDistance != null && dist > m.maxDistance) return;

  const strength = m.strength ?? 0.001;
  const falloff = m.falloff ?? "none";
  const accelMag = falloff === "linear" ? strength / dist : falloff === "quadratic" ? strength / (dist * dist) : strength;

  Matter.Body.setVelocity(body, {
    x: body.velocity.x + (dx / dist) * accelMag,
    y: body.velocity.y + (dy / dist) * accelMag,
  });
}

/**
 * @param {Array} resolvedAssets  pass-1 (+ refs) resolved assets, mutated in place
 * @param {Record<string, object>} physicsSpecsById
 * @param {object|null|undefined} scenePhysicsSpec
 * @param {number} sceneDurationInFrames
 * @param {number} fps
 * @param {Record<string, {cx,cy,vx,vy,angleDeg,angularVelocityDeg}>=} initialOverridesById
 *   from carryFromScene — resolveScene.js builds this by calling
 *   getFinalPhysicsState() against an earlier resolved scene. Empty {} by
 *   default: strict no-op for every scene that doesn't use carryFromScene.
 */
export function resolveScenePhysics(
  resolvedAssets,
  physicsSpecsById,
  scenePhysicsSpec,
  sceneDurationInFrames,
  fps,
  initialOverridesById = {},
) {
  const ids = Object.keys(physicsSpecsById ?? {});
  if (ids.length === 0) return;

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
    const body = makeBody(resolvedAsset, spec, categoryBitById[id], initialOverridesById[id]);
    bodiesById[id] = body;
    halfSizeById[id] = { w: resolvedAsset.resolvedStyle.width / 2, h: resolvedAsset.resolvedStyle.height / 2 };
    Matter.World.add(engine.world, body);
  }

  for (const id of ids) {
    const spec = physicsSpecsById[id];
    if (Array.isArray(spec.collidesWith)) {
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
    if (spec.magnet && !bodiesById[spec.magnet.targetAssetId]) {
      throw new Error(
        `Asset "${id}" physics.magnet.targetAssetId "${spec.magnet.targetAssetId}" not found among ` +
          `this scene's physics bodies. Known: ${ids.join(", ")}`,
      );
    }
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
    if (frame >= startFrame) {
      for (const id of dynamicIds) {
        const spec = physicsSpecsById[id];
        const body = bodiesById[id];
        applyForce(body, spec, frame);
        applyMagnet(body, spec, bodiesById, frame, id);
      }
      Matter.Engine.update(engine, deltaMs);
    }
    for (const id of dynamicIds) framesById[id].push(snapshot(id));
  }

  for (const id of dynamicIds) {
    byId[id].resolvedPhysics = { frames: framesById[id] };
  }
}

/**
 * Extracts the final simulated state of a physics-driven asset, for a
 * downstream scene's `physics.carryFromScene` to seed its own body from.
 * Velocity/angular-velocity are finite-differenced from the last two baked
 * frames (px/frame and deg/frame — the same units resolveScenePhysics's
 * override branch expects), since the framework never stores instantaneous
 * Matter velocity itself, only the baked position/angle track.
 *
 * @param {object} resolvedAsset  an already-resolved asset from an EARLIER
 *   scene (must itself be a dynamic physics body — i.e. have resolvedPhysics.frames)
 * @returns {{cx,cy,vx,vy,angleDeg,angularVelocityDeg}|null}
 */
export function getFinalPhysicsState(resolvedAsset) {
  const frames = resolvedAsset?.resolvedPhysics?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const { width, height } = resolvedAsset.resolvedStyle;
  const last = frames[frames.length - 1];
  const prev = frames.length > 1 ? frames[frames.length - 2] : last;
  return {
    cx: last.left + width / 2,
    cy: last.top + height / 2,
    vx: last.left - prev.left,
    vy: last.top - prev.top,
    angleDeg: last.rotateDeg,
    angularVelocityDeg: last.rotateDeg - prev.rotateDeg,
  };
}
```

## 3. `resolveScene.js` — wire `carryFromScene`

```diff
-import { resolveScenePhysics } from "../../physics/resolvePhysics.js";
+import { resolveScenePhysics, getFinalPhysicsState } from "../../physics/resolvePhysics.js";

-export function resolveScene(scene, { styles, assetRegistry, config, timingById, narrationTextById, hasNarration, isLastScene }) {
+export function resolveScene(scene, { styles, assetRegistry, config, timingById, narrationTextById, hasNarration, isLastScene, resolvedScenesById = {} }) {
```

After the asset loop (which already builds `physicsSpecsById`), before `resolveScenePhysics` is called — and *after* `resolveSceneRefs` per the earlier `WavyLine`-as-`shape:"path"` ordering fix:

```js
resolveSceneRefs(resolvedAssets, { sceneId: scene.id, composition: compositionSize });

// carryFromScene: build initial-state overrides for any physics asset that
// wants to continue an earlier scene's simulation rather than start at
// rest. Must run after resolveSceneRefs (harmless ordering here, kept
// consistent) and before resolveScenePhysics, which consumes the map.
const physicsInitialOverridesById = {};
for (const [assetId, spec] of Object.entries(physicsSpecsById)) {
  if (!spec.carryFromScene) continue;
  const sourceSceneId = spec.carryFromScene.sceneId;
  const sourceAssetId = spec.carryFromScene.assetId ?? assetId;
  const sourceScene = resolvedScenesById[sourceSceneId];
  if (!sourceScene) {
    throw new Error(
      `Asset "${assetId}" (scene "${scene.id}") physics.carryFromScene references scene ` +
        `"${sourceSceneId}", which hasn't been resolved yet (or doesn't exist). carryFromScene ` +
        `can only reference a scene that appears EARLIER in manifest.scenes.`,
    );
  }
  const sourceAsset = sourceScene.assets.find((a) => a.id === sourceAssetId);
  const finalState = sourceAsset ? getFinalPhysicsState(sourceAsset) : null;
  if (!finalState) {
    throw new Error(
      `Asset "${assetId}" (scene "${scene.id}") physics.carryFromScene references ` +
        `"${sourceSceneId}"/"${sourceAssetId}", which has no baked physics track to carry ` +
        `(the source asset must itself be a dynamic physics body).`,
    );
  }
  physicsInitialOverridesById[assetId] = finalState;
}

resolveScenePhysics(resolvedAssets, physicsSpecsById, scene.physics, sceneDurationInFrames, config.fps, physicsInitialOverridesById);
```

## 4. `resolve.js` — sequential resolution (needed so carry can see earlier scenes)

```diff
-  const resolvedScenes = scenes.map((scene, i) =>
-    resolveScene(scene, {
-      styles,
-      assetRegistry,
-      config,
-      timingById,
-      narrationTextById,
-      hasNarration,
-      isLastScene: i === scenes.length - 1,
-    }),
-  );
+  // Sequential (not .map()) so carryFromScene can reference an EARLIER
+  // scene's already-baked physics — each iteration's resolveScene call
+  // gets everything resolved so far via resolvedScenesById. Per-scene
+  // output is otherwise identical to before; only scenes that actually
+  // declare carryFromScene read the accumulator.
+  const resolvedScenes = [];
+  const resolvedScenesById = {};
+  for (let i = 0; i < scenes.length; i += 1) {
+    const resolved = resolveScene(scenes[i], {
+      styles,
+      assetRegistry,
+      config,
+      timingById,
+      narrationTextById,
+      hasNarration,
+      isLastScene: i === scenes.length - 1,
+      resolvedScenesById,
+    });
+    resolvedScenes.push(resolved);
+    resolvedScenesById[resolved.id] = resolved;
+  }
```

## 5. The demo: coin over a hill, no bounce, rolls down then up, carried into a new scene

**Scene 1 — `coin-hill`** (no narration/duration budget assumed 150 frames):

```json
{
  "id": "coin-hill",
  "background": "shade1",
  "physics": { "gravity": { "x": 0, "y": 1 } },
  "assets": [
    {
      "id": "downSlope",
      "assetType": "PhysicsShape",
      "anchor": { "position": "bottom-left", "offsetXPercent": 5, "offsetYPercent": -25 },
      "styleOverride": { "shape": "rectangle", "width": 500, "height": 24, "fillColorToken": "main2" },
      "physics": { "bodyType": "static", "angle": 18, "restitution": 0, "friction": 0.15 }
    },
    {
      "id": "upSlope",
      "assetType": "PhysicsShape",
      "anchor": { "position": "bottom-right", "offsetXPercent": -5, "offsetYPercent": -22 },
      "styleOverride": { "shape": "rectangle", "width": 500, "height": 24, "fillColorToken": "main2" },
      "physics": { "bodyType": "static", "angle": -22, "restitution": 0, "friction": 0.15 }
    },
    {
      "id": "climbTarget",
      "assetType": "PhysicsShape",
      "anchor": { "position": "top-right", "offsetXPercent": -8, "offsetYPercent": 12 },
      "styleOverride": { "shape": "circle", "width": 4, "height": 4, "fillColorToken": "transparent" },
      "physics": { "bodyType": "static" }
    },
    {
      "id": "coin",
      "assetType": "PhysicsShape",
      "anchor": { "position": "top-left", "offsetXPercent": 8, "offsetYPercent": 6 },
      "styleOverride": { "shape": "circle", "width": 70, "height": 70, "fillColorToken": "accentWarm" },
      "physics": {
        "bodyType": "dynamic",
        "shape": "circle",
        "restitution": 0,
        "friction": 0.15,
        "frictionAir": 0.005,
        "magnet": { "targetAssetId": "climbTarget", "strength": 0.0022, "startFrame": 60 }
      }
    }
  ]
}
```

`restitution: 0` everywhere — no bounce. The coin falls onto `downSlope`, friction lets it roll rather than slide, gravity carries it down. At frame 60 the magnet toward `climbTarget` (an invisible static marker sitting up on the far slope) switches on — that's the energy source that pulls it across the valley and up `upSlope`. `climbTarget` itself just needs a `physics` block to be a valid magnet target; it never moves (`bodyType: "static"`, no shape interaction needed beyond existing as a point).

**Scene 2 — `coin-continue`**, carrying the coin's momentum forward:

```json
{
  "id": "coin-continue",
  "background": "shade2",
  "physics": { "gravity": { "x": 0, "y": 1 } },
  "assets": [
    {
      "id": "floor",
      "assetType": "PhysicsShape",
      "anchor": { "position": "bottom", "offsetYPercent": -8 },
      "styleOverride": { "shape": "rectangle", "width": 1920, "height": 24, "fillColorToken": "main2" },
      "physics": { "bodyType": "static", "restitution": 0, "friction": 0.2 }
    },
    {
      "id": "coin",
      "assetType": "PhysicsShape",
      "anchor": { "position": "top-right", "offsetXPercent": -10, "offsetYPercent": 15 },
      "styleOverride": { "shape": "circle", "width": 70, "height": 70, "fillColorToken": "accentWarm" },
      "physics": {
        "bodyType": "dynamic",
        "shape": "circle",
        "restitution": 0,
        "friction": 0.15,
        "frictionAir": 0.01,
        "carryFromScene": { "sceneId": "coin-hill" }
      }
    }
  ]
}
```

`carryFromScene: { sceneId: "coin-hill" }` (assetId defaults to `"coin"`) — the coin in scene 2 starts from exactly where and how fast it was moving at the end of `coin-hill`'s simulation (position + velocity + spin, finite-differenced from the last two baked frames), then keeps rolling under this scene's own gravity/friction until it settles on `floor`. The `anchor` authored on this asset is irrelevant once `carryFromScene` is present — it's fully overridden the instant simulation starts — so it's really just a placeholder to satisfy the schema's `required: ["anchor"]`.

**Caveats worth flagging:** the carry assumes both scenes share the same `config.fps` and composition size (true for a project's config today, but not schema-enforced) — a differing fps would make the carried px/frame velocity numerically wrong; and `carryFromScene` only reads the *last two* baked frames, so if `coin-hill`'s magnet/force pushes are still active on its very last frame, the finite-difference velocity carries that instantaneous rate rather than "true" post-force velocity — fine for this use case, worth knowing if you ever carry mid-force.