/**
 * Composition plugin: flags films where the scene composition is too
 * repetitive. Unlike overlap_warn.js (which only ever console.warns), this
 * plugin defaults to severity "error" — enforceCompositionPlugins() throws
 * when it fires, aborting resolve/render. The intent is to make an
 * LLM-driven authoring loop *stop* and vary background/composition/camera/
 * transition instead of silently shipping a sequence of near-identical
 * shots.
 *
 * This intentionally does NOT compare asset content (text strings, image
 * paths) — two scenes both showing a single KineticText over shade1 with a
 * static camera are "the same shot" even if the words differ. That's the
 * whole point: it's a composition/blocking check, not a content check.
 *
 * --------------------------------------------------------------------------
 * What's it actually calibrated on
 * --------------------------------------------------------------------------
 * The reference "bad" project is `studio/manifest/inflation-basics`: seven
 * scenes, each a single centered `KineticText` with `width:900`, no camera,
 * alternating `shade1`/`shade2` backgrounds and `WhipPan`/`pivotZoom`
 * transitions. A viewer reads that as the same shot seven times in a row.
 *
 * The original version of this plugin computed *one* big per-scene
 * signature (background||assetTypes||camera||transition joined together)
 * and only flagged *contiguous runs of exact-equal full signatures*.
 * Alternating two backgrounds and two transitions was enough to make every
 * adjacent pair differ on the joined key, so the run never accumulated past
 * 1 and inflation-basics sailed through with zero findings — exactly the
 * failure mode it was written to stop.
 *
 * The fix is twofold, and both halves are what make inflation-basics fire
 * while the genuinely-varied `inflation-causes-us` project stays clean:
 *
 *   1. Per-attribute "diversity" floor. Count how many distinct signature
 *      *values* each enabled attribute takes across the whole film. If any
 *      attribute's distinct-value count is below its `minDistinct` floor,
 *      that's a finding — "the whole film only ever shows one camera motion"
 *      or "every shot is a lone KineticText". This is what inflation-basics
 *      trips on (1 distinct asset-type set, 1 distinct camera), and what
 *      inflation-causes-us clears (4 distinct asset-type sets, a mix of
 *      camera-present/camera-absent, 2 distinct backgrounds).
 *
 *   2. Per-attribute consecutive-run ratchet. The longest contiguous streak
 *      of identical per-attribute signatures longer than `maxConsecutive`
 *      is its own finding. This is the "back-to-back" check the original was
 *      after, but done *per attribute* so alternating a second attribute no
 *      longer cancels it. A real three-in-a-row of the same background —
 *      even if the camera keeps changing — still trips.
 *
 * Both halves give per-attribute findings, so the report tells the author
 * *which* axis to vary, and (thanks to assertion #1) alternation that is
 * purely decorative — two near-identical dark shades, two brand
 * transitions — no longer masquerades as diversity.
 */

