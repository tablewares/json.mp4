# Toon Manifest Pattern

Authoring project, scene, and style files in TOON (Token-Oriented Object Notation). Same
contract as the JSON form, lower token cost when an agent is composing files in-context.

Source: `src/pipelines/pipeline1-validate/validate.js` — `loadStructuredFile()`. This is
the ONLY place the framework looks at file extension. If it's `.toon`, the raw bytes go
through `decodeToon` from `@toon-format/toon`; if `.json`, plain `JSON.parse`. Everything
downstream — Ajv schemas in validate, `resolveScene` in pipeline 2, `Composition.jsx` in
pipeline 3 — sees the same plain JS object and has no idea which format the file was
written in. You can mix-and-match freely, switching individual files to `.toon` as needed.

Working example: `studio/manifest/example-project/` — entirely `.toon`.

TOON itself: <https://github.com/toon-format/toon> — spec v4.1, JS package `@toon-format/toon`.

## Why bother

The whole manifest-layer data is exactly TOON's sweet spot — uniform objects with the
same fields across array items, keyed by ID where appropriate. The narration entries, audio
overlay rows, scene routes, and style tokens all qualify for the tabular forms TOON folds
from JSON:

- Declare the field list **once** in a header, then one row per element — like CSV, but
  with explicit `[N]` length hints and `{fields}` schema right next to the data.
- LLMs are far more reliable at producing structural validation output when the expected
  shape is visible at the top of a list, not implied by repetition.
- The example-project's `narration.entries` saves roughly half its JSON tokens, since the
  `id,text` pair is declared once and each entry collapses to a single comma-separated row.

When TOON loses: deeply nested non-uniform structures, or semi-uniform arrays (~40–60%
field overlap). For this project that's effectively never at the manifest layer — the
scene file's `assets[]` is the one place variety creeps in (different `assetType`s have
different `contentOverride`/`styleOverride` shapes), so the `assets[]` block uses TOON's
list form (`- id / ...` per asset) rather than tabular form. See the scene file example
below.

## File mapping

| JSON file             | TOON file                  | Notes                                   |
| --------------------- | -------------------------- | --------------------------------------- |
| `manifest.json`       | `manifest.toon`            | See [manifest.md](../reference/manifest.md) for the contract. |
| `config.json`         | `config.toon`              | Same 4 keys; trivially TOON-shaped.     |
| `styles/theme.json`   | `styles/theme.toon`        | Colors/typography/spacing/easing — natural TOON. |
| `scenes/<id>.json`    | `scenes/<id>.toon`         | Uses list form for the `assets[]` array. |

The manifest's `config`, `styles`, and `scenes[].path` string keys point at the relative
file path — extension included. So if you switch to TOON, update those path strings in the
manifest too, or validate will throw trying to open the old filename.

## config.toon

Straightforward — every key is a scalar. No arrays, no nested objects. This is roughly
identical to the JSON form minus the braces and quotes.

```toon
fps: 30
width: 1920
height: 1080
defaultSceneDurationInFrames: 90
```

Reference: [config.md](../reference/config.md). Same four keys required (`fps`, `width`,
`height`, `defaultSceneDurationInFrames`).

## manifest.toon

This is where TOON shines. The `narration.entries`, `audioOverlay`, and `scenes[]` arrays
all qualify for **tabular form** — declare the field list once in the header, then one
row per item.

```toon
projectId: example-project
config: config.toon
styles: styles/theme.toon
narration:
  entries[2]{id,text}:
    n1,Why most AI videos look like slideshows.
    n2,"Because they resolve every asset independently, with no shared registry and no continuity."
  fullTranscript: "Why most AI videos look like slideshows. Because they resolve every asset independently, with no shared registry and no continuity."
audioOverlay[1]{id,start,end,path}:
  voiceover,0,8.5,audio/voiceover.mp3
scenes[2]{id,path}:
  scene-001,scenes/scene-001.toon
  scene-002,scenes/scene-002.toon
```

How to read the headers:

- `entries[2]{id,text}:` — an array of **2** entries, each with the fields `{id, text}`.
  One row per entry, comma-separated in declared field order.
- `audioOverlay[1]{id,start,end,path}:` — same idea. Row values are positional, matching
  the field list. Numeric values (`0`, `8.5`) are parsed as numbers, not strings.
- `scenes[2]{id,path}:` — the scene router. Note `path` here ends in `.toon` because the
  scene files are TOON; if any one scene were still JSON, point its row's `path` at the
  `.json` and the loader resolves it by extension.

Reference: [manifest.md](../reference/manifest.md). The cross-reference rules (id match,
narrationRef existence) and "don't put scene/style content here" rule apply unchanged.

## styles/theme.toon

The style registry maps naturally to keyed-object form. Each section (`colors`,
`typography`, `spacing`, `easing`) is a map from token name to a uniform value object.
TOON's keyed tabular form declares the shared field list per section and emits one row per
token.

```toon
colors:
  shade1: "#0B0E14"
  shade2: "#161B26"
  main1: "#F5F7FA"
  main2: "#8B93A7"
  accentBg: "#3D7BFD"
  transparent: "#00000000"
typography:
  heading1:
    fontFamily: "Inter, sans-serif"
    fontSize: 72
    fontWeight: 700
    lineHeight: 1.1
    colorToken: main1
  body1:
    fontFamily: "Inter, sans-serif"
    fontSize: 36
    fontWeight: 400
    lineHeight: 1.4
    colorToken: main2
spacing:
  sceneMargin: 96
  gutter: 32
easing:
  gentleSpring:
    damping: 16
    mass: 0.7
    stiffness: 110
  snappySpring:
    damping: 12
    mass: 0.4
    stiffness: 180
```

