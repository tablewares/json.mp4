/**
 * Owns entrance/exit/rotation motion math for scene assets — same split as
 * camera.js: resolveMotion() runs at pipeline2 (authoring-time, produces a
 * JSON-safe descriptor for resolved.json), computeMotionTransform() runs at
 * pipeline3 (Composition.jsx, pure per-frame math, no remotion import).
 *
 * No-op by default: an asset with no `motion` key resolves to null, and
 * computeMotionTransform(null, ...) returns the identity transform — every
 * pre-existing manifest renders byte-identical.
 */

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;

const EASINGS = {
  linear: (t) => t,
  easeIn: easeInCubic,
  easeOut: easeOutCubic,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

const DEFAULT_DISTANCE_PX = 80;
const DEFAULT_DURATION_IN_FRAMES = 18;

// direction -> unit offset (multiplied by distancePx). "up" means: for an
// entrance, the asset STARTS below its anchored position (positive Y) and
// rises to 0 — i.e. "fadeUp" fades the asset up into place. The same table
// is reused for exits; computeMotionTransform flips the sign so "fadeOutUp"
// travels upward and away as it leaves.
const DIRECTION_OFFSETS = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};

const IN_ALIASES = {
  none: { fade: false, direction: null },
  fade: { fade: true, direction: null },
  fadeUp: { fade: true, direction: "up" },
  fadeDown: { fade: true, direction: "down" },
  fadeLeft: { fade: true, direction: "left" },
  fadeRight: { fade: true, direction: "right" },
};

const OUT_ALIASES = {
  none: { fade: false, direction: null },
  fadeOut: { fade: true, direction: null },
  fadeOutUp: { fade: true, direction: "up" },
  fadeOutDown: { fade: true, direction: "down" },
  fadeOutLeft: { fade: true, direction: "left" },
  fadeOutRight: { fade: true, direction: "right" },
};

function normalizePhase(preset, overrides) {
  const distancePx = overrides.distancePx ?? DEFAULT_DISTANCE_PX;
  const durationInFrames = overrides.durationInFrames ?? DEFAULT_DURATION_IN_FRAMES;
  const dir = preset.direction ? DIRECTION_OFFSETS[preset.direction] : { x: 0, y: 0 };

  return {
    fade: preset.fade ?? true,
    translateXFrom: dir.x * distancePx,
    translateYFrom: dir.y * distancePx,
    rotateFromDeg: overrides.rotateFromDeg ?? 0,
    durationInFrames,
  };
}

function resolvePhase(raw, aliasTable, phaseLabel) {
  if (raw == null) return null; // no-op: phase not authored

  if (typeof raw === "string") {
    const preset = aliasTable[raw];
    if (!preset) {
      throw new Error(
        `Unknown motion.${phaseLabel} alias "${raw}". Available: ${Object.keys(aliasTable).join(", ")}`,
      );
    }
    return normalizePhase(preset, {});
  }

  if (typeof raw === "object") {
    const preset = raw.alias
      ? aliasTable[raw.alias]
      : { fade: raw.fade ?? true, direction: raw.direction ?? null };
    if (raw.alias && !preset) {
      throw new Error(
        `Unknown motion.${phaseLabel} alias "${raw.alias}". Available: ${Object.keys(aliasTable).join(", ")}`,
      );
    }
    return normalizePhase(preset, raw);
  }
  throw new Error(`motion.${phaseLabel} must be a string alias or an object, got ${typeof raw}`);
}

/**
 * Normalizes motion.rotate — an independently-animated rotation phase,
 * distinct from the transient rotateFromDeg offsets in/out phases carry.
 * `staticRotateDeg` (motion.rotateDeg, default 0) is used as the default
 * `fromDeg` when the author doesn't specify one, so `{ rotate: { toDeg: 15 } }`
 * alone reads as "spin from resting orientation to 15deg".
 */
function resolveRotatePhase(raw, staticRotateDeg) {
  if (raw == null) return null;
  if (typeof raw !== "object") {
    throw new Error(`motion.rotate must be an object, got ${typeof raw}`);
  }
  if (typeof raw.toDeg !== "number") {
    throw new Error(`motion.rotate requires a numeric "toDeg"`);
  }
  const easingName = raw.easing ?? "easeInOut";
  if (!EASINGS[easingName]) {
    throw new Error(`Unknown motion.rotate.easing "${easingName}". Available: ${Object.keys(EASINGS).join(", ")}`);
  }
  const startAt = raw.startAt ?? "afterIn";
  if (!["afterIn", "withIn", "atFrame"].includes(startAt)) {
    throw new Error(`Unknown motion.rotate.startAt "${startAt}". Available: afterIn, withIn, atFrame`);
  }
  if (startAt === "atFrame" && typeof raw.atFrame !== "number") {
    throw new Error(`motion.rotate.startAt "atFrame" requires a numeric "atFrame"`);
  }

  return {
    fromDeg: raw.fromDeg ?? staticRotateDeg,
    toDeg: raw.toDeg,
    durationInFrames: raw.durationInFrames ?? DEFAULT_DURATION_IN_FRAMES,
    delayFrames: raw.delayFrames ?? 0,
    startAt,
    atFrame: raw.atFrame ?? null,
    easingName,
  };
}

/**
 * Authoring-time resolver — called from resolveScene.js's per-asset map,
 * alongside resolveAnchor()/resolveAssetStyle()/resolveCamera().
 *
 * @param {{
 *   in?: string|object,
 *   out?: string|object,
 *   rotateDeg?: number,      // static base rotation, held before/without an animated `rotate` phase
 *   rotate?: {               // animated rotation phase
 *     fromDeg?: number, toDeg: number, durationInFrames?: number,
 *     delayFrames?: number, startAt?: 'afterIn'|'withIn'|'atFrame',
 *     atFrame?: number, easing?: 'linear'|'easeIn'|'easeOut'|'easeInOut',
 *   },
 * }} motionSpec
 * @returns {object|null} null when nothing was authored (strict no-op)
 */
