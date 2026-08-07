---
name: video-agent-cli
description: How to build and render Remotion-based videos in this repo using scripts/agent-cli.mjs as the only build entry point. Use this skill whenever the user asks to create a new video project, add scenes/assets/transitions/narration/audio, edit an existing project, look up what an asset or transition type accepts, or render a project to mp4. Never read or hand-author files under studio/manifest/**, studio/assets/**/manifest.json, or studio/transitions/**/manifest.json to discover options — ask the CLI instead. This skill contains no design criteria; supply those externally per run.
---

# Video agent CLI

This repo is a JSON-to-MP4 video framework built on Remotion. A project is a
small tree of JSON files (manifest + config + theme + per-scene files) under
`studio/manifest/<projectId>/`. The repo turns that tree into an mp4 through a
three-stage pipeline: `validate → resolve → render`. Every asset type
(`studio/assets/*`, `studio/graphics/*`) and every transition type
(`studio/transitions/*`) is self-describing via its own `manifest.json`, and
the CLI reads those registries for you.

**This skill holds no creative direction.** It will not tell you which asset
type, anchor, palette, or scene cadence to use — those are design criteria
that belong to the run, supplied via external context the user provides or
that you gather with your other tools (web research, brief files, design
docs). Follow whatever external design context the run gives you. If none was
supplied, ask the user before inventing one. The two places to look:

- **Project contracts (what fields exist, how they validate)** — read on
  demand from `docs/agent-guide/`, not from this file. Start at
  `docs/agent-guide/CONTEXT.md`; descend into `reference/`, `conventions/`,
  and `pipelines/` only when a specific command's output mentions a contract
  you need to understand.
- **Design criteria (palette, typography, layout, pacing, composition rules)**
  — supplied per run via external context (brief file, design system doc, user
  prose). The repo also carries reference design material at
  `docs/composition/composition-design-principles.md` and
  `docs/designmd/DESIGN.md`; consult those *when the run references them or
  the user asks for them*, never as an implicit default.

