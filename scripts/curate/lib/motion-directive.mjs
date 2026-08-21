/**
 * motion-directive.mjs — translate a velocity sample into
 * src/motion/motion.js's exact vocabulary: the up/down/left/right
 * direction aliases plus a distancePx magnitude tier ("more" = bigger
 * distancePx, same direction — not a fifth direction).
 */

export const DIRECTION_BY_AXIS = {
  vertical: { positive: "up", negative: "down" },
  horizontal: { positive: "right", negative: "left" },
};

export const MAX_DISTANCE_PX = 320; // clamp so "more" can't blow past a sane on-screen travel
export const BASE_DISTANCE_PX = 80; // matches DEFAULT_DISTANCE_PX in src/motion/motion.js

/**
 * @param {number} v velocity sample (signed)
 * @param {number} vMax peak |velocity| over the sampled boundary set, used
 *   to normalize distancePx/intensity consistently across the whole plan
 * @param {"vertical"|"horizontal"} axis
 */
export function velocityToDirective(v, vMax, axis) {
  const dirPair = DIRECTION_BY_AXIS[axis];
  const direction = v >= 0 ? dirPair.positive : dirPair.negative;
  const normalized = vMax > 0 ? Math.min(1, Math.abs(v) / vMax) : 0;
  const distancePx = Math.round(Math.min(MAX_DISTANCE_PX, BASE_DISTANCE_PX + normalized * (MAX_DISTANCE_PX - BASE_DISTANCE_PX)));
  const intensity = normalized < 0.34 ? "subtle" : normalized < 0.7 ? "normal" : "more";
  return { direction, distancePx, intensity, normalizedSpeed: Math.round(normalized * 1000) / 1000 };
}

// alias names in src/motion/motion.js's IN_ALIASES/OUT_ALIASES tables
const IN_ALIASES = { up: "fadeUp", down: "fadeDown", left: "fadeLeft", right: "fadeRight" };
const OUT_ALIASES = { up: "fadeOutUp", down: "fadeOutDown", left: "fadeOutLeft", right: "fadeOutRight" };

export function inAlias(direction) {
  return IN_ALIASES[direction];
}
export function outAlias(direction) {
  return OUT_ALIASES[direction];
}
