---
name: video-agent-cli
description: How to build and render Remotion-based videos in this repo using scripts/agent-cli.mjs as the only build entry point. Use this skill whenever the user asks to create a new video project, add scenes/assets/transitions/narration/audio, add background music, control TTS humanization, apply post-cinematography effects (vignette/grain/color-grade/letterbox), edit an existing project, look up what an asset or transition type accepts, or render a project to mp4. Never read or hand-author files under studio/manifest/**, studio/assets/**/manifest.json, or studio/transitions/**/manifest.json to discover options — ask the CLI instead. This skill contains no design criteria; supply those externally per run.
---

# Video agent CLI

JSON-to-MP4 video framework built on Remotion. A project = small tree of JSON
files (manifest + config + theme + per-scene) under
`studio/manifest/<projectId>/`. Repo runs that tree through three-stage
pipeline: `validate → resolve → render` to produce an mp4. Every asset type
(`studio/assets/*`, `studio/graphics/*`) and transition type
(`studio/transitions/*`) is self-describing via own `manifest.json`; the CLI
reads those registries for you.

## Validate
```bash
node scripts/agent-cli.mjs validate <projectId> 
```

## Render
```bash
node scripts/agent-cli.mjs render <projectId> 
```

- **Project contracts** — on demand from `docs/agent-guide/`, not here. Start at `docs/agent-guide/CONTEXT.md`; descend into `reference/`, `conventions/`, `pipelines/` only when a command's output mentions a contract you need.
- **Design criteria** (palette, typography, layout, pacing, composition rules) — supplied per run via external context. Repo also carries `docs/composition/composition-design-principles.md` and `docs/designmd/DESIGN.md`; consult when the run references them or the user asks — never as implicit default.

## Rule of thumb

If about to `view`, `cat`, or `str_replace` anything under `studio/` to learn what fields an asset/transition takes or what an existing project looks like, stop — a CLI command does that. Only exception: authoring a *new* asset/transition component's JSX (necessarily bespoke; see `validate-render.md` in the dir below).

Same trap with the asset library: if about to `ls`/`tree`/`find` `studio/assets/**`, `studio/graphics/**`, `studio/transitions/**`, or `public/assets/**` to "see what's available" before sourcing new images/audio/SFX, stop — that folder-walk yields filenames, not what each type accepts or how to source more. Use the collection workflow instead: `node scripts/agent-cli.mjs collections` lists every asset-library workflow; `node scripts/agent-cli.mjs collection <Name>` gives exact command + destination + output fields for one (`image`, `youtube`, `ytdlp`, `sfx`, `manifest`, …). For images specifically, see `avoid.md`'s Yandex connection-test rule before wiring any URL.

**CRITICAL: Trust the contract, not the name.** Asset types like `ImageReveal` may use `src` whereas others use `url` or `text`. ALWAYS run `node scripts/agent-cli.mjs asset <Type>` to verify the exact key name for `contentOverride` before authoring. Using `url` when `src` is required will pass `validate` (since it's a generic object) but crash the render with `TypeError: Cannot read properties of undefined`.

### What the CLI shows — and what it hides

`asset <Type>` / `transition <Type>` print the live contract: required vs optional content keys, style keys with defaults, enums, and bounded-value constraints (the output carries any `minimum`/`maximum`/`minItems`/`maxItems`/`pattern` from the underlying manifest schema). Author inside those bounds the first time — the AJV validators behind `validate` reject out-of-range values and unknown keys (`additionalProperties: false` on the scene envelope, the camera spec, and most manifests), so guessing silently fails.

- **Required content keys are required at author time.** `content.required` from `asset <Type>` is the exhaustive list of `contentOverride` keys you must set; any other key on content/styleOverride is either defaulted or rejected depending on the asset. Omitting a required key fails `validate`, not just produce a quiet bad render.
- **Branched fields (oneOf):** the camera anchor (`{position}` vs `{followAssetId}`) and `motion.in`/`motion.out` (string-alias form vs object form) each take exactly one branch. Fill in both and `validate` produces a dense `oneOf` error. Before authoring `camera` call `anchors` for the position enum; for `motion` pick `in`/`out` as either a string alias *or* the object form, not a hybrid.
- **Per-asset content/style keys are bespoke.** RouteDraw wants `routes`; a different asset wants `text`, another `src`. The envelope only types these as `object` — the content boundaries live in the per-asset manifest, surfaced only via `asset <Type`. Never reuse the content keys of one asset type for another, even if the shape looks similar.

## How to use the CLI

Read `scripts/curate/cli-usage/` for the full command reference, split by stage:

- `scripts/curate/cli-usage/SKILL.md` — brief index of the dir + entry-point + stdin + workflow overview.
- `scripts/curate/cli-usage/discover.md` — list/describe asset + transition types, schemas, anchors, envelope, collections, existing projects.
- `scripts/curate/cli-usage/init.md` — init a project, add/replace narration, manifest-level audio overlay.
- `scripts/curate/cli-usage/build.md` — add scene/asset/effect, edit existing assets/transitions, other build commands.
- `scripts/curate/cli-usage/audio.md` — audio overlays, background music, TTS humanization.
- `scripts/curate/cli-usage/post-effects.md` — `config.postEffects`, overlap/composition diagnostics, batching many steps at once.
- `scripts/curate/cli-usage/validate-render.md` — validate, render, authoring a new asset or transition, pipeline pointers.
- `scripts/curate/cli-usage/avoid.md` — what not to do.

Concept guides (not part of cli-usage split, but actionable via the CLI described above; ranges only, exact values from your run's design context):

- `scripts/curate/asset/motion.md` — entrance/exit animations + animated/static rotation; how to author `motion` via add-asset/update-asset.
- `scripts/curate/asset/parallax.md` — depth + `easeZoom` for 2.5D camera work; set-camera/update-camera/add-camera-action/remove-camera usage.
- `scripts/curate/asset/highlight.md` — TextHighlight asset + inline `highlighter` on KineticText; styleOverride-based, set via add-asset/update-asset.

Also in the repo:

- `scripts/curate/` (#) — curate index.
- `scripts/agent-cli.mjs` — the CLI itself.
- `scripts/agent-batch.mjs` — batch wrapper over `agent-cli.mjs`.
- `src/agent/ProjectBuilder.js` — class behind `agent-cli.mjs`; fallback when a command's behavior is unclear.
- `docs/agent-guide/CONTEXT.md` — high-level mental model and router into `reference/`, `conventions/`, `pipelines/`.

This file is brief context only — all command signatures + options live in the `cli-usage/` files above.
