---
name: render-project
description: "Use when rendering an MP4 from a json.mp4 project manifest. Three-stage pipeline: validate -> resolve -> render."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [video, render, json-to-mp4, pipeline, toon, remotion]
    related_skills: [json-to-mp4-render]
---

# render-project

## What

Turn a wired json.mp4 project folder into an MP4. Three-node pipeline, run in order:

```
validate manifest  ->  resolve -> resolved.json  ->  render -> out/video.mp4
```

Each stage trusts only the previous stage's output. Render reads `resolved.json` only — never the manifest, styles, or asset registries. So resolved graph must be fresh before render, or visuals are stale.

## When

- Project folder exists under `studio/manifest/<project>/` with a `manifest.toon` (or `manifest.json`) and the scene/config/style files it references.
- User says "render this project", "produce the mp4", "build the video".
- Fastest first render: run `studio/manifest/example-project/` — fully `.toon`, wired, renders clean in ~40s.

## When not

- Filling `boilerplate/` placeholders → see in-repo `json-to-mp4-render` skill (it has the fill checklist + schema-required fields).
- Authoring a new asset/transition → `docs/agent-guide/assets/authoring-new.md`.
- TTS server must run for narrated timing; see "TTS" pitfall below.

## Layout (project folder)

```
studio/manifest/<project>/
  manifest.toon        # or manifest.json — routes config/styles + scene list + narration/audioOverlay
  config.toon           # fps, width, height, defaultSceneDurationInFrames (all numbers)
  styles/theme.toon     # colors, typography, spacing, easing — tokens resolved downstream
  scenes/scene-001.toon # id, narrationRef, background, transitionOut, assets[]
  ...
```

`.toon` and `.json` are interchangeable per-file; loader picks by extension. Paths in manifest MUST match the on-disk extension. See `docs/agent-guide/recipes/toon-manifest.md`.

## Commands (run from repo root `/home/tablewares/json.mp4`)

Tenant: pass manifest path to stages 1-2; stage 3 renders `resolved.json` to `out/video.mp4`.

```bash
# 1. validate — schema + cross-reference check (id match, narrationRef existence)
node src/pipelines/pipeline1-validate/validate.js studio/manifest/<project>/manifest.toon
# expect: OK: N scene(s) validated for project "..."

# 2. resolve — tokens->values, anchors->pixels, timing attached, transitions bundled
node src/pipelines/pipeline2-resolve/resolve.js  studio/manifest/<project>/manifest.toon
# expect: done   (writes ./resolved.json at repo root; also see [overlap-warning] lines — non-fatal)

# 3. render — bundles src/index.jsx via Remotion, renders "Video" composition
node src/pipelines/pipeline3-render/render.js    out/video.mp4
# expect: Done.   (a Remotion "Target closed"/"Protocol error" line at exit is benign teardown noise — exit 0 = success)
```

One-shot for the default project (already points at `studio/manifest/example-project/manifest.toon`):

```bash
npm run build   # = validate && generate:registry && resolve && render
```

`generate:registry` rescans `studio/{assets,graphics,transitions}`. Re-run it (or `npm run prebuild`) after adding/renaming an asset folder — else `Composition.jsx` throws a "component not found" or root-count error at render.

## Verify the MP4

```bash
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 out/video.mp4
```

Expect: `codec_name=h264`, `width=1920`, `height=1080`, `r_frame_rate=30/1`, `duration` = total scene frames / fps. For a narration-driven project this is the TTS-aligned timeline (example-project ~8.08s); for a no-narration project it is `scenes * defaultSceneDurationInFrames / fps`.

## TOON syntax essentials

Headers declare the field list once, then one row per item. Positional — order in header = order in every row.

```toon
# keyed tabular array — common at manifest layer
narration:
  entries[2]{id,text}:
    n1,Why most AI videos look like slideshows.
    n2,"Because they resolve every asset independently, with no shared registry and no continuity."
audioOverlay[1]{id,start,end,path}:
  voiceover,0,8.5,audio/voiceover.mp3
scenes[2]{id,path}:
  scene-001,scenes/scene-001.toon
  scene-002,scenes/scene-002.toon
```

Scene `assets[]` uses **list form** (assets vary in shape — different `assetType`s yield different override schemas):

