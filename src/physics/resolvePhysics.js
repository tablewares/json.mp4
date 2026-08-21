import Matter from "matter-js";
import { getLength, getPointAtLength, getTangentAtLength } from "@remotion/paths";
import { sampleWavyPath, buildWavyPathD } from "../templating/wavyPath.js";
import { ANCHOR_ALIGN, resolveAnchorPoint } from "../templating/anchor.js";

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
 *   - scenePhysicsSpec.constraints — Matter.Constraint point-to-point
 *     joints (bodyA/bodyB, or bodyA/fixed-world-point when bodyB is
 *     omitted). This is the primitive free bodies + force/magnet can't
 *     express on their own: a rigid PIVOT another body swings/rotates
 *     around (a balance scale's beam pinned at its center to a static
 *     fulcrum, a see-saw, a pendulum arm) as opposed to a body merely
 *     accelerating toward a target. Built once, after every scene body
 *     exists, before the simulation loop starts stepping.
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
      : ((spec.initialAngularVelocity ?? 0) * Math.PI) / 180;
    Matter.Body.setAngularVelocity(body, av);
  }
  return body;
}

/**
 * Resolves force.vector for this step. Either the raw fixed vector, or —
 * for force.towardAssetId — a live direction recomputed every step toward
 * the target body's current centroid, scaled to force.magnitude. Mirrors
 * applyMagnet's targeting model (same live-position tracking), but kept as
 * a plain acceleration add rather than Matter's mass-scaled applyForce, to
 * stay consistent with the rest of this force API.
 */
function resolveForceVector(f, body, bodiesById, assetId) {
  if (f.vector) return f.vector;
  const targetBody = bodiesById[f.towardAssetId];
  if (!targetBody) {
    throw new Error(
      `Asset "${assetId}" physics.force.towardAssetId "${f.towardAssetId}" was not found among ` +
        `this scene's physics bodies. The target must also carry a "physics" block (dynamic or static).`,
    );
  }
  const dx = targetBody.position.x - body.position.x;
  const dy = targetBody.position.y - body.position.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: (dx / dist) * f.magnitude, y: (dy / dist) * f.magnitude };
}

function applyForce(body, spec, frame, bodiesById, assetId) {
  const f = spec.force;
  if (!f) return;
  const start = f.startFrame ?? 0;
  const end = f.endFrame ?? Infinity;
  if (f.oneShot) {
    if (frame === start) {
      const v = resolveForceVector(f, body, bodiesById, assetId);
      Matter.Body.setVelocity(body, { x: body.velocity.x + v.x, y: body.velocity.y + v.y });
    }
    return;
  }
  if (frame >= start && frame < end) {
    const v = resolveForceVector(f, body, bodiesById, assetId);
    Matter.Body.setVelocity(body, { x: body.velocity.x + v.x, y: body.velocity.y + v.y });
  }
}

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
  if (targetSpec.shape === "path") {
    let best = null;
    let bestDist = Infinity;
    // Matter.js compound bodies store the parent hull at index 0, actual segments follow
    const parts = targetBody.parts.length > 1 ? targetBody.parts.slice(1) : targetBody.parts;
    for (const part of parts) {
      const dist = Math.hypot(part.position.x - fromPoint.x, part.position.y - fromPoint.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = part.position;
      }
    }
    return best || targetBody.position;
  }

  if (targetSpec.shape === "circle") {
    const radius = targetSpec.radius ?? (targetBody.bounds.max.x - targetBody.bounds.min.x) / 2;
    const dx = fromPoint.x - targetBody.position.x;
    const dy = fromPoint.y - targetBody.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    return {
      x: targetBody.position.x + (dx / dist) * radius,
      y: targetBody.position.y + (dy / dist) * radius,
    };
  }

  // Rectangle calculation using local coordinate space to handle rotation
  const angle = targetBody.angle;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  
  // Translate point to origin and rotate to axis-aligned space
  const dx = fromPoint.x - targetBody.position.x;
  const dy = fromPoint.y - targetBody.position.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  
  const { width, height } = targetResolvedAsset.resolvedStyle;
  const halfW = width / 2;
  const halfH = height / 2;
  
  // Clamp to the unrotated rectangle boundaries
  const clampedX = Math.max(-halfW, Math.min(localX, halfW));
  const clampedY = Math.max(-halfH, Math.min(localY, halfH));
  
  // Rotate back and translate to world space
  const worldCos = Math.cos(angle);
  const worldSin = Math.sin(angle);
  return {
    x: targetBody.position.x + (clampedX * worldCos - clampedY * worldSin),
    y: targetBody.position.y + (clampedX * worldSin + clampedY * worldCos),
  };
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

  const effectiveDist = Math.max(dist, 5);

  const strength = m.strength ?? 0.001;
  const falloff = m.falloff ?? "none";
  const accelMag =
    falloff === "linear"
      ? strength / effectiveDist
      : falloff === "quadratic"
      ? strength / (effectiveDist * effectiveDist)
      : strength;

  Matter.Body.setVelocity(body, {
    x: body.velocity.x + (dx / dist) * accelMag,
    y: body.velocity.y + (dy / dist) * accelMag,
  });
}