const DEFAULT_OPTIONS = {
  // --- diversity floor (whole-film, per attribute) ---------------------
  // When the film has at least `minScenesToEnforceDiversity` scenes, each
  // enabled attribute must take at least `minDistinct` distinct signature
  // *values* overall — or it's a finding.
  //
  // Calibration: `minDistinct: 3` is what makes inflation-basics trip on
  // asset types (1 distinct: a lone KineticText every scene) and on camera
  // (1 distinct: never moves), while inflation-causes-us clears (4 distinct
  // asset-type sets; a mix of static + several different zoom moves).
  //
  // Background and transition are gentler by default because a tight two-tone
  // palette (shade1/shade2) and a `default`-cut rhythm are legitimate
  // documentary choices — see `backgroundMinDistinct` /
  // `transitionMinDistinct` below.
  minDistinct: 3,                  // asset types & camera use this floor
  backgroundMinDistinct: 2,         // 2-tone documentary palette is OK
  transitionMinDistinct: 2,        // cut + one hero transition is OK
  // Only enforce the diversity floor this many scenes in or more. A short
  // 2-3 scene sequence can't realistically hit minDistinct=3, so don't beat
  // up teasers/intros.
  minScenesToEnforceDiversity: 4,
  // inflation-basics alternates shade1/shade2 which are visually the same
  // dark family. When true, near-identical dark plain colours are treated as
  // ONE diversity bucket (so two alternating darks don't paper over a
  // missing background variety), while remaining distinct for the stricter
  // consecutive-run ratchet (a genuine multi-in-a-row of the same swatch
  // still trips there). See `darkShadeFamily()` for the threshold.
  groupNearbyShadeBackgrounds: true,

  // --- consecutive-run ratchet (per attribute) --------------------------
  // Longest allowed contiguous run of identical per-attribute signatures
  // before it's a finding. Same semantics as the original
  // maxConsecutiveSimilar but applied per-attribute.
  //
  // Calibration: `4` lets a documentary pace sustain a repeated lockup for
  // ~4 beats (intro..cost-push sharing a background in inflation-causes-us)
  // without tripping, while the 7-scene strangle of identical asset-types
  // and identical (absent) camera in inflation-basics fires hard.
  // 4 means "four in a row is fine, five in a row is not."
  maxConsecutiveSimilar: 4,

  // --- common -----------------------------------------------------------
  // "error" -> enforceCompositionPlugins() throws (blocks resolve/render).
  // "warn"  -> logged via console.warn, resolve/render proceeds. Useful
  // while iterating before promoting to "error" for a final pass.
  //
  // We split severities per attribute so the *blocking* signals are the
  // ones that distinguish a fundamentally repetitive film (inflation-basics:
  // never-varying subject + never-moving camera) from things that are
  // merely a tight aesthetic (inflation-causes-us: a 2-tone palette). The
  // background breaches default to "warn" — a real observation the author
  // can choose to ignore — while subject (asset type) and motion (camera)
  // breaches block.
  severity: "error",
  backgroundSeverity: "warn",
  assetTypesSeverity: "error",   // overrides `severity` for the asset-type findings
  cameraSeverity: "error",       // overrides `severity` for the camera findings
  transitionSeverity: "error",   // overrides `severity` for transition findings
  compareBackground: true,
  compareAssetTypes: true,
  compareCamera: true,
  compareTransition: true,
};

/** Resolve null/undefined/missing background to a canonical 'none' token. */
function bgColorString(bg) {
  if (bg == null) return null;
  if (typeof bg === "string") return bg;
  return bg.color ?? null;
}

/** Hex color -> [r,g,b] or null. */
function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** @returns {{h:number,s:number,l:number}|null}  h,s,l in 0..1 (l in 0..1) */
function hsl(rgb) {
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: h / 360, s, l };
}

/**
 * "Dark documentary shade" family — the shade1/shade2 visual family that
 * inflation-basics rotates between (and which inflation-causes-us also leans
 * on). Two colours in this family collapse to one background diversity bucket
 * because viewers register them as the same look. Concretely: very low
 * lightness + very low saturation (so a near-black/tinted-black pair reads
 * as "the dark stage" regardless of which exact hex).
 */
function darkShadeFamily(hex) {
  const rgb = hexRgb(hex);
  if (!rgb) return null;
  const { l, s } = hsl(rgb);
  if (l <= 0.20 && s <= 0.18) return "darkshade";
  return null;
}

/** Near-identical dark documentary shades (e.g. shade1/shade2 in
 *  inflation-basics) collapse to ONE bucket when
 *  groupNearbyShadeBackgrounds is on, so alternating them doesn't paper
 *  over a missing background variety. Stays distinct for the strict
 *  consecutive-run ratchet (a genuine multi-in-a-row of the same swatch
 *  still trips there). */
function backgroundDiversityBucket(scene, options) {
  const bg = scene.background;
  if (bg == null) return "none";
  if (typeof bg === "string") {
    if (options?.groupNearbyShadeBackgrounds && darkShadeFamily(bg)) return "darkshade";
    return `color:${bg}`;
  }
  if (bg.texturePath) return `color:${bg.color ?? ""}|texture:${bg.texturePath}`;
  const c = bg.color ?? "";
  if (options?.groupNearbyShadeBackgrounds && darkShadeFamily(c)) return "darkshade";
  return `color:${c}|blend:${bg.blendMode ?? ""}`;
}