```toon
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
```

Rules that bite: (a) quote any value starting with `#`, `@`, `[`, `{`, `,`, or whitespace (TOON treats `#` as comment); (b) wrap tabular row values containing commas in double quotes (narration text is the usual offender); (c) keep the length hint `[N]` in sync with the row count — helps both you and the loader audit shape.

Reference: `docs/agent-guide/recipes/toon-manifest.md`.

## Common Pitfalls

1. **Stale `resolved.json`.** Edited scene/style but skipped stage 2 → render shows old visuals. Fix: always re-run `resolve.js` after any manifest/scene/style edit, then `render.js`. Treat the resolved graph as the single render input.

2. **Path extension mismatch.** `manifest.config: config.toon` still pointing at `config.json` after a rename → "cannot read …" throw at validate. Path string is the source of truth; loader doesn't fall back to alternate extensions.

3. **`null` placeholder left behind.** Boilerplate `config` ships `null` for fps/width/height. Ajv rejects `null` for `type: number`. Replace every null with a real number before validating.

4. **`Unknown assetType "X"`.** Scene references an asset folder that doesn't exist under `studio/assets/` or `studio/graphics/`. Resolve throws. Fix: use a folder that exists (`ls studio/assets studio/graphics`), or author the new asset first (`docs/agent-guide/assets/authoring-new.md`).

5. **Registry drift.** Added/renamed an asset folder and skipped `generate:registry` → `Composition.jsx` throws at render. Fix: `node src/registry/generateRegistryManifest.js` (or `npm run prebuild`) before stage 2.

6. **TTS server not running.** Resolve calls `external/tts-provider.js` when `manifest.narration` is present. No narration, no audio → omit `narration` from manifest and every scene's `narrationRef` resolves to `""`. Schema still requires `narrationRef` (use `""`); resolve skips timing when `manifest.narration` is absent and falls back to `defaultSceneDurationInFrames`. `audioOverlay: []` and you get a silent render.

7. **Composition id hardcoded.** `render.js` selects `"Video"`. Moved `src/index.jsx` or renamed the id → `composition of id "Video" not found`. Don't move the entry.

8. **Carry asset id broken across the cut.** `slideContinuity` `transitionOut.params.carryAssetId` MUST exist with the same `id` in BOTH scenes. Resolve throws if only one side has it. You may change everything else (size, anchor, style) about the carried asset across the cut — just not its id.

9. **Text-block overlap warning.** `studio/assets/TextBlock/manifest.json` ships `defaultSize: 900x200`. A text asset whose `styleOverride` omits `width`/`height` gets a 900x200 box far larger than its glyphs, so a short kicker anchored `top-left` swallows a centered headline. Resolve warns `[overlap-warning]` (non-fatal, exit 0) then they overlap on screen. Fix: give text assets explicit `styleOverride.width` + `height`; nudge `offsetYPercent` ±2-4 if boxes still collide. See `json-to-mp4-overlap-warnings` skill for a Python rect pre-check.

10. **Remotion "Target closed"/"Protocol error" at exit.** Benign teardown noise. Check exit code is 0 and `Done.` printed. Not a render failure.

## Verification Checklist

- [ ] Project folder complete: `manifest.toon`, `config`, `styles/theme`, every scene path resolves.
- [ ] No `null` placeholders remaining; no `{{...}}` template tokens.
- [ ] `validate.js` prints `OK: N scene(s) validated`.
- [ ] `resolve.js` prints `done`; `./resolved.json` has the correct `projectId` and fresh scene count. (Skim `[overlap-warning]` lines; fix only if a real overlap.)
- [ ] `render.js` prints `Done.` with exit 0.
- [ ] `out/video.mp4` exists; `ffprobe` shows h264, expected fps + dimensions, duration matches the timeline.

## Scene authoring — full reference

Everything the renderer needs to render one scene. Applies to `.toon` and `.json` alike — extension only controls how the file is parsed, not the contract.

**Scene file** (`scenes/<id>.toon`) shape — required `id`; everything else optional:

```toon
id: scene-001
narrationRef: n1            # "" if no narration; schema still requires the key
background: shade1          # color token OR hex literal
transitionOut:              # omit for `default` transition
  type: slideContinuity      # see "Transitions" table below
  durationInFrames: 24       # falls back to transition.manifest.defaultDurationInFrames
  params:                    # merged into the transition component's props
    carryAssetId: heroImage
  effects[2]:                # optional per-boundary SFX/visual fx (see "Transition effects")
    - id: thud
      kind: sfx
      offsetPercent: -10
      path: audio/sfx.mp3
      volume: 0.9
    - id: flash
      kind: visual
      offsetPercent: 0
      durationInFrames: 10
      assetType: ImageReveal
      anchor:
        position: center
      contentOverride:
        src: assets/white.avif
        alt: ""
      styleOverride:
        width: 1920
        height: 1080
        borderRadius: 0
        revealDirection: center-out
assets[2]:                   # list form (assets vary by assetType) — see asset-spec.md
  - id: titleText
    assetType: TextBlock
    anchor: { ... }
    contentOverride: { ... }
    styleOverride: { ... }
    enterAt: 0
    exitAt: 0.9
```

### Scene keys

| key | required | type | notes |
|---|---|---|---|
| `id` | required | string | ⛔ MUST equal the `id` in the `manifest.scenes[]` entry pointing at this file. |
| `narrationRef` | optional* | string | `*` the schema marks it required, but use `""` when `manifest.narration` is absent — resolve skips TTS timing and falls back to `defaultSceneDurationInFrames`. |
| `background` | optional | token \| literal | Unknown token → resolve throw listing known tokens. |
| `transitionOut` | optional | object | Handoff to the NEXT scene. Omit → `default` transition. See "Transitions" below. |
| `assets` | optional | array | Defaults to `[]`. Each entry — see "Asset spec" below. |

### Asset spec (one entry in `assets[]`)

| key | required | type | notes |
|---|---|---|---|
| `id` | optional | string | **Set it** if any transition's `carryAssetId` references this asset; auto-generated otherwise. Must match across both scenes of a carry. |
| `assetType` | required | string | ⛔ Must match a folder under `studio/assets/` or `studio/graphics/`. Unknown → resolve throw listing available types. |
| `anchor` | required | object | `position` (9 anchors: `center \| top \| bottom \| left \| right \| top-left \| top-right \| bottom-left \| bottom-right`) + optional `offsetXPercent` / `offsetYPercent` (signed % of composition width/height, default 0). ⛔ Unknown position → resolve throw. Anchor pulls the box back so the anchor point (not top-left) lands where requested. You never author pixels. |
| `contentOverride` | optional | object | What the asset shows. Shape = that asset's `manifest.contentOverrideSchema`. ⛔ Missing a `required` field → validate throw. |
| `styleOverride` | optional | object | How the asset looks. Shape = that asset's `manifest.styleOverrideSchema`. Unknown fields silently ignored; missing fields fall back to manifest `defaultStyle`. Tokens resolve against `styles/theme.toon`. |
| `enterAt` | optional | float `[0,1]` | Fraction of scene duration when the asset enters. Default `0`. |
| `exitAt` | optional | float `[0,1]` | Fraction when it exits. Default `1`. Multiplied by resolved `durationInFrames` → absolute `enterAtFrame`/`exitAtFrame`. |

**contentOverride vs styleOverride** — the rule: `contentOverride` = what (text, image src, chart bars). `styleOverride` = how (color, radius, easing, typography, width/height). Unsure which side a key lives on? Open `studio/<assets\|graphics>/<Type>/manifest.json` — the two schemas sit side-by-side, named explicitly.

**width / height** — set in `styleOverride` to override the asset manifest's `defaultSize`. Resolved size is what `resolveAnchor` uses to position the box; changing size shifts position predictably, never breaks the anchor contract. For text assets omitting `width`/`height` is **the** overlap-warning cause (TextBlock default is 900x200, far larger than its glyphs) — always set them.

### Shipped asset types

`ls studio/assets studio/graphics` to confirm what's present in this checkout.

