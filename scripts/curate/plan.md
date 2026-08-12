# Pre-flight plan ( authored before any `agent-cli.mjs` build command )

A planning template an agent fills in *before* creating a render with this
framework. The build phase (`init` → `add-scene` → `add-asset` → `validate`
→ `render`) is mechanical once the design is on paper; the expensive mistakes
are design gaps that surface at render time. Fill every section below first,
then execute the Build section at the end.

The CLI writes the project; this doc is where you decide what it writes.

## How to use this doc

1. Copy this file into `.hermes/plans/<timestamp>-<projectId>-plan.md` (or
   fill it in place — no rule against that for solo runs).
2. Answer every section in order. Each section tells you which CLI commands
   to run to *discover* the options you're choosing between (read-only) and
   which curate doc to consult for the contract.
3. Do not run any *mutating* `agent-cli.mjs` command (`init`, `add-scene`,
   `add-asset`, `set-transition`, `add-camera-action`, `add-music`,
   `inject-effects`) until the entire plan is filled in.
4. The Build section at the end is a literal command sequence, copy-pasteable
   into `scripts/agent-batch.mjs` once the plan is complete.

Discovery commands (run these freely — they're read-only):
```bash
node scripts/agent-cli.mjs assets                   # list every asset type + one-line desc
node scripts/agent-cli.mjs asset <Type>             # full content/style schema for one type
node scripts/agent-cli.mjs transitions              # list every transition type + one-line desc
node scripts/agent-cli.mjs transition <Type>        # params schema for one transition
node scripts/agent-cli.mjs collections              # every asset-library collection workflow
node scripts/agent-cli.mjs collection <Name>        # command + destination + output fields
node scripts/agent-cli.mjs anchors                  # the 9 anchor.position values
node scripts/agent-cli.mjs envelope                 # scene/asset/effect field reference
```

---

## 1. Project identity

- **projectId** (lowercase, hyphens): ____________________
- **One-line intent** (what the video is *about*, in one sentence):
  ____________________________________________________________________
- **Total expected duration** (rough, seconds): ____
- **Target aspect ratio / resolution**: 1920×1080 (16:9) unless the run says otherwise
- **Narration?** yes / no  → if no, scenes are timed by
  `config.defaultSceneDurationInFrames` not TTS; skip section 4's TTS fields
  and section 6's narration-timing path.

## 2. Design surface

Per-run external context supplies these. **Do not invent defaults here** —
this framework deliberately encodes no design criteria (`SKILL.md` §
"avoid.md" → "Don't invent design criteria when none supplied"). If the run
gave no palette/typography/etc., ask the user before continuing.

- **Palette** (hex tokens — at minimum a dark, a light, an accent):
  - `shade1` (canvas dark): #________
  - `shade2` (panel dark): #________
  - `main1` (primary text): #________
  - `main2` (secondary text): #________
  - `accentBg` (accent): #________
  - (add any project-specific tokens below in section 9)
- **Typography** (per role — fontFamily / fontSize / fontWeight / lineHeight / colorToken):
  - `title`  : ________________________ / ____ / ____ / ___ / main1
  - `body`   : ________________________ / ____ / ____ / ___ / main2
  - `kicker` : ________________________ / ____ / ____ / ___ / main2
- **Easing presets** (spring tokens — damping / mass / stiffness). Optional;
  framework defaults exist. Only author if run specifies:
  - `gentleSpring` : ____ / ____ / ____
  - `snappy`       : ____ / ____ / ____
- **Composition rules** in force for this run:
  - Rule of thirds / golden ratio / power-point anchors? If yes, consult
    `docs/composition/composition-design-principles.md` for the exact
    offset-percents to use in section 7. If no, anchor `center` and stay
    symmetrical.
  - Is the run referencing `docs/designmd/DESIGN.md`? If yes, load it.

## 3. Audio sources — resolve via collections first

All audio files must land under `public/audio/` *before* any scene references
them. The manifest references assets as paths relative to `public/`. Source
them via the collection workflows, not by hand.

Run `node scripts/agent-cli.mjs collection <Name>` for exact command shape
of each. For each track you need:

### 3a. Background music (optional, `music` block)
| id | mood | source (search term / file) | collection to run | dest path under `public/audio/` | volume | loop | fadeIn / fadeOut |
|----|------|-----------------------------|--------------------|---------------------------------|--------|------|-------------------|
|    |      |                             | `youtubeSearch` → `ytDlpDownload` (or pre-existing file) |       | 0.25 | true | / |

### 3b. SFX / one-shots (optional, fired via boundary `effects` or `inject-effects`)
| id | beat | source | collection to run | dest path under `public/audio/` | volume |
|----|------|--------|--------------------|---------------------------------|--------|
|    |      |        | `youtubeSearch` → `ytDlpDownload` → `sfxSplit` (silence-splitter) |       | 0.6 |

### 3c. Manifest wiring
- After files land on disk, run `node scripts/agent-cli.mjs collection manifestWiring`
  to validate the path contract before referencing from a scene. Failing this
  is the #1 cause of `validate` passing but `render` crashing with
  `TypeError: Cannot read properties of undefined` on a media `src`.

## 4. Image sources — resolve via collections first

All still images must land under `public/assets/` before scene reference.
For each image asset you plan to use:

| asset id (must match across scenes if carried) | subject | source | collection to run | dest path under `public/assets/` |
|------------------------------------------------|---------|--------|--------------------|-----------------------------------|
|                                                |         |        | `imageSearch` (Yandex) + `curl` connection test |  |

**Yandex connection-test rule** (`avoid.md`): every `imageSearch` result is
a URL only — Yandex frequently returns captcha walls / redirect-to-CSS
placeholders / stale `img_url`s that 404. Before wiring, `curl -fsSL` one
`image_url`, then `file` the output to confirm real PNG/JPEG/AVIF with
dimensions (not an HTML error page). Re-run search or trigger a captcha solve
if it fails. Don't trust the JSON shape as proof of a downloadable image.

## 5. Narration (if section 1 said yes)

- **fullTranscript** (every word TTS will synthesize, in order — TTS aligns
  against this; missing words drift out of sync):
  ____________________________________________________________________
  ____________________________________________________________________
- **entries** (split the transcript; each `id` is referenced by a scene's
  `narrationRef` — split roughly by scene cadence):

| entry id | text |
|----------|------|
| n1       |      |
| n2       |      |
| n3       |      |

- **TTS provider**: `http` (default) | other (set on `init` if needed)
- **ttsHumanize**: default (on) | off | partial override (see `audio.md` §3)
- **Note** — if narration is absent, drop sections 5 + 7's `narrationRef`
  + the `useNarrationTiming` KineticText option. Scene durations fall back
  to `config.defaultSceneDurationInFrames`.

## 6. Scene breakdown

One row per scene, in cut order. `narrationRef` ties the scene's duration to
the TTS window for that entry; if no narration, put the intended
`durationInFrames` instead.

| # | sceneId | narrationRef (or duration) | intent (one phrase) | carried asset(s) (ids that appear in both this + next scene, for `slideContinuity` / `pivotZoom`) | transitionOut (type + carryAssetId) | background |
|---|---------|---------------------------|---------------------|----------------------------------------------------------------------------------------------|-------------------------------------|------------|
| 1 |         |                           |                     |                                                                                              |                                     |            |
| 2 |         |                           |                     |                                                                                              |                                     |            |
| 3 |         |                           |                     |                                                                                              | (null — last scene)                 |            |

- **Carry rules** (`style-transition.md`): for a `slideContinuity` or
  `pivotZoom` transition, the `carryAssetId` must exist in *both* the
  outgoing and the incoming scene. List those ids per row above.
- **Multi-asset carry** (new): if a transition's manifest declares
  `consumes.carriedAssets: true`, you can pass `params.carryAssetIds`
  (array) instead of `carryAssetId` to morph multiple elements. Transit
  bundle resolves to `carriesFrom`/`carriesTo` keyed-by-id. Use only if the
  transition component reads `carriesFrom`/`carriesTo` (slideContinuity does
  not yet — it reads the singular `carryFrom`/`carryTo`).

## 7. Per-scene asset list

For each scene, list every asset with the *exact* keys its type requires.
**Trust the contract, not the name** — before filling `contentOverride` for
any row, run `node scripts/agent-cli.mjs asset <Type>` and read
`content.required` — those are the only keys that *must* be set. Using `url`
when `src` is required passes `validate` but crashes `render`.

### Scene ___: ____

| asset id | assetType | anchor (position + ±% nudge) | enterAt / exitAt (fraction 0–1) | contentOverride (required keys per `asset <Type>`) | styleOverride (optional, see `asset <Type>`) | motion (`scripts/curate/asset/motion.md`) | z (stacking) |
|----------|-----------|------------------------------|----------------------------------|---------------------------------------------------|----------------------------------------------|------------------------------------------|--------------|
|          |           |                              | 0 / 1                            |                                                   |                                              |                                          |              |

Duplicate this table per scene. Common asset types in this repo's registry:
`TextBlock` (single text block), `KineticText` (word-by-word pop, syncs to
narration when `content.text` is word-for-word with the scene's narration),
`ImageReveal` (clip-path wipe + scale-in), `BackdropImage` (background layer
with optional vignette), `BarChartRace` / `TickerTape` (finance),
`CodeBlock` (line-staggered code panel), `WavyLine` (self-drawing connector
between two asset ids), `TextHighlight` (standalone marker sweep). Full list
via `node scripts/agent-cli.mjs assets`.

### Camera per scene (optional — `scripts/curate/cli-usage/camera.md`)
- form: start/end (two keypoints) | actions[] (multi-keypoint)
- start anchor / end anchor / easeZoom (bool)
- zoom fields (≥ 1, percent not fraction — 100 = unity):
- `followAssetId` anchor? (tracks an asset's resolved center, `edge` picks
  enter vs exit frame) | named-corner anchor?
- `durationInFrames` (optional sub-window) / `speed` (default 1)

### Boundary effects (optional — `timing.md` + `build.md`)
List any SFX/visual effects fired on this scene's exit cut, each with a
`timingAnchor`:
| effect id | kind (sfx/visual) | timing anchor (offsetPercent / relativeToAsset+edge / relativeToCameraAction) | payload (path+volume / assetType+anchor+contentOverride) |
|-----------|-------------------|--------------------------------------------------------------------------------|--------------------------------------------------------|
|           |                   |                                                                                |                                                        |

`inject-effects` is shorthand when the same effect hits the start or end of
*every* scene (writes `offsetPercent:-100` for enter, `0` for exit for you).
Use it instead of authoring per-scene when the pattern is global.

## 8. Transitions (summary — section 6 already chose per-scene)

| outgoing sceneId | transitionOut.type | durationInFrames | params (carryAssetId / carryAssetIds / etc. — run `transition <Type>` for exact) |
|------------------|--------------------|------------------|------------------------------------------------------------------------------------|
|                  |                    |                  |                                                                                    |

Available types (run `node scripts/agent-cli.mjs transitions`): `default`
(fade+slide), `slideContinuity` (carry one asset across cut), `pivotZoom`
(push-through around carried asset), `ShapeWipe` (expand-from-center),
`SplitScreen` (split-down-middle comparison), `WhipPan` (lateral motion
blur), `TransitionBoilerplate` (starter — adapt for new types).

## 9. Tokens to add beyond section 2 defaults

List any project-specific tokens to author on `init` (or add later by editing
the style registry — but there is no `update-styles` CLI, so best to bake them
into the `init` call's `colors`/`typography`/`easing`/`textures` overrides):

- **colors** (additional):    ______ : #______
- **typography** (additional): ______ : {fontFamily:___, fontSize:___, fontWeight:___, lineHeight:___, colorToken:___}
- **easing** (additional):    ______ : {damping:___, mass:___, stiffness:___}
- **textures** (additional — paths relative to `public/`, consumed by
  Remotion's `staticFile()`. Only needed if any scene's `background` is the
  object form with a `texture`):
  - ______ : public/______

## 10. Post-cinematography (optional — `post-effects.md`)

No CLI command — edit `studio/manifest/<projectId>/config.json` directly
(sanctioned exception, see `avoid.md`). Every key optional; omit for no
post-pass.

- [ ] vignette      : { strength: ___ }
- [ ] grain         : { strength: ___ }
- [ ] colorGrade    : { contrast:___, brightness:___, saturation:___, gamma:___ }
- [ ] letterbox     : { aspectRatio: ___ }
- (raw ffmpeg shell-out — `ffmpeg` must be on PATH; render throws a clear
  error naming the missing binary if absent)

## 11. Pitfalls to remember while building

- **Trust the contract, not the name.** `asset <Type>` before authoring any
  asset's `contentOverride`. `ImageReveal` uses `src` not `url`. Using the
  wrong key passes `validate` (generic object) but crashes `render`.
- **`carryAssetId` must exist in both outgoing + incoming scene.** Resolver
  throws naming the type, scene id, and missing id — not silent.
- **`zoomPercent` is in percent (≥ 1).** 100 = unity, 200 = 2×, 1.5 fails
  validation. `cameraAction.at` is a fraction `[0,1]` — frame 45 of 90 is
  `at:0.5`.
- **`exitAt < 1` on narration-riders cuts audio mid-word.** Asset disappears
  at `exitAt * sceneDuration` which can land before TTS finishes. Reserve
  `<1` for assets you explicitly want to leave early.
- **Don't hand-edit `studio/manifest/**`.** Go through `add-scene` /
  `add-asset` / `update-asset` / etc. Only sanctioned raw edits:
  `music` (manifest.json), `ttsHumanize` and `postEffects` (config.json) —
  each its own section above. (Note: `update-scene` does not exist — set
  `background` and scene-level fields at `add-scene` time; plan them in
  section 6 before building.)
- **Read `warnings` after every `add-asset` / `update-asset`.** Empty = clean;
  non-empty = fix before moving on. Don't wait for `validate`/`render`.
- **`offset_warn.js` warns, never blocks.** If `render` succeeds despite
  warnings, expected — read as sanity, don't edit the checker to silence.
- **Last scene has no `transitionOut` bundle** (no incoming scene to cut to),
  but authored `effects[]` on its exit boundary *are* still resolved. So
  `inject-effects` with `anchor:"exit"` on the last scene isn't dropped.

---

## Build (execute once every section above is filled in)

Every `'<json>'` arg below can also be `"-"` for stdin (large contentOverride
payloads avoid shell quoting issues that way). For 2+ commands in a row, use
`scripts/agent-batch.mjs` (see `post-effects.md` §"Batching many steps"); it
stringifies JSON for you and can `continueOnError` for independent steps.

### Step 0 — Resolve collections (sections 3 + 4)

Run the collection workflows identified in sections 3 and 4 *first*, so all
media lands under `public/audio/` and `public/assets/` before any scene
references them. For each row in section 3a/3b and section 4:

```bash
# example: download a YouTube track as background-music source
node scripts/agent-cli.mjs collection ytDlpDownload   # run for the exact command shape
node scripts/agent-cli.mjs collection sfxSplit          # if slicing SFX from a pack
node scripts/agent-cli.mjs collection imageSearch       # Yandex image search
# then for every result: curl -fsSL <url> | file -      # connection-test before wiring
node scripts/agent-cli.mjs collection manifestWiring    # validate path contract
```

### Step 1 — Init the project (section 1 + 2 + 5 + 9)

```bash
node scripts/agent-cli.mjs init '{
  "projectId": "<projectId>",
  "narration": {
    "entries": [
      { "id": "n1", "text": "<entry n1 text>" },
      { "id": "n2", "text": "<entry n2 text>" }
    ],
    "fullTranscript": "<full transcript from section 5, in order>"
  },
  "colors":     { "shade1":"#___", "shade2":"#___", "main1":"#___", "main2":"#___", "accentBg":"#___" },
  "typography": { "title":{__}, "body":{__}, "kicker":{__} },
  "easing":     { "gentleSpring":{__}, "snappy":{__} },
  "textures":   { "<token>": "public/<path>" }
}'
```
Override only the tokens you're changing — everything else keeps defaults.
Pass `"overwrite": true` to replace an existing project.

### Step 2 — Build scenes (section 6) + their assets (section 7)

For each scene in section 6's table, in cut order:

```bash
node scripts/agent-cli.mjs add-scene <projectId> '{
  "id": "<sceneId>",
  "narrationRef": "<n#>",
  "background": "<token | #hex | {color, texture, blendMode, opacity}>",
  "transitionOut": { "type": "<type>", "durationInFrames": <n>, "params": { "carryAssetId": "<id>" } }
}'

# then one add-asset per row in section 7's table for that scene
node scripts/agent-cli.mjs add-asset <projectId> <sceneId> '{
  "assetType": "<Type>",
  "anchor":    { "position": "<one of 9>", "offsetXPercent": <n>, "offsetYPercent": <n> },
  "contentOverride": { /* keys from `asset <Type>` content.required */ },
  "styleOverride":   { /* optional — keys from `asset <Type>` style */ },
  "enterAt": <0..1>,
  "exitAt":  <0..1>,
  "motion":  { /* scripts/curate/asset/motion.md */ },
  "z": <n>
}'
```

Camera (if the scene has one — `scripts/curate/cli-usage/camera.md`):
```bash
node scripts/agent-cli.mjs set-camera <projectId> <sceneId> '{ "easeZoom": true, "actions": [...] }'
# or the shorthand two-keypoint form: { start:{...}, end:{...}, zoomStartPercent:___, zoomEndPercent:___ }
# append further keypoints:
node scripts/agent-cli.mjs add-camera-action <projectId> <sceneId> '{ "at": ___, "anchor": {__}, "zoomPercent": ___ }'
```

### Step 3 — Wire audio (section 3)

```bash
# one add-music per row in section 3a (background music)
node scripts/agent-cli.mjs add-music <projectId> '{ "id":"<id>", "src":"/audio/<path>.mp3", "volume":0.25, "loop":true, "fadeInSeconds":1.5, "fadeOutSeconds":2 }'
# (`src` accepted as shorthand for `path`; CLI normalizes it)

# Boundary SFX / visuals (section 7 table): one add-effect per row, per scene
node scripts/agent-cli.mjs add-effect <projectId> <sceneId> '{ "id":"<id>", "kind":"sfx", "path":"audio/<f>.mp3", "volume":0.6, "timing":{<timingAnchor>} }'

# OR — if an effect hits every scene's start/end: inject-effects (shorthand)
node scripts/agent-cli.mjs inject-effects <projectId> '[{ "match":{"scene":"all"}, "anchor":"exit", "effect":{"kind":"sfx","id":"hit","path":"audio/sfx.mp3","volume":0.6} }]'
```

### Step 4 — Post-effects (section 10, if any)

No CLI — edit `studio/manifest/<projectId>/config.json` directly (sanctioned
exception). Add:
```json
{ "postEffects": { "vignette":{...}, "grain":{...}, "colorGrade":{...}, "letterbox":{...} } }
```
Keep `"postEffects"` absent entirely for no post-pass; `ffmpeg` must be on PATH.

### Step 5 — Validate (before render)
```bash
node scripts/agent-cli.mjs validate <projectId>
```
Expect `{ ok:true, sceneCount, projectId }`. On `ok:false` read `error` — it
names the file/stage. Fix with the matching `add-*`/`set-*`/`update-*`
command, not hand-editing.

### Step 6 — Render
```bash
node scripts/agent-cli.mjs render <projectId>     # -> out/<projectId>.mp4
# or: node scripts/agent-cli.mjs render <projectId> out/<custom>.mp4
```
On `ok:false`, read `stderr` — it points at the stage (validate/registry/
resolve/render) and file that failed. Fix by re-running the relevant build
command, not hand-editing the written JSON. `overlap_warn.js` output is a
sanity check, not a validation failure — successful render despite warnings
is expected.

### Step 7 — Verify output
```bash
ffprobe out/<projectId>.mp4   # confirm real h264 stream + duration match section 1
```
