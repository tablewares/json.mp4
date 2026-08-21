import React from "react";

/**
 * Shared SVG-native "shader" pipeline for SVG-based assets — a real SVG
 * `<filter>` graph (feColorMatrix/feComponentTransfer/feGaussianBlur/
 * feFlood/feComposite/feBlend), not the CSS-`filter` string the existing
 * per-asset `effects[]` system (`src/effects/assetEffects.js`) already
 * offers. Reach for THIS when an SVG-drawn asset wants tone/tint/glow
 * baked into its own render graph rather than a post-hoc CSS filter on the
 * wrapper div — e.g. a glow halo that reads the actual traced silhouette
 * shape (see `useAlphaSilhouette` in `boundaryDrawer.jsx`), which a CSS
 * `drop-shadow` on a transparent-background image can't cheaply reproduce.
 *
 * === Literal-value contract ===
 * Every field here (`blur`, `brightness`, `contrast`, `saturate`,
 * `hueRotateDeg`, `tintFill`, `tintStrength`, `glowFill`, `glowStrength`,
 * `metallicStrength`, `metallicLightFill`, `metallicSurfaceScale`,
 * `metallicAzimuth`, `metallicElevation`, `metallicSpecularConstant`) is a
 * concrete literal — a raw number or a raw hex string — NOT a style
 * registry token. This mirrors the repo's `*Fill`/`*Line`/`*Stroke` naming
 * convention for raw-hex fields (see the `svg-substrate` skill / the
 * project's own `strokeColorToken` vs `*Fill` split in WavyLine/DrawLine):
 * naming these `tintFill`/`glowFill` instead of `tintColor`/`glowColor`
 * means `resolveAssetStyle` in `src/registry/styleRegistry.js` never
 * attempts token resolution on them even if they were ever hoisted to a
 * top-level style key (its substring-"color" check only fires on TOP-LEVEL
 * keys — nesting these under `styleOverride.shader` already keeps them out
 * of that check entirely; the `*Fill` naming is belt-and-suspenders).
 * An asset embeds them under one `styleOverride.shader` object so an author
 * (or an alias expansion — see below) can swap the whole tone in one shot
 * without hand-merging individual keys.
 *
 * === Presets via the alias system, not hardcoded here ===
 * This module intentionally ships NO named presets/looks — "gold tint",
 * "cold glow", etc. are curated separately as `shader.<name>` aliases
 * (`node scripts/cli.js alias create shader.<name> '<expansion-json>'`,
 * loaded from `studio/library/aliases/*.json` same as the existing
 * `effects.*`/`motion.*` aliases). An author references a preset with a
 * nested `$alias`, which `resolveAliasesDeep` (pipeline2) expands to a
 * literal object BEFORE this module or the asset component ever runs:
 *
 *   "styleOverride": {
 *     "align": "center",
 *     "shader": { "$alias": "shader.goldTint" }
 *   }
 *
 * Nesting `$alias` under `shader` (rather than at `styleOverride`'s own
 * top level) is what lets a preset be combined with unrelated sibling style
 * keys (`align` above) — `resolveAliasesDeep` replaces only the object it
 * finds `$alias` inside, so `styleOverride.align` survives untouched while
 * `styleOverride.shader` becomes the alias's literal expansion.
 *
 * === No-op when absent ===
 * `isShaderActive(shader)` returns false for `undefined`/`{}`/an object
 * whose every field equals its identity default, and the asset should skip
 * rendering `<SvgShaderFilter>`/applying `filter: url(#...)` entirely in
 * that case — a plain `<image>` renders byte-identical to before this
 * module existed.
 *
 * === Metallic / shine, not just glow ===
 * Two distinct primitives cover "make it look like metal", both literal
 * and both additive/opt-in:
 *
 *  - `metallic*` fields (folded into `SvgShaderFilter`'s filter graph) —
 *    a STATIC embossed-lighting texture: `feTurbulence` generates a bump
 *    map, `feSpecularLighting` (with a `feDistantLight`) simulates a
 *    directional light catching that bump map's ridges, and the resulting
 *    specular highlights are masked to the image's own alpha and added on
 *    top. This is what gives a flat-color logo a brushed-metal/foil
 *    texture — the same technique CSS/SVG "metallic text" recipes use,
 *    baked into this asset's own filter graph instead of a separate
 *    library. No animation; it reads the same every frame (a real physical
 *    metal surface doesn't shimmer on its own either — see `SvgShineSweep`
 *    for the animated light-catching-a-surface look).
 *  - `<SvgShineSweep>` — an ANIMATED diagonal highlight band that sweeps
 *    across the image's traced silhouette once (or on a loop), the classic
 *    "light catching a moving reflective surface" read (coin/foil shimmer).
 *    Masked to the real opaque pixels via the same silhouette polygon
 *    `useAlphaSilhouette`/`BoundaryDrawer` already trace, not a rectangular
 *    sweep across the transparent canvas. Driven by `frame`/timing like
 *    every other asset in this repo — NOT part of the static filter graph,
 *    since SVG filter primitives can't read Remotion's frame clock on
 *    their own.
 */