/**
 * Center-based box {cx, cy, width, height} for an id at a given scene-local
 * frame. Reads `byId[id].resolvedPhysics.frames` when present — which by
 * this point covers BOTH Matter-simulated dynamic bodies (baked earlier in
 * resolveScenePhysics) and landAt assets (baked in the pass right before
 * attachTo runs) — falling back to the constant anchor-resolved box for
 * static bodies and plain non-physics assets, which don't move.
 */
function assetBoxAtFrame(id, frame, byId) {
  const resolvedAsset = byId[id];
  const { width, height } = resolvedAsset.resolvedStyle;
  const track = resolvedAsset.resolvedPhysics?.frames;
  if (track && track.length > 0) {
    const snap = track[Math.min(frame, track.length - 1)];
    return { cx: snap.left + width / 2, cy: snap.top + height / 2, width, height };
  }
  const { cx, cy } = boxOf(resolvedAsset);
  return { cx, cy, width, height };
}

/**
 * Cartoon-physics primitive #1: deterministic "ride along". Recomputes this
 * asset's own box every frame from the followed asset's LIVE box (baked
 * Matter track, baked landAt track, or a constant static/plain box) via the
 * same named-edge + %-offset vocabulary scene.assets[].anchor already uses —
 * no mass/friction/collision involved, just a per-frame point lookup. The
 * followed asset may itself be a landAt asset (its track is baked before
 * attachTo runs — see the two-pass split at the bottom of
 * resolveScenePhysics) — this is the common "sticker rides the tossed ball"
 * case. It may NOT be another attachTo asset (see the chain guard below).
 */
function computeAttachToFrames(id, spec, byId, sceneDurationInFrames, compositionSize) {
  const { followAssetId, anchorEdge = "center", offsetXPercent = 0, offsetYPercent = 0 } = spec.attachTo;
  if (!byId[followAssetId]) {
    throw new Error(
      `Asset "${id}" physics.attachTo.followAssetId "${followAssetId}" was not found among this scene's resolved assets.`,
    );
  }
  const align = ANCHOR_ALIGN[anchorEdge];
  if (!align) {
    throw new Error(`Asset "${id}" physics.attachTo.anchorEdge "${anchorEdge}" is not a valid corner/center position.`);
  }
  const { width: ownWidth, height: ownHeight } = byId[id].resolvedStyle;

  const frames = [];
  for (let frame = 0; frame < sceneDurationInFrames; frame += 1) {
    const box = assetBoxAtFrame(followAssetId, frame, byId);
    const edgeX = box.cx + (align.x - 0.5) * box.width;
    const edgeY = box.cy + (align.y - 0.5) * box.height;
    const px = edgeX + (offsetXPercent / 100) * compositionSize.width;
    const py = edgeY + (offsetYPercent / 100) * compositionSize.height;
    frames.push({ left: px - ownWidth / 2, top: py - ownHeight / 2, rotateDeg: 0 });
  }
  return frames;
}

/**
 * Cartoon-physics primitive #2: deterministic "toss to a point". A closed-
 * form parabola (x(t)=x0+vx·t, y(t)=y0+vy0·t+½·g·t²) solved so the body
 * reaches the target EXACTLY at atFrame — no velocity/angle tuning, no
 * Matter integration drift. Gravity only shapes the arc's height, never the
 * landing point or timing; `g` is a simplified px/frame² reading of
 * scenePhysicsSpec.gravity (same DEFAULT_GRAVITY/gravityScale the Matter
 * bodies use, just applied directly rather than through Matter's own
 * per-step integration). Once landed (frame >= atFrame) the body holds at
 * the target — no bounce, no continued fall; author a second scene or
 * attachTo if it needs to keep moving after landing.
 */