**Rule of thumb: if you're about to `view`, `cat`, or `str_replace` anything
under `studio/` to learn what fields an asset/transition takes or what an
existing project looks like, stop — a CLI command does that.** The only
exception is authoring a *new* asset/transition component's JSX, which
deliberately lives outside this skill (see "Authoring a new asset or
transition" below).

Run every command from the repo root:

```bash
node scripts/agent-cli.mjs <command> [args...]
```

Every command prints a compact text result and exits 0 on success, or prints
an `error:` line and exits 1 on failure. Treat a non-zero exit as "read the
error and fix the last command", not as a signal to fall back to editing files.

For any `'<json>'` argument you can either inline the JSON (quote it for the
shell) or pass `-` to read the JSON from stdin. Use stdin for anything long
(multi-paragraph `code`, long `items` lists, any payload where shell-quoting
is risky), e.g.:

```bash
echo '{"assetType":"CodeBlock","contentOverride":{"code":"line1\nline2\n..."}}' \
  | node scripts/agent-cli.mjs add-asset <projectId> <sceneId> -
```

## The workflow

1. Discover — list/describe the asset and transition types available right
   now, and the schemas for the ones you'll actually use.
2. Init — create the project (config + theme + empty manifest).
3. Build — add scenes, then add assets/transitions/effects/narration to
   them.
4. Validate — cheap sanity check before spending time on a render.
5. Render — produces the mp4.

Steps 3–4 loop freely; nothing is final until you render.

## 1. Discover

```bash
node scripts/agent-cli.mjs assets                 # every asset type + one-line description
node scripts/agent-cli.mjs asset <Type>           # full contentOverride/styleOverride schema + defaults for one type
node scripts/agent-cli.mjs transitions           # every transition type + one-line description
node scripts/agent-cli.mjs transition <Type>     # full params schema + defaults for one type
node scripts/agent-cli.mjs anchors                # valid anchor.position values
node scripts/agent-cli.mjs envelope               # scene/asset/transitionEffect field reference (anchor, enterAt/exitAt, effects shape)
node scripts/agent-cli.mjs projects               # existing project ids under studio/manifest/
node scripts/agent-cli.mjs show <projectId>                 # full built tree (manifest+config+styles+scenes)
node scripts/agent-cli.mjs list-assets <projectId>          # every asset currently placed, grouped by scene
node scripts/agent-cli.mjs list-assets <projectId> <sceneId>  # one scene's assets
node scripts/agent-cli.mjs list-transitions <projectId>     # each scene's current transitionOut (or null = hard cut)
```

`list-assets` and `list-transitions` are the "what's actually in this project
right now" views — run them before any `update-*` or `remove-*` call rather
than guessing an asset's current id or a scene's current transition.

`asset <Type>` returns `{ description, defaultSize, defaultStyle, content:
{required, optional}, style: [...] }`. `content.required` is the exact list of
`contentOverride` keys you must supply; everything else already has a working
default. Don't guess a schema — call `asset <Type>` first for every type you
use in this conversation, even one you've used in a prior run. The same goes
for `transition <Type>` before you set a transition's `params`.

You may also discover assets/transitions that don't exist yet in the
registry — see "Authoring a new asset or transition" below.

## 2. Init a project

```bash
node scripts/agent-cli.mjs init '{ "projectId": "<projectId>" }'
```

Only `projectId` is required. Everything else has a working default:
`fps`, `width`, `height`, `defaultSceneDurationInFrames`, `ttsProvider`, the
whole color/typography/spacing/easing theme. Override any of them piecemeal
(e.g. `"colors": { "accentBg": "#FF6600" }` replaces only that token; every
other color/typography/easing default stays intact). Which overrides you pass
should come from the run's external design context, not from this skill.

Narration is optional — omit it entirely for a project with no voiceover.
When present, scenes are timed by their narration window (TTS is the source
of truth for timing). See `docs/agent-guide/conventions/timing-from-tts.md`
for the contract; the short version: each scene's `narrationRef` must match
an `entries[].id`, and `fullTranscript` must contain every word the TTS will
synthesize, in order.

Add or replace narration after init with `add-narration` /
`set-transcript` (see "Other build commands" below).

```bash
# Add a single narration entry to an existing project
node scripts/agent-cli.mjs add-narration <projectId> '{ "id": "n2", "text": "..." }'

# Replace the full transcript string (TTS aligns against this)
node scripts/agent-cli.mjs set-transcript <projectId> '{ "text": "every word, in order..." }'

# Add a manifest-level audio overlay (non-TTS bed/SFX track)
node scripts/agent-cli.mjs add-audio <projectId> '{ "id": "bed", "start": 0, "end": 12, "path": "audio/bed.mp3" }'
```

Pass `"overwrite": true` in the init spec to replace an existing project.

## 3. Build scenes and assets

Add a scene first, then add assets to it:

```bash
node scripts/agent-cli.mjs add-scene <projectId> '{
  "id": "<sceneId>",
  "narrationRef": "<id-from-narration-entries>",
  "background": "<colorToken-from-theme>",
  "transitionOut": { "type": "<transitionType>" }
}'

node scripts/agent-cli.mjs add-asset <projectId> <sceneId> '{
  "assetType": "<Type>",
  "anchor": { "position": "<one-of-the-9-anchors>" },
  "contentOverride": { /* required keys from `asset <Type>` */ },
  "styleOverride": { /* optional keys from `asset <Type>` */ }
}'
```

Notes the CLI enforces for you — useful, not load-bearing for choice:

- `id` is optional on scenes and assets. Assets auto-number as
  `<assetType>-1`, `<assetType>-2`, ... . Give an asset an explicit `id` when
  a transition needs to `carryAssetId` of it across a cut (the id must appear
  in both the outgoing and incoming scene).
- `anchor` defaults to `{ position: "center", offsetXPercent: 0,
  offsetYPercent: 0 }` if omitted. `offsetXPercent` / `offsetYPercent` are
  signed percent nudges from the anchor position; `anchor.js` resolves them
  to pixels at render time.
- `enterAt` / `exitAt` default to `0` / `1` (the full scene). They are
  fractions of the scene's resolved duration, not frame numbers.
- `add-asset` returns `{ asset, warnings }`. `warnings` is the Ajv result of
  checking your `contentOverride` against that asset type's own schema. An
  empty array means clean — fix non-empty `warnings` before moving on; don't
  wait for `validate` or `render` to catch it.
- `background` and style keys containing `color` (or naming a `typography`
  /`easing` token) accept either a project theme token (e.g. `"shade1"`,
  `"gentleSpring"`) or, for keys documented as "raw hex" in `asset <Type>`
  output, a literal hex string. `docs/agent-guide/conventions/token-vs-literal.md`
  is the precise rule.

### Editing an existing asset or transition

`update-asset` and `update-transition` patch in place — a **shallow merge**,
not a full replace: only the keys you pass are touched, everything else is
left alone.

```bash
# patches contentOverride.text only; anchor, styleOverride, timing untouched
node scripts/agent-cli.mjs update-asset <projectId> <sceneId> <assetId> '{
  "contentOverride": { "text": "..." }
}'

# anchor/styleOverride merge key-by-key; timing fields overwrite when given
node scripts/agent-cli.mjs update-asset <projectId> <sceneId> <assetId> '{
  "anchor": { "offsetYPercent": 12 },
  "styleOverride": { "align": "right" },
  "enterAt": 0.1, "exitAt": 0.9
}'
```

`update-asset` returns `{ asset, warnings }` (same schema check as
`add-asset`) — read `warnings` after every edit. `update-transition` merges
`params` key-by-key and overwrites `durationInFrames` / `type` wholesale
when given; it throws if the scene has no `transitionOut` yet (use
`set-transition` first). `update-asset` throws if the `assetId` doesn't exist
(run `list-assets` first instead of guessing).

### Other build commands

```bash
# remove an asset
node scripts/agent-cli.mjs remove-asset <projectId> <sceneId> <assetId>

# set a scene's outgoing transition from scratch (replaces any existing one)
node scripts/agent-cli.mjs set-transition <projectId> <sceneId> '{
  "type": "<transitionType>",
  "durationInFrames": <number>,
  "params": { /* from `transition <Type>` */ }
}'

# clear a scene's transitionOut entirely (back to a hard cut)
node scripts/agent-cli.mjs remove-transition <projectId> <sceneId>

# append a boundary effect on a scene's transitionOut
# kind:"sfx"   -> { id, kind:"sfx", offsetPercent, path, volume, durationInFrames? }
# kind:"visual" -> { id, kind:"visual", assetType, anchor, contentOverride?, styleOverride?, durationInFrames? }
node scripts/agent-cli.mjs add-effect <projectId> <sceneId> '{ "id": "...", "kind": "...", ... }'
```

Visual effects are resolved through the same asset pipeline as a normal
scene asset — run `envelope` if you forget the shape.

### Batching many steps at once

Once you're about to issue more than two or three `agent-cli.mjs` commands in
a row, use `scripts/agent-batch.mjs` instead. It spawns the same
`agent-cli.mjs` per step (so behavior is identical) but takes the whole
sequence as one JSON array and returns one JSON result:

```bash
node scripts/agent-batch.mjs '<steps-array>'
```

Each step is `["command", arg1, arg2, ...]`, where the JSON payload argument
is written as real JSON, not a pre-escaped string — the wrapper stringifies
it for you. Default behavior: stops at the first failing step (later steps
return `{ skipped: true }`). Pass the object form
`{ "steps": [...], "continueOnError": true }` when later steps don't depend
on earlier ones (e.g. several independent `add-scene` calls) and you want
every step attempted regardless.

The response is `{ ok: <all steps ok>, results: [...] }`. Check each
result's own `ok` (and, for `add-asset` / `update-asset` steps, its nested
`result.warnings`), not only the top-level `ok`.

