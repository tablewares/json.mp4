// src/registry/aliasRegistry.js
//
// Central alias registry for the pipeline. Maps a string name to an object
// template (or a function that takes input variables and returns one),
// grouped by category. The registry is injected into pipeline2's resolver:
//   - Written as:   { "$alias": "motion.fadeUpHeavy" }
//   - Resolved to:  { "in": "fadeUp", "out": "fadeOutDown" }  (or whatever the alias expands to)
//
// Two authoring shapes, same as motion's existing alias resolver:
//   1. Bare string:  "$alias": "motion.fadeUp"
//      — when the alias takes no variables, or you want all defaults.
//   2. Object with variables:  { "$alias": "effects.oldComputer", "grayscale": 0.9 }
//      — the extra keys are passed as input vars to the alias function.
//
// The "$alias" key is the reserved discriminator. An alias expansion may
// itself contain "$alias" (chain), to a max depth of 10 (cycle guard).
//
// The registry is deliberately extensible, not hardcoded:
//   - Built-ins are registered at module load (see BUILTIN_ALIASES below).
//   - registerAlias() lets plugins, tests, or future pipeline stages add
//     their own without touching this file.
//   - listAliases() / describeAlias() power the discovery CLI.
//
// No-op when absent: an asset spec with no "$alias" key passes through
// unchanged. resolveAlias returns the input untouched. Every pre-existing
// manifest renders byte-identical.

// -------------------------------------------------------------
// types
// -------------------------------------------------------------

/**
 * @typedef {(vars: Record<string,*> ) => Record<string,*>} AliasFn
 * A function that takes input variables and returns the expanded object.
 */

/**
 * @typedef {object} AliasEntry
 * @property {string} name     — "motion.fadeUp" (category.name)
 * @property {string} category — "motion"
 * @property {string} shortName — "fadeUp"
 * @property {string} description
 * @property {string[]} vars   — declared variable names (for discovery)
 * @property {AliasFn|Record<string,*>} fn — the impl, or a static object
 */

// -------------------------------------------------------------
// registry
// -------------------------------------------------------------

const _aliases = new Map(); // "category.name" → AliasEntry

/**
 * Register one alias. Overwrites an existing name in the same category.
 *
 * @param {string} name          Fully qualified: "motion.fadeUp"
 * @param {AliasFn|Record<string,*>} fn  Static object or (vars) => object
 * @param {object} [meta]
 * @param {string} meta.description
 * @param {string[]} meta.vars  Declared variable names the fn reads
 */
export function registerAlias(name, fn, meta = {}) {
  const dot = name.indexOf(".");
  if (dot === -1) {
    throw new Error(`Alias name "${name}" must be "category.shortName" (e.g. "motion.fadeUp"). Found no dot.`);
  }
  const category = name.slice(0, dot);
  const shortName = name.slice(dot + 1);
  if (!category || !shortName) {
    throw new Error(`Alias "${name}" has empty category or shortName.`);
  }

  _aliases.set(name, {
    name,
    category,
    shortName,
    description: meta.description ?? "",
    vars: meta.vars ?? [],
    // "builtin": registered at module load from the hardcoded map below.
    // "custom": registered by src/registry/aliasLibrary.js from
    // studio/library/aliases/*.json. Surfaced by listAliases/describeAlias
    // so the CLI can show which layer an alias comes from.
    source: meta.source ?? "builtin",
    fn,
  });
}

/**
 * Register many aliases from a flat object: { "cat.name": fn | object }.
 * If the value is a plain object, it's wrapped as a constant-return fn.
 */
export function registerAliases(map, metaMap = {}) {
  for (const [name, fn] of Object.entries(map)) {
    const entryFn = typeof fn === "function" ? fn : () => fn;
    registerAlias(name, entryFn, metaMap[name] ?? {});
  }
}

// -------------------------------------------------------------
// resolution
// -------------------------------------------------------------

const MAX_DEPTH = 10;

/**
 * Looks up one alias by full name and calls it with the given vars.
 * @param {string} name  "motion.fadeUp"
 * @param {Record<string,*>} [vars]
 * @returns {Record<string,*>}
 */
export function resolveAlias(name, vars = {}) {
  const entry = _aliases.get(name);
  if (!entry) {
    throw new Error(`Unknown alias "${name}". Available: ${[..._aliases.keys()].join(", ")}`);
  }
  const out = typeof entry.fn === "function" ? entry.fn(vars) : entry.fn;
  if (out == null || typeof out !== "object") {
    throw new Error(`Alias "${name}" expanded to a non-object (${typeof out}). Must return an object.`);
  }
  return out;
}