function backgroundSignature(scene) {
  const bg = scene.background;
  if (bg == null) return "none";
  if (typeof bg === "string") return `color:${bg}`;
  return `color:${bg.color ?? ""}|texture:${bg.texturePath ?? ""}|blend:${bg.blendMode ?? ""}`;
}

function assetTypeSignature(scene) {
  return (scene.assets ?? [])
    .map((a) => a.assetType)
    .sort()
    .join(",");
}

function cameraSignature(scene) {
  const cam = scene.camera;
  if (!cam) return "static";
  const path = (cam.actions ?? [])
    .map((a) => (a.anchor?.followAssetId ? `follow:${a.anchor.followAssetId}` : a.anchor?.position ?? "?"))
    .join(">");
  const zoom = (cam.actions ?? []).map((a) => a.zoomPercent).join(">");
  return `${path}|zoom:${zoom}`;
}

function transitionSignature(scene) {
  return scene.transitionOut?.type ?? "cut";
}

/**
 * @param {object} scene
 * @param {object} options  full merged options (compare* + minDistinct + ...)
 * @returns {{attr:string, sig:string}[]}  list of enabled per-attribute
 *   signatures for one scene.
 */
function attributeSignatures(scene, options) {
  const out = [];
  if (options.compareBackground) out.push({ attr: "background", sig: backgroundSignature(scene) });
  if (options.compareAssetTypes) out.push({ attr: "assetTypes", sig: assetTypeSignature(scene) });
  if (options.compareCamera) out.push({ attr: "camera", sig: cameraSignature(scene) });
  if (options.compareTransition) out.push({ attr: "transition", sig: transitionSignature(scene) });
  return out;
}

const ATTRIBUTE_LABELS = {
  background: "background",
  assetTypes: "which asset types are on screen",
  camera: "camera movement",
  transition: "outgoing transition",
};

const ATTRIBUTE_VARIES = {
  background: "background color/texture",
  assetTypes: "which asset types appear (not the text/image content, just the set)",
  camera: "camera motion (or add a camera to static-only scenes)",
  transition: "outgoing transition style",
};

function describeComparator(options) {
  return [
    ["background", options.compareBackground],
    ["assetTypes", options.compareAssetTypes],
    ["camera", options.compareCamera],
    ["transition", options.compareTransition],
  ]
    .filter(([, on]) => on)
    .map(([a]) => ATTRIBUTE_LABELS[a])
    .join(", ");
}

/** Per-attribute distinct-value floor used in the diversity check. */
function minDistinctFor(attr, options) {
  if (attr === "background") return options.backgroundMinDistinct ?? options.minDistinct;
  if (attr === "transition") return options.transitionMinDistinct ?? options.minDistinct;
  return options.minDistinct;
}
function severityFor(attr, options) {
  if (attr === "background") return options.backgroundSeverity ?? options.severity;
  if (attr === "assetTypes") return options.assetTypesSeverity ?? options.severity;
  if (attr === "camera") return options.cameraSeverity ?? options.severity;
  if (attr === "transition") return options.transitionSeverity ?? options.severity;
  return options.severity;
}

