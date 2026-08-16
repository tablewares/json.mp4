"Resolve the surface" — good framing. A `WavyLine` isn't a box, so neither the renderer's arc-length draw-in nor a physics collider can honestly be derived from `resolvedPosition`/`resolvedStyle.width/height` the way `PhysicsShape` can. Right now WavyLine re-derives its curve **at render time**, per-frame, via a DOM `<path>` ref + `getTotalLength()` — that's exactly the render-time-side-effect pattern the architecture forbids everywhere else. And it means physics has nothing to hook into: there's no JSON-safe curve geometry sitting in `resolved.json` for a static body to collide against.

Fix: pull the curve math out into one pure module, resolve it **once at pipeline2** using `@remotion/paths` (Node-safe, no DOM), and have both the renderer and the physics resolver consume that same baked surface.

## 1. `src/templating/wavyPath.js` (new — the single source of curve geometry)

```js
import { getLength, getPointAtLength, getTangentAtLength } from "@remotion/paths";

/**
 * Pure math for the WavyLine curve — the ONE place that turns two endpoints
 * + curveAmount into an SVG path `d` string. Previously this logic lived
 * inline inside WavyLine.jsx's render body, recomputed every frame, with
 * arc length measured via a DOM `<path>` ref + getTotalLength() — a
 * render-time side effect that also meant there was no JSON-safe curve
 * geometry anywhere for anything else (e.g. physics) to consume.
 *
 * @remotion/paths parses the `d` string directly (no DOM), so the exact
 * same functions work at resolve time in Node and at render time in the
 * browser — this module is imported by BOTH resolveRefs.js (resolve-time,
 * bakes `content._path`) and resolvePhysics.js (resolve-time, samples
 * collision geometry). WavyLine.jsx itself no longer computes curve math —
 * it just reads content._path.
 */
export function buildWavyPathD(a, b, curveAmount = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segLen = Math.hypot(dx, dy) || 1;
  const perpX = -dy / segLen;
  const perpY = dx / segLen;
  const offset = curveAmount * segLen;
  const c1x = a.x + dx / 3 + perpX * offset;
  const c1y = a.y + dy / 3 + perpY * offset;
  const c2x = a.x + (2 * dx) / 3 + perpX * offset;
  const c2y = a.y + (2 * dy) / 3 + perpY * offset;
  return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
}

/**
 * Resolves the full "surface" of a wavy line: the `d` string plus its real
 * arc length, computed once here instead of re-measured every render frame.
 * JSON-safe — this is what gets written into resolved.json.
 *
 * @returns {{ d: string, length: number }}
 */
export function resolveWavyPath(a, b, curveAmount = 0) {
  const d = buildWavyPathD(a, b, curveAmount);
  const length = getLength(d);
  return { d, length };
}

/**
 * Samples the curve into `segments` evenly-spaced points + the tangent
 * angle at each — the collision-geometry primitive resolvePhysics.js needs
 * to approximate a curved static body as a chain of small oriented
 * rectangles (Matter has no native bezier collider). Also the primitive the
 * on-the-horizon "traveling accent marker" (styleOverride.pulse) needs, so
 * this one function serves both features.
 *
 * @param {{d:string, length:number}} resolvedPath  output of resolveWavyPath
 * @param {number} segments  number of sample points, minimum 2
 * @returns {{x:number, y:number, angleDeg:number}[]}
 */
export function sampleWavyPath(resolvedPath, segments = 12) {
  const n = Math.max(2, Math.round(segments));
  const { d, length } = resolvedPath;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const at = t * length;
    const point = getPointAtLength(d, at);
    const tangent = getTangentAtLength(d, at);
    out.push({
      x: point.x,
      y: point.y,
      angleDeg: (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI,
    });
  }
  return out;
}
```

> Per the "backward compatibility verification" habit — before wiring this in for real, confirm `getPointAtLength`/`getTangentAtLength`'s exact return shape (`{x,y}` vs `[x,y]`, angle in radians vs a unit vector) against the installed `@remotion/paths` version. I've written it assuming `{x,y}` point objects and a `{x,y}` unit tangent vector, which matches the current published API, but that's exactly the kind of assumption that's bitten this project before.