Notes on the choice of form here:

- `colors` is a flat token→scalar map — kept as plain indented key-value lines. The values
  are CSS color strings; quote them so TOON's value parser doesn't strip a leading `#`.
- `typography`, `spacing`, `easing` are token→object maps with uniform fields per section.
  They could fold into keyed tabular form (e.g. `typography[2:]{fontFamily,fontSize,...}:`)
  but each token's value object nests further, and the nested-field-group syntax starts
  costing more readability than it saves. The list-style rendering above stays scannable.

Reference: [styles.md](../reference/styles.md). Same four sections, same resolution rules
(`shade1` → `#0B0E14` etc.), same `colorToken` indirection inside `typography` entries.

## scenes/<id>.toon

The scene file is the one place this project uses TOON's **list form** — the `assets[]`
array entries vary in shape (different `assetType`s → different
`contentOverride`/`styleOverride` fields), so they don't qualify for tabular form. Use
`- ` items and keep the shared fields (`id`, `assetType`, `anchor`, `enterAt`, `exitAt`)
at item-scope. Nested objects like `anchor`, `contentOverride`, `styleOverride`,
`transitionOut` are written as indented key-value children.

Example — `scenes/scene-001.toon`:

```toon
id: scene-001
narrationRef: n1
background: shade1
transitionOut:
  type: slideContinuity
  durationInFrames: 24
  params:
    carryAssetId: heroImage
assets[2]:
  - id: titleText
    assetType: TextBlock
    anchor:
      position: top-left
      offsetXPercent: 6
      offsetYPercent: 10
    contentOverride:
      text: "Why most AI videos look like slideshows"
    styleOverride:
      typography: heading1
      align: left
    enterAt: 0
    exitAt: 0.9
  - id: heroImage
    assetType: ImageReveal
    anchor:
      position: right
      offsetXPercent: -8
      offsetYPercent: 0
    contentOverride:
      src: ""
      alt: hero
    styleOverride:
      borderRadius: 32
      revealDirection: left-to-right
      width: 640
      height: 640
    enterAt: 0.05
    exitAt: 1
```

Notes:

- `assets[2]:` still declares the count (`[2]`), even though tabular form isn't used —
  the length hint helps both human and model check the array they're emitting against the
  expected shape. Items follow, each prefixed with `- `.
- Color tokens (`shade1`, `heading1` via `styleOverride.typography`) are still resolved
  against `styles/theme.toon` exactly as in the JSON form. The loader produces the same
  plain object the schema validator and resolver see — no parser awareness of tokens.
- Reference: [scene.md](../reference/scene.md), [asset-spec.md](../reference/asset-spec.md).
  ⛔ `manifest.scenes[].id === scene file id`, narrationRef existence, anchor `position`
  one of the 9 valid — all enforced identically against the decoded object.

## Switching an existing project to TOON

Per-file, mechanical. Pick a file:

1. Decode its JSON (`cat config.json | npx @toon-format/toon --encode`, or by hand).
2. Write the `.toon` form alongside the `.json`, following the patterns above.
3. Update the manifest path strings to the new extension (e.g. `config: config.toon`).
4. Run `validate.js` — the schema check runs against the decoded object, so if you got a
   field wrong you'll see the familiar Ajv error, no format-specific surprises.
5. `resolve.js` and `render.js` need no changes — they see the same plain object.

You can keep some files in JSON and switch only the ones with high uniformity (manifest,
config). Hybrid projects are fine; the loader decides per-file by extension.

## Common pitfalls

- **Forgetting to update path strings.** `manifest.config: config.toon` still pointing at
  `config.json` after a rename → "cannot read …" throw at validate. The loader doesn't
  fall back to alternate extensions; the path string in the manifest is the source of
  truth.
- **Mixing field order in tabular rows.** Tabular form is positional. If the header is
  `{id,start,end,path}` and a row is `voiceover,0,8.5,audio/voiceover.mp3`, the order must
  match — there are no field labels per row. If you add or remove a field, update every
  row.
- **Unquoted leading special chars in values.** Color literals starting with `#` (e.g.
  `#0B0E14`) need double quotes, otherwise TOON's value parser treats `#` as comment-like.
  Same for any value that starts with `@`, `[`, `{`, `,`, or whitespace. When in doubt,
  quote; it's still cheaper than JSON's quotes-on-everything.
- **Commas in text values.** Narration text entries with commas (very common) need to be
  wrapped in double quotes so the tabular parser doesn't split the field. The example
  manifest's `n2` entry does exactly this.
- **Tabular form where it doesn't fit.** `assets[]` is the canonical "don't tabulate"
  case for this project — different `assetType`s yield different override schemas. Forcing
  them into tabular form drops either fields or readability; list form (`- `) is correct
  here. The check is simple: if the field set across items varies a lot, use list form.

## The pipeline command is unchanged

```bash
# Default manifest path is already the TOON example:
node src/pipelines/pipeline1-validate/validate.js studio/manifest/example-project/manifest.toon
node src/pipelines/pipeline2-resolve/resolve.js  studio/manifest/example-project/manifest.toon
node src/pipelines/pipeline3-render/render.js    out/video.mp4
```

`validate.js` and `resolve.js` accept a manifest path as argv — both already point at
`manifest.toon` by default per the source file invariants above. `render.js` operates on
`resolved.json`, which is pure JSON and never touched by the TOON loader at runtime.