Minimal shape — replace `<…>` from your run's design context:

```bash
node scripts/agent-batch.mjs '[
  ["init",       {"projectId":"<projectId>", "narration":{"entries":[{"id":"n1","text":"..."}],"fullTranscript":"..."}}],
  ["add-scene",  "<projectId>", {"id":"<sceneId>", "narrationRef":"n1", "background":"<token>", "transitionOut":{"type":"<type>"}}],
  ["add-asset",  "<projectId>", "<sceneId>", {"assetType":"<Type>", "anchor":{"position":"<anchor>"}, "contentOverride":{}}],
  ["validate",   "<projectId>"]
]'
```

If you need to inspect state mid-build (e.g. before a transition that needs
to `carryAssetId`), use `show <projectId>` — it returns the fully assembled
tree in one call.

## 4. Validate

```bash
node scripts/agent-cli.mjs validate <projectId>
```

Runs the real schema + cross-reference checks (Ajv against every scene,
`narrationRef` existence, anchor validity, etc.) without bundling or
rendering. Returns `{ ok: true, sceneCount, projectId }` or `{ ok: false,
error }`. Always run this after a batch of `add-*` calls and before
`render` — it's much cheaper than a failed render.

## 5. Render

```bash
node scripts/agent-cli.mjs render <projectId> [out/<filename>.mp4]
```

`outputMp4` is optional (defaults to `out/<projectId>.mp4`). This runs the
full `validate → registry → resolve → render` pipeline via
`scripts/render-project.mjs` as a subprocess and returns
`{ ok, code, stdout, stderr }`. On `ok: false`, read `stderr` — it points at
the specific stage (validate/registry/resolve/render) and file that failed.
Fix by re-running the relevant `add-*`/`set-*` command, not by hand-editing
the written JSON.

## Authoring a new asset or transition

When no registered asset/transition type fits what the run needs, the agent
can introduce one. The repo ships two starter folders under `studio/`:

- `studio/assets/AssetBoilerplate/` — copy-and-adapt template for a new
  visual asset. Its `README.md` is a 5-step adaptation checklist.
