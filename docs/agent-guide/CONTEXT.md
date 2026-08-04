# Agent guide — starting point

Authoritative reference for authoring a video project against the json-to-mp4
framework. Load only the context you need, not one giant spec.

## Use this directory

Start here, follow the path matching your task. Each subfolder has a `README.md`
listing which files to read and in what order. Files are small and
single-purpose — load the ones a path points at, not everything.

- `getting-started/` — minimum for a working video. Read first.
- `reference/` — precise contract for every authored file/field: manifest,
  config, scene, styles, narration, audio overlay.
- `assets/` — use built-in assets, or add a new one.
- `transitions/` — use built-in transitions, or add a new one.
- `pipelines/` — three-stage contract (validate → resolve → render). Read when
  debugging why a project fails at a specific stage.
- `conventions/` — enforced design rules (anchor+nudge, token-vs-literal,
  registry pattern). Read once; the "why".
- `recipes/` — worked, copy-pasteable patterns for common scene shapes.

## 30-second mental model

1. Never write one big JSON. Write small typed files; the manifest just routes.
2. Every visual value is a **token** (from `styles/theme.json`) or a **literal
   override**. Prefer tokens — change one place, every scene updates.
3. Assets never get raw x/y. They get `anchor` (corner/edge/center) + signed
   percent nudge. Pixels computed at resolve time.
4. Timing from TTS, not guesses. Per-scene duration is the narration window;
   animations and transitions must resolve *within* it.
5. Three pipelines: validate, resolve, render. Each trusts only the contract
   of the one before it.

## Pointers into the source

When a reference file describes a contract, it links the source that enforces
it. Keep this mapping in mind:

- Manifest / config / scene / styles contracts → `src/pipelines/pipeline1-validate/`
- Token + anchor resolution → `src/registry/styleRegistry.js`, `src/templating/anchor.js`
- Asset + transition discovery → `src/registry/assetRegistry.js`
- Overlap warnings → `src/pipelines/pipeline2-resolve/overlap_warn.js`
- TTS timing seam → `src/timing/ttsTiming.js`
- Audio overlay → `src/audio/overlay.jsx`
- Render entry → `src/pipelines/pipeline3-render/render.js`,
  `src/pipelines/pipeline3-render/Composition.jsx`
- Working examples → `studio/manifest/example-project/` (`.toon` format),
  `studio/manifest/boilerplate/` (`.json` template), `studio/manifest/packet-journey/`,
  `studio/manifest/finance-project/`

## Skills (beyond this guide)

Three Hermes skills embed hard-won workflow context not duplicated here. Load
them via `skill_view` when the task fits:

- **`json-to-mp4-manifest`** — authoring/editing manifests and scene layouts.
  Carries pitfalls the docs don't: the `default`-transition registration bug in
  `Composition.jsx` (loader fallback), the `<Audio>` inside
  `<TransitionSeries.Sequence>` silence trap (SFX must live at the composition
  root), the TTS provider return shape (`{timing, totalDuration, audioPath}`),
  full-bleed centering via `useVideoConfig()`, and links to four references
  (`full-bleed-centering`, `transitions-and-tts`, `audio-pipeline`,
  `asset-gathering`).
- **`json-to-mp4-overlap-warnings`** — silencing `[overlap-warning]` from
  resolve. Root cause 9×/10 is the `TextBlock` `defaultSize: 900×200` shadowing
  real text. Recipe: explicit `styleOverride.width`/`height`, ±2–4% nudge,
  on-frame check, re-run resolve.
- **`json-to-mp4-render`** — producing an MP4. Repo layout, boilerplate fill
  recipe, pipeline commands (`validate` → `resolve` → `render`), TTS-skip path,
  `ffprobe` verification, stale-`resolved.json` and registry-out-of-date
  pitfalls.

## Asset gathering (separate workflow)

Acquiring audio tracks, transition SFX, and still images so they land under
`public/` is documented outside `agent-guide/`, at `docs/skills/assetlibrary/`.
That suite (`ytsearch*` → `yt-dlp` → `ffmpeg` silence-split → `public/audio/`,
and the OpenCLI `yandeximages/search` adapter → `public/assets/`) feeds
manifests but doesn't touch them. Read it before authoring a scene whose
SFX/music/image asset isn't yet on disk. One rule: **all files land in
`public/`**; the manifest references assets as paths relative to `public/`.

## Growing this guide

Add files under the relevant subfolder and update that subfolder's `README.md`
path. Do **not** append new topics to this file — keep it a router. If a new
top-level concern appears (e.g. a new pipeline stage, a new file kind an agent
must author), add a new subfolder with its own `README.md` and add one line to
the list above.
