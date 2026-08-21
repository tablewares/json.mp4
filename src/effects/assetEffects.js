/**
 * Per-asset visual effects — filters/overlays scoped to ONE asset's own box.
 * Distinct from:
 *   - postEffects.js: composition-wide ffmpeg pass, after Remotion renders
 *   - scene.effects (transitionOut effects): freestanding assets positioned
 *     by anchor, not bound to an existing asset's box
 *
 * Same two-phase split as camera.js / motion.js:
 *   resolveAssetEffects()      — pipeline2, authoring-time, JSON-safe descriptor
 *   computeAssetEffectStyle()  — pipeline3, pure render-time CSS/overlay math,
 *                                 no remotion import
 *
 * No-op by default: an asset with no `effects` key resolves to null, and
 * computeAssetEffectStyle(null) returns { filter: undefined, overlays: [] } —
 * every pre-existing manifest renders byte-identical.
 */

const KNOWN_TYPES = new Set(["grain", "scanlines", "filter"]);

function resolveOne(spec, i) {
  if (!spec || typeof spec !== "object") {
    throw new Error(`asset.effects[${i}] must be an object`);
  }
  if (!KNOWN_TYPES.has(spec.type)) {
    throw new Error(
      `Unknown asset effect type "${spec.type}" at effects[${i}]. Available: ${[...KNOWN_TYPES].join(", ")}`,
    );
  }
  switch (spec.type) {
    case "grain":
      return { type: "grain", intensity: spec.intensity ?? 0.35, monochrome: spec.monochrome ?? true };
    case "scanlines":
      return { type: "scanlines", opacity: spec.opacity ?? 0.25, lineHeight: spec.lineHeight ?? 2 };
    case "filter":
      return {
        type: "filter",
        grayscale: spec.grayscale ?? 0,
        contrast: spec.contrast ?? 1,
        brightness: spec.brightness ?? 1,
        sepia: spec.sepia ?? 0,
        blur: spec.blur ?? 0,
        // hueRotateDeg: standard CSS filter function, no token resolution
        // (a plain number, same treatment as contrast/brightness). Combined
        // with sepia(1) upstream this is the well-known "fake color tint via
        // CSS filters alone" recipe — sepia flattens the image to a warm
        // monochrome base, then hue-rotate spins that base hue to whatever
        // target color is wanted. Lets a div-based ImageReveal photo share
        // the same color-normalization vocabulary an SvgImage gets natively
        // via src/svg's SvgShaderFilter (tintFill/hueRotateDeg there too) —
        // see effects.tokenGreen / shader.tokenGreen aliases for the
        // matched-pair worked example.
        hueRotateDeg: spec.hueRotateDeg ?? 0,
      };
    default:
      return spec;
  }
}

/**
 * @param {Array<object>=} effectsSpec  asset.effects from scene.schema.json
 * @returns {Array<object>|null}  null when nothing was authored (strict no-op)
 */
export function resolveAssetEffects(effectsSpec) {
  if (!Array.isArray(effectsSpec) || effectsSpec.length === 0) return null;
  return effectsSpec.map(resolveOne);
}

/**
 * Convenience preset: the "grainy old computer" look — desaturated, slightly
 * high-contrast, dim, visible grain, CRT scanlines. Expands to the same
 * three effect entries a hand-authored `effects: [...]` array would use, so
 * it's just sugar over resolveAssetEffects, not a separate code path.
 *
 *   asset.effects = oldComputerEffectsSpec()   // author-time helper
 */
export function oldComputerEffectsSpec(overrides = {}) {
  return [
    {
      type: "filter",
      grayscale: overrides.grayscale ?? 0.85,
      contrast: overrides.contrast ?? 1.15,
      brightness: overrides.brightness ?? 0.85,
      sepia: overrides.sepia ?? 0.15,
    },
    { type: "grain", intensity: overrides.grainIntensity ?? 0.45, monochrome: true },
    { type: "scanlines", opacity: overrides.scanlineOpacity ?? 0.2, lineHeight: overrides.scanlineHeight ?? 2 },
  ];
}

function buildCssFilter(resolvedEffects) {
  const f = resolvedEffects.find((e) => e.type === "filter");
  if (!f) return undefined;
  const parts = [];
  if (f.grayscale) parts.push(`grayscale(${f.grayscale})`);
  if (f.sepia) parts.push(`sepia(${f.sepia})`);
  if (f.hueRotateDeg) parts.push(`hue-rotate(${f.hueRotateDeg}deg)`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
  if (f.blur) parts.push(`blur(${f.blur}px)`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Render-time (pure, no remotion import). Returns a CSS `filter` string for
 * the asset's own wrapper, plus overlay descriptors the renderer paints as
 * absolutely-positioned children INSIDE that same wrapper — so grain/
 * scanlines are clipped to exactly that asset's box, never bleeding onto
 * neighboring assets.
 *
 * @param {Array|null} resolvedEffects  output of resolveAssetEffects()
 */
export function computeAssetEffectStyle(resolvedEffects) {
  if (!resolvedEffects || resolvedEffects.length === 0) {
    return { filter: undefined, overlays: [] };
  }
  return {
    filter: buildCssFilter(resolvedEffects),
    overlays: resolvedEffects.filter((e) => e.type === "grain" || e.type === "scanlines"),
  };
}
