---
name: render-project
description: "Use when rendering an MP4 from a json.mp4 project manifest. Three-stage pipeline: validate -> resolve -> render. The golden reference project is studio/manifest/fed-2026/."
version: 1.2.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [video, render, json-to-mp4, pipeline, toon, remotion, golden-reference]
    related_skills: [json-to-mp4-render]
---

# render-project

Render a json.mp4 project folder to MP4. Pipeline:

```
manifest.toon -> validate -> resolve -> resolved.json -> render -> out/<id>.mp4
```

Each stage trusts only the previous stage's output. Render reads `resolved.json` only — never the manifest, styles, or registries. Re-resolve after any manifest/scene/style edit or visuals go stale.

The **golden reference project** is `studio/manifest/fed-2026/` (7 scenes, narration, custom SVG assets, carry chains, transitions, transition SFX). New projects should mirror its structure and the recipe in the "Building a golden-reference project" section below.

## When

- Project folder exists under `studio/manifest/<project>/` with `manifest.toon` (or `.json`) + the scene/config/style files it references.
- User says "render this project", "produce the mp4", "build the video".
- Fastest first render: `studio/manifest/example-project/` — fully `.toon`, wired.
- Don't use for: authoring new asset/transition components (`docs/agent-guide/assets/authoring-new.md`), or filling `boilerplate/` placeholders (in-repo `json-to-mp4-render` skill has the fill checklist).

## Project layout

```
studio/manifest/<project>/
  manifest.toon        # routes config/styles + scene list + narration/audioOverlay
  config.toon           # fps, width, height, defaultSceneDurationInFrames (all numbers)
  styles/theme.toon     # colors, typography, spacing, easing — tokens resolved downstream
  scenes/scene-001.toon # id, narrationRef, background, transitionOut, assets[]
```

`.toon` and `.json` are interchangeable per-file; loader picks by extension. Path strings in the manifest MUST match the on-disk extension — the loader doesn't fall back.

## Render (run from repo root `/home/tablewares/json.mp4`)

```bash
node src/pipelines/pipeline1-validate/validate.js studio/manifest/<project>/manifest.toon
# OK: N scene(s) validated for project "..."

node src/pipelines/pipeline2-resolve/resolve.js studio/manifest/<project>/manifest.toon
# done   (writes ./resolved.json; [overlap-warning] lines are non-fatal)

node src/pipelines/pipeline3-render/render.js out/<project>.mp4
# Done.   (Remotion "Target closed"/"Protocol error" at exit is benign teardown noise — exit 0 = success)
```

One-shot orchestrator (mirrors `npm run build`, targets any project manifest):

```bash
node scripts/render-project.mjs studio/manifest/<project>/manifest.toon [out/custom.mp4]
# default manifest = studio/manifest/example-project/manifest.toon
# default output    = out/<projectId>.mp4  (out/video.mp4 if unknown)
# runs: validate -> generate:registry -> resolve -> render, aborts on first failure
```

`npm run build` itself now delegates to the orchestrator (`package.json` `build` script = `node scripts/render-project.mjs`), so it accepts the same positional args via `--`:

```bash
npm run build                                                    # default -> out/example-project.mp4
npm run build -- studio/manifest/<project>/manifest.toon         # -> out/<projectId>.mp4
npm run build -- studio/manifest/<project>/manifest.toon out/custom.mp4
npm run build:help                                              # prints orchestrator usage
```

`generate:registry` rescans `studio/{assets,graphics,transitions}` into `studio/generated/registry.generated.json`. The orchestrator already runs it between validate and resolve, so adding/renaming an asset folder is picked up automatically; if you call the three node commands directly instead, run `node src/registry/generateRegistryManifest.js` (or `npm run prebuild`) before resolve — else `Composition.jsx` throws "component not found"/root-count at render.

## Verify

```bash
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 out/<project>.mp4
```

Expect: `codec_name=h264`, `width=1920`, `height=1080`, `r_frame_rate=30/1`, `duration` matches the timeline. Narration-driven = TTS-aligned (example-project ~8.08s); no-narration = `scenes * defaultSceneDurationInFrames / fps`.

## Getting assets (images, audio, video)

All files live in `public/` (audio → `public/audio/`, images → `public/assets/`). Manifest paths are relative to `public/`. To find/download/prepare media before authoring scenes, follow `docs/skills/assetlibrary/` — YouTube search, yt-dlp download, SFX slicing, image search, and manifest wiring are all documented there, one method per doc.