function computeLandAtFrames(id, spec, byId, scenePhysicsSpec, sceneDurationInFrames, startFrame) {
  const { atFrame, targetAssetId, target } = spec.landAt;
  if (atFrame <= startFrame) {
    throw new Error(
      `Asset "${id}" physics.landAt.atFrame (${atFrame}) must be greater than scene.physics.startFrame (${startFrame}).`,
    );
  }
  const targetPoint = target ?? (() => {
    if (!byId[targetAssetId]) {
      throw new Error(
        `Asset "${id}" physics.landAt.targetAssetId "${targetAssetId}" was not found among this scene's resolved assets.`,
      );
    }
    const box = boxOf(byId[targetAssetId]);
    return { x: box.cx, y: box.cy };
  })();

  const { cx: startX, cy: startY, width, height } = boxOf(byId[id]);
  const gravity = scenePhysicsSpec?.gravity ?? DEFAULT_GRAVITY;
  const gravityScale = scenePhysicsSpec?.gravityScale ?? 0.001;
  const gY = gravity.y * gravityScale * 1000; // approximate px/frame², see doc comment above

  const T = atFrame - startFrame;
  const vx = (targetPoint.x - startX) / T;
  const vy0 = (targetPoint.y - startY) / T - 0.5 * gY * T;

  const frames = [];
  for (let frame = 0; frame < sceneDurationInFrames; frame += 1) {
    const t = Math.max(0, Math.min(frame, atFrame) - startFrame);
    const x = startX + vx * t;
    const y = startY + vy0 * t + 0.5 * gY * t * t;
    frames.push({ left: x - width / 2, top: y - height / 2, rotateDeg: 0 });
  }
  return frames;
}

/**
 * Resolves a physics.followPath.points[] item to a composition-space
 * {x, y} point. Reuses the exact same "named corner / follow another
 * asset / raw pixels" vocabulary WavyLine's contentOverride.points already
 * accepts (shared.schema.json#/definitions/anchorPointSpec), through the
 * SAME resolver (resolveAnchorPoint) — a followPath waypoint and a WavyLine
 * endpoint are authored identically. Raw {x,y} passes through unchanged;
 * {position,...}/{followAssetId,...} resolve against the composition frame
 * / an earlier-authored asset's box.
 */
function resolveFollowPathPoint(spec, byId, compositionSize) {
  if (typeof spec?.x === "number" && typeof spec?.y === "number" && spec.position == null && spec.followAssetId == null) {
    return { x: spec.x, y: spec.y };
  }
  return resolveAnchorPoint(spec, compositionSize, { resolvedAssetsById: byId });
}

/**
 * Cartoon-physics primitive #3: deterministic "plot points, follow the
 * curve". Authored waypoints (shared anchor vocabulary, resolved via
 * resolveFollowPathPoint) become one continuous Catmull-Rom spline — the
 * SAME buildWavyPathD/getLength/getPointAtLength machinery WavyLine and
 * resolvePhysics's shape:'path' collision surface already use, so a
 * followPath curve and a WavyLine drawn along the same points look
 * identical. Travel is paced by REAL ARC LENGTH (t = distance traveled /
 * total length), not point index or frame-linear time, so unevenly spaced
 * waypoints don't cause uneven speed bursts. `rotateToPath` reads the
 * curve's own tangent angle at each frame's arc-length position.
 */
