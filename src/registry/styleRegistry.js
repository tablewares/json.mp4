/**
 * Global style registry resolution. A value anywhere in a scene/asset can be:
 *  - a token string ("shade1") that must exist in styles.colors / styles.easing / etc
 *  - a literal object/value, used as-is (rare, one-off escape hatch)
 *
 * Resolution always prefers: assetStyleOverride > sceneOverride > registry default.
 */

export function resolveColorToken(styles, tokenOrLiteral) {
  if (typeof tokenOrLiteral !== "string") return tokenOrLiteral;
  // Pass through a literal hex color (#RRGGBB or #RRGGBBAA) untouched —
  // matches the `tokenOrLiteral` definition in scene.schema.json: a value
  // is either a style registry token (e.g. "shade1") OR a raw hex string.
  // Without this, any asset-style key containing "color" that's authored
  // with a literal hex (#EA3943) instead of a token fails at resolve with
  // "Unknown color token", even though the schema permits the literal.
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(tokenOrLiteral.trim())) {
    return tokenOrLiteral;
  }
  const value = styles.colors[tokenOrLiteral];
  if (!value) {
    throw new Error(
      `Unknown color token "${tokenOrLiteral}". Known tokens: ${Object.keys(styles.colors).join(", ")}`
    );
  }
  return value;
}

export function resolveTypographyToken(styles, tokenName) {
  const typo = styles.typography[tokenName];
  if (!typo) {
    throw new Error(
      `Unknown typography token "${tokenName}". Known tokens: ${Object.keys(styles.typography).join(", ")}`
    );
  }
  return {
    ...typo,
    color: typo.colorToken ? resolveColorToken(styles, typo.colorToken) : undefined,
  };
}

export function resolveEasingToken(styles, tokenName) {
  if (!styles.easing?.[tokenName]) {
    throw new Error(`Unknown easing token "${tokenName}"`);
  }
  return styles.easing[tokenName];
}

/**
 * Texture tokens resolve to a path relative to public/ (consumed by Remotion's
 * staticFile() at render time). As with colors, a literal non-string value is
 * passed through untouched — the escape hatch for ad-hoc textures.
 */
export function resolveTextureToken(styles, tokenOrLiteral) {
  if (typeof tokenOrLiteral !== "string") return tokenOrLiteral;
  const value = styles.textures?.[tokenOrLiteral];
  if (!value) {
    const known = styles.textures ? Object.keys(styles.textures).join(", ") : "(no textures section)";
    throw new Error(`Unknown texture token "${tokenOrLiteral}". Known tokens: ${known}`);
  }
  return value;
}

/**
 * Merges an asset's styleOverride against the global registry. Any field the
 * override doesn't specify falls through to the registry default for that
 * asset type (assetManifest.defaultStyle), which itself is usually expressed
 * in tokens.
 */
export function resolveAssetStyle(styles, assetManifest, styleOverride = {}) {
  const merged = { ...(assetManifest.defaultStyle ?? {}), ...styleOverride };
  const resolved = {};
  for (const [key, value] of Object.entries(merged)) {
    if (key.toLowerCase().includes("color") && typeof value === "string") {
      resolved[key] = resolveColorToken(styles, value);
    } else if (key === "typography" && typeof value === "string") {
      resolved[key] = resolveTypographyToken(styles, value);
    } else if (key === "easing" && typeof value === "string") {
      resolved[key] = resolveEasingToken(styles, value);
    } else if (key.toLowerCase().includes("texture") && typeof value === "string") {
      resolved[key] = resolveTextureToken(styles, value);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