## TOON syntax

Headers declare the field list once, then one row per item. Positional: header order = every row's order. Tabular form is the win for uniform arrays; list form (`- ` items) when item shapes vary.

```toon
# tabular — uniform rows (manifest layer)
narration:
  entries[2]{id,text}:
    n1,Why most AI videos look like slideshows.
    n2,"Because they resolve every asset independently, no shared registry, no continuity."
audioOverlay[1]{id,start,end,path}:
  voiceover,0,8.5,audio/voiceover.mp3
scenes[2]{id,path}:
  scene-001,scenes/scene-001.toon
  scene-002,scenes/scene-002.toon

# list form — items vary (scene assets[])
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

Rules that bite: (a) quote any value starting with `#`, `@`, `[`, `{`, `,`, or whitespace (TOON treats `#` as comment); (b) wrap tabular row values containing commas in double quotes (narration text is the usual offender); (c) keep the `[N]` length hint in sync with the row count.

## Scene file (full contract)

Applies to `.toon` and `.json` alike — extension only controls parsing. Required `id`; everything else optional.

```toon
id: scene-001
narrationRef: n1            # "" if no narration; schema still requires the key
background: shade1          # color token OR hex literal; unknown token -> resolve throw
transitionOut:              # omit for `default` transition
  type: slideContinuity
  durationInFrames: 24       # falls back to transition.manifest.defaultDurationInFrames
  params:                    # merged into the transition component's props
    carryAssetId: heroImage
  effects[2]:                # optional per-boundary SFX/visual fx (see below)
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
assets[2]:                   # list form (assets vary by assetType)
  - id: titleText
    assetType: TextBlock
    anchor: { ... }
    contentOverride: { ... }
    styleOverride: { ... }
    enterAt: 0
    exitAt: 0.9
```

### Scene keys

| key | required | notes |
|---|---|---|
| `id` | required | ⛔ MUST equal the `id` in the `manifest.scenes[]` entry. |
| `narrationRef` | optional* | `*` schema marks it required; use `""` when `manifest.narration` is absent → resolve skips TTS timing, falls back to `defaultSceneDurationInFrames`. If set, must match a `narration.entries[].id`. |
| `background` | optional | color token \| hex literal. Unknown token → resolve throw listing known tokens. |
| `transitionOut` | optional | Handoff to NEXT scene. Omit → `default`. See "Transitions" below. Ignored on the last scene. |
| `assets` | optional | Defaults to `[]`. Each entry — see "Asset spec" below. |

### Asset spec (one entry in `assets[]`)

| key | required | notes |
|---|---|---|
| `id` | optional | **Set it** if any transition's `carryAssetId` references this asset (auto-generated otherwise). Must match across both scenes of a carry — everything else (size, anchor, style, src) may change across the cut. |
| `assetType` | required | ⛔ Must match a folder under `studio/assets/` or `studio/graphics/`. Unknown → resolve throw listing available types. |
| `anchor` | required | `position` (9 anchors: `center \| top \| bottom \| left \| right \| top-left \| top-right \| bottom-left \| bottom-right`) + optional `offsetXPercent`/`offsetYPercent` (signed % of composition width/height, default 0). Pulls the box back so the anchor point (not top-left) lands where requested. You never author pixels. |
| `contentOverride` | optional | What the asset shows. Shape = that asset's `manifest.contentOverrideSchema`. ⛔ Missing a `required` field → validate throw. |
| `styleOverride` | optional | How the asset looks. Shape = that asset's `manifest.styleOverrideSchema`. Unknown fields silently ignored; missing fields fall back to manifest `defaultStyle`. Tokens resolve against `styles/theme.toon`. |
| `enterAt` | optional | float `[0,1]` fraction of scene duration when the asset enters. Default `0`. |
| `exitAt` | optional | float `[0,1]` fraction when it exits. Default `1`. × resolved `durationInFrames` → absolute `enterAtFrame`/`exitAtFrame`. |

**contentOverride vs styleOverride:** `contentOverride` = what (text, image src, chart bars). `styleOverride` = how (color, radius, easing, typography, width/height). Unsure which side a key lives on? Open `studio/<assets\|graphics>/<Type>/manifest.json` — the two schemas sit side-by-side.