export function resolveMotion(motionSpec) {
  if (!motionSpec) return null;

  const inPhase = resolvePhase(motionSpec.in, IN_ALIASES, "in");
  const outPhase = resolvePhase(motionSpec.out, OUT_ALIASES, "out");
  const staticRotateDeg = typeof motionSpec.rotateDeg === "number" ? motionSpec.rotateDeg : 0;
  const rotatePhase = resolveRotatePhase(motionSpec.rotate, staticRotateDeg);

  if (!inPhase && !outPhase && staticRotateDeg === 0 && !rotatePhase) return null;
  return { in: inPhase, out: outPhase, staticRotateDeg, rotate: rotatePhase };
}

/**
 * Scene-local frame the animated rotate phase begins at.
 *   - "afterIn" (default): enterAtFrame + the `in` phase's own duration (0
 *     if there's no `in` phase) + delayFrames. This is what makes rotation
 *     resolve AFTER the asset has moved/faded into the scene: by the time
 *     rotation starts, the in-phase's translateX/Y contribution is already
 *     back to 0, so the visible motion is a clean in-place spin, not a
 *     spin-while-still-sliding blend.
 *   - "withIn": starts at enterAtFrame + delayFrames, running concurrently
 *     with the entrance motion.
 *   - "atFrame": starts at the explicit scene-local atFrame + delayFrames.
 */
function resolveRotateStartFrame(rotatePhase, enterAtFrame, inPhase) {
  if (rotatePhase.startAt === "atFrame") {
    return rotatePhase.atFrame + rotatePhase.delayFrames;
  }
  if (rotatePhase.startAt === "withIn") {
    return enterAtFrame + rotatePhase.delayFrames;
  }
  const inDuration = inPhase?.durationInFrames ?? 0;
  return enterAtFrame + inDuration + rotatePhase.delayFrames;
}

/**
 * Render-time per-frame transform. `frame` is scene-local (same axis as
 * timing.enterAtFrame/exitAtFrame).
 *
 * Rotation is composed from two layers:
 *   1. `baseRotateDeg` — either the flat `staticRotateDeg`, or, when a
 *      `rotate` phase is authored, an eased fromDeg->toDeg animation that
 *      starts at `resolveRotateStartFrame()` and holds at toDeg afterward.
 *   2. Transient in/out offsets (`rotateFromDeg`) layered additively on
 *      top, exactly as before — e.g. a "fadeUp" entrance that also wants a
 *      slight settle-rotation independent of the standalone `rotate` phase.
 *
 * @param {object|null} resolvedMotion  output of resolveMotion()
 * @param {number} frame
 * @param {{enterAtFrame:number, exitAtFrame:number}} timing
 * @returns {{opacity:number, translateX:number, translateY:number, rotateDeg:number}}
 */
export function computeMotionTransform(resolvedMotion, frame, timing) {
  const identity = { opacity: 1, translateX: 0, translateY: 0, rotateDeg: 0 };
  if (!resolvedMotion) return identity;

  const { in: inPhase, out: outPhase, staticRotateDeg, rotate: rotatePhase } = resolvedMotion;
  const enterAtFrame = timing?.enterAtFrame ?? 0;
  const exitAtFrame = timing?.exitAtFrame ?? enterAtFrame;

  let opacity = 1;
  let translateX = 0;
  let translateY = 0;

  let baseRotateDeg = staticRotateDeg;
  if (rotatePhase) {
    const rotateStartFrame = resolveRotateStartFrame(rotatePhase, enterAtFrame, inPhase);
    if (frame < rotateStartFrame) {
      baseRotateDeg = rotatePhase.fromDeg;
    } else {
      const t = clamp01((frame - rotateStartFrame) / Math.max(rotatePhase.durationInFrames, 1));
      const eased = EASINGS[rotatePhase.easingName](t);
      baseRotateDeg = rotatePhase.fromDeg + (rotatePhase.toDeg - rotatePhase.fromDeg) * eased;
    }
  }

  let rotateDeg = baseRotateDeg;

  if (inPhase) {
    if (frame < enterAtFrame) {
      opacity = inPhase.fade ? 0 : 1;
      translateX = inPhase.translateXFrom;
      translateY = inPhase.translateYFrom;
      rotateDeg = baseRotateDeg + inPhase.rotateFromDeg;
    } else {
      const t = clamp01((frame - enterAtFrame) / Math.max(inPhase.durationInFrames, 1));
      const eased = easeOutCubic(t);
      opacity = inPhase.fade ? eased : 1;
      translateX = inPhase.translateXFrom * (1 - eased);
      translateY = inPhase.translateYFrom * (1 - eased);
      rotateDeg = baseRotateDeg + inPhase.rotateFromDeg * (1 - eased);
    }
  }

  if (outPhase) {
    const outStart = exitAtFrame - outPhase.durationInFrames;
    if (frame >= outStart) {
      const t = clamp01((frame - outStart) / Math.max(outPhase.durationInFrames, 1));
      const eased = easeInCubic(t);
      opacity = Math.min(opacity, outPhase.fade ? 1 - eased : 1);
      translateX += outPhase.translateXFrom * eased * -1;
      translateY += outPhase.translateYFrom * eased * -1;
      rotateDeg += outPhase.rotateFromDeg * eased;
    }
  }

  return { opacity, translateX, translateY, rotateDeg };
}