| assetType | location | required contentOverride | notable styleOverride | default size |
|---|---|---|---|---|
| `TextBlock` | `studio/assets/` | `text` | `typography`, `align`, `backgroundColorToken`, `easing` | 900×200 ⚠ set width/height |
| `KineticText` | `studio/assets/` | `text` | `typography`, `align`, `easing`, `staggerFrames`, `wordPopScale`, `useNarrationTiming`, `width` | 1100×260 |
| `ImageReveal` | `studio/assets/` | `src` (path relative to `public/` or URL) ; `alt` optional | `borderRadius`, `easing`, `revealDirection` (`left-to-right \| top-to-bottom \| center-out`) | 640×640 |
| `BarChartRace` | `studio/graphics/` | `bars[]` each `{label, value, fillStyle?}` | `typography`, `easing`, `canvasFill`, `barFill`, `barWidth`, `barRadius`, `valueFormat` (`currency \| number \| compact`), `sortByValue` (`asc \| desc`), `staggerFrames` | 1400×520 |
| `TickerTape` | `studio/graphics/` | `tickers[]` each `{symbol, price, change?}` | `borderLine`, `trackFill`, `upFill`, `downFill`, `scrollPxPerSec`, `trackHeight`, `typography` | 1600×96 |

Path-of-truth per type: `studio/<assets\|graphics>/<Type>/manifest.json`. Open it before authoring content/style overrides — the schema fields above are summary, the manifest is authoritative.

### Transitions

Shipped — `studio/transitions/<Name>/`. Omit `transitionOut` → `default`. Unknown `type` silently falls back to `default`, **not** an error — if you intended a specific one, spell it right.

| type | one-line | carries asset | requires `params.carryAssetId` in BOTH scenes | notes |
|---|---|---|---|---|
| `default` | Fade + slight slide | no | — | Used when no continuity is requested |
| `shatterWipe` | Grid of tiles fly apart from center / reassemble inward | no | — | `params`: `cols`/`rows`/`throwDistance`. Carry-less but polished cut |
| `slideContinuity` | Morph a named asset's color + position across the cut | yes | ⛔ yes | The same `id` must appear in BOTH the outgoing and incoming scene; everything else about the asset (size, anchor, style) may change across the cut |

Authoring rule (cross-cut from `docs/agent-guide/transitions/using-transitions.md`): for any transition whose manifest `consumes.carriedAssets` is true, the `carryAssetId` must appear in both scenes. Resolve-time throw names the missing side: `Transition "..." on scene "..." requested carryAssetId "..." but it wasn't found in both the outgoing and incoming scene.`

`durationInFrames` falls back to the transition manifest's `defaultDurationInFrames` when omitted. The resolved bundle is attached symmetrically — `outgoing.transitionOut` AND `incoming.transitionIn` — so a transition component always has both sides without re-reading any scene file.

### Transition effects

Optional per-boundary SFX/visual effects, anchored to a scene's **resolved** ending frame. Lives under `scene.transitionOut.effects` (optional array; omit entirely for no effects — the default for every shipped manifest).

Each entry:

| key | required | meaning |
|---|---|---|
| `id` | no | Auto-generated (`sfx-N` / `fx-N`) if omitted |
| `kind` | yes | `"sfx"` or `"visual"` |
| `offsetPercent` | yes | `0` = exactly the last frame; `-10` = 10% before end; `+10` = 10% *past* nominal end into the overlap padding reserved for the transition. Clamped to `[0, durationInFrames]` |
| `durationInFrames` | no | `sfx`: omit → clip plays natural length. `visual`: how long the effect asset stays mounted (default `30`) |
| `path` | sfx only | Audio file path relative to `public/` |
| `volume` | sfx only | `0–1`, default `1` |
| `assetType` | visual only | Must match a registered assetType — a boundary effect is literally one of the existing renderable assets, instantiated at a scene-end-relative time |
| `anchor` | visual only | Same shape as an asset's `anchor`. Defaults to `center` |
| `contentOverride` | visual only | Same shape as that assetType's `contentOverride` |
| `styleOverride` | visual only | Same shape as that assetType's `styleOverride` |

Writing the timing formula in one place — `src/timing/effectTiming.js`, `resolveEffectFrame(offsetPercent, sceneDurationInFrames)`. Nothing else does this arithmetic.

Backward-compat: `effects` optional + not in `required`, so all existing scenes validate unchanged; resolve short-circuits to `[]`; render guards with `?? []`. No boundary after the *last* scene (no scene to attach `transitionOut.effects` to).

### Token vs literal