**width/height** — set in `styleOverride` to override the manifest `defaultSize`. Resolved size is what `resolveAnchor` uses to position the box. For text assets omitting `width`/`height` is **the** overlap-warning cause (TextBlock default is 900×200, far larger than its glyphs) — always set them.

### Shipped asset types

`ls studio/assets studio/graphics` to confirm what's present. `studio/<assets\|graphics>/<Type>/manifest.json` is authoritative — open it before authoring overrides.

| assetType | location | required contentOverride | notable styleOverride | default size |
|---|---|---|---|---|
| `TextBlock` | `studio/assets/` | `text` | `typography`, `align`, `backgroundColorToken`, `easing` | 900×200 ⚠ set width/height |
| `KineticText` | `studio/assets/` | `text` | `typography`, `align`, `easing`, `staggerFrames`, `wordPopScale`, `useNarrationTiming`, `width` | 1100×260 |
| `ImageReveal` | `studio/assets/` | `src` (path relative to `public/` or URL); `alt` optional | `borderRadius`, `easing`, `revealDirection` (`left-to-right \| top-to-bottom \| center-out`) | 640×640 |
| `BarChartRace` | `studio/graphics/` | `bars[]` each `{label, value, fillStyle?}` | `typography`, `easing`, `canvasFill`, `barFill`, `barWidth`, `barRadius`, `valueFormat` (`currency \| number \| compact`), `sortByValue` (`asc \| desc`), `staggerFrames` | 1400×520 |
| `TickerTape` | `studio/graphics/` | `tickers[]` each `{symbol, price, change?}` | `borderLine`, `trackFill`, `upFill`, `downFill`, `scrollPxPerSec`, `trackHeight`, `typography` | 1600×96 |

To add a new asset type: author the folder + component per `docs/agent-guide/assets/authoring-new.md`, then re-run `generate:registry`.

### Transitions

Shipped: `studio/transitions/<Name>/`. Omit `transitionOut` → `default`. Unknown `type` silently falls back to `default` (not an error) — spell it right if you intend a specific one. `durationInFrames` falls back to the transition manifest's `defaultDurationInFrames`. The resolved bundle attaches symmetrically (`outgoing.transitionOut` AND `incoming.transitionIn`) so a transition component always has both sides without re-reading any scene file.

| type | one-line | carries asset | `params.carryAssetId` in BOTH scenes | notes |
|---|---|---|---|---|
| `default` | Fade + slight slide | no | — | No continuity |
| `shatterWipe` | Grid of tiles fly apart from center / reassemble inward | no | — | `params`: `cols`/`rows`/`throwDistance`. Polished cut |
| `slideContinuity` | Morph a named asset's color + position across the cut | yes | ⛔ yes | Same `id` in both scenes; everything else may change across the cut |

Carry contract (for any transition whose manifest `consumes.carriedAssets` is true): `carryAssetId` must appear in BOTH outgoing and incoming scene. Resolve-time throw names the missing side: `Transition "..." on scene "..." requested carryAssetId "..." but it wasn't found in both the outgoing and incoming scene.`

### Transition effects

Optional per-boundary SFX/visual effects, anchored to a scene's **resolved** ending frame. Lives under `scene.transitionOut.effects` (optional array; omit entirely for no effects — the default for every shipped manifest).

| key | required | meaning |
|---|---|---|
| `id` | no | Auto-generated (`sfx-N` / `fx-N`) if omitted |
| `kind` | yes | `"sfx"` or `"visual"` |
| `offsetPercent` | yes | `0` = last frame; `-10` = 10% before end; `+10` = 10% past nominal end into transition-overlap padding. Clamped to `[0, durationInFrames]` |
| `durationInFrames` | no | `sfx`: omit → natural clip length. `visual`: how long the asset stays mounted (default `30`) |
| `path` | sfx only | Audio path relative to `public/` |
| `volume` | sfx only | `0–1`, default `1` |
| `assetType` | visual only | Must match a registered assetType — a boundary effect is an existing renderable asset instantiated at a scene-end-relative time |
| `anchor` | visual only | Same shape as an asset's `anchor`. Defaults to `center` |
| `contentOverride` | visual only | Same shape as that assetType's `contentOverride` |
| `styleOverride` | visual only | Same shape as that assetType's `styleOverride` |