- `studio/transitions/TransitionBoilerplate/` — equivalent for a new
  transition (no README; follow `docs/agent-guide/transitions/authoring-new.md`).

The agent-driven authoring flow:

1. Copy the relevant boilerplate folder into a new PascalCase-named folder
   (`studio/assets/<NewName>/` or `studio/transitions/<NewName>/`).
2. Rename the component file and its export to `<NewName>`.
3. Update the boilerplate `manifest.json`'s `assetType` /
   `transitionType`, `component`, and `description`. Author the
   `contentOverrideSchema` / `styleOverrideSchema` / `params` to match the
   behavior you intend the component to read.
4. Edit the JSX to implement that behavior. The component receives
   `resolvedPosition`, `resolvedStyle`, `content`, and `timing` (see the
   boilerplate's own JSDoc / `studio/assets/AssetBoilerplate/README.md`).
5. The registry is auto-rescanned on every `npm run build` / `render` call,
   so the new type becomes visible to `agent-cli.mjs assets` / `transitions`
   immediately — no separate registration step. Run `node scripts/agent-cli.mjs
   asset <NewName>` (or `transition <NewName>`) to confirm the manifest
   parses, then issue a probe `add-asset` against a scratch scene to confirm
   `warnings: []`.

Authoring a *new asset or transition component* is the one case where you
will edit files under `studio/` by hand — the manifest schemas and the JSX
implementation are necessarily bespoke. This is by design; it is the only
exception to the "go through the CLI" rule, and it applies to the component
side, never to project manifests under `studio/manifest/**/`.

Detailed contracts for asset and transition authoring are in
`docs/agent-guide/assets/authoring-new.md` and
`docs/agent-guide/transitions/authoring-new.md`. Read those the first time
you author one in a session.

## Things to avoid

- Don't write or edit files under `studio/manifest/**` directly — always go
  through `init` / `add-scene` / `add-asset` / `update-asset` / etc. The
  only sanctioned `studio/` edits are component + manifest authoring for a
  brand-new asset/transition type (above), never for a project's manifest,
  scene, theme, or config files.
- Don't read files under `studio/manifest/**` (including
  `studio/manifest/example-project/` and `studio/manifest/boilerplate-toon/`)
  to learn how a scene is shaped, what fields an asset accepts, or what a
  project looks like. Use `show` if you need to inspect an existing project
  you're editing, and `asset <Type>` / `transition <Type>` for schemas.
- Don't fire a long chain of individual `agent-cli.mjs` calls when you
  already know the whole sequence — use `scripts/agent-batch.mjs` once
  you're past two or three commands.
- Don't guess an asset's current id or a scene's current transition before
  editing it — run `list-assets` / `list-transitions` first.
- Don't invent asset or style keys. If `asset <Type>` doesn't list a key
  under `content` or `style`, that component doesn't read it — check the
  command output, not memory of a similar-looking asset.
- Don't skip `validate` before `render` on anything non-trivial — a failed
  render subprocess is far more expensive to debug than a validate error.
- Don't use `exitAt < 1` on an asset that's meant to ride the full scene's
  narration. The asset visually disappears at `exitAt * sceneDuration`,
  which can land *before* the scene's TTS audio finishes — leaving the
  last word(s) playing against an empty board. Reserve `exitAt < 1` for
  assets you explicitly want to leave early; for closers / narration-riders
  use the default `1` (or omit `exitAt`).
- Don't assume TOON. This CLI writes plain JSON project files, which the
  pipeline reads identically to hand-authored `.toon` — no extra step
  needed, and nothing here requires the `@toon-format/cli` conversion
  flow. (If you're curious, `docs/agent-guide/recipes/toon-manifest.md`
  covers the per-file swap; it's never required.)
- Don't invent design criteria when none were supplied. If the run gives you
  no external design context (palette, typography, scene cadence, asset
  choices), ask the user. This skill deliberately does not encode any
  defaults for those.

## Pipeline pointers

When a `validate` or `render` error points at a stage contract you don't
recognize, the authoritative references are:

- `docs/agent-guide/CONTEXT.md` — high-level mental model and router.
- `docs/agent-guide/reference/` — manifest, config, scene, styles,
  narration, audio-overlay contracts.
- `docs/agent-guide/conventions/` — enforced design rules the validators
  care about (anchor+nudge, token-vs-literal, registry pattern,
  timing-from-tts, no-one-big-json, pipeline-trust).
- `docs/agent-guide/pipelines/` — the three-stage contract in depth. Read
  these when debugging which stage threw.
- `src/agent/ProjectBuilder.js` — the class behind `agent-cli.mjs`. The
  fallback when a command's behavior is unclear.
