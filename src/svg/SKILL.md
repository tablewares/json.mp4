---
name: svg-substrate
description: How to author and use the SVG drawing substrate (src/svg/) in this JSON-to-MP4 repo. Use this skill when the agent needs to make a video asset that draws gradients, masked/draw-on geometry, glow halos, arcs, crisp lines, or per-glyph text — anything a flat CSS div can't express — and when porting an existing div-based asset to that substrate. Covers SvgStage + the primitive set (Bar, Rect, Line, Arc, Dot, Text), the useReveal motion contract, the gradient/glow defs, the raw-hex naming rule, import paths, and the verify loop. Holds no design criteria (palette/size/pacing come from the run); supplies the mechanism only.
---

# SVG substrate

The repo's asset library was originally all flat CSS `<div>`s with a per-asset
spring-fade — a hard ceiling on what the output could look like. `src/svg/` is
the drawing + motion substrate added to break that ceiling: SVG-based assets
can render gradients, masked/draw-on geometry, glow halos, crisp arcs/lines,
and per-glyph text choreography that divs fundamentally cannot.

This skill covers *how to use the substrate*. It deliberately does NOT tell
the agent which colors, sizes, animations, or scene layouts to choose — those
are design criteria supplied by the run (per the parent `video-agent-cli`
skill's "holds no creative direction" rule). Supply palette/size/pacing from
the run's external design context; this skill supplies the mechanism.

## Where it lives

All substrate code lives under `src/svg/`, imported by asset components under
`studio/assets/<Name>/` and `studio/graphics/<Name>/`. The pipeline, the
composition root, the registry generator, the agent CLI, and the scene/schema
contracts are all unchanged — the substrate is just a library assets import,
exactly the way they import from `remotion`. No CLI command is aware of it.

## The contract the framework already hands every asset

Every asset (div-based OR SVG-based) receives four props from
`pipeline2-resolve` / `Composition.jsx`:

  - `resolvedPosition` — `{ position:'absolute', left, top, transformOrigin }`
                     from `anchor.js`. Spread onto the asset's host element.
  - `resolvedStyle`    — resolved style object; `width`/`height` are baked
                     in by resolve.js (from manifest `defaultSize` merged with
                     any `styleOverride.width`/`height`). May also carry an
                     `easing` remotion spring config (raw object, not a token).
  - `content`         — the merged `contentOverride`.
  - `timing`          — `{ durationInFrames, enterAtFrame, exitAtFrame }`.
                     This is the ONLY animation budget the asset gets. Nothing
                     in the substrate invents additional time.

An SVG-based asset spreads `resolvedPosition` and `resolvedStyle.width/height`
onto `<SvgStage>` and draws children in the stage's local coordinate system —
never composition pixels, never the camera transform (the camera lives on a
parent AbsoluteFill in Composition.jsx, untouched here).

## The motion contract: `useReveal`

`useReveal(timing, options)` (in `src/svg/useReveal.js`) is the single
animation hook the whole substrate shares. It turns the asset's `timing` window
into a handful of frame-driven values every primitive consumes, so an asset
stops re-implementing "a spring + opacity fade" per component.

Returns `{ frame, fps, duration, enter, exitOpacity, reveal, localFrame }`:

  - `reveal` — the ONE value a primitive should drive its draw/scale/opacity
               from. Guaranteed to reach ~1 BEFORE the exit blind starts (the
               last ~15% of the window is reserved for the exit fade), so a
               figure finishes landing and THEN leaves — never crawls straight
               into the exit.
  - `enter` / `exitOpacity` — the enter-spring progress and the exit fade, for
               primitives that want them separately (e.g. opacity from `enter`,
               geometry from `reveal`).
  - `localFrame` — `frame - enterAtFrame`: 0 at the asset's own start. Use
               this for staggered children instead of recomputing.

`options`:
  - `easing` — a remotion spring config object. Pass `resolvedStyle.easing`
               when it carries one (raw object). The framework default spring
               applies when omitted.
  - `enterFrame` — override the enter frame (used for staggered children; see
               "Stagger" below).

Primitives should drive their reveal from `reveal`. An asset that needs two
different reveal curves (e.g. count-up number meets grow bar) calls `useReveal`
twice with different options — same contract, just shifted.

## SvgStage — the substrate wrapper

`SvgStage` (in `src/svg/SvgStage.jsx`) renders a sized `<svg viewBox>` inside a
host `<div>` positioned via `resolvedPosition`. Drop-in for the existing asset
contract:

```jsx
export function MyAsset({ resolvedPosition, resolvedStyle, content, timing }) {
  return (
    <SvgStage resolvedPosition={resolvedPosition} resolvedStyle={resolvedStyle} timing={timing} content={content}>
      {/* children draw in local 0 0 width height coords; reveal/easing flow via context */}
      <Bar x={0} y={0} width={resolvedStyle.width} height={40} grow="right" fill="url(#g)" />
    </SvgStage>
  );
}
```

SvgStage binds `useReveal(timing, { easing: resolvedStyle.easing })` and injects
the result into `RevealContext`, so every primitive below it gets `reveal`,
`enter`, `exitOpacity`, `frame`, `fps`, `duration`, `timing`, `easing`, and
`viewBox` WITHOUT prop-drilling. A primitive that wants to override the stage's
default `reveal` (e.g. a staggered chart bar) passes `reveal` explicitly to
that primitive — explicit prop wins over context. That is the ONLY escape hatch
for staggered timing.

Import paths (note the depth: assets live at `studio/assets/<Name>/`,
substrate at `src/svg/`):

  - from `studio/assets/<Name>/<Name>.jsx` → `../../../src/svg/index.jsx`
  - from `studio/graphics/<Name>/<Name>.jsx` → `../../../src/svg/index.jsx`

Always import through the barrel `src/svg/index.jsx` so the surface stays
stable as primitives are added.

## The primitive set (`src/svg/primitives.jsx`)

All shapes read `reveal` from context unless an explicit `reveal` prop is
passed. All accept the standard SVG passthrough props (`opacity`, `style`, etc.)
on top of their named geometry.

  - `<Bar>` — directional draw from an edge. `grow` is `"up"` (default, baseline
    at `y+height`, grows toward `y=0`), `"down"`, `"left"`, or `"right"`. A bar
    "draws to its length" rather than appearing. The classic chart-bar / gauge
    move. Pass `rx` for rounded ends.
  - `<Rect>` — filled panel that scales in from its center (the "card land" move).
    No directional draw; use `<Bar>` for that. Accepts `stroke`/`strokeWidth`/
    `rx`. Use for backdrop cards, chips, gradient panels.
  - `<Line>` — stroked segment with a draw-on reveal via `strokeDashoffset` —
    the trace-itself move a flat div literally could not do. `x1,y1,x2,y2`,
    `stroke`, `strokeWidth`, `strokeLinecap`.
  - `<Arc>` — a stroked arc sector that sweeps in clockwise as `reveal`→1.
    `cx,cy,r`, `startAngle`/`endAngle` in degrees, `stroke`, `strokeWidth`,
    `strokeLinecap`. Use for donut/ring/gauge stat visuals.
  - `<Dot>` — a filled circle that pops with a slight overshoot
    (scale 0→overshoot→1). A marker/particle primitive. `cx,cy,r,fill`.
  - `<Text>` — SVG `<text>` with an optional per-word staggered reveal. When
    `stagger` is true, each word fades+rises with a per-word offset derived
    from the stage frame; the stage `reveal` gates the whole group so the text
    still leaves on exit. `x,y,text,fontFamily,fontSize,fontWeight,fill,anchor`
    (`"start"`/`"middle"`/`"end"`). SVG `<tspan>` keeps word/letter
    choreography honest — each word is a real positioned run, not an
    inline-block CSS hack.

Reveal overrides: a primitive used as a staggered child (e.g. one bar among
many in a chart) should call `useReveal(timing, { enterFrame: itsOwnStartFrame })`
itself and pass that `reveal` down to the primitive. The stage-wide value stays
the default for non-staggered children.

## Defs — gradients and glow (`src/svg/defs.jsx`)

These are the components that make an SVG render *look rich* rather than flat.

  - `<LinearGradient>` — a `<defs>` linear gradient. `id`, `from`, `to`,
    `angle` (degrees), or `stops` (`[{offset,color,opacity?}, ...]`).
    Reference a gradient on any primitive via `fill="url(#<id>)"`.
  - `<Glow>` — a `<filter>` glowing halo via `feGaussianBlur` + `feMerge`.
    `id`, `strength` (stdDeviation in px — pass 0 to disable), `color`
    (optional; tints the halo, else uses the shape's own color). Apply on a
    primitive via `style={{ filter: "url(#<id>)" }}`.
  - `<Defs>` — raw passthrough for bespoke `<defs>` children when the
    convenience components aren't enough.

Declare defs as children of `<SvgStage>` (sibling to the primitives that
reference them). Each stage instance shares one `<svg>`, so a single set of ids
is enough for all its children — but ids must be unique within a stage. Use a
short prefix per asset (e.g. your asset's initials) to avoid collisions if the
same asset type could appear twice in one scene, since both instances live in
the same document.

## The raw-hex naming rule (important)

This is the one repo convention that will silently bite an SVG asset author.
The style registry in `src/registry/styleRegistry.js` treats ANY style key
whose name contains the substring `"color"` (case-insensitive) with a string
value as a **color TOKEN** and tries to resolve it against the theme's
`colors` map — throwing `Unknown color token "<value>"` if the value is a raw
hex literal (which is not a token).

Therefore any raw-hex field an SVG-listed asset exposes MUST NOT contain the
word "color". Name raw-hex fields with a different suffix — `*Fill`, `*Line`,
`*Stroke` — exactly as the existing chart assets already do (`barFill`,
`canvasFill`, `borderLine`, `valueFill`, `labelFill`). The original word was
"Fill" not "color" deliberately, and the substrate follows the same rule.

Concrete, value-free form:
  - DO declare raw-hex fields as: `trackFill`, `labelFill`, `fill`, `stroke`,
    `valueFill`, `accentFill`, etc.
  - DO NOT declare raw-hex fields as: `trackColor`, `labelColor`, `fillColor`,
    `barColor`, etc. — those names will be parsed as tokens and crash resolve.

Tokens remain the right mechanism when the field intends to take a THEME color
(`shade1`, `accentBg`, …); the rule applies only to raw-hex passthrough fields.

## Authoring a new asset on the substrate

The repo's authoring flow (see the parent `video-agent-cli` skill, "Authoring a
new asset or transition") applies unchanged: copy `studio/assets/
AssetBoilerplate/` into a PascalCase folder, rename files/exports, then write
the component. The change for a substrate asset is purely inside the component
body:

1. Import the surface: `import { SvgStage, Bar, Rect, Line, Arc, Dot, Text,
   LinearGradient, Glow, useReveal, useRevealContext } from
   "../../../src/svg/index.jsx"` (adjust depth if not under
   `studio/assets/<Name>/`).
2. Render `<SvgStage ...>` as the root, with the asset's four framework props.
3. Draw children inside it using the primitives. Geometry goes in local viewBox
   coordinates; never use composition pixel constants.
4. Declare any `<LinearGradient>`/`<Glow>` defs as the first children, each with
   a unique id; reference them as `fill="url(#id)"` / `filter: url(#id)`.
5. Author the manifest (`manifest.json`): set `assetType`/`component`/
   `description`, declare `defaultSize`, `defaultStyle`, the
   `contentOverrideSchema` (required `content` keys), and the
   `styleOverrideSchema` (the `style` keys the component actually reads) — with
   raw-hex fields named per the rule above, described as "raw hex" so the agent
   using the CLI knows not to pass a token.

The registry generator (`npm run generate:registry`) rescans `studio/assets/`
and `studio/graphics/` on every `prebuild`/`render`, so a new folder is picked
up automatically — no separate registration step. Confirm with
`node scripts/agent-cli.mjs asset <NewName>` after authoring.

## Porting an existing div-based asset

When an existing asset's output is too flat, migrate it: keep the manifest
schema compatible (so existing scenes that place the asset continue to
validate and render unchanged in structure), swap the component body for a
`<SvgStage>` + primitives implementation, and ADD substrate-only style keys as
optional additions to the schema (e.g. `gradient`, `glowStrength`, `revealMode:
"wipe"`) so the agent can opt into richer reveals without breaking older scenes.

Keep the old behavior reachable by default where reasonable (e.g. if `gradient`
is absent, fall through to the original solid fill source). The migrated
`SolidShape` asset is the reference example in this repo: same `shape`/
`backgroundColorToken`/`borderRadius`/`revealMode`/`opacity` schema as before,
plus an optional `gradient` and a real `"wipe"` reveal mode that the old div
couldn't do.

## Stagger and continuity

For staggered children (bars in a chart, words in a Text), each child should
call `useReveal(timing, { enterFrame: baseEnter + i * stagger })` and pass that
`reveal` to its primitive — do NOT try to stagger by manipulating the stage's
own `reveal`. The stage value is the SCENE-WIDE default; staggering is a child
concern.

For transitions where an asset carries across a cut (the `pivotZoom` /
`slideContinuity` transitions, per the parent skill), the carried asset's
`id` must be present in BOTH the outgoing and the incoming scene, and resolve.js
checks this — a `pivotZoom`/`slideContinuity"` that names an id missing from
either side throws a specific error naming the failing side. The carried id
works identically for an SVG-based asset and a div-based one; the transition
reads `resolvedPosition` + `resolvedStyle`, which the substrate sets the same
way. To carry an SVG asset into a scene where you don't want it visible, author
it in the incoming scene at a low/zero `opacity` — the transition still reads
its geometry across the cut and can reveal it again on a later scene.

## Verify loop

After authoring or porting a substrate asset:

1. `node scripts/agent-cli.mjs assets` — confirm the new type appears in the
   list (registry rescanned on `prebuild`).
2. `node scripts/agent-cli.mjs asset <NewName>` — confirm the manifest parses
   and the content/style schema is what you intended.
3. Probe-add the asset to a scratch scene:
   `node scripts/agent-cli.mjs add-asset <pid> <sid> '<...>'` and check the
   returned `warnings: []`. Non-empty `warnings` means a schema mismatch
   (commonly a raw-hex field accidentally named with "color" — fix the manifest
   and the styleOverride before proceeding).
4. `node scripts/agent-cli.mjs validate <pid>` — cross-reference + narrationRef
   + anchor check.
5. `node scripts/agent-cli.mjs render <pid> out/<pid>.mp4` — full pipeline.
   `overlap_warn.js` runs at resolve time and may warn on intentional layering
   (a backdrop panel behind a title is supposed to overlap); warnings are
   advisory and never block the render, per the parent skill.

## When to reach for the substrate vs the old divs

Reach for SvgStage when the asset needs ANY of:
gradients, glow halos, masked/draw-on reveals, traced lines, swept arcs,
per-glyph text, crisp vector geometry, or compositing primitives that share
one coordinate system.

Keep a div-based asset when the primitive genuinely is a flat panel + a fade and
nothing richer adds value (a plain caption, a single color block). The substrate
and the divs interoperate freely inside one scene — they share
`resolvedPosition`/`resolvedStyle`/`content`/`timing` identically.

## Things to avoid

- Don't import from `src/svg/` using relative paths other than the barrel
  (`src/svg/index.jsx`). Importing a submodule directly couples your asset to
  internal layout that may move as primitives are added.
- Don't declare a raw-hex style field whose name contains "color". It will be
  treated as a token and resolve.js will throw `Unknown color token "<hex>"`.
  Use `*Fill`/`*Line`/`*Stroke` instead.
- Don't put two `<SvgStage>` instances in one asset component expecting them to
  share ids — each renders its own `<svg>`; gradient/glow ids must be unique
  per stage instance.
- Don't compute composition-pixel geometry inside an asset. The stage gives you
  a local viewBox of `0 0 width height` — stay in it. The camera, anchors, and
  composition size are all handled upstream.
- Don't bypass `useReveal` and hand-roll a spring/opacity fade in a substrate
  asset. The whole point is one shared motion contract; rolling your own
  reintroduces the visual-uniformity problem the substrate was added to fix.
- Don't author design constants (specific hexes, pixel sizes, easing numbers)
  into the skill or the asset's defaults from memory. Pull palette/size/pacing
  from the run's design context. Asset `defaultStyle` should be a sensible
  neutral fallback, not a brand statement.
