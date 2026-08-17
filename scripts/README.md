# agent-cli

A command-line tool for an AI agent to generate and edit video-project
manifests — scenes, assets, camera moves, effects, physics, and the style
registry — that conform exactly to the schemas in
`src/pipelines/pipeline1-validate/schema/*.schema.json`.

It's built for machine callers, not humans: every invocation prints exactly
one JSON object, to stdout on success (exit `0`) or stderr on failure (exit
`1`). Nothing else is ever written to those streams — no progress spinners,
no "Done!" banners — so an agent can always `JSON.parse()` the output.

## Install

```
cd tools/agent-cli
npm install
```

Run it as `node tools/agent-cli/cli.js ...` from the repo root (or add a
shell alias). It locates the repo root, the schema directory, and
`studio/manifest/` relative to its own file location, so it works from any
cwd.

## Project-scoped workflow

The agent sets a project **once**, and every other command operates on it:

```
node tools/agent-cli/cli.js project create physics-slope-demo --width 1920 --height 1080 --fps 30
node tools/agent-cli/cli.js scene create main '{"background":"#f0f0f0"}'
node tools/agent-cli/cli.js asset create main ball '{"assetType":"PhysicsShape","position":{"position":"center"},...}'
node tools/agent-cli/cli.js asset ball position '{"position":"center","offsetYPercent":-15}'
```

The active project id is persisted in `.agent-cli-state.json` at the repo
root (gitignore this). `project set <id>` switches to an existing project
without recreating it. Every command that isn't `project *` fails fast with
a `NoActiveProject` error if nothing has been set yet.

## Commands

```
project create <projectId> [--width N] [--height N] [--fps N] [--duration N]
project set <projectId>
project current
project validate

scene create <sceneId> ['<json>']
scene delete <sceneId>
scene get <sceneId> [field]
scene <sceneId> <field> '<json>' [<field> '<json>' ...]
    fields: narrationRef, transitionIn, transitionOut, effects, background, camera, physics

asset create <sceneId> <assetId> '<json>'
asset delete <assetId> [--scene <sceneId>]
asset get <assetId> [--scene <sceneId>] [field]
asset <assetId> <field> '<json>' [<field> '<json>' ...] [--scene <sceneId>]
    fields: position (alias for anchor), anchor, assetType, contentOverride,
            styleOverride, enterAt, exitAt, z, motion, physics, effects

styles <field> '<json>' [<field> '<json>' ...] [--replace]
    fields: colors, typography, spacing, easing, textures
    merges the given tokens into the existing object unless --replace is given

config '<json>'
    shallow-merges keys into config.json, e.g. '{"fps":60}'

batch '<json-array>' | --file <path> | -
    see "Batch mode" below
```

This matches the pattern in the original request —
`node script.js <scene-id> effects {json} camera {json}` and
`node script.js <asset-id> position {json}` — with one addition: the
literal `scene` / `asset` keyword up front. Without it, a bare id can't be
told apart from another subcommand (`create`, `delete`, ...), so it's kept
explicit for reliable machine parsing. Everything after the id is still
`<field> <json>` pairs, chainable in a single call.

### Setting fields is a replace, not a deep merge

`scene main camera '{...}'` replaces `camera` wholesale. `styles colors
'{...}'` is the one exception — token registries merge by default (add a
color without wiping the others), with `--replace` to override that.

### Asset addressing

Asset ids only need to be unique **within a scene** per the schema, but this
tool enforces uniqueness **across the whole project**, so `asset <assetId>
<field> <json>` can find the right scene automatically instead of the agent
having to track scene/asset pairs. `asset create` rejects an id that's
already used anywhere in the project. If two scenes ever do end up sharing
an id (e.g. hand-edited outside the tool), asset commands return an
`AmbiguousAsset` error and ask for `--scene`.

## The output contract

Success:

```json
{
  "ok": true,
  "projectId": "physics-slope-demo",
  "sceneId": "main",
  "changedFields": ["camera", "effects"],
  "scene": { "...": "full updated scene object" },
  "file": "studio/manifest/physics-slope-demo/scenes/main.json",
  "filesWritten": ["studio/manifest/physics-slope-demo/scenes/main.json"]
}
```

Failure (stderr, exit 1):

```json
{
  "ok": false,
  "error": "ValidationError",
  "message": "Invalid value for \"camera\".",
  "field": "camera",
  "received": { "...": "the value that failed" },
  "schemaRef": "scene.schema.json#/properties/camera",
  "errors": [
    { "path": "/durationInFrames", "message": "must be >= 1", "keyword": "minimum", "params": { "limit": 1 } }
  ]
}
```

`error` is a stable machine-readable code (`ValidationError`,
`UnknownField`, `InvalidJSON`, `SceneNotFound`, `AssetNotFound`,
`AmbiguousAsset`, `AlreadyExists`, `NoActiveProject`, `BadArguments`, ...).
`errors[]`, when present, are the raw Ajv errors (path/message/keyword/
params) so an agent can point at exactly what's wrong instead of re-parsing
prose.

Validation always runs against the actual schema files under
`src/pipelines/pipeline1-validate/schema/`, loaded fresh each run — there's
no hand-copied schema logic inside the tool to drift out of sync.

## Atomicity ("contract on error")

Nothing is written to disk until **everything** in the current invocation
has already validated. A single command that sets multiple fields
(`scene main camera {...} effects {...}`) validates both before writing
either. A `batch` of many commands across many files behaves the same way:
one in-memory workspace, one commit. If item 5 of 8 fails, items 0–4 are
never written either — rerun the batch after fixing item 5.

## Batch mode

```
node tools/agent-cli/cli.js batch '[
  {"type":"scene.create","sceneId":"intro","value":{"background":"shade1"}},
  {"type":"asset.create","sceneId":"intro","assetId":"logo","value":{"assetType":"Image","anchor":{"position":"center"}}},
  {"type":"asset.setFields","assetId":"logo","fields":{"z":2}},
  {"type":"styles.setFields","fields":{"colors":{"accentTeal":"#1AA6A6"}}}
]'
```

Also accepts `--file path/to/batch.json` or `-` to read the array from
stdin. Supported item `type`s: `scene.create`, `scene.delete`,
`scene.setFields`, `asset.create`, `asset.delete`, `asset.setFields`,
`styles.setFields`, `config.set`. Each item's shape mirrors its single-
command equivalent, with `fields` as a plain JSON object instead of
stringified `<field> <json>` pairs (no double-encoding needed inside a
batch). Commands within a batch see each other's effects in order — e.g.
`scene.create` followed by `asset.create` into that same new scene, in one
call.

## `project validate`

Runs the full schema validation pass (manifest, config, styles, every
scene) plus one cross-file check the individual schemas can't express:
asset-id uniqueness across the whole project. Useful as a final sanity
check, or after any manual/out-of-band edits to the manifest tree.

## Layout

```
cli.js              argument parsing + dispatch + the ok()/fail() output contract
lib/errors.js        CliError — the one error shape used everywhere
lib/paths.js          ROOT / SCHEMA_DIR / MANIFEST_ROOT / STATE_FILE constants
lib/fsutil.js         readJSON / writeJSONAtomic (temp-file + rename)
lib/schema.js         Ajv setup, sourced live from the schema files; field allow-lists
lib/state.js          active-project persistence
lib/workspace.js       per-invocation file cache + dirty-set + commit()
lib/ops.js            pure operations (scene/asset/styles/config) that mutate a Workspace
lib/project.js         project create/set/current/validate
lib/commands.js        thin single-command wrappers around ops.js + Workspace
lib/batch.js           runs many ops.js calls against one Workspace, one commit
```

`ops.js` is shared by both single commands and `batch`, so a chained
multi-field update and a batch item get identical validation and identical
atomicity — there's exactly one code path for "change this scene/asset and
make sure it's still valid."