/** whole-film diversity check — see the header doc. */
function diversityFindings(resolvedScenes, options) {
  if (resolvedScenes.length < options.minScenesToEnforceDiversity) return [];

  // Per-attribute set of distinct diversity-bucket values. For background,
  // use the luma/shade bucket so alternating near-identical darks collapse.
  const attrFns = {
    background: (s) => backgroundDiversityBucket(s, options),
    assetTypes: assetTypeSignature,
    camera: cameraSignature,
    transition: transitionSignature,
  };
  const distinctByAttr = {};
  for (const attr of Object.keys(attrFns)) {
    if (!options[`compare${attr[0].toUpperCase() + attr.slice(1)}`]) continue;
    distinctByAttr[attr] = new Set();
  }
  for (const s of resolvedScenes) {
    for (const attr of Object.keys(distinctByAttr)) {
      distinctByAttr[attr].add(attrFns[attr](s));
    }
  }

  const findings = [];
  for (const [attr, set] of Object.entries(distinctByAttr)) {
    const n = set.size;
    const floor = minDistinctFor(attr, options);
    if (n < floor) {
      findings.push({
        plugin: name,
        severity: severityFor(attr, options),
        sceneIds: resolvedScenes.map((s) => s.id),
        message:
          `Whole-film diversity floor breached for "${ATTRIBUTE_LABELS[attr]}": only ${n} distinct ` +
          (n === 1 ? "value occurs" : "values occur") +
          ` across all ${resolvedScenes.length} scenes (minDistinct: ${floor}). ` +
          `Vary ${ATTRIBUTE_VARIES[attr]} between scenes — even outright alternation ` +
          (attr === "background" && options.groupNearbyShadeBackgrounds
            ? "of near-identical dark shades doesn't count as variety. "
            : "") +
          `Reference failure case: studio/manifest/inflation-basics.`,
      });
    }
  }
  return findings;
}

/** contiguous-run ratchet, per attribute. */
function consecutiveRunFindings(resolvedScenes, options) {
  const enabledAttrs = Object.entries({
    background: options.compareBackground,
    assetTypes: options.compareAssetTypes,
    camera: options.compareCamera,
    transition: options.compareTransition,
  })
    .filter(([, on]) => on)
    .map(([attr]) => attr);

  if (enabledAttrs.length === 0 || resolvedScenes.length === 0) return [];

  const max = options.maxConsecutiveSimilar;
  const findings = [];

  for (const attr of enabledAttrs) {
    const sigs = resolvedScenes.map((s) => {
      switch (attr) {
        case "background": return backgroundSignature(s);
        case "assetTypes": return assetTypeSignature(s);
        case "camera": return cameraSignature(s);
        case "transition": return transitionSignature(s);
        default: return "?";
      }
    });

    let runStart = 0;
    for (let i = 1; i <= sigs.length; i += 1) {
      const prev = sigs[i - 1];
      const cur = i < sigs.length ? sigs[i] : null;
      const runContinues = cur !== null && cur === prev;
      if (!runContinues) {
        const runLength = i - runStart;
        if (runLength > max) {
          const sceneIds = resolvedScenes.slice(runStart, i).map((s) => s.id);
          findings.push({
            plugin: name,
            severity: severityFor(attr, options),
            sceneIds,
            message:
              `Scenes [${sceneIds.join(", ")}] repeat the same ${ATTRIBUTE_LABELS[attr]} ${runLength} times in a row ` +
              `(limit: ${max}). Vary ${ATTRIBUTE_VARIES[attr]} at least once inside that run.`,
          });
        }
        runStart = i;
      }
    }
  }
  return findings;
}

export const name = "similarSceneGuard";

/**
 * @param {Array} resolvedScenes  fully pass-2-resolved scenes (transitionOut
 *   must already be bundled — called after resolve.js's pass-2 loop)
 * @param {object} ctx            reserved for future cross-plugin context
 * @param {Partial<typeof DEFAULT_OPTIONS>} rawOptions
 * @returns {Array<{plugin:string, severity:string, sceneIds:string[], message:string}>}
 */
export function run(resolvedScenes, ctx = {}, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };

  const findings = [];
  findings.push(...diversityFindings(resolvedScenes, options));
  findings.push(...consecutiveRunFindings(resolvedScenes, options));

  return findings;
}

// exported for tests / ProjectBuilder introspection.
export const DEFAULTS = DEFAULT_OPTIONS;
export const _internals = {
  backgroundSignature,
  backgroundDiversityBucket,
  assetTypeSignature,
  cameraSignature,
  transitionSignature,
  attributeSignatures,
  diversityFindings,
  consecutiveRunFindings,
  darkShadeFamily,
  hexRgb,
  hsl,
  minDistinctFor,
  severityFor,
  ATTRIBUTE_LABELS,
  ATTRIBUTE_VARIES,
  describeComparator,
};