Every visual property (color, typography, easing) can be a **token** string (`shade1`, `heading1`, `gentleSpring`) — resolved against `styles/theme.toon` so changing the token's value in one place updates every scene using it — OR a **literal** (`#112233`) for one-off escape cases. Prefer tokens. Unknown tokens throw listing the known ones — you can't silently typo a token into a wrong color. Resolution is centralized in `src/registry/styleRegistry.js` (`resolveColorToken`, `resolveTypographyToken`, `resolveEasingToken`, `resolveAssetStyle`).

### Putting it together — a multi-scene render in toon

Working example: `studio/manifest/render-demo-toon/` (3 scenes, 4 asset types, two transition types, transition effects, continuity carry, no TTS). Renders to a ~10.5s h264 mp4.

```bash
node src/pipelines/pipeline1-validate/validate.js studio/manifest/render-demo-toon/manifest.toon
node src/pipelines/pipeline2-resolve/resolve.js  studio/manifest/render-demo-toon/manifest.toon
node src/pipelines/pipeline3-render/render.js    out/render-demo-toon.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 out/render-demo-toon.mp4   # 10.496000
```

Manifest referencing 3 scenes — tabular form for the router:

```toon
scenes[3]{id,path}:
  scene-hook,scenes/scene-001.toon
  scene-globe,scenes/scene-002.toon
  scene-arrive,scenes/scene-003.toon
```

Scene 1's `transitionOut` with `shatterWipe` + effects — `effects[2]:` uses list form because sfx and visual entries have different shapes:

```toon
transitionOut:
  type: shatterWipe
  durationInFrames: 22
  params:
    cols: 6
    rows: 4
    throwDistance: 220
  effects[2]:
    - id: shatter-thud
      kind: sfx
      offsetPercent: -10
      path: audio/sfx.mp3
      volume: 0.9
    - id: shatter-flash
      kind: visual
      offsetPercent: 0
      durationInFrames: 10
      assetType: ImageReveal
      anchor:
        position: center
      contentOverride:
        src: assets/white.avif
        alt: ""
      styleOverride:
        width: 1920
        height: 1080
        borderRadius: 0
        revealDirection: center-out
```

Scene 2's carry into scene 3 — same `id: heroImage` on both sides (anchor + size change across the cut; id stays). Scene 2 selects `slideContinuity` and names `carryAssetId`:

```toon
# scene-002.toon (outgoing)
transitionOut:
  type: slideContinuity
  durationInFrames: 24
  params:
    carryAssetId: heroImage
assets[4]:
  - id: heroImage
    assetType: ImageReveal
    anchor:
      position: center
      offsetXPercent: -10
    contentOverride:
      src: assets/network.png
      alt: "..."
    styleOverride:
      revealDirection: center-out
      easing: gentleSpring
      width: 640
      height: 640
    enterAt: 0.05
    exitAt: 0.95
```

```toon
# scene-003.toon (incoming) — same id, different anchor/size/src
assets[4]:
  - id: heroImage
    assetType: ImageReveal
    anchor:
      position: top-right
      offsetXPercent: -14
      offsetYPercent: 20
    contentOverride:
      src: assets/destination.png
      alt: "..."
    styleOverride:
      revealDirection: left-to-right
      easing: gentleSpring
      width: 480
      height: 480
    enterAt: 0.04
    exitAt: 0.95
```

That pair — identical `id` on both sides, `slideContinuity` names it as `carryAssetId` — is the canonical "AI video, not slideshow" pattern. The transition morphs position + style + src across the cut; the eye tracks the same object into a new layout.

### Final-scene authoring rules

- The last scene's `transitionOut` is ignored — there's no next scene to hand off to, and pass 2's loop only sets `transitionIn` on the *incoming* side, so a final scene only ever gets `transitionIn` from the previous scene's `transitionOut`.
- There is no "after the last scene" boundary for effects. A boundary effect lives on `transitionOut.effects`, and the last scene has no `transitionOut` consumer — do not attach `effects` there.
- `narrationRef: ""` on every scene + no `narration` block in the manifest → every scene's `durationInFrames = config.defaultSceneDurationInFrames`. No TTS server looked up. This is the fast-iteration path used by `render-demo-toon` above (3 × 120 frames + 2 × 24 transition frames ≈ 10.5s at 30fps).