Timing math lives in one place: `src/timing/effectTiming.js`, `resolveEffectFrame(offsetPercent, sceneDurationInFrames)`. No boundary after the *last* scene — do not attach `effects` to a final scene's `transitionOut` (it has no consumer).

### Token vs literal

Every visual property (color, typography, easing) can be a **token** (`shade1`, `heading1`, `gentleSpring`) resolved against `styles/theme.toon` — change the token once, every scene using it updates — OR a **literal** (`#112233`) for one-off cases. Prefer tokens. Unknown tokens throw listing the known ones (no silent typo into a wrong color). Resolution centralized in `src/registry/styleRegistry.js` (`resolveColorToken`, `resolveTypographyToken`, `resolveEasingToken`, `resolveAssetStyle`).

## Working examples

`studio/manifest/example-project/` — fully `.toon`, 2 scenes, narration + audioOverlay, continuity carry. Default of `npm run build`.

`studio/manifest/fed-2026/` — **golden reference**. 7 scenes, narrated (TTS synthesis), custom SVG graphical assets, two `slideContinuity` carry chains, `shatterWipe` transitions with `sfx` boundary effects, `CodeBlock` + `NumberStat` + `ListReveal` + `TickerTape` + `ImageReveal` asset types, design-system-styled theme (Claude DESIGN.md port: cream/coral/dark-navy + Cormorant Garamond serif / Inter sans / JetBrains Mono). Renders to a 76.5s narrated MP4 with zero overlap warnings. Read its files top-to-bottom before authoring a new narrated project; the recipe below reconstructs how it was built.

```bash
npm run build -- studio/manifest/fed-2026/manifest.toon
# out/fed-2026.mp4  (~76s, narrated, h264 1920x1080 30fps)
```

