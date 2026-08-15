---
name: video-agent-cli
description: Build/render Remotion videos via scripts/agent-cli.mjs. Use for new projects, scene/asset/audio/TTS/post-effects edits, or mp4 rendering. Never hand-author studio/manifest/** or manifest.json files; use CLI instead.
---

# Video agent CLI

JSON-to-MP4 framework. Projects live in `studio/manifest/<projectId>/`.
Pipeline: `validate → resolve → render`. Assets/transitions are self-describing; CLI reads their registries.

## Core Commands
- Validate: `node scripts/agent-cli.mjs validate <projectId>`
- Render: `node scripts/agent-cli.mjs render <projectId>`

## Discovery: what to call and when

Three layers of contract discovery, each for a different question. Use all
three before building — they make every subsequent `add-asset`/`set-transition`
call accurate.

**"Which file owns which field?"**
```bash
node scripts/agent-cli.mjs envelope                 # scene/asset/transitionEffect field map
```

**"What keys does this specific asset/transition type accept?"**
```bash
node scripts/agent-cli.mjs asset <Type>              # contentOverride/styleOverride schema + defaults
node scripts/agent-cli.mjs transition <Type>         # params schema + defaults
```

**"What's the exact contract for an authored file — every field, type, range, enum, sub-shape?"**
```bash
node scripts/agent-cli.mjs schemas                   # list every pipeline schema file + required keys
node scripts/agent-cli.mjs schema <filename>        # flatten one schema file's full contract (refs resolved)
node scripts/agent-cli.mjs definition <name>        # find a definition by name (e.g. "timingAnchor", "assetEffect")
```

`schema` and `definition` read the same JSON Schema files `validate.js`
loads, so they can never drift from what the pipeline enforces. Use them
instead of opening `studio/` or `schema/` files by hand. Full guide:
`scripts/curate/cli-usage/schema.md`.

**"Is there a preset that expands into the shape I want?"**
```bash
node scripts/agent-cli.mjs aliases [category]        # every alias grouped by category (motion/camera/effects/timing/transition)
node scripts/agent-cli.mjs alias <name>             # full info + expanded (default-vars) shape
node scripts/agent-cli.mjs alias-categories          # known category names
```

Aliases let you write `"$alias": "motion.fadeInOut"` instead of handwriting
`{ "in": "fadeUp", "out": "fadeOutDown" }`. They take input variables:
`{ "$alias": "effects.oldComputer", "grayscale": 0.9 }`. The expansion
happens at resolve time — pipeline2 calls `resolveAliasesDeep` once per
scene before any sub-resolver touches it. A spec with no `$alias` key passes
through byte-identical. Full guide: `scripts/curate/cli-usage/registry.md`.

## Critical Rules
- **No Hand-Editing:** Do not `view`/`cat`/`patch` `studio/` files to learn schemas. Use the CLI discovery commands above.
- **Contract First:** Always run `node scripts/agent-cli.mjs asset <Type>` to verify `contentOverride` keys. Using `url` instead of `src` (or vice versa) causes render crashes despite passing `validate`.
- **Schema for new features:** When you need to know the shape of `enterAt`/`exitAt` (fraction vs timing-anchor object), `effects[]` on an asset, or `camera.actions`, run `schema scene.schema.json` or `definition <name>`. Do not guess field shapes from examples — the schema is authoritative.
- **Aliases before handwriting:** Before handwriting `motion`, `effects`, `camera`, `timing` objects, run `aliases` to see if a preset exists. If one fits, use `"$alias"` with vars instead of writing the full object. This reduces edit surface and makes intent explicit.
- **Collections:** Use `node scripts/agent-cli.mjs collections` to source images/audio.
- **No Invented Design:** Do not guess colors/fonts. Use provided context or ask user.

## Common Pitfalls
- **Asset Addition:** Use `assetType` key in `add-asset`, not `type`.
- **Transitions:** In `set-transition`, only pass `type` and `params`. Do not include `id` or `duration` at the top level of the transition object.
- **Narration:** For narrated projects, `node scripts/agent-cli.mjs set-transcript` must be called before `render` to avoid `generateTtsTiming` failures.
- **Anchors:** Use `node scripts/agent-cli.mjs anchors` to verify valid position enums (e.g., use `left` instead of `left-center`).
- **Render Timeouts:** Large projects may timeout in foreground; use `terminal(background=true)` for `render`.
- **Alias discriminator:** The `$alias` key is reserved. When authoring an alias, all other keys in that object become input vars. The alias fn's return replaces the whole object — do not also hand-author the target keys alongside `$alias`.
- **Timing anchors:** `enterAt`/`exitAt` now accept `{ relativeToAsset, edge, offsetFrames }` objects (via `timing.withPreviousExit` alias or direct). The referenced asset must be authored EARLIER in `scene.assets[]`. Unknown asset id → resolve throw.

## Reference Docs
AI agents MUST read `scripts/curate/` for high-accuracy output.
- **Usage Guide:** `scripts/curate/cli-usage/` (Split by stage: discover, init, build, audio, post-effects, validate-render, avoid, collections, registry, schema).
- **Planning:** `scripts/curate/plan.md` (Mandatory pre-flight template).
- **Concepts:** `scripts/curate/asset/` (Motion, Parallax, Highlighting).
- **Mental Model:** `docs/agent-guide/CONTEXT.md`.

## CLI Capability Summary
- `asset <Type>` / `transition <Type>`: Live per-type schema (required vs optional keys, bounds, defaults).
- `anchors`: Position enum.
- `envelope`: Scene/asset/transitionEffect field reference (which field lives on which file).
- `schemas` / `schema <filename>` / `definition <name>`: Pipeline JSON Schema files flattened — every `$ref` resolved, every `oneOf`/`anyOf` expanded, constraint metadata surfaced. Authoritative for field shapes the envelope describes but doesn't fully specify.
- `aliases` / `alias <name>` / `alias-categories`: Central alias registry — named presets grouped by category that expand into full shapes at resolve time.
- `collections`: Asset-library workflows.


## Batching many steps at once

If more than two or three `agent-cli.mjs` calls in a row, use `scripts/agent-batch.mjs`:

```bash
node scripts/agent-batch.mjs '<steps-array>'
```

Each step = `["command", arg1, arg2, ...]`. JSON payload argument is real JSON, not pre-escaped string — wrapper stringifies for you. Default: stops at first failing step (later steps return `{ skipped:true }`). Pass `{ "steps":[...], "continueOnError":true }` when later steps don't depend on earlier ones (e.g. several independent `add-scene` calls).

Response = `{ ok:<all steps ok>, results:[...] }`. Check each result's own `ok` (and, for `add-asset`/`update-asset` steps, its nested `result.warnings`), not only top-level.

Minimal shape — replace `<…>` from run's design context:

```bash
node scripts/agent-batch.mjs '[
  ["init",       {"projectId":"<projectId>", "narration":{"entries":[{"id":"n1","text":"..."}],"fullTranscript":"..."}}],
  ["add-scene",  "<projectId>", {"id":"<sceneId>", "narrationRef":"n1", "background":"<token>", "transitionOut":{"type":"<type>"}}],
  ["add-asset",  "<projectId>", "<sceneId>", {"assetType":"<Type>", "anchor":{"position":"<anchor>"}, "contentOverride":{}}],
  ["validate",   "<projectId>"],
  ["add-music",  "<projectId>", {"id":"m1","src":"/audio/track.mp3","volume":0.8}]
]'
```
