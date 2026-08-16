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

import { getPointAtLength } from "@remotion/paths";

/**
 * Closest point on `targetBody` to `fromPoint`. Three cases:
 *   - rectangle/circle: closest point on the primitive's own geometry
 *     (clamped box edge, or circle-radius projection)
 *   - compound path body (shape:"path"): closest point sampled off the
 *     ACTUAL curve via content._path + getPointAtLength — walks the
 *     baked arc length in fixed steps and keeps the nearest hit. Coarser
 *     than exact projection but cheap and good enough at video pixel
 *     scale; bump `steps` if a very sharp bow needs finer resolution.
 */
function nearestSurfacePoint(fromPoint, targetBody, targetSpec, targetResolvedAsset) {
  if (targetSpec.shape === "path" && targetResolvedAsset?.content?._path) {
    const { d, length } = targetResolvedAsset.content._path;
    const steps = 40;
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i <= steps; i += 1) {
      const at = (i / steps) * length;
      const p = getPointAtLength(d, at);
      const dist = Math.hypot(p.x - fromPoint.x, p.y - fromPoint.y);
      if (dist < bestDist) { bestDist = dist; best = p; }
    }
    return best;
  }

  // FIX 3: Proper circle & rectangle surface calculation
  if (targetSpec.shape === "circle") {
    const radius = targetSpec.radius ?? Math.min(targetBody.bounds.max.x - targetBody.bounds.min.x) / 2;
    const dx = fromPoint.x - targetBody.position.x;
    const dy = fromPoint.y - targetBody.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    return {
      x: targetBody.position.x + (dx / dist) * radius,
      y: targetBody.position.y + (dy / dist) * radius,
    };
  }

  // Rectangle fallback using clamped bounds
  const bounds = targetBody.bounds;
  const clampedX = Math.max(bounds.min.x, Math.min(fromPoint.x, bounds.max.x));
  const clampedY = Math.max(bounds.min.y, Math.min(fromPoint.y, bounds.max.y));
  return { x: clampedX, y: clampedY };
}

function applyMagnet(body, spec, bodiesById, specsById, assetsById, frame, assetId) {
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

  const attractTo = m.attractTo ?? "centroid";
  const targetPoint =
    attractTo === "nearestSurfacePoint"
      ? nearestSurfacePoint(body.position, targetBody, specsById[m.targetAssetId], assetsById[m.targetAssetId])
      : targetBody.position;

  const dx = targetPoint.x - body.position.x;
  const dy = targetPoint.y - body.position.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (m.maxDistance != null && dist > m.maxDistance) return;

  // FIX 1: Clamp minimum distance so force doesn't explode near 0
  const effectiveDist = Math.max(dist, 5);

  const strength = m.strength ?? 0.001;
  const falloff = m.falloff ?? "none";
  const accelMag =
    falloff === "linear"
      ? strength / effectiveDist
      : falloff === "quadratic"
      ? strength / (effectiveDist * effectiveDist)
      : strength;

  // FIX 2: Use applyForce instead of setVelocity so Matter's collision solver stays stable
  const forceMag = accelMag * body.mass;
  Matter.Body.applyForce(body, body.position, {
    x: (dx / dist) * forceMag,
    y: (dy / dist) * forceMag,
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
 *   getFinalPhysicsState() against an earlier resolved scene. Empty {}
 *   by default: strict no-op for every scene that doesn't use carryFromScene.
 */
export function resolveScenePhysics(
  resolvedAssets,
  physicsSpecsById,
  scenePhysicsSpec,
  sceneDurationInFrames,
  fps,
  initialOverridesById = {},
) {
  console.log("resolveScenePhysics: physicsSpecsById", Object.keys(physicsSpecsById ?? {}).length, "bodies,", sceneDurationInFrames, "frames,", fps, "fps");
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
        applyMagnet(body, spec, bodiesById, physicsSpecsById, byId, frame, id);
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