`studio/manifest/render-demo-toon/` — 3 scenes, 4 asset types, two transition types, transition effects, continuity carry, no TTS (fast-iteration path: `narrationRef: ""` on every scene + no `narration` block → each scene's `durationInFrames = config.defaultSceneDurationInFrames`, ~10.5s at 30fps).

```bash
node scripts/render-project.mjs studio/manifest/render-demo-toon/manifest.toon
# out/render-demo-toon.mp4  (10.496000s)
```

Carry pattern (the "AI video, not slideshow" move) — same `id: heroImage` on both sides, `slideContinuity` names it as `carryAssetId`. Anchor + size + src change across the cut; id stays. The transition morphs position+style+src; the eye tracks the same object into a new layout.

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
    anchor: { position: center, offsetXPercent: -10 }
    contentOverride: { src: assets/network.png, alt: "..." }
    styleOverride: { revealDirection: center-out, easing: gentleSpring, width: 640, height: 640 }
    enterAt: 0.05
    exitAt: 0.95

# scene-003.toon (incoming) — same id, different anchor/size/src
assets[4]:
  - id: heroImage
    assetType: ImageReveal
    anchor: { position: top-right, offsetXPercent: -14, offsetYPercent: 20 }
    contentOverride: { src: assets/destination.png, alt: "..." }
    styleOverride: { revealDirection: left-to-right, easing: gentleSpring, width: 480, height: 480 }
    enterAt: 0.04
    exitAt: 0.95
```

## Building a golden-reference project

The `fed-2026` project is the reference for a narrated, multi-scene, design-system-styled render. Reproduce a new project the same way:

### 1. Author the theme → `styles/theme.toon`

Define color tokens, typography tokens (fontFamily/fontSize/fontWeight/lineHeight/colorToken), spacing, and easing springs. Two font families is the sweet spot: one serif/sans for display, one sans for body, optionally a mono for `CodeBlock`. Each `typography.*` token is referenced by name from scene `styleOverride.typography` fields. Unknown tokens throw at resolve listing the known ones — typos cannot silently land a wrong color.

### 2. Gather or author media → `public/assets/`, `public/audio/`

Follow `docs/skills/assetlibrary/` doc-by-doc: `01-youtube-search` to `05-manifest-wiring` cover YouTube/SFX download, silence-based splitting, image search, and the `public/`-relative path contract. For brand/mark graphics, author SVGs directly (see pitfall 12 — `ImageReveal` rasterizes SVG natively in Remotion's headless Chrome, no PNG pre-conversion). One SVG per surface tone for marks that must read on both cream and dark; swap `src` across a `slideContinuity` carry.

### 3. Write the manifest → `manifest.toon`

Tabs (id/path), narration block (entries[] + fullTranscript), scenes[] list. Omit `audioOverlay` when narration is present — resolve builds the single `voiceover` track from the TTS provider's real output `path` (keyed by transcript hash, per-project wav at `public/audio/tts_<hash>.wav`). The transcript you write IS what gets synthesized and aligned, so each `entries[i].text` must match the on-screen beat you want timed to that narration slice.

### 4. Write scenes → `scenes/scene-XXX.toon`

Each scene:
- An opening `id` + `narrationRef` pointing at one `narration.entries[].id` (or `""` for a no-narration scene — schema still requires the key).
- A `background` color token (one of your theme's). Alternate surface tones scene-by-scene — cream → cream-card → dark → cream → dark is the editorial pacing rhythm.
- `transitionOut` on every scene except the last. Mix `shatterWipe` (hard cut, no carry) with `slideContinuity` (carry an asset id across the cut — same `id` in both scenes; anchor/size/src may change). Add `effects[]` (sfx and/or visual) anchored to the scene's resolved end frame — keep `effects[N]` in sync with the row count (pitfall 11).
- `assets[]` with explicit `styleOverride.width` + `height` on every text/image asset to defeat overlap warnings (pitfall 9, 13). Use `enterAt`/`exitAt` fractions (0–1) to stagger asset entrances against the narration timeline.

### 5. Validate → resolve → render

```bash
npm run build -- studio/manifest/<project>/manifest.toon
```

Watch the resolve stage output: `Timing for "n1": start=… end=…` confirms narration timing aligned; zero `[overlap-warning]` lines confirms a clean layout. Render prints `Done.` with exit 0. `ffprobe` the output to confirm h264, expected fps, dimensions, and a duration matching the narration timeline (narration-driven) or `scenes * defaultSceneDurationInFrames / fps` (no-narration).

The first narrated render synthesizes the wav (Kyutai TTS server must be running on `localhost:8000` — probe with `curl -s -m 2 http://localhost:8000/`). Subsequent runs with the same transcript hit the cache (no re-synthesis); change a word in `narration` and the cache key changes, forcing a fresh synthesis.

## Common Pitfalls

1. **Stale `resolved.json`.** Edited scene/style, skipped resolve → stale visuals. Fix: always re-run `resolve.js` after any manifest/scene/style edit, then `render.js`. (The orchestrator does this for you in order.)

2. **Path extension mismatch.** `manifest.config: config.toon` still pointing at `config.json` after a rename → "cannot read …" throw at validate. Path string is the source of truth; the loader doesn't fall back to alternate extensions.

3. **`null` placeholder left behind.** Boilerplate `config` ships `null` for fps/width/height. Ajv rejects `null` for `type: number`. Replace every null with a real number before validating.

4. **`Unknown assetType "X"`.** Scene references a folder that doesn't exist under `studio/assets/` or `studio/graphics/`. Fix: use a folder that exists (`ls studio/assets studio/graphics`), or author the new asset first (`docs/agent-guide/assets/authoring-new.md`).

5. **Registry drift.** Added/renamed an asset folder, skipped `generate:registry` → `Composition.jsx` throws at render. Fix: `node src/registry/generateRegistryManifest.js` (or `npm run prebuild`) before resolve. The orchestrator runs this between validate and resolve.

6. **TTS server not running / narrated audio path.** Resolve calls `external/tts-provider.js` when `manifest.narration` is present; that provider POSTs the concatenated transcript to the local Kyutai TTS server (`http://localhost:8000/tts`), then runs WhisperX word-level alignment to recover per-entry start/end times. The synthesized wav lands at `public/audio/tts_<sha256-of-transcript>.wav` (per-project, keyed by transcript hash — older runs hardcoded a single shared `hardcoded_voice.wav` that every narration-bearing project overwrote; the path is now keyed, and a cache hit for an older record still returns whatever path it stored). For a no-TTS render: omit `narration` from the manifest, set every scene's `narrationRef` to `""`, omit `audioOverlay`. Resolve skips timing, falls back to `defaultSceneDurationInFrames` per scene. (The shipped `public/audio/hardcoded_voice.wav` + its cache record are example-project's narration; `AudioOverlay` in `src/audio/overlay.jsx` renders the resolved `audioOverlay` array's `track.path` values — it is NOT hardcoded to any single file. With narration, resolve builds exactly one `voiceover` track from the TTS provider's real output `path`.)