function computeFollowPathFrames(id, spec, byId, sceneDurationInFrames, compositionSize) {
  const { points, atFrame, curveAmount = 0, rotateToPath = false, startFrame = 0 } = spec.followPath;
  if (atFrame <= startFrame) {
    throw new Error(
      `Asset "${id}" physics.followPath.atFrame (${atFrame}) must be greater than physics.followPath.startFrame (${startFrame}).`,
    );
  }
  const resolvedPoints = points.map((p) => resolveFollowPathPoint(p, byId, compositionSize));
  const smoothCurve = resolvedPoints.length >= 3;
  const d = buildWavyPathD(resolvedPoints, curveAmount, smoothCurve);
  const length = getLength(d);

  const { width, height } = byId[id].resolvedStyle;
  const T = atFrame - startFrame;

  const frames = [];
  for (let frame = 0; frame < sceneDurationInFrames; frame += 1) {
    const t = Math.max(0, Math.min(frame, atFrame) - startFrame) / T;
    const at = t * length;
    const point = getPointAtLength(d, at);
    const rotateDeg = rotateToPath
      ? (() => {
          const tangent = getTangentAtLength(d, at);
          return (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
        })()
      : 0;
    frames.push({ left: point.x - width / 2, top: point.y - height / 2, rotateDeg });
  }
  return frames;
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
 * @param {{width:number, height:number}=} compositionSize
 *   Only needed for physics.attachTo's %-offset math. Defaults to a 1920x1080
 *   fallback so existing call sites/tests that never use attachTo keep working
 *   without passing it.
 */
export function resolveScenePhysics(
  resolvedAssets,
  physicsSpecsById,
  scenePhysicsSpec,
  sceneDurationInFrames,
  fps,
  initialOverridesById = {},
  compositionSize = { width: 1920, height: 1080 },
) {
  const allIds = Object.keys(physicsSpecsById ?? {});
  if (allIds.length === 0) return;

  // attachTo/landAt assets are deterministic kinematic tracks computed
  // OUTSIDE the Matter world entirely — they never get a Matter body, never
  // collide, never consume a collision category bit. They're the
  // "cartoon physics" escape hatch: skip the simulation, just say where the
  // thing ends up (and optionally what it rides on).
  const specialIds = allIds.filter((id) => physicsSpecsById[id].attachTo || physicsSpecsById[id].landAt || physicsSpecsById[id].followPath);
  const ids = allIds.filter((id) => !specialIds.includes(id));

  if (ids.length > MAX_PHYSICS_BODIES) {
    throw new Error(
      `Scene has ${ids.length} Matter-simulated physics bodies but the collision mask supports at most ` +
        `${MAX_PHYSICS_BODIES}. Split into multiple scenes, drop unused collidesWith constraints, or move ` +
        `some bodies to attachTo/landAt (which don't consume a collision slot).`,
    );
  }

  const byId = Object.fromEntries(resolvedAssets.map((a) => [a.id, a]));
  const startFrame = Math.max(0, Math.round(scenePhysicsSpec?.startFrame ?? 0));

  for (const id of specialIds) {
    const spec = physicsSpecsById[id];
    if (!byId[id]) {
      throw new Error(`scene physics references asset id "${id}" which was not found among resolved assets.`);
    }
    const specialKinds = ["attachTo", "landAt", "followPath"].filter((k) => spec[k]);
    if (specialKinds.length > 1) {
      throw new Error(`Asset "${id}" sets more than one of physics.attachTo/landAt/followPath (${specialKinds.join(", ")}) — author at most one.`);
    }
    // landAt/followPath are self-contained (their target/waypoints must
    // resolve BEFORE this asset's own track is baked) — neither may
    // reference another attachTo/landAt/followPath asset, since bake order
    // between two self-contained kinds isn't guaranteed. attachTo MAY
    // follow a landAt or followPath asset (both bake in the earlier pass,
    // before attachTo runs — see the bake order below) but never another
    // attachTo (also order-dependent).
    if (spec.landAt?.targetAssetId && specialIds.includes(spec.landAt.targetAssetId)) {
      throw new Error(
        `Asset "${id}" physics.landAt.targetAssetId "${spec.landAt.targetAssetId}" is itself an attachTo/landAt/followPath ` +
          `asset — chaining isn't supported. Target a Matter-simulated or plain asset instead.`,
      );
    }
    if (Array.isArray(spec.followPath?.points)) {
      for (const p of spec.followPath.points) {
        if (typeof p?.followAssetId === "string" && specialIds.includes(p.followAssetId)) {
          throw new Error(
            `Asset "${id}" physics.followPath.points references followAssetId "${p.followAssetId}", which is ` +
              `itself an attachTo/landAt/followPath asset — chaining isn't supported. Target a Matter-simulated or plain asset instead.`,
          );
        }
      }
    }
    if (spec.attachTo?.followAssetId) {
      const followed = spec.attachTo.followAssetId;
      if (physicsSpecsById[followed]?.attachTo) {
        throw new Error(
          `Asset "${id}" physics.attachTo.followAssetId "${followed}" is itself an attachTo asset — chaining ` +
            `attachTo→attachTo isn't supported. It MAY follow a landAt/followPath asset, a Matter-simulated body, or a plain asset.`,
        );
      }
    }
  }

  let framesById = {};
  if (ids.length > 0) {
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
        if (bodiesById[id].parts) {
          bodiesById[id].parts.forEach((part) => (part.collisionFilter.mask = mask));
        }
      }
      if (spec.magnet && !bodiesById[spec.magnet.targetAssetId]) {
        throw new Error(
          `Asset "${id}" physics.magnet.targetAssetId "${spec.magnet.targetAssetId}" not found among ` +
            `this scene's physics bodies. Known: ${ids.join(", ")}`,
        );
      }
      if (spec.force?.towardAssetId && !bodiesById[spec.force.towardAssetId]) {
        throw new Error(
          `Asset "${id}" physics.force.towardAssetId "${spec.force.towardAssetId}" not found among ` +
            `this scene's physics bodies. Known: ${ids.join(", ")}`,
        );
      }
    }

    const deltaMs = 1000 / fps;

    // Constraints (pivots/hinges/pendulum rods) — built AFTER every body exists
    // (so bodyA/bodyB can reference any physics asset in the scene) but BEFORE
    // the simulation steps. A rigid (stiffness:1, length:0) point constraint is
    // Matter's own recipe for a hinge: the pinned point stays fixed while the
    // body remains free to rotate about it — e.g. a balance-scale beam pinned
    // at its center to a static fulcrum, or one payload pinned to a beam's end.
    for (const c of scenePhysicsSpec?.constraints ?? []) {
      const bodyA = bodiesById[c.bodyA];
      if (!bodyA) {
        throw new Error(
          `scene.physics.constraints references bodyA "${c.bodyA}" which was not found among this ` +
            `scene's physics bodies. Known: ${ids.join(", ")}`,
        );
      }
      const bodyB = c.bodyB != null ? bodiesById[c.bodyB] : undefined;
      if (c.bodyB != null && !bodyB) {
        throw new Error(
          `scene.physics.constraints references bodyB "${c.bodyB}" which was not found among this ` +
            `scene's physics bodies. Known: ${ids.join(", ")}. Omit bodyB entirely to anchor to a ` +
            `fixed world point instead.`,
        );
      }
      const constraint = Matter.Constraint.create({
        bodyA,
        pointA: c.pointA ?? { x: 0, y: 0 },
        ...(bodyB ? { bodyB, pointB: c.pointB ?? { x: 0, y: 0 } } : { pointB: c.pointB ?? { x: 0, y: 0 } }),
        length: c.length ?? 0,
        stiffness: c.stiffness ?? 1,
        damping: c.damping ?? 0,
      });
      Matter.World.add(engine.world, constraint);
    }

    const dynamicIds = ids.filter((id) => physicsSpecsById[id].bodyType !== "static");
    framesById = Object.fromEntries(dynamicIds.map((id) => [id, []]));

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
          applyForce(body, spec, frame, bodiesById, id);
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

  // landAt and followPath first (both self-contained closed forms — landAt
  // reads a target's static/Matter box, followPath's points may reference a
  // Matter/static/plain asset but never another special one, enforced
  // above), then attachTo (may follow a Matter dynamic body's just-baked
  // framesById, a landAt/followPath asset's just-baked track, a static
  // body, or a plain asset — never another special id).
  for (const id of specialIds) {
    const spec = physicsSpecsById[id];
    if (!spec.landAt) continue;
    byId[id].resolvedPhysics = {
      frames: computeLandAtFrames(id, spec, byId, scenePhysicsSpec, sceneDurationInFrames, startFrame),
    };
  }
  for (const id of specialIds) {
    const spec = physicsSpecsById[id];
    if (!spec.followPath) continue;
    byId[id].resolvedPhysics = {
      frames: computeFollowPathFrames(id, spec, byId, sceneDurationInFrames, compositionSize),
    };
  }
  for (const id of specialIds) {
    const spec = physicsSpecsById[id];
    if (!spec.attachTo) continue;
    byId[id].resolvedPhysics = {
      frames: computeAttachToFrames(id, spec, byId, sceneDurationInFrames, compositionSize),
    };
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
