/**
 * parabola.mjs — fit ONE parabola across the whole timeline (t in [0,1],
 * t=0 first scene start, t=1 last scene end). p(t) = k*(t - vertexT)^2,
 * in an "up/right-positive" convention: positive p means displaced
 * toward up (vertical axis) or right (horizontal axis) from baseline.
 *
 * "arc" (hump, k<0): starts low, rises to a peak near vertexT, falls
 * back — like a thrown object.
 * "dip" (valley, k>0): starts high, drops to a trough, rises back —
 * like a dip/drop beat.
 *
 * Why a parabola: a single quadratic across the whole scene sequence
 * gives a physically coherent arc (ease in, apex, ease out) instead of
 * picking a random direction per scene — consecutive scenes naturally
 * share velocity sign near the cut, which is what makes an exit motion
 * and the next scene's entrance motion read as one continuous move
 * instead of two unrelated fades.
 */

/**
 * @param {object} opts
 * @param {"arc"|"dip"} opts.curveShape
 * @param {number} opts.amplitude peak displacement in px over the domain
 * @param {number} opts.vertexT apex/trough location in [0,1]
 * @returns {{ position: (t: number) => number, velocity: (t: number) => number, k: number }}
 */
export function fitParabola({ curveShape, amplitude, vertexT }) {
  if (!["arc", "dip"].includes(curveShape)) {
    throw new Error(`curveShape must be "arc" or "dip", got "${curveShape}"`);
  }

  // k chosen so |p(t)| hits `amplitude` at whichever end (0 or 1) is
  // farther from the vertex — i.e. amplitude is the parabola's true peak
  // displacement over the domain, not an arbitrary coefficient.
  const farEnd = Math.max(vertexT, 1 - vertexT);
  const kMagnitude = amplitude / (farEnd * farEnd);
  const k = curveShape === "arc" ? -kMagnitude : kMagnitude;

  function position(t) {
    return k * (t - vertexT) * (t - vertexT);
  }
  function velocity(t) {
    // dp/dt of k*(t-vertexT)^2
    return 2 * k * (t - vertexT);
  }

  return { position, velocity, k };
}
