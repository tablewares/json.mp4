# Build scenes and assets

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

## Enforced notes (useful, not load-bearing for choice)

- `id` optional on scenes/assets. Assets auto-number as `<assetType>-1`, `<assetType>-2`, ... Give explicit `id` when a transition needs to `carryAssetId` of it across a cut — id must appear in both outgoing and incoming scene.
- `anchor` defaults to `{ position:"center", offsetXPercent:0, offsetYPercent:0 }`. `offsetXPercent`/`offsetYPercent` = signed percent nudges from anchor; resolved to pixels at render.
- `enterAt`/`exitAt` default to `0`/`1` (full scene). Fractions of scene's resolved duration, not frame numbers.
- `add-asset` returns `{ asset, warnings }`. `warnings` = Ajv check of `contentOverride` vs that type's schema. Empty array = clean. Fix non-empty before moving on; don't wait for `validate`/`render`.
- `background` and style keys containing `color` (or naming a `typography`/`easing` token) accept either a project theme token (e.g. `"shade1"`, `"gentleSpring"`) or, for keys documented "raw hex" in `asset <Type>` output, a literal hex string. Rule: `docs/agent-guide/conventions/token-vs-literal.md`.

## Editing an existing asset or transition

`update-asset` / `update-transition` patch in place — **shallow merge**, not full replace: only keys you pass are touched.

```bash
# patches contentOverride.text only; anchor, styleOverride, timing untouched
node scripts/agent-cli.mjs update-asset <projectId> <sceneId> <assetId> '{ "contentOverride":{ "text":"..." } }'

# anchor/styleOverride merge key-by-key; timing fields overwrite when given
node scripts/agent-cli.mjs update-asset <projectId> <sceneId> <assetId> '{
  "anchor": { "offsetYPercent": 12 },
  "styleOverride": { "align": "right" },
  "enterAt": 0.1, "exitAt": 0.9
}'
```

`update-asset` returns `{ asset, warnings }` — read `warnings` after every edit. `update-transition` merges `params` key-by-key, overwrites `durationInFrames`/`type` wholesale when given; throws if scene has no `transitionOut` yet (use `set-transition` first). `update-asset` throws if `assetId` doesn't exist — run `list-assets` first.

## Other build commands

```bash
# remove an asset
node scripts/agent-cli.mjs remove-asset <projectId> <sceneId> <assetId>

# set scene's outgoing transition from scratch (replaces any existing)
node scripts/agent-cli.mjs set-transition <projectId> <sceneId> '{
  "type": "<transitionType>",
  "durationInFrames": <number>,
  "params": { /* from `transition <Type>` */ }
}'

# clear scene's transitionOut (back to hard cut)
node scripts/agent-cli.mjs remove-transition <projectId> <sceneId>

# append a boundary effect on scene.effects[] (post-refactor: detached from
# transitions; frame-first shape; legacy `offsetPercent` / `timing` keys still
# accepted by `effects.schema.json` for backward-compat with migrated scenes)
# kind:"sfx"    -> { id, kind:"sfx",    frame, path, volume?, durationInFrames? }
# kind:"visual" -> { id, kind:"visual", frame, assetType, anchor?, contentOverride?, styleOverride?, durationInFrames? }
node scripts/agent-cli.mjs add-effect <projectId> <sceneId> '{ "id":"...", "kind":"...", "frame":42, ... }'
```

> Full reference (one per command, named after it — see `cli-usage/README.md`):
> `add-effect.md` appends one entry to `scene.effects[]`; `inject-effects.md`
> is the timeline-driven bulk counterpart.

Visual effects resolve through same asset pipeline as normal scene asset — run `envelope` if you forget the shape.

## Injecting effects at scene boundaries (timeline-driven)

> Full reference: `inject-effects.md` (filename = command name per
> `cli-usage/README.md`). The snippets below are the executive summary.

`inject-effects` can place an effect on every scene independently of which assets each scene contains — useful for \"hit on every cut\" SFX/visuals. It **resolves + reads the project's timeline FIRST**, then writes each effect with an **exact scene-local `frame`** derived from it — no percent math survives on disk (the `offsetPercent` snippets in older notes are historical; the CLI now writes `frame`).

```bash
# one effect at the END of every scene (frame = scene.durationInFrames, the visible end)
node scripts/agent-cli.mjs inject-effects <projectId> \
  '[{"match":{"scene":"all"},"anchor":"exit","effect":{"kind":"sfx","id":"hit","path":"audio/sfx.mp3","volume":0.6}}]'

# one effect at the START of every scene (frame = 0)
node scripts/agent-cli.mjs inject-effects <projectId> \
  '[{"match":{"scene":"all"},"anchor":"enter","effect":{"kind":"sfx","id":"hit","path":"audio/sfx.mp3","volume":0.6}}]'
```

`match.scene: "all"` (or the `predicate` aliases `"sceneEnd"` / `"sceneStart"`) bypasses the asset-segment path entirely — it iterates `timeline.scenes` and writes one effect per scene regardless of assets present. `anchor: "exit"` → `frame: scene.durationInFrames` (visible end); `anchor: "enter"` → `frame: 0` (scene start). Each scene gets `${effect.id}-${sceneIndex}`; idempotent by id (re-running a rule replaces, doesn't stack).

The `match.assetType` path is also supported: it lifts each matched segment's global enter/exit frame into scene-local space by subtracting the scene's timeline start. So a KineticText entering at global frame 218 inside a scene whose global start is 88 writes `frame: 130` — exactly when the asset becomes visible.