7. **Composition id hardcoded.** `render.js` selects `"Video"`. Moved `src/index.jsx` or renamed the id → `composition of id "Video" not found`. Don't move the entry.

8. **Carry asset id broken across the cut.** `slideContinuity` `params.carryAssetId` MUST exist with the same `id` in BOTH scenes. Resolve throws naming the missing side. Everything else about the carried asset may change across the cut — just not its id.

9. **Text-block overlap warning.** `studio/assets/TextBlock/manifest.json` ships `defaultSize: 900×200`. A text asset whose `styleOverride` omits `width`/`height` gets a 900×200 box far larger than its glyphs, so a short kicker anchored `top-left` swallows a centered headline. Resolve warns `[overlap-warning]` (non-fatal, exit 0) then they overlap on screen. Fix: give text assets explicit `styleOverride.width` + `height`; nudge `offsetYPercent` ±2-4 if boxes still collide. See `json-to-mp4-overlap-warnings` skill for a Python rect pre-check.

10. **Remotion "Target closed"/"Protocol error" at exit.** Benign teardown noise. Check exit code is 0 and `Done.` printed. Not a render failure.

11. **TOON `[N]` length hint out of sync with rows.** TOON's tabular/list header carries a length (`assets[5]:`, `effects[2]:`, `bars[2]:`, `highlightLines[3]:`). The decoder counts the items under it and throws `Expected N ... items, but got M` at validate when the count mismatches the rows you actually wrote. This bites when you add an asset to a scene but forget to bump `assets[N]`, or drop an effect without bumping `effects[N]`. Fix: keep the `[N]` exactly equal to the row count, or use `highlightLines: [2, 3, 6]` inline-array form when the value is short. (The orchestrator aborts on the first failing stage, so this fails fast at validate — sub-second — not at render.)

12. **Custom SVG assets.** `ImageReveal` accepts any `src` Remotion's `<img>` can load, including `assets/foo.svg` (Remotion renders in headless Chrome, which rasterizes SVG natively — no PNG pre-conversion step needed). Author SVGs directly into `public/assets/` with a `viewBox` and explicit `width`/`height`; set `styleOverride.width`/`height` on the asset to the rendered pixel size. For brand marks that must read on both cream and dark surfaces, ship two variants (`foo.svg` in ink, `foo-on-dark.svg` in cream) and swap `src` across a `slideContinuity` carry — same `id`, different `src`. See `public/assets/fed-seal.svg` + `fed-seal-on-dark.svg` for the pattern.

13. **Overlap layout recipe (text + image in the same band).** The overlap warning fires when an image's anchor box overlaps a centered headline's anchor box, even if the visible glyphs don't touch — because the headline box is wide (e.g. 1500px centered = 210→1710 on a 1920 frame) and a top-right corner image sits inside that x-range. Reliable fix recipe:
    - Push the headline DOWN from `position: top` (raise `offsetYPercent` 20→26).
    - Push the corner image UP (lower `offsetYPercent` 12→6) and shrink it (120→96 px).
    - For a centered hero image vs a top headline, push the image DOWN (`offsetYPercent` 6→18) AND shrink its `height` (640→540) so its top edge clears the headline's bottom edge.
    - Re-run resolve; iterate until zero `[overlap-warning]` lines. The orchestrator's resolve stage is the only check — fix overlaps there before render, not after.

## Verification Checklist

- [ ] Project folder complete: `manifest.toon`, `config`, `styles/theme`, every scene path resolves.
- [ ] No `null` placeholders remaining; no `{{...}}` template tokens.
- [ ] `validate` prints `OK: N scene(s) validated`.
- [ ] `resolve` prints `done`; `./resolved.json` has the correct `projectId` + fresh scene count. (Skim `[overlap-warning]` lines; fix only if a real overlap.)
- [ ] `render` prints `Done.` with exit 0.
- [ ] `out/<id>.mp4` exists; `ffprobe` shows h264, expected fps + dimensions, duration matches the timeline.
- [ ] After adding/renaming an asset folder: `generate:registry` ran (orchestrator does this; manual `npm run prebuild` if calling node commands directly).
