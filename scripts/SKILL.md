---
name: json-to-mp4-agent-cli
description: Use when editing video project manifests via scripts/cli.js.
---

# Agent CLI (`scripts/cli.js`)

The `agent-cli` is a machine-oriented tool designed for AI agents to create and manipulate video project manifests (scenes, assets, styles, and config) while ensuring they strictly adhere to the project's JSON schemas.

## Core Principles
- **Deterministic Output**: Every command prints exactly one JSON object to `stdout` on success or `stderr` on failure.
- **Project-Scoped**: You must set an active project once; all subsequent commands operate on that project.
- **Atomic Writes**: No files are written to disk until the entire command (or batch) has been validated against the schemas.

## Setup & Context
The CLI expects to be run from the repo root. It locates the schema directory and manifest root relative to its own position in `scripts/`.

**Global `--minify` flag:** pass `--minify` anywhere in the argv to `cli.js` (or `project-cli.js create`) to write every JSON file that invocation touches with no whitespace (`JSON.stringify(obj)`, no indent) instead of the default pretty-printed 2-space format. Cuts on-disk/regen size ~30-40% on typical scene files — meaningful when a project is repeatedly regenerated or read back into an LLM agent's context. Still plain valid JSON; every downstream reader (`validate.js`'s `loadStructuredFile`, `resolve.js`) is whitespace-agnostic. Only affects files WRITTEN by that invocation, not the whole project tree.

**Project creation now has its own CLI:** `scripts/project-cli.js` (scaffold + optional immediate render) is the preferred entry point for creating a new project. `cli.js project create` still works (same underlying `commands.project.projectCreate`) for backward compatibility.
```
node scripts/project-cli.js create <projectId> [--width N] [--height N] [--fps N] [--duration N] [--theme <name>] [--minify] [--render [outputMp4]]
node scripts/project-cli.js list
node scripts/project-cli.js render <projectId> [outputMp4]
```

**Setting the active project:**
`node scripts/cli.js project set <projectId>`
`node scripts/cli.js project create <projectId> [--width N] [--height N] [--fps N] [--duration N] [--theme <name>]`

## Command Reference

### 1. Project Management
- `project create <id> [flags]`: Initializes a new project folder with `manifest.json`, `config.json`, and `styles/theme.json`. `--theme <name>` seeds the theme from `studio/library/themes/<name>.json` instead of the hardcoded default.
- `project set <id>`: Switches the active project.
- `project current`: Returns the current active project ID.
- `project validate`: Performs a full validation of the entire project manifest tree and checks for asset-id uniqueness across the project.

### 2. Scene Operations
- `scene create <sceneId> ['<json>']`: Creates a new scene file. Optional JSON for initial properties (e.g., `{"background": "#fff"}`).
- `scene delete <sceneId>`: Removes a scene.
- `scene get <sceneId> [field]`: Retrieves the scene object or a specific field.
- `scene <sceneId> <field> '<json>' [<field> '<json>' ...]`: Replaces specified fields (e.g., `camera`, `effects`, `physics`).

### 3. Asset Operations
- `asset create <sceneId> <assetId> '<json>'`: Creates an asset within a specific scene.
- `asset delete <assetId> [--scene <sceneId>]`: Deletes an asset.
- `asset get <assetId> [--scene <sceneId>] [field]`: Retrieves asset data.
- `asset <assetId> <field> '<json>' [<field> '<json>' ...] [--scene <sceneId>]`: Updates asset fields (e.g., `anchor`, `physics`, `styleOverride`).

### 4. Styles & Config
- `styles <field> '<json>' [<field> '<json>' ...] [--replace]`: Merges tokens into the style registry (`colors`, `typography`, `spacing`, `easing`). Use `--replace` to wipe the field first.
- `config '<json>'`: Shallow-merges keys into `config.json`.

### 5. Theme Library (`studio/library/themes/`)
Named, reusable style-registry presets that live OUTSIDE any one project — see `studio/library/README.md`. Discoverable read-only via `scripts/discovery.mjs themes` / `theme <name>`; mutated here.
- `theme list`: list every named preset (colorTokens/typographyTokens/easingTokens counts).
- `theme show <name>`: full JSON for one preset.
- `theme create <name> ['<json>'] [--overwrite]`: save a new preset; omit the JSON to snapshot the ACTIVE project's current `styles/theme.json`.
- `theme delete <name>`.
- `theme use <name> [--replace]`: merge (default, token-category by token-category) or replace the ACTIVE project's `styles/theme.json` with a saved preset.

### 6. Alias Library (`studio/library/aliases/`)
Custom `"$alias"` presets, loaded into the SAME runtime registry the built-in aliases live in (`src/registry/aliasRegistry.js` + `src/registry/aliasLibrary.js`) — a custom alias is usable in scene JSON immediately, no code change, no restart (resolve.js reloads the library every run). Discoverable read-only alongside built-ins via `scripts/discovery.mjs aliases [category]` / `alias <name>` (tagged `source: "custom"` vs `"builtin"`); mutated here.
- `alias list [category]`: lists custom aliases only (see discovery.mjs for built-ins too).
- `alias show <category.name>`.
- `alias create <category.name> '<expansion-json>' ['<description>'] [--overwrite]`: `expansion` must be a STATIC JSON object/array — file-based aliases can't take variables the way code-registered ones can (see `studio/library/README.md` for the caveat).
- `alias delete <category.name>`.

### 7. Manifest Export
- `manifest export`: dumps the ACTIVE project's full manifest+config+styles+scenes tree as one JSON object — read-only convenience so an agent doesn't have to stitch N file reads together. `--minify` only affects on-disk writes; this command's stdout is always pretty-printed for readability (via the shared `ok()` output contract).

### 8. Batch Mode (High Efficiency)
For complex changes, use `batch` to perform multiple operations in a single transaction. If any item in the batch fails validation, nothing is written.

`node scripts/cli.js batch '[\n  {"type":"scene.create","sceneId":"intro","value":{...}},\n  {"type":"asset.create","sceneId":"intro","assetId":"logo","value":{...}}\n]'`

Alternatively, use `--file <path>` to load a JSON array from a file.

## Common Pitfalls
- **Field Replacement**: Setting a field via `scene <id> <field> <json>` replaces the entire field object; it does not perform a deep merge.
- **Asset Uniqueness**: The tool enforces unique asset IDs across the *entire project*, even if the schema only requires uniqueness within a scene.
- **JSON Escaping**: When passing JSON as a CLI argument, ensure it is properly quoted and escaped for the shell.
- **Pathing**: Ensure `scripts/lib/paths.js` is correctly configured for the current directory structure (typically `ROOT` is `path.resolve(__dirname, '..', '..')`).

## Verification Workflow
After making a series of changes, always run:
`node scripts/cli.js project validate`