## 2. `resolveRefs.js` — bake `content._path` (additive, in `resolveOneRef`)

Add after the existing connector/standalone branches resolve `content.points`, before `return asset`:

```js
import { resolveWavyPath } from "../../templating/wavyPath.js";

// ... inside resolveOneRef, right before each `return asset;` that sets
// content.points (connector branch AND standalone branch) — factor to one
// spot by running it once at the end instead, since both branches converge
// on `asset.content.points` being populated:

function bakeWavyPathSurface(asset) {
  const pts = asset.content?.points;
  if (!Array.isArray(pts) || pts.length < 2 || pts[0] == null || pts[1] == null) return;
  const curveAmount = asset.resolvedStyle?.curveAmount ?? 0;
  asset.content = {
    ...asset.content,
    _path: resolveWavyPath(pts[0], pts[1], curveAmount),
  };
}
```

Call `bakeWavyPathSurface(asset)` at the end of `resolveOneRef`, right before each `return asset` in the connector and standalone-points branches (both already populate `content.points` before returning). No-op for every other asset type — `content.points` is only ever populated by WavyLine's own contract, so nothing else grows a `_path`.

## 3. `WavyLine.jsx` — consume the resolved surface, drop the DOM measurement

```diff
-import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
+import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
+import { buildWavyPathD } from "../../src/templating/wavyPath.js";

 export function WavyLine({ resolvedStyle, content, timing }) {
   const frame = useCurrentFrame();
   const { fps } = useVideoConfig();
   const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

   const pts = Array.isArray(content?.points) ? content.points : [];
   const a = pts[0] ?? { x: 0, y: 0 };
   const b = pts[1] ?? { x: 0, y: 0 };
   if (pts.length < 2) return null;

-  // ---- curved path between the two points --------------------------------
-  const dx = b.x - a.x;
-  const dy = b.y - a.y;
-  const segLen = Math.hypot(dx, dy) || 1;
-  const perpX = -dy / segLen;
-  const perpY = dx / segLen;
-  const curveAmount = resolvedStyle.curveAmount ?? 0;
-  const offset = curveAmount * segLen;
-  const c1x = a.x + dx / 3 + perpX * offset;
-  const c1y = a.y + dy / 3 + perpY * offset;
-  const c2x = a.x + (2 * dx) / 3 + perpX * offset;
-  const c2y = a.y + (2 * dy) / 3 + perpY * offset;
-  const pathD = `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
+  // ---- curved path — resolved ONCE at pipeline2 (resolveRefs.js bakes
+  // content._path = { d, length } via wavyPath.js's resolveWavyPath, using
+  // @remotion/paths, the same lib this component used to need a DOM ref
+  // for). Fallback recomputes inline for a resolved.json baked before this
+  // change / a standalone preview that skipped pass 2 — same math, just
+  // not pre-measured, so totalLen falls back to the old layout-effect path.
+  const curveAmount = resolvedStyle.curveAmount ?? 0;
+  const pathD = content?._path?.d ?? buildWavyPathD(a, b, curveAmount);
+  const resolvedLength = content?._path?.length ?? null;
```

And the length section:

```diff
-  // ---- path length measurement (one-time, layout effect) -----------------
-  const measureRef = React.useRef(null);
-  const [totalLen, setTotalLen] = React.useState(0);
-  React.useLayoutEffect(() => {
-    const el = measureRef.current;
-    if (!el) return;
-    try {
-      setTotalLen(el.getTotalLength());
-    } catch {
-      setTotalLen(0);
-    }
-  }, [pathD]);
+  // ---- path length: resolved at pipeline2 when available (the normal
+  // case — see content._path above). Only a manifest resolved before this
+  // change falls back to the DOM-measured layout-effect path, so old
+  // resolved.json files still render instead of hard-breaking.
+  const [measuredLen, setMeasuredLen] = React.useState(0);
+  const measureRef = React.useRef(null);
+  React.useLayoutEffect(() => {
+    if (resolvedLength != null) return; // already have it, skip the DOM measure entirely
+    const el = measureRef.current;
+    if (!el) return;
+    try {
+      setMeasuredLen(el.getTotalLength());
+    } catch {
+      setMeasuredLen(0);
+    }
+  }, [pathD, resolvedLength]);
+  const totalLen = resolvedLength ?? measuredLen;
```

The `<path ref={measureRef} .../>` hidden measurement path stays (cheap, harmless, and is the fallback's only way to measure) — it just goes unused in the normal case since `resolvedLength` short-circuits the effect.

## 4. `physics.schema.json` — add `"path"` as a static-only shape

```diff
         "shape": { "type": "string", "enum": ["rectangle", "circle"], "default": "rectangle" },
