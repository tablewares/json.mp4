/**
 * Resolves a transition effect's { offsetPercent } into a concrete frame in
 * the OUTGOING scene's own local frame space (frame 0 == scene start).
 *
 * The effect is anchored to the scene's visible ending frame, i.e. the last
 * frame before the outgoing transition overlap begins. When the transition
 * consumes overlap frames, that effective end is sceneDurationInFrames -
 * transitionOverlapInFrames. offsetPercent then measures from that visible
 * end rather than the full scene duration.
 *
 * Examples:
 *   0    -> lands exactly on the scene's visible end frame
 *   -10  -> fires 10% before that visible end
 *   +10  -> fires 10% past that visible end, into the overlap the outgoing
 *           transition uses
 *
 * Always clamped to [0, sceneDurationInFrames].
 */
export function resolveEffectFrame(offsetPercent, sceneDurationInFrames, transitionOverlapInFrames = 0) {
  const effectiveEndFrame = Math.max(0, sceneDurationInFrames - transitionOverlapInFrames);
  const raw = effectiveEndFrame * (1 + offsetPercent / 100);
  return Math.max(0, Math.min(sceneDurationInFrames, Math.round(raw)));
}