export const SHADER_DEFAULTS = {
  blur: 0,
  brightness: 1,
  contrast: 1,
  saturate: 1,
  hueRotateDeg: 0,
  tintFill: null,
  tintStrength: 0.35,
  glowFill: null,
  glowStrength: 12,
  metallicStrength: 0,
  metallicLightFill: "#FFFFFF",
  metallicSurfaceScale: 2,
  metallicSpecularConstant: 1,
  metallicAzimuth: 235,
  metallicElevation: 40,
  metallicFrequency: 0.015,
  // Shine-sweep fields live in the same `shader` object for one-stop
  // authoring, but (unlike everything above) are NOT part of the static
  // <filter> graph SvgShaderFilter builds — see SvgShineSweep's doc comment
  // for why (it needs Remotion's frame clock, filters don't get one).
  // shineFill absent/null = no sweep rendered (no-op).
  shineFill: null,
  shineWidth: 40,
  shineAngleDeg: 25,
  shineOpacity: 0.55,
  shineLoop: false,
  shinePeriodFrames: 60,
};

/**
 * @param {object} [shader]  a literal `styleOverride.shader` object (any
 *        subset of SHADER_DEFAULTS' keys; missing keys fall back to the
 *        identity default for that field)
 * @returns {boolean} true when at least one field differs from its
 *        identity default — i.e. there's actually something to render
 */
export function isShaderActive(shader) {
  if (!shader || typeof shader !== "object") return false;
  const s = { ...SHADER_DEFAULTS, ...shader };
  return (
    s.blur > 0 ||
    s.brightness !== 1 ||
    s.contrast !== 1 ||
    s.saturate !== 1 ||
    s.hueRotateDeg !== 0 ||
    Boolean(s.tintFill) ||
    Boolean(s.glowFill) ||
    s.metallicStrength > 0
  );
}

