/**
 * Resolves timing anchors for transition effects (and, more generally, any
 * authored thing that needs to fire at a concrete frame within a scene).
 *
 * Two input shapes share one resolver:
 *
 *  1. Legacy `offsetPercent` — the original shape, preserved byte-for-byte.
 *     `0` lands exactly on the scene's resolved end; `-10` fires at 90% of
 *     the scene's length; `+10` overshoots into the transition-overlap pad
 *     but is clamped to the scene's own duration. Backwards compatible with
 *     every shipped manifest.
 *
 *  2. Asset-relative / camera-relative anchors — new. Lets an effect fire
 *     at (or a fixed number of frames before/after) another resolved asset's
 *     `enterAtFrame`/`exitAtFrame`, or a camera action's resolved frame.
 *
 * `resolveEffectFrame` is preserved as the legacy entry point — existing
 * callers (transition-effects pass-2) keep working unchanged. New callers
 * that want the wider input shape use `resolveTimingAnchor`.
 *
 * Always clamped to [0, sceneDurationInFrames].
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function resolveAssetRelative(anchor, ctx) {
  const id = anchor.relativeToAsset;
  const target = ctx.resolvedAssetsById?.[id];
  if (!target) {
    throw new Error(
      `Timing anchor references asset "${id}" but no such asset was found in ` +
        `scene "${ctx.sceneId ?? "?"}". Known: ${
          Object.keys(ctx.resolvedAssetsById ?? {}).join(", ") || "(none)"
        }. A referencing asset/effect must be resolved AFTER its target (target must appear earlier in scene.assets).`,
    );
  }
  const edge = anchor.edge === "exit" ? "exitAtFrame" : "enterAtFrame";
  const base = target.timing[edge];
  const offset = anchor.offsetFrames ?? 0;
  return clamp(Math.round(base + offset), 0, ctx.sceneDurationInFrames);
}

function resolveCameraRelative(anchor, ctx) {
  const idx = anchor.relativeToCameraAction;
  const camera = ctx.camera;
  const actions = camera?.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error(
      `Timing anchor references camera action ${JSON.stringify(idx)} but scene "${ctx.sceneId ?? "?"}" has no camera.actions. Author a camera with actions first.`,
    );
  }
  let match;
  if (typeof idx === "number") {
    match = actions[idx];
  } else if (typeof idx === "string") {
    match = actions.find((a) => a.id === idx);
  }
  if (!match) {
    throw new Error(
      `Timing anchor references camera action ${JSON.stringify(idx)} but no such action exists. Available indices: ${actions.map((_, i) => i).join(", ")}.`,
    );
  }
  const motionDuration = camera.durationInFrames ?? Math.max((ctx.sceneDurationInFrames ?? 1) / (camera.speed ?? 1), 1);
  const frame = motionDuration <= 1 ? 0 : Math.round(match.at * (motionDuration - 1));
  const offset = anchor.offsetFrames ?? 0;
  return clamp(frame + offset, 0, ctx.sceneDurationInFrames);
}

/**
 * @typedef {object} TimingAnchorCtx
 * @property {number} sceneDurationInFrames  fully-resolved scene length
 * @property {Record<string, object>=} resolvedAssetsById  pass-1 asset map
 * @property {{durationInFrames?:number, speed?:number, actions?:Array}=} camera
 * @property {string=} sceneId  for error messages
 */

/**
 * Resolves any timing-anchor shape to a concrete scene-local frame.
 *
 * Accepted anchor shapes (discriminated by first-present key below):
 *   - { relativeToAsset }      — fire relative to an asset's edge ± offsetFrames
 *   - { relativeToCameraAction } — fire relative to a camera action's frame
 *   - { offsetPercent }        — legacy percent-of-scene-end (default)
 *
 * Legacy `{ offsetPercent }` is the implicit default: a bare number or an
 * anchor object carrying only `offsetPercent` resolves exactly as
 * `resolveEffectFrame` always has. Existing manifests are untouched.
 *
 * @param {number|object} anchor
 * @param {TimingAnchorCtx} ctx
 * @returns {number}
 */
export function resolveTimingAnchor(anchor, ctx) {
  // Bare-number shorthand for the legacy form (effect specs that pass a
  // raw offsetPercent, e.g. the `offsetPercent ?? 0` destructure site).
  if (typeof anchor === "number") {
    return resolveEffectFrame(anchor, ctx.sceneDurationInFrames);
  }
  if (!anchor || typeof anchor !== "object") {
    return resolveEffectFrame(0, ctx.sceneDurationInFrames);
  }

  if (anchor.relativeToAsset !== undefined) {
    return resolveAssetRelative(anchor, ctx);
  }
  if (anchor.relativeToCameraAction !== undefined) {
    return resolveCameraRelative(anchor, ctx);
  }
  return resolveEffectFrame(anchor.offsetPercent ?? 0, ctx.sceneDurationInFrames);
}

/**
 * Legacy entry point. Resolves a transition effect's { offsetPercent } into a
 * concrete frame in the OUTGOING scene's own local frame space (frame 0 ==
 * scene start).
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
