// src/templating/elbowPath.js
//
// Pure-math orthogonal ("elbow" / Manhattan-style) connector path builder.
// Produces axis-aligned straight segments with 90-degree turns between
// resolved points, optionally starting with a straight "stub" that leaves
// each endpoint along a fixed direction (matching the edge it's anchored
// to -- e.g. fromEdge: "bottom" -> the line travels straight down out of
// the asset first) before turning to route toward the other endpoint.
//
// Mirrors wavyPath.js: pure functions, JSON-safe points in, `d` string
// (+ small metadata) out. No Remotion/React/DOM imports, so it's safe to
// call from a resolver at pipeline2-resolve time (matching the pattern
// already used for buildWavyPathD + getLength()), or as a same-shape
// fallback inside the render component the way WavyLine.jsx already
// falls back to buildWavyPathD when content._path.d isn't pre-resolved.
//
// KNOWN GAP: this module infers fromDir/toDir from the relative position
// of the two resolved points when not told otherwise -- it does not know
// which authored fromEdge/toEdge produced those points, because that
// information doesn't currently survive resolveRefs.js's anchor
// resolution into `content`. For the common "attach above/below/left of"
// cases the inferred direction usually matches the authored edge anyway,
// but for exact fidelity (e.g. deliberately routing out the *right* edge
// of a box that happens to sit to the upper-left of its target),
// resolveRefs.js should thread fromEdge/toEdge through into
// content._path.fromDir / content._path.toDir, which this module already
// prefers when present (see WavyLine.jsx).

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

// direction -> heading in degrees, for orienting an arrowhead on a stub
// end without any path measurement (orthogonal segments have a fixed,
// known heading -- unlike the wavy curve, which needs tangent sampling).
const DIR_TO_ANGLE = { right: 0, down: 90, left: 180, up: 270 };

// Shared anchorEdge vocabulary (center/top/bottom/left/right/corners) ->
// outward stub direction. Corners fall back to their dominant axis;
// "center" has no natural outward direction, so callers should leave it
// unset and let inferDirection() pick one from the other endpoint.
const EDGE_TO_DIR = {
  top: "up",
  bottom: "down",
  left: "left",
  right: "right",
  "top-left": "up",
  "top-right": "up",
  "bottom-left": "down",
  "bottom-right": "down",
};

export function edgeToDirection(edge) {
  return EDGE_TO_DIR[edge] ?? null;
}

export function oppositeDirection(dir) {
  return OPPOSITE[dir] ?? dir;
}

export function directionAngle(dir) {
  return DIR_TO_ANGLE[dir] ?? 0;
}

// Infer a stub direction from which axis two points are mostly separated
// on, biased outward from `from` toward `to`. `axisPreference` lets a
// styleOverride ("horizontal-first" | "vertical-first") force the axis
// instead of picking whichever delta is larger.
export function inferDirection(from, to, axisPreference = "auto") {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (axisPreference === "horizontal-first") return dx >= 0 ? "right" : "left";
  if (axisPreference === "vertical-first") return dy >= 0 ? "down" : "up";
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up";
}

function isHorizontal(dir) {
  return dir === "left" || dir === "right";
}

// Waypoint list (before corner rounding) for a single elbow hop from p0
// (direction fromDir, stubbing OUT of p0) to p1 (direction toDir,
// stubbing OUT of p1 -- the path arrives from the opposite side).
export function buildElbowWaypoints(
  p0,
  p1,
  { fromDir = "auto", toDir = "auto", stubLength = 40, routeStyle = "auto" } = {},
) {
  const resolvedFromDir = fromDir === "auto" ? inferDirection(p0, p1, routeStyle) : fromDir;
  const resolvedToDir = toDir === "auto" ? inferDirection(p1, p0, routeStyle) : toDir;

  const d0 = DIRS[resolvedFromDir] ?? DIRS.right;
  const d1 = DIRS[resolvedToDir] ?? DIRS.left;

  const s0 = { x: p0.x + d0.x * stubLength, y: p0.y + d0.y * stubLength };
  const e0 = { x: p1.x + d1.x * stubLength, y: p1.y + d1.y * stubLength };

  const points = [p0, s0];

  if (s0.x === e0.x || s0.y === e0.y) {
    // Already aligned on one axis after stubbing out: a single corner
    // (L-shape) connects them.
    points.push(e0);
  } else if (isHorizontal(resolvedFromDir)) {
    // Left stub traveling horizontally -> bend to e0's row, then run
    // horizontally again into e0 (Z-shape via one mid point).
    points.push({ x: s0.x, y: e0.y });
    points.push(e0);
  } else {
    points.push({ x: e0.x, y: s0.y });
    points.push(e0);
  }

  points.push(p1);
  return { points, fromDir: resolvedFromDir, toDir: resolvedToDir };
}

// Waypoints -> SVG path `d`. cornerRadius > 0 fillets each interior
// corner with a short quadratic-bezier rounding instead of a hard turn.
export function waypointsToPathD(points, cornerRadius = 0) {
  if (!Array.isArray(points) || points.length < 2) return "";
  if (cornerRadius <= 0) {
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const segIn = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const segOut = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (segIn === 0 || segOut === 0) continue;
    const r = Math.min(cornerRadius, segIn / 2, segOut / 2);

    const inX = curr.x - ((curr.x - prev.x) / segIn) * r;
    const inY = curr.y - ((curr.y - prev.y) / segIn) * r;
    const outX = curr.x + ((next.x - curr.x) / segOut) * r;
    const outY = curr.y + ((next.y - curr.y) / segOut) * r;

    d += ` L ${inX} ${inY} Q ${curr.x} ${curr.y} ${outX} ${outY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// Convenience one-shot matching buildWavyPathD's points-array-in shape,
// so the render component can pick a builder by variant without
// branching on argument shape. Chains hops when more than 2 points are
// given (fromDir/toDir only apply to the very first/last stub; interior
// joints are auto-inferred).
export function buildElbowPathD(
  pts,
  { fromDir = "auto", toDir = "auto", stubLength = 40, cornerRadius = 0, routeStyle = "auto" } = {},
) {
  if (!Array.isArray(pts) || pts.length < 2) {
    return { d: "", points: [], fromDir: null, toDir: null };
  }

  let allPoints = [];
  let resolvedFromDir = null;
  let resolvedToDir = null;

  for (let i = 0; i < pts.length - 1; i++) {
    const segFromDir = i === 0 ? fromDir : "auto";
    const segToDir = i === pts.length - 2 ? toDir : "auto";
    const { points, fromDir: fd, toDir: td } = buildElbowWaypoints(pts[i], pts[i + 1], {
      fromDir: segFromDir,
      toDir: segToDir,
      stubLength,
      routeStyle,
    });
    if (i === 0) {
      resolvedFromDir = fd;
      allPoints.push(...points);
    } else {
      allPoints.push(...points.slice(1)); // drop the duplicated join point
    }
    if (i === pts.length - 2) resolvedToDir = td;
  }

  const d = waypointsToPathD(allPoints, cornerRadius);
  return { d, points: allPoints, fromDir: resolvedFromDir, toDir: resolvedToDir };
}