/**
 * Walk a value, replacing every `"$alias":` occurrence in any object.
 *
 *   resolveAliasesDeep({ "$alias": "motion.fadeUp" })
 *     → { "in": "fadeUp" }
 *
 *   resolveAliasesDeep({ "$alias": "effects.oldComputer", "grayscale": 0.9 })
 *     → [ { "type": "filter", "grayscale": 0.9, ... }, ... ]
 *
 * The rest of the object's keys (besides "$alias") are passed as the
 * alias's input vars. The expansion result replaces the *	containing
 * object entirely, returning the already-spread target object.*
 *
 * Supports chaining (alias expansions can contain further "$alias"s).
 *
 * @param {any} input  Any JSON value — objects, arrays, primitives pass through.
 * @param {number} [depth]  current chain depth (cycle guard)
 */
export function resolveAliasesDeep(input, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new Error(`"$alias" chain exceeded max depth ${MAX_DEPTH}. Probable cycle.`);
  }

  if (Array.isArray(input)) {
    return input.map((v) => resolveAliasesDeep(v, depth));
  }

  if (input !== null && typeof input === "object") {
    // is the discriminator present?
    if ("$alias" in input) {
      const aliasName = input.$alias;
      if (typeof aliasName !== "string") {
        throw new Error(`"$alias" value must be a string, got ${typeof aliasName}`);
      }
      // extract vars (everything except the discriminator key)
      const vars = {};
      for (const [k, v] of Object.entries(input)) {
        if (k !== "$alias") vars[k] = v;
      }
      const expanded = resolveAlias(aliasName, vars);
      // recurse into the result (chains)
      return resolveAliasesDeep(expanded, depth + 1);
    }

    // otherwise a plain object — recurse into each value (so nested aliases
    // still resolve).
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = resolveAliasesDeep(v, depth);
    }
    return out;
  }

  return input;
}

// -------------------------------------------------------------
// discovery
// -------------------------------------------------------------

/**
 * List every registered alias, grouped by category.
 * Returns { category: [{ name, shortName, description, vars }] }.
 * Pass a category name to filter.
 */
export function listAliases(category) {
  const byCat = {};
  for (const entry of _aliases.values()) {
    if (category && entry.category !== category) continue;
    if (!byCat[entry.category]) byCat[entry.category] = [];
    byCat[entry.category].push({
      name: entry.name,
      shortName: entry.shortName,
      description: entry.description,
      vars: entry.vars,
      source: entry.source,
    });
  }
  return byCat;
}

/**
 * Full info for one alias, including the expanded shape with default vars.
 * If the alias fn throws on an empty-vars lookup (a var is required), the
 * error message is returned in the `error` field rather than thrown.
 */
export function describeAlias(name) {
  const entry = _aliases.get(name);
  if (!entry) {
    throw new Error(`Unknown alias "${name}". Available: ${[..._aliases.keys()].join(", ")}`);
  }
  let expanded = null;
  let error = null;
  try {
    expanded = typeof entry.fn === "function" ? entry.fn({}) : entry.fn;
  } catch (e) {
    error = e.message;
  }
  return {
    name: entry.name,
    category: entry.category,
    shortName: entry.shortName,
    description: entry.description,
    vars: entry.vars,
    source: entry.source,
    expanded,
    error,
  };
}

/**
 * Pluggable for usage from the CLI or introspect: just the list of known
 * category names.
 */
export function listAliasCategories() {
  const cats = new Set();
  for (const entry of _aliases.values()) {
    cats.add(entry.category);
  }
  return [...cats];
}

// -------------------------------------------------------------
// built-in aliases
// -------------------------------------------------------------
//
// motion aliases mirror the exact resolution outcomes motion.js's own
// IN_ALIASES / OUT_ALIASES would produce, so a manifest written with
// `$alias: "motion.fadeIn"` resolves identically to `{ in: "fade" }` and
// the exact same per-frame output.

