import { getLength, getPointAtLength, getTangentAtLength } from "@remotion/paths";

/**
 * Calculates smooth control points for an array of 3+ points using Catmull-Rom spline interpolation.
 */
function buildSmoothSplineD(pts, curveAmount = 0, tension = 1) {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    // Fall back to 2-point wavy calculation for simple pairs
    return buildSegmentD(pts[0], pts[1], curveAmount);
  }

  let pathD = `M ${pts[0].x} ${pts[0].y}`;

  // Pad endpoints so Catmull-Rom splines work at boundaries
  const paddedPts = [
    { x: pts[0].x * 2 - pts[1].x, y: pts[0].y * 2 - pts[1].y },
    ...pts,
    {
      x: pts[pts.length - 1].x * 2 - pts[pts.length - 2].x,
      y: pts[pts.length - 1].y * 2 - pts[pts.length - 2].y,
    },
  ];

  for (let i = 1; i < paddedPts.length - 2; i++) {
    const p0 = paddedPts[i - 1];
    const p1 = paddedPts[i];
    const p2 = paddedPts[i + 1];
    const p3 = paddedPts[i + 2];

    // Catmull-Rom to Cubic Bézier control points conversion
    let c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    let c1y = p1.y + ((p2.y - p0.y) / 6) * tension;
    let c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    let c2y = p2.y - ((p3.y - p1.y) / 6) * tension;

    // Apply offset if curveAmount is provided
    if (curveAmount !== 0) {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const segLen = Math.hypot(dx, dy) || 1;
      const perpX = -dy / segLen;
      const perpY = dx / segLen;
      const offset = curveAmount * segLen;

      c1x += perpX * offset;
      c1y += perpY * offset;
      c2x += perpX * offset;
      c2y += perpY * offset;
    }

    pathD += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }

  return pathD;
}

function buildSegmentD(a, b, curveAmount = 0) {
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
  return ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
}

export function buildWavyPathD(points, curveAmount = 0, smoothCurve = false) {
  let pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return "";

  if (smoothCurve && pts.length >= 3) {
    return buildSmoothSplineD(pts, curveAmount);
  }

  // Piecewise continuous curve (point-by-point)
  let pathD = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    pathD += buildSegmentD(pts[i], pts[i + 1], curveAmount);
  }
  return pathD;
}
/**
 * Resolves the full "surface" of a wavy line: the `d` string plus its real
 * arc length, computed once here instead of re-measured every render frame.
 * JSON-safe — this is what gets written into resolved.json.
 *
 * `smoothCurve` threads into `buildWavyPathD`: true + 3+ points selects the
 * Catmull-Rom spline; otherwise the piecewise segment path is used. This
 * matters because pipeline 2 (`bakeWavyPathSurface`) bakes `_path.d` here
 * and the renderer reads it first — dropping `smoothCurve` at this call
 * would silently downgrade any 3+ point line to piecewise.
 *
 * @param {{x:number,y:number}[]} a
 * @param {number} [curveAmount=0]
 * @param {boolean} [smoothCurve=false]
 * @returns {{ d: string, length: number }}
 */
export function resolveWavyPath(a, curveAmount = 0, smoothCurve = false) {
  const d = buildWavyPathD(a, curveAmount, smoothCurve);
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
