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

  // relativeToWord: anchor to a specific spoken word's real TTS timestamp
  // on the target, rather than the target's overall enter/exit frame.
  // Only meaningful when the target resolved word-level timing — today
  // that's KineticText assets whose contentOverride.text exactly matches
  // its scene's narration text (see resolveKineticWordTimings in
  // resolveScene.js). `edge` here picks the word's own start vs end frame
  // (default "enter" -> startFrame), NOT the asset's enter/exit — reusing
  // the same enter/exit vocabulary keeps one mental model across both
  // anchor shapes.
  if (anchor.relativeToWord != null) {
    const words = target.timing?.words;
    if (!Array.isArray(words) || words.length === 0) {
      throw new Error(
        `Timing anchor references relativeToWord on asset "${id}" but that asset has no resolved ` +
          `word timing in scene "${ctx.sceneId ?? "?"}". Word timing only resolves when the asset is a ` +
          `KineticText whose contentOverride.text exactly matches its scene's narration text ` +
          `(word-for-word, including word count).`,
      );
    }
    const word =
      typeof anchor.relativeToWord === "number"
        ? words[anchor.relativeToWord]
        : words.find((w) => w.word === anchor.relativeToWord);
    if (!word) {
      const available =
        typeof anchor.relativeToWord === "number"
          ? `0-${words.length - 1}`
          : words.map((w) => w.word).join(", ");
      throw new Error(
        `Timing anchor references relativeToWord ${JSON.stringify(anchor.relativeToWord)} on asset "${id}" ` +
          `but it wasn't found. Available: ${available}.`,
      );
    }
    const edge = anchor.edge === "exit" ? "endFrame" : "startFrame";
    const base = word[edge];
    const offset = anchor.offsetFrames ?? 0;
    return clamp(Math.round(base + offset), 0, ctx.sceneDurationInFrames);
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

function resolveWordRelative(anchor, ctx) {
  const words = ctx.words;
  if (!Array.isArray(words) || words.length === 0) {
    throw new Error(
      `Timing anchor references relativeToWord ${JSON.stringify(anchor.relativeToWord)} but scene ` +
        `"${ctx.sceneId ?? "?"}" has no resolved narration word timing. This requires the scene to have ` +
        `a narrationRef with word-level (WhisperX/TTS) alignment.`,
    );
  }

  const specs = Array.isArray(anchor.relativeToWord) ? anchor.relativeToWord : [anchor.relativeToWord];
  const matched = specs.map((s) => {
    const w = typeof s === "number" ? words[s] : words.find((word) => word.word === s);
    if (!w) {
      const available = typeof s === "number" ? `0-${words.length - 1}` : words.map((word) => word.word).join(", ");
      throw new Error(
        `Timing anchor references relativeToWord ${JSON.stringify(s)} but it wasn't found in scene ` +
          `"${ctx.sceneId ?? "?"}"'s narration. Available: ${available}.`,
      );
    }
    return w;
  });

  const first = matched[0];
  const last = matched[matched.length - 1];
  const base = anchor.edge === "exit" ? last.endFrame : first.startFrame;
  const offset = anchor.offsetFrames ?? 0;
  return clamp(Math.round(base + offset), 0, ctx.sceneDurationInFrames);
}

/**
 * @typedef {object} TimingAnchorCtx
 * @property {number} sceneDurationInFrames  fully-resolved scene length
 * @property {Record<string, object>=} resolvedAssetsById  pass-1 asset map
 * @property {{durationInFrames?:number, speed?:number, actions?:Array}=} camera
 * @property {Array<=object>=} words  scene-level narration word timing
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
  // Standalone relativeToWord — no relativeToAsset — anchors to the scene's
  // own narration word timing directly. When relativeToAsset IS present,
  // resolveAssetRelative handles relativeToWord against that asset's own
  // resolved word array instead (see its branch above).
  if (anchor.relativeToWord !== undefined) {
    return resolveWordRelative(anchor, ctx);
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