registerAliases(
  {
    // --- motion: presets for common in/out phase combinations ---
    "motion.fadeIn": (v) => ({
      in: v.direction ? `fade${cap(v.direction)}` : "fade",
    }),
    "motion.fadeInHalf": () => ({ in: { alias: "fade", durationInFrames: 9 } }),
    "motion.fadeInOut": (v) => ({
      in: v.direction ? `fade${cap(v.direction)}` : "fade",
      out: v.outDirection ? `fadeOut${cap(v.outDirection)}` : "fadeOut",
    }),
    "motion.spinIn": (v) => ({
      in: v.in ?? "fade",
      rotateDeg: v.fromDeg ?? 0,
      rotate: { toDeg: (v.toDeg ?? 360), durationInFrames: v.durationInFrames ?? 24, easing: v.easing ?? "easeOut" },
    }),
    "motion.clearIn": (v) => ({
      out: v.out ?? "fadeOut",
      rotateDeg: v.fromDeg ?? v.toDeg ?? 360,
      rotate: { fromDeg: v.fromDeg ?? v.toDeg ?? 360, toDeg: (v.toDeg ?? 0), durationInFrames: v.durationInFrames ?? 24, easing: v.easing ?? "easeIn" },
    }),
    "motion.settle": (v) => ({
      in: { alias: "fadeUp", durationInFrames: v.inDuration ?? 15 },
      rotate: { toDeg: v.toDeg ?? 0, fromDeg: v.fromDeg ?? -8, durationInFrames: v.rotateDuration ?? 12, easing: "easeOut" },
    }),

    // --- camera presets ---
    "camera.dollyIn": (v) => ({
      start: v.startAnchor ?? { position: "center" },
      end: v.endAnchor ?? { position: "center" },
      zoomStartPercent: v.zoomStart ?? 1,
      zoomEndPercent: v.zoomEnd ?? 1.25,
      easeZoom: true,
    }),
    "camera.overshootHold": (v) => ({
      start: v.startAnchor ?? { position: "center" },
      zoomStartPercent: v.zoomStart ?? 1,
      zoomEndPercent: v.zoomEnd ?? 1.15,
      durationInFrames: v.durationInFrames ?? 24,
      actions: v.actionIndex != null ? [{ at: 0.5, anchor: v.startAnchor ?? { position: "center" }, zoomPercent: 1.0 }] : undefined,
    }),
    // Vox-style "swoosh" zoom: snap-in halfway, drift subtly, snap fully in.
    // Three legs sharing one anchor — the first and third legs cover a short
    // `at` window with `easeOut`/`easeIn` (reads as a fast snap), the middle
    // leg covers most of the duration with `linear` (reads as a slow, subtle
    // continued push). Requires easeZoom: true (set here) so the per-action
    // `easing` actually shapes the zoom, not just the anchor pan.
    "camera.swooshSnap": (v) => ({
      easeZoom: true,
      durationInFrames: v.durationInFrames ?? 30,
      actions: [
        { at: 0, anchor: v.anchor ?? { position: "center" }, zoomPercent: v.zoomStart ?? 100, easing: "easeOut" },
        { at: v.snapAt ?? 0.12, anchor: v.anchor ?? { position: "center" }, zoomPercent: v.zoomHalf ?? 130, easing: "linear" },
        { at: v.settleAt ?? 0.88, anchor: v.anchor ?? { position: "center" }, zoomPercent: v.zoomSubtle ?? 140, easing: "easeIn" },
        { at: 1, anchor: v.anchor ?? { position: "center" }, zoomPercent: v.zoomFinal ?? 165, easing: "easeIn" },
      ],
    }),

    // --- effects presets (same shape as the exported helper) ---
    "effects.oldComputer": (v) => [
      {
        type: "filter",
        grayscale: v.grayscale ?? 0.85,
        contrast: v.contrast ?? 1.15,
        brightness: v.brightness ?? 0.85,
        sepia: v.sepia ?? 0.15,
      },
      { type: "grain", intensity: v.grainIntensity ?? 0.45, monochrome: true },
      { type: "scanlines", opacity: v.scanlineOpacity ?? 0.2, lineHeight: v.scanlineHeight ?? 2 },
    ],
    "effects.warmPhoto": (v) => [
      { type: "filter", sepia: v.sepia ?? 0.4, contrast: v.contrast ?? 1.1, brightness: v.brightness ?? 1.05 },
    ],
    "effects.coldMonochrome": (v) => [
      { type: "filter", grayscale: v.grayscale ?? 1, contrast: v.contrast ?? 1.2, brightness: v.brightness ?? 0.9 },
      { type: "scanlines", opacity: v.scanlineOpacity ?? 0.15, lineHeight: 3 },
    ],

    // --- timing presets ---
    "timing.withPreviousExit": (v) => ({
      relativeToAsset: v.assetId,
      edge: "exit",
      offsetFrames: v.offsetFrames ?? 0,
    }),
    "timing.withPreviousEnter": (v) => ({
      relativeToAsset: v.assetId,
      edge: "enter",
      offsetFrames: v.offsetFrames ?? 0,
    }),
    "timing.atCameraAction": (v) => ({
      relativeToCameraAction: v.action ?? 0,
      offsetFrames: v.offsetFrames ?? 0,
    }),
    "timing.nearEnd": (v) => ({
      offsetPercent: v.offsetPercent ?? -10,
    }),

    // --- transition presets ---
    "transition.quickCut": (v) => ({
      type: "default",
      durationInFrames: v.durationInFrames ?? 6,
    }),
    "transition.smoothSlide": (v) => ({
      type: "slideContinuity",
      durationInFrames: v.durationInFrames ?? 24,
      params: v.params ?? {},
    }),
  },
  {
    "motion.fadeIn": {
      description: "Fade-in entrance (directional if 'direction' var is set). Expands to the motion.in alias name.",
      vars: ["direction"],
    },
    "motion.fadeInHalf": {
      description: "Half-duration fade-in — uses 9-frame duration instead of the default 18.",
      vars: [],
    },
    "motion.fadeInOut": {
      description: "Fade-in then fade-out. 'direction' sets the in direction; 'outDirection' the out direction.",
      vars: ["direction", "outDirection"],
    },
    "motion.spinIn": {
      description: "Fade in while rotating from 'fromDeg' (default 0) to 'toDeg' (default 360).",
      vars: ["in", "fromDeg", "toDeg", "durationInFrames", "easing"],
    },
    "motion.clearIn": {
      description: "Fade-out while clearing the spin from 'fromDeg'/'toDeg' (defaults to 360->0).",
      vars: ["out", "fromDeg", "toDeg", "durationInFrames", "easing"],
    },
    "motion.settle": {
      description: "fadeUp entrance + a brief rotate from -8deg to 0 (water 'settle' wobble).",
      vars: ["inDuration", "rotateDuration", "fromDeg", "toDeg"],
    },
    "camera.dollyIn": {
      description: "Slow zoom-in from zoomStartPercent to zoomEndPercent (defaults 1 → 1.25).",
      vars: ["startAnchor", "endAnchor", "zoomStart", "zoomEnd"],
    },
    "camera.overshootHold": {
      description: "Zoom overshoot then hold — zoom in to ~1.15, optional mid-point action pauses to zoom 1.0.",
      vars: ["startAnchor", "zoomStart", "zoomEnd", "durationInFrames", "actionIndex"],
    },
    "camera.swooshSnap": {
      description: "Vox-style camera taste recipe: snap-zoom halfway, subtly continue zooming, then snap fully in. Four actions sharing one anchor; requires easeZoom (set automatically).",
      vars: ["anchor", "zoomStart", "zoomHalf", "zoomSubtle", "zoomFinal", "durationInFrames", "snapAt", "settleAt"],
    },
    "effects.oldComputer": {
      description: "Grainy old computer/CRT look — desaturated, grain, scanlines.",
      vars: ["grayscale", "contrast", "brightness", "sepia", "grainIntensity", "scanlineOpacity", "scanlineHeight"],
    },
    "effects.warmPhoto": {
      description: "Warm, sepia-toned photo filter.",
      vars: ["sepia", "contrast", "brightness"],
    },
    "effects.coldMonochrome": {
      description: "Cold grayscale filter with subtle scanlines.",
      vars: ["grayscale", "contrast", "brightness", "scanlineOpacity"],
    },
    "timing.withPreviousExit": {
      description: "Fires this asset/effect when another asset exits. Provide 'assetId' required.",
      vars: ["assetId", "offsetFrames"],
    },
    "timing.withPreviousEnter": {
      description: "Fires this asset/effect when another asset enters. 'assetId' required.",
      vars: ["assetId", "offsetFrames"],
    },
    "timing.atCameraAction": {
      description: "Fires relative to a camera action. 'action' is the index (number) or id (string).",
      vars: ["action", "offsetFrames"],
    },
    "timing.nearEnd": {
      description: "Legacy offsetPercent form: 0 = scene's last frame; negative = earlier. Default -10.",
      vars: ["offsetPercent"],
    },
    "transition.quickCut": {
      description: "Default transition with a short (6-frame default) duration.",
      vars: ["durationInFrames"],
    },
    "transition.smoothSlide": {
      description: "slideContinuity transition; default 24-frame duration. Pass 'params' for carryAssetId etc.",
      vars: ["durationInFrames", "params"],
    },
  },
);

function cap(s) {
  if (!s || typeof s !== "string") return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
