/**
 * camera-plan.mjs — same per-scene velocity sample that drives asset
 * motion also drives a `scene.camera` block (src/templating/camera.js
 * contract — `actions[]` of `{at, anchor, zoomPercent, easing}` +
 * `easeZoom`). Same axis, same direction, same intensity tier — so the
 * camera swooshes in the same direction the assets are sliding, landing
 * centered on a focus asset via `anchor.followAssetId`.
 *
 * Sequenced to the focus asset's actual appearance, not scene start.
 * THREE actions per scene, not two: `at:0` AND `at:focusEnterAt` both
 * hold the SAME pulled-back anchor/zoom (no interpolation happens
 * between two identical keyframes) — the camera sits still through the
 * scene's opening beat exactly as long as the focus asset hasn't shown
 * up yet. Only once `focusEnterAt` arrives does the THIRD action
 * (`at: min(focusEnterAt + settleWindow, 1)`) swoosh the camera to a
 * SUBTLE zoomed-in (106-128%, intensity-scaled, never a dramatic push),
 * `followAssetId`-centered settle, `easing: easeOut` for the
 * fast-launch/settle "swoosh" read (see
 * scripts/curate/components/parallax.md's `camera.swooshSnap` pattern),
 * `easeZoom: true` so the zoom eases continuously across that final leg
 * instead of snapping.
 */

// `direction` here is the entry direction (motion-directive's
// up/down/left/right) — the camera "arrives from" that side, i.e. it
// starts pulled back on the OPPOSITE named anchor corner (a swoosh that
// arrives from "up" pulls back toward "bottom" and pushes up into
// center) so the settle motion visually agrees with the asset's own
// entrance direction. Named-anchor pairs, not raw offsets, so this stays
// inside the "corner + signed % nudge" vocabulary every other spatial
// field in the framework uses (see the pattern note in CLAUDE.md).
export const PULLBACK_ANCHOR_BY_DIRECTION = {
  up: { position: "bottom", offsetXPercent: 0, offsetYPercent: 6 },
  down: { position: "top", offsetXPercent: 0, offsetYPercent: -6 },
  left: { position: "right", offsetXPercent: -6, offsetYPercent: 0 },
  right: { position: "left", offsetXPercent: 6, offsetYPercent: 0 },
};

export const FOCUS_ASSET_PLACEHOLDER = "<FOCUS_ASSET_ID>";
export const SETTLE_WINDOW = 0.12; // fraction of the scene the swoosh itself takes, once triggered

// intensity tier -> zoom target fraction within [zoomMin, zoomMax], same
// tiering language as distancePx ("subtle"/"normal"/"more") so a plan
// reader doesn't have to learn a second vocabulary for the camera's push.
const ZOOM_TIER_FRACTION = { subtle: 0.15, normal: 0.5, more: 1 };

/**
 * @param {{direction: string, intensity: string}} entry velocityToDirective's entry sample for this scene
 * @param {number} sceneIndex 0-based scene index
 * @param {{zoomMin: number, zoomMax: number, focusAssetIds?: string[], focusEnterAts?: number[]}} opts
 * @param {() => number} rnd shared PRNG, used only for the placeholder focusEnterAt fallback
 */
export function cameraForScene(entry, sceneIndex, opts, rnd) {
  const pullback = PULLBACK_ANCHOR_BY_DIRECTION[entry.direction];
  const tierFrac = ZOOM_TIER_FRACTION[entry.intensity];
  const zoomPercent = Math.round(opts.zoomMin + (opts.zoomMax - opts.zoomMin) * tierFrac);
  const focusAssetId = opts.focusAssetIds?.[sceneIndex] ?? FOCUS_ASSET_PLACEHOLDER;

  // When does the focus asset actually show up? Prefer the real per-scene
  // enterAt the caller supplied; otherwise sample a plausible stagger
  // fraction (a hero visual staggered after the scene's opening text beat
  // — see scripts/curate/components/motion.md's worked scenes, which
  // enter their hero ImageReveal around 0.25-0.35 of the scene window).
  const focusEnterAt = opts.focusEnterAts?.[sceneIndex] ?? 0.2 + rnd() * 0.25;
  const swooshAt = Math.min(1, focusEnterAt + SETTLE_WINDOW);

  return {
    easeZoom: true,
    actions: [
      // Hold pulled-back and static from scene start THROUGH the focus
      // asset's own entrance — two keyframes at the SAME anchor/zoom
      // produce zero interpolation (segmentProgress is irrelevant when
      // current.anchor === next.anchor), so the camera visibly does
      // nothing until focusEnterAt, instead of already swooshing before
      // the thing it's swooshing toward has appeared on screen.
      { at: 0, anchor: pullback, zoomPercent: 100, easing: "linear" },
      { at: Math.min(focusEnterAt, swooshAt), anchor: pullback, zoomPercent: 100, easing: "easeOut" },
      {
        at: swooshAt,
        // schema note: cameraAnchor's followAssetId branch only accepts
        // followAssetId/edge(enter|exit — legacy timing-edge enum, NOT a
        // spatial corner)/offsetXPercent/offsetYPercent — no "center"/
        // spatial-edge key here (that's `anchorEdge` on ASSET anchors,
        // scene.schema.json's separate definition). Omit `edge` entirely;
        // resolveAnchorPoint's spatial default (asset center) applies.
        anchor: { followAssetId: focusAssetId, offsetXPercent: 0, offsetYPercent: 0 },
        zoomPercent,
        easing: "easeOut",
      },
    ],
    focusEnterAt: Math.round(focusEnterAt * 1000) / 1000,
  };
}
