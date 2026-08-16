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
