/**
 * Resolves a transition effect's { offsetPercent } into a concrete frame in
 * the OUTGOING scene's own local frame space (frame 0 == scene start).
 *
 * offsetPercent is relative to the scene's *resolved* ending frame
 * (scene.durationInFrames, i.e. after TTS timing + transition padding are
 * baked in):
 *   0    -> lands exactly on the scene's last frame
 *   -10  -> fires at 90% of the scene's length (10% before the end)
 *   +10  -> fires 10% past the nominal end, into the overlap the outgoing
 *           transition eats into
 *
 * Always clamped to [0, sceneDurationInFrames].
 */
export function resolveEffectFrame(offsetPercent, sceneDurationInFrames) {
  const raw = sceneDurationInFrames * (1 + offsetPercent / 100);
  return Math.max(0, Math.min(sceneDurationInFrames, Math.round(raw)));
}