+        "shape": { "type": "string", "enum": ["rectangle", "circle", "path"], "default": "rectangle" },
+        "pathSegments": {
+          "type": "integer",
+          "minimum": 2,
+          "default": 12,
+          "description": "Only used with shape:'path'. Number of straight sub-segments the resolved curve (asset.content._path, e.g. a WavyLine) is chopped into to approximate a collision surface — Matter has no native bezier body. Higher = smoother collisions, more bodies."
+        },
```

Add a note to `bodyType`'s description: `shape: "path"` requires `bodyType: "static"` — enforced in the resolver, not the schema, since it's a cross-field rule Ajv would need `if/then` for and the resolver error is clearer anyway.

## 5. `resolvePhysics.js` — build a compound body from the resolved surface

```js
import { sampleWavyPath } from "../templating/wavyPath.js";

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
        `qualify. Was resolveScenePhysics called AFTER resolveSceneRefs for this scene?`,
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
    const rect = Matter.Bodies.rectangle(midX, midY, segLen, Math.max(strokeWidth, 4), {
      angle: (p0.angleDeg * Math.PI) / 180,
    });
    segmentBodies.push(rect);
  }

  return Matter.Body.create({
    parts: segmentBodies,
    isStatic: true,
    restitution: spec.restitution ?? 0.6,
    friction: spec.friction ?? 0.1,
    collisionFilter: { category: categoryBit, mask: 0xffffffff, group: 0 },
  });
}
```

In `makeBody()`, branch on `spec.shape === "path"` before the existing rectangle/circle logic:

```diff
 function makeBody(resolvedAsset, spec, categoryBit) {
+  if (spec.shape === "path") return makePathBody(resolvedAsset, spec, categoryBit);
   const { cx, cy, width, height } = boxOf(resolvedAsset);
   ...
```

## 6. `resolveScene.js` — ordering fix (this is the load-bearing change)

`content._path` only exists **after** `resolveSceneRefs` runs, but my earlier wiring called `resolveScenePhysics` *before* it. Swap the order:

```diff
-  resolveScenePhysics(resolvedAssets, physicsSpecsById, scene.physics, sceneDurationInFrames, config.fps);
   resolveSceneRefs(resolvedAssets, { sceneId: scene.id, composition: compositionSize });
+  resolveScenePhysics(resolvedAssets, physicsSpecsById, scene.physics, sceneDurationInFrames, config.fps);
```

Dynamic bodies (boxes) don't care about this ordering — only `shape: "path"` statics do, since they read `content._path` which only exists post-refs.

## Example: ball bouncing off a WavyLine ledge

```json
{
  "id": "line",
  "assetType": "WavyLine",
  "anchor": { "position": "bottom", "offsetYPercent": -20 },
  "contentOverride": {
    "points": [
      { "position": "bottom-left", "offsetXPercent": 5 },
      { "position": "bottom-right", "offsetXPercent": -5 }
    ]
  },
  "styleOverride": { "curveAmount": 0.22, "strokeWidth": 10 },
  "physics": { "bodyType": "static", "shape": "path", "pathSegments": 16, "restitution": 0.7 }
},
{
  "id": "ball",
  "assetType": "PhysicsShape",
  "anchor": { "position": "top" },
  "styleOverride": { "shape": "circle", "width": 90, "height": 90, "fillColorToken": "accentRed" },
  "physics": { "bodyType": "dynamic", "shape": "circle", "restitution": 0.75 }
}
```

The ball now falls and actually bounces along the bow of the curve rather than off its flat bounding box — because both the pixel it's drawn at and the surface it collides against were resolved from the identical `content._path`, computed once, in one place.