/** Sanitizes React.useId()'s colon-bearing output into a bare SVG-id-safe string. */
function useSanitizedId() {
  const raw = React.useId();
  return raw.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Renders the `<filter>` element (place as a child of an `<defs>` inside the
 * asset's `<svg>`) implementing tone (brightness/contrast/saturate/
 * hueRotate), blur, and multiply-blend tint. Returns `null` when the shader
 * has nothing active — callers should check `isShaderActive` themselves
 * before deciding whether to apply `filter: url(#id)` at all, but this also
 * self-guards so passing an inert shader object is harmless.
 *
 * @param {object} props
 * @param {string} props.id  the `<filter id>` — must be unique within the
 *        asset's own `<svg>` document. Pair with `useSvgShaderId()` below.
 * @param {object} [props.shader]  literal shader values (see SHADER_DEFAULTS)
 */
export function SvgShaderFilter({ id, shader }) {
  if (!isShaderActive(shader)) return null;
  const s = { ...SHADER_DEFAULTS, ...shader };

  const children = [];
  let prev = "SourceGraphic";
  let step = 0;
  const nextResult = () => `shd${step++}`;

  if (s.saturate !== 1) {
    const result = nextResult();
    children.push(
      <feColorMatrix key="saturate" in={prev} type="saturate" values={String(s.saturate)} result={result} />
    );
    prev = result;
  }

  if (s.hueRotateDeg !== 0) {
    const result = nextResult();
    children.push(
      <feColorMatrix key="hue" in={prev} type="hueRotate" values={String(s.hueRotateDeg)} result={result} />
    );
    prev = result;
  }

  if (s.brightness !== 1 || s.contrast !== 1) {
    // Combined linear transform: brightness scales first (x *= brightness),
    // then contrast pivots around mid-gray (x = (x-0.5)*contrast + 0.5).
    // Folded into one feComponentTransfer: slope = brightness*contrast,
    // intercept = 0.5*(1-contrast).
    const slope = s.brightness * s.contrast;
    const intercept = 0.5 * (1 - s.contrast);
    const result = nextResult();
    children.push(
      <feComponentTransfer key="tone" in={prev} result={result}>
        <feFuncR type="linear" slope={slope} intercept={intercept} />
        <feFuncG type="linear" slope={slope} intercept={intercept} />
        <feFuncB type="linear" slope={slope} intercept={intercept} />
      </feComponentTransfer>
    );
    prev = result;
  }

  if (s.blur > 0) {
    const result = nextResult();
    children.push(<feGaussianBlur key="blur" in={prev} stdDeviation={s.blur} result={result} />);
    prev = result;
  }

  if (s.tintFill) {
    const floodResult = nextResult();
    const maskedResult = nextResult();
    children.push(
      <feFlood key="tintFlood" floodColor={s.tintFill} floodOpacity={s.tintStrength} result={floodResult} />,
      <feComposite key="tintComposite" in={floodResult} in2={prev} operator="in" result={maskedResult} />,
      <feBlend key="tintBlend" in={maskedResult} in2={prev} mode="multiply" result={nextResult()} />
    );
    prev = children[children.length - 1].props.result;
  }

  if (s.metallicStrength > 0) {
    // Bump-map + directional specular light: feTurbulence generates a noise
    // field, feDiffuseLighting/feSpecularLighting reads it as a heightmap
    // and simulates a light source catching the "ridges" — the standard
    // SVG recipe for a brushed-metal/foil texture. The specular result is
    // masked to the SOURCE image's own alpha (so the texture never spills
    // onto the transparent canvas around a round logo) then added on top
    // of everything upstream via feComposite arithmetic (k1=0 additive-ish
    // blend: result = specular*strength + prev).
    const turbResult = nextResult();
    const specResult = nextResult();
    const maskedSpecResult = nextResult();
    children.push(
      <feTurbulence
        key="metallicTurb"
        type="fractalNoise"
        baseFrequency={s.metallicFrequency}
        numOctaves={2}
        seed={2}
        result={turbResult}
      />,
      <feSpecularLighting
        key="metallicSpecular"
        in={turbResult}
        surfaceScale={s.metallicSurfaceScale}
        specularConstant={s.metallicSpecularConstant}
        specularExponent={12}
        lightingColor={s.metallicLightFill}
        result={specResult}
      >
        <feDistantLight azimuth={s.metallicAzimuth} elevation={s.metallicElevation} />
      </feSpecularLighting>,
      <feComposite key="metallicMaskToAlpha" in={specResult} in2="SourceAlpha" operator="in" result={maskedSpecResult} />,
      <feComposite
        key="metallicAdd"
        in={maskedSpecResult}
        in2={prev}
        operator="arithmetic"
        k1={0}
        k2={s.metallicStrength}
        k3={1}
        k4={0}
        result={nextResult()}
      />
    );
    prev = children[children.length - 1].props.result;
  }

  return (
    <filter id={id} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
      {children}
    </filter>
  );
}

/**
 * Convenience hook: generates a stable, sanitized, per-instance filter id
 * and returns both the id and the `style` fragment to spread onto whatever
 * element the filter applies to (only actually points at the filter when
 * the shader is active; otherwise `style.filter` is `undefined` — a strict
 * no-op).
 *
 * @param {object} [shader]  literal shader values (see SHADER_DEFAULTS)
 * @returns {{id: string, active: boolean, style: {filter: string|undefined}}}
 */
export function useSvgShaderId(shader) {
  const raw = useSanitizedId();
  const id = `svgshader-${raw}`;
  const active = isShaderActive(shader);
  return { id, active, style: { filter: active ? `url(#${id})` : undefined } };
}

/**
 * Renders a blurred, filled copy of a traced silhouette (see
 * `useAlphaSilhouette` in `boundaryDrawer.jsx`) behind the asset's real
 * content — a glow halo shaped like the actual opaque pixels, not a
 * rectangular drop-shadow. Place this BEFORE the image/content element in
 * document order so it paints underneath. Renders nothing when `glowFill`
 * is falsy or `points` is empty (no-op).
 *
 * @param {object} props
 * @param {Array<[number,number]>} [props.points]  closed silhouette polygon
 *        in local viewBox coords (from `useAlphaSilhouette`)
 * @param {string} [props.glowFill]  raw hex fill for the glow (literal, no
 *        token resolution — see the module doc comment)
 * @param {number} [props.glowStrength=12]  feGaussianBlur stdDeviation, px
 * @param {number} [props.opacity=1]  additional opacity multiplier (e.g.
 *        the host asset's own enter/exit envelope)
 */
export function SvgGlow({ points, glowFill, glowStrength, opacity = 1 }) {
  const id = `svgglow-${useSanitizedId()}`;
  if (!glowFill || !points || points.length < 3) return null;
  const strength = glowStrength ?? SHADER_DEFAULTS.glowStrength;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ") + " Z";

  return (
    <>
      <defs>
        <filter id={id} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={strength} />
        </filter>
      </defs>
      <path d={d} fill={glowFill} opacity={opacity} style={{ filter: `url(#${id})` }} pointerEvents="none" />
    </>
  );
}

/**
 * Renders an animated diagonal highlight band that sweeps across the
 * image's traced alpha silhouette — the "light catching a moving
 * reflective surface" read (coin/foil/chrome shimmer), as opposed to the
 * static `metallic*` bump-lighting texture above. Masked to the real
 * opaque pixels via `points` (from `useAlphaSilhouette`), so the sweep
 * travels across the actual logo shape, never the transparent square
 * canvas around it.
 *
 * Driven by `frame`, not part of `SvgShaderFilter`'s static filter graph —
 * SVG filter primitives have no access to Remotion's frame clock, so the
 * moving band is a masked `<rect>` gradient instead, painted as a sibling
 * layer over the image (place AFTER the `<image>` in document order so it
 * paints on top).
 *
 * One pass by default (`loop: false`) timed to the asset's own active
 * window — the classic single shimmer-across-once a coin/logo reveal uses.
 * `loop: true` repeats it continuously at `periodFrames` cadence instead,
 * for a persistent ambient shimmer.
 *
 * @param {object} props
 * @param {Array<[number,number]>} [props.points]  closed silhouette polygon
 *        in local viewBox coords (from `useAlphaSilhouette`). No-op when
 *        absent/too short.
 * @param {number} props.frame  current scene-local frame (useCurrentFrame())
 * @param {number} props.enterAtFrame  frame the sweep's single pass starts
 * @param {number} [props.exitAtFrame]  frame the sweep's single pass ends;
 *        defaults to enterAtFrame + durationInFrames
 * @param {number} [props.durationInFrames]  fallback window length when
 *        exitAtFrame is omitted
 * @param {string} [props.shineFill="#FFFFFF"]  literal raw hex for the
 *        highlight band
 * @param {number} [props.shineWidth=40]  band width, local viewBox units
 * @param {number} [props.shineAngleDeg=25]  sweep direction, degrees off
 *        horizontal (positive = tilts down-right)
 * @param {number} [props.shineOpacity=0.55]  peak opacity at the band's
 *        brightest point (the band itself fades edge-to-edge via a
 *        gradient, this is the multiplier on that gradient's peak)
 * @param {boolean} [props.loop=false]  repeat continuously instead of one pass
 * @param {number} [props.periodFrames=60]  cadence between sweeps when `loop` is true
 * @param {number} [props.opacity=1]  additional opacity multiplier (e.g. the
 *        host asset's own enter/exit envelope)
 */
export function SvgShineSweep({
  points,
  frame,
  enterAtFrame = 0,
  exitAtFrame,
  durationInFrames,
  shineFill = "#FFFFFF",
  shineWidth = 40,
  shineAngleDeg = 25,
  shineOpacity = 0.55,
  loop = false,
  periodFrames = 60,
  opacity = 1,
}) {
  const rawId = useSanitizedId();
  const clipId = `svgshine-clip-${rawId}`;
  const gradId = `svgshine-grad-${rawId}`;

  if (!points || points.length < 3) return null;

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ") + " Z";

  // Bounding box of the silhouette drives the sweep's travel distance —
  // the band starts fully off one side and ends fully off the other.
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const diag = Math.sqrt(w * w + h * h);
  const travel = diag + shineWidth * 2;

  const activeEnd = exitAtFrame ?? enterAtFrame + (durationInFrames ?? 1);
  const activeFrames = Math.max(1, activeEnd - enterAtFrame);

  let progress;
  if (loop) {
    const cadence = Math.max(1, periodFrames);
    const local = ((frame - enterAtFrame) % cadence + cadence) % cadence;
    progress = Math.min(1, local / cadence);
  } else {
    progress = Math.max(0, Math.min(1, (frame - enterAtFrame) / activeFrames));
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const offset = -travel / 2 + progress * travel;

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <path d={d} />
        </clipPath>
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={-shineWidth / 2} y1="0" x2={shineWidth / 2} y2="0">
          <stop offset="0%" stopColor={shineFill} stopOpacity="0" />
          <stop offset="50%" stopColor={shineFill} stopOpacity={shineOpacity} />
          <stop offset="100%" stopColor={shineFill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clipId})`} opacity={Math.max(0, Math.min(1, opacity))} pointerEvents="none">
        <rect
          x={-diag}
          y={-diag}
          width={diag * 2}
          height={diag * 2}
          fill={`url(#${gradId})`}
          transform={`translate(${cx} ${cy}) rotate(${shineAngleDeg}) translate(${offset} 0)`}
        />
      </g>
    </>
  );
}
