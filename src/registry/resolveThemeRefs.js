/**
 * Resolves "$<source>.<dot.path>" string references anywhere in a raw
 * scene/manifest tree into a concrete value pulled from an already-loaded
 * JSON source — theme.json (styles) treated as a read-only "environment"
 * an agent can point into by path, instead of re-typing literal values or
 * guessing new ones.
 *
 * Distinct from styleRegistry.js's token resolution (resolveColorToken /
 * resolveTypographyToken / etc), which only fires on known field-name
 * conventions ("...color...", "typography", "easing", "...texture...").
 * This resolver has no opinion about which field it's in — a "$theme.*"
 * reference works whether it's a styleOverride.strokeColor, a physics
 * spec's restitution number, or a whole physics/camera/motion object three
 * levels deep. Both mechanisms coexist: styleRegistry.js still resolves a
 * plain token string like "accentRed" for color-keyed fields; $theme.* is
 * for everything that convention doesn't cover.
 *
 * Runs BEFORE schema validation (see validateScene.js), unlike $alias
 * (which resolve.js expands at pipeline2, after validation). This is
 * deliberate: $alias only ever needs to pass ajv where the schema already
 * carves out room for it (e.g. motionInPhase's `alias` property). $theme /
 * $physics references need to be able to stand in for a WHOLE typed value
 * — a full assetPhysicsSpec object in place of the `physics` field — and
 * ajv must never see the unexpanded string.
 *
 * Strict no-op: an input tree with no "$<source>." string anywhere is
 * walked and rebuilt but produces byte-identical content.
 */

const REF_PATTERN = /^\$([a-zA-Z0-9_]+)\.(.+)$/;

function getAtPath(root, dotPath, sourceLabel, fullRef) {
  const parts = dotPath.split(".");
  let cur = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object" || !(part in cur)) {
      throw new Error(
        `Unresolvable reference "${fullRef}": "${sourceLabel}.${dotPath}" — "${part}" not found. ` +
          `Available at that level: ${
            cur && typeof cur === "object" ? Object.keys(cur).join(", ") : "(nothing — path ended early)"
          }`,
      );
    }
    cur = cur[part];
  }
  return cur;
}

/**
 * @param {any} input     any JSON value from a raw (pre-validate) scene/manifest
 * @param {Record<string, object>} sources  e.g. { theme: styles, physics: physicsPresets, config }
 * @returns {any}  same shape, every "$source.path" string replaced by the
 *   value at that path in sources[source]. Objects/arrays returned by a
 *   reference are deep-cloned so the resolved output can never alias back
 *   to the shared source object (theme.json/presets are loaded once and
 *   reused across every scene in the project).
 */
export function resolveThemeRefsDeep(input, sources = {}) {
  if (Array.isArray(input)) {
    return input.map((v) => resolveThemeRefsDeep(v, sources));
  }
  if (input !== null && typeof input === "object") {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = resolveThemeRefsDeep(v, sources);
    }
    return out;
  }
  if (typeof input === "string") {
    const m = REF_PATTERN.exec(input);
    if (!m) return input;
    const [, sourceLabel, dotPath] = m;
    const source = sources[sourceLabel];
    if (!source) {
      throw new Error(
        `Unresolvable reference "${input}": unknown source "${sourceLabel}". ` +
          `Available sources: ${Object.keys(sources).join(", ") || "(none configured)"}`,
      );
    }
    const value = getAtPath(source, dotPath, sourceLabel, input);
    return JSON.parse(JSON.stringify(value));
  }
  return input;
}
