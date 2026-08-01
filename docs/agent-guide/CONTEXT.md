# Agent guide — starting point

This directory is the authoritative reference for an LLM agent (or human)
authoring a video project against the json-to-mp4 framework. It is organized
so you can load only the context you need for the task at hand, instead of
one giant spec.

## How to use this directory

Start here, then follow the path that matches your task. Each subfolder has
its own `README.md` that tells you exactly which files to read and in what
order. Files are small and single-purpose — load the ones a path points at,
not everything.

- `getting-started/` — the minimum to produce a working video. Read first.
- `reference/` — the precise contract for every file and field an agent
  authors: manifest, config, scene, styles, narration, audio overlay.
- `assets/` — how to use built-in assets and how to add a new one.
- `transitions/` — how to use built-in transitions and how to add a new one.
- `pipelines/` — the three-stage contract (validate → resolve → render).
  Read this when debugging why a project fails at a specific stage.
- `conventions/` — the design rules the framework enforces (anchor+nudge,
  token-vs-literal, registry pattern). Read once; these are the "why".
- `recipes/` — worked, copy-pasteable patterns for common scene shapes.
  Grows over time as the project accumulates real usage.

## The 30-second mental model

1. You never write one big JSON. You write small typed files and the
   manifest just routes to them.
2. Every visual value is either a **token** (from `styles/theme.json`) or a
   **literal override**. Prefer tokens — change one place, every scene
   updates.
3. Assets are never given raw x/y. They get `anchor` (corner/edge/center) +
   signed percent nudge. Pixels are computed at resolve time.
4. Timing comes from TTS, not guesses. Per-scene duration is the narration
   window; animations and transitions must resolve *within* it.
5. There are exactly three pipelines: validate, resolve, render. Each only
   trusts the contract of the one before it.

## Pointers into the source

When a reference file here describes a contract, it links the source that
enforces it. Keep this mapping in mind:

- Manifest / config / scene / styles contracts → `src/pipelines/pipeline1-validate/`
- Token + anchor resolution → `src/registry/styleRegistry.js`, `src/templating/anchor.js`
- Asset + transition discovery → `src/registry/assetRegistry.js`
- TTS timing seam → `src/timing/ttsTiming.js`
- Render entry → `src/pipelines/pipeline3-render/render.js`
- A complete working example → `src/manifest/example-project/`

## Growing this guide

As the project grows, add files under the relevant subfolder and update that
subfolder's `README.md` path. Do **not** append new topics to this file —
keep it a router. If a new top-level concern appears (e.g. a new pipeline
stage, a new file kind an agent must author), add a new subfolder with its
own `README.md` and add one line to the list above.
