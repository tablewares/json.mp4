---
name: json-to-mp4-agent-cli
description: Use when editing video project manifests via scripts/cli.js.
---

# Agent CLI (`scripts/cli.js`)

Tool for AI agents to create/manipulate video project manifests (scenes, assets, styles, config) with strict JSON schema validation.

## Core Principles
- **Deterministic**: Success prints one JSON object to `stdout`; failure to `stderr`.
- **Project-Scoped**: Set active project once; all commands apply to it.
- **Atomic**: Writes to disk only after full schema validation.

## Setup & Context
Run from repo root.

**`--minify` flag**: Pass to `cli.js` or `project-cli.js create` to write JSON without whitespace. Reduces file size ~30-40%, improves LLM context efficiency. Downstream tools are whitespace-agnostic.

**Project Creation**: Use `scripts/project-cli.js` (preferred) or `cli.js project create`.
```
node scripts/project-cli.js create <projectId> [--width N] [--height N] [--fps N] [--duration N] [--theme <name>] [--minify] [--render [outputMp4]]
node scripts/project-cli.js list
node scripts/project-cli.js render <projectId> [outputMp4]
```

**Set active project**:
`node scripts/cli.js project set <projectId>`

## Discovery (`scripts/discovery.mjs`)
Read-only companion to `cli.js`. Use to check schemas and avoid render-cycle errors.

```
node scripts/discovery.mjs assets                       # All asset types
node scripts/discovery.mjs asset <assetType>             # Specific asset schema
node scripts/discovery.mjs transitions                   # All transition types
node scripts/discovery.mjs transition <transitionType>   # Specific transition schema
node scripts/discovery.mjs anchors                       # Valid anchor.position values
node scripts/discovery.mjs envelope                      # Generic field reference (anchor, motion, z, etc.)
node scripts/discovery.mjs manifest                      # Top-level manifest.json fields
node scripts/discovery.mjs pitfalls                       # Pitfall topics
node scripts/discovery.mjs pitfalls <topic>               # Known rendering traps
node scripts/discovery.mjs aliases [category]             # All "$alias" shorthands
node scripts/discovery.mjs alias <name>                   # Alias info + expansion
node scripts/discovery.mjs themes / theme <name>           # Theme presets
node scripts/discovery.mjs collections / collection <type> # Asset-gathering workflows
```
**Recommended Workflow**: `envelope`/`manifest` → `asset`/`transition` → `pitfalls` → Author.

## Timeline (`scripts/timeline-cli.mjs`)
Dynamic, per-project frame-axis introspection + injection — split out of `discovery.mjs` since it resolves the project fresh from disk every call (never static). Always run `outline` first: it's a compact hierarchical (DAG-shaped) view — composition → scene → {assets, effects, camera} — where every child only carries offsets local to its own parent, not the full resolved payload `timeline` repeats per node. Drill into one scene's full detail (content/resolvedPosition/resolvedStyle/word timing) with `scene <id> <sceneId>` only once `outline` tells you which scene matters.

```
node scripts/timeline-cli.mjs outline <projectId>                    # compact DAG-shaped timeline — read this first
node scripts/timeline-cli.mjs scene <projectId> <sceneId>            # full per-node detail for ONE scene
node scripts/timeline-cli.mjs timeline <projectId>                   # full global-frame timeline (every scene/asset/effect, full payload)
node scripts/timeline-cli.mjs describe-frame <projectId> <frame>     # what's on screen at this global frame
node scripts/timeline-cli.mjs open-ranges <projectId> <sceneId>      # safe gaps in a scene
node scripts/timeline-cli.mjs inject-effects <projectId> '<rules>'   # write sfx/visual effects anchored to asset segments or scene boundaries
```

### Injecting SFX at asset intro/outro (`inject-effects`)
`inject-effects` rules come in two anchor modes — pick deliberately, they land in very different places:
- `match: { assetType: "<Type>" }` + `anchor: "enter"|"exit"` — **per-asset**. Fires once per matching asset SEGMENT, at that exact asset's own resolved enter/exit frame (converted from the timeline's global frame back to scene-local). Multiple assets of the same type in one scene each get their own hit — this is what you want for "sound when each text/image/logo appears/leaves".
- `match: { scene: "all" }` (or `predicate: "sceneStart"/"sceneEnd"`) — **per-scene-boundary**. Fires once per scene at frame 0 or `scene.durationInFrames`, regardless of what assets are on screen. Use for a cut-transition whoosh, not an asset-level sting.
Don't confuse the two — `assetType` rules do NOT collapse to one hit per scene; a scene with 4 `SvgImage` logos entering at different times gets 4 separate SFX hits, each id-suffixed `-0`, `-1`, `-2`... Re-running the same rules is idempotent (replaces by id), so it's safe to iterate on volume/path and re-run.
Always sanity-check placement with `outline <projectId>` after injecting — each scene's `effects[]` block shows `enter`/`exit` scene-local frames right next to the `assets[]` they're meant to align with.

### Sourcing SFX or media
Assuming that the endpoint is on.
```bash
curl -X POST http://localhost:3000/download      -H "Content-Type: application/json"      -d '{"url": "https://www.instagram.com/reel/DcGtO6ZMKkf/?hl=en"}' -o name.mp4 
```
node scripts/discovery.mjs collection youtubeSearch    # command template + example
node scripts/discovery.mjs collection ytDlpDownload
node scripts/discovery.mjs collection sfxSplit
node scripts/discovery.mjs collection manifestWiring   # confirms path is relative to public/, e.g. "audio/sfx/whoosh-01.mp3"
```
Workflow that actually worked:
1. `yt-dlp --flat-playlist --dump-json 'ytsearchN:<query> no copyright'` → eyeball `id`/`duration`/`title` for a short, clean pack video (not a 10-min compilation — silencedetect slicing gets noisy on those).
2. `cd public/audio/sources && yt-dlp -x --audio-format mp3 --audio-quality 0 -o '%(id)s - %(title).70s.%(ext)s' '<url>'`.
3. `ffmpeg -nostdin -hide_banner -i '<source>.mp3' -af 'silencedetect=n=-30dB:d=0.18' -f null - 2>&1 | grep silence` → read the `silence_start`/`silence_end` pairs; a "hit" is the gap BETWEEN two silence windows (i.e. `silence_end` of one to `silence_start` of the next).
4. `ffmpeg -nostdin -y -hide_banner -loglevel error -i '<source>.mp3' -ss <start> -to <end> public/audio/sfx/<name>.mp3` per hit you want — write straight to `public/audio/sfx/`, not `public/audio/split/` (the collection's documented `destination`), since the manifest path only needs to be relative to `public/` and a flat `sfx/` folder is simpler to reference than juggling two dirs.
5. Reference as `"path": "audio/sfx/<name>.mp3"` in an `inject-effects` rule's `effect.path` (or hand-authored `scene.effects[]`) — never the full `public/...` prefix.
`ffprobe -v error -show_entries format=duration -of csv=p=0 <clip>.mp3` afterward confirms you sliced a short transient (well under 2s), not a leftover silence gap.

### Image sourcing: Yandex vs Pexels
Two collections, different jobs — check `discovery.mjs collection <type>` for exact command/output fields.
- **Pexels** (`scripts/pexels/fetch_image.mjs`, `fetch_broll.mjs`): stock footage/photos, generic objects/b-roll. Not for hyper-specific subjects.
- **Yandex Images** (`discovery.mjs collection imageSearch`, aliases: `image`/`images`/`yandex`/`yandeximages`): browser-backed search via `opencli yandeximages search '<query>' --limit 10 -f json` → `public/assets/`. Use for hyper-specific real-world subjects Pexels won't have: real people (named individuals), company/product logos, named buildings/landmarks, brand-specific imagery. Output fields: `image_url`, `thumb_url`, `title`, `width`, `height`, `source_url`. Docs: `docs/skills/assetlibrary/04-images-opencli.md`.
- Rule of thumb: asset must literally depict named thing → Yandex. Generic/stock-style illustration of a concept → Pexels.

### Scene requirement planning (`scripts/curate/scene-quota.mjs`)
Randomized per-scene requirement generator for short-form content. Walks a hook→context→build→payoff→cta arc and rolls, per scene: estimated duration (seconds+frames), rough asset count, image/svg/video/text requirement counts, and a composition size budget (mirrors `scripts/curate/composition/rules.md` rule 1). Output is a planning list, not manifest JSON — use it before authoring scenes/assets.
```
node scripts/curate/scene-quota.mjs                                  # random 4-7 scenes, 20-45s, JSON
node scripts/curate/scene-quota.mjs --scenes 6 --duration 30 --format md
node scripts/curate/scene-quota.mjs --seed 42                        # reproducible roll
node scripts/curate/scene-quota.mjs --vertical false                 # 1920x1080 instead of 1080x1920
```

## Command Reference

### 1. Project Management
- `project create <id> [flags]`: Init project. `--theme <name>` seeds from `studio/library/themes/`.
- `project set <id>`: Switch active project.
- `project current`: Get active project ID.
- `project validate`: Full manifest tree and asset-id uniqueness check.

### 2. Scene Operations
- `scene create <sceneId> ['<json>']`: Create scene.
- `scene delete <sceneId>`: Delete scene.
- `scene get <sceneId> [field]`: Get scene or field.
- `scene <sceneId> <field> '<json>' ...`: Replace fields (no deep merge).

### 3. Asset Operations
- `asset create <sceneId> <assetId> '<json>'`: Create asset in scene.
- `asset delete <assetId> [--scene <sceneId>]`: Delete asset.
- `asset get <assetId> [--scene <sceneId>] [field]`: Get asset data.
- `asset <assetId> <field> '<json>' ... [--scene <sceneId>]`: Update fields.

### 4. Styles & Config
- `styles <field> '<json>' ... [--replace]`: Merge/replace tokens in style registry.
- `config '<json>'`: Shallow-merge keys into `config.json`.

### 5. Theme Library (`studio/library/themes/`)
Global presets. Mutate here, discover via `discovery.mjs`.
- `theme list`: List presets.
- `theme show <name>`: Get JSON.
- `theme create <name> ['<json>'] [--overwrite]`: Save preset (defaults to active project styles).
- `theme delete <name>`.
- `theme use <name> [--replace]`: Merge/replace active project styles.

### 6. Alias Library (`studio/library/aliases/`)
Custom `"$alias"` presets. Loaded at runtime; no restart needed.
- `alias list [category]`: List custom aliases.
- `alias show <category.name>`.
- `alias create <category.name> '<expansion-json>' ['<description>'] [--overwrite]`: Expansion must be static JSON.
- `alias delete <category.name>`.

### 7. Manifest Export
- `manifest export`: Dump active project (manifest+config+styles+scenes) as one JSON. Always pretty-printed.
*Note: `cli.js manifest export` = live data; `discovery.mjs manifest` = schema reference.*

### 8. Batch Mode
Atomic multi-operation transaction.
`node scripts/cli.js batch '[{"type":"scene.create",...}, {"type":"asset.create",...}]'`
Or use `--file <path>`.

### Composition plugins (overlap / similar-scene checks) — opt-in, NOT default
`overlapGuard` (asset-overlap, off-frame, tiny-size, short-duration, low-activity checks) and `similarSceneGuard` (repetitive-scene diversity check) do NOT run unless a project's `config.json` names them. `resolve.js` always prints a `composition plugin findings: N total, ...` line — that line appears even with zero plugins configured (`N` is just `0` then), so don't read its presence as evidence a check ran.

Enable via the existing generic config command (no dedicated flag needed):
```
node scripts/cli.js config '{"compositionPlugins": ["overlapGuard", "similarSceneGuard"]}'
```
Per-check severity/threshold tuning:
```
node scripts/cli.js config '{"compositionPlugins": [{"name": "overlapGuard", "options": {"overlapSeverity": "error", "checkTinySize": false}}]}'
```
`severity: "warn"` (default) only `console.warn`s and resolve proceeds; `"error"` collects findings into one thrown Error and aborts resolve/render. See the `json-to-mp4-overlap-warnings` and `json-to-mp4-composition-plugins` skills for the fix workflow and full plugin authoring contract.

## Common Pitfalls
- **Field Replacement**: `scene <id> <field> <json>` replaces entire object; no deep merge.
- **Asset Uniqueness**: Enforced project-wide.
- **JSON Escaping**: Ensure shell-proper quoting.
- **Silent Failures**: Schema-valid $\neq$ Render-correct. Check `discovery.mjs pitfalls <topic>`.
- **`background` is a bare value, not `{ colorToken }`**: `scene create` / `scene <id> background <json>` takes a plain color-token string (`"shade1"`), a literal `"#RRGGBB"`, or `{ color?, texture?, blendMode?, opacity? }` — never `{ "colorToken": "..." }`. Check `discovery.mjs envelope` or `schema-cli.mjs fields scene` / `schema-cli.mjs field scene background` before guessing the shape.
- **Prefer `schema-cli.mjs field`/`asset-field` over `schema-cli.mjs schema`**: `schema scene` dumps the ENTIRE dereferenced scene.schema.json (1000+ lines) — expensive in both tool calls and context. Use `fields <file>` (cheap, one line per top-level field, no expansion) to see what's there, then `field <file> <name> [<name>...]` (accepts multiple names in one call) for just the field(s) you need. Same split for per-asset fields via `asset-fields`/`asset-field`. Add `--depth N` to `schema`/`definition`/`field`/`asset-field` to cap nested expansion instead of a full dump. `search <term> [<term>...]` also batches multiple terms in one process.
- **Enum/default vocabulary (easing names, anchor positions, blend modes, ...) is centralized in ONE command, not scattered per-field**: don't grep individual schema files or reverse-engineer defaults from motion.js/camera.js source. Run `node scripts/schema-cli.mjs vocab [term]` — it walks every schema file's `enum`/`default` keys and returns them in one shot (optionally filtered by a substring, e.g. `vocab easing`). This is how you find, in ONE call: the 4 curve-easing names (`linear`/`easeIn`/`easeOut`/`easeInOut`, used by camera legs and `motion.rotate`) and their per-field defaults, the 9 anchor `position` values, transition/blend-mode enums, etc. Two DIFFERENT things share the name "easing" and must not be confused: (1) the curve-shape enum `vocab easing` surfaces (motion/camera timing curves — a string like `"easeOut"`), and (2) spring PHYSICS presets (`gentleSpring`/`snappySpring`, defined per-project in `styles/theme.json`'s `easing` map, referenced by name from an asset's `styleOverride.easing`, e.g. `TextEmerge`) — those are NOT in the schema files at all; list them via `node scripts/discovery.mjs theme <name>` (or `theme show <name>` in cli.js) instead.
- **Asset field is `assetType`, not `type`**: authored asset objects use `assetType` (matches `discovery.mjs assets` output). `scene create`'s own `transitionOut.type` is the only sibling field actually called `type`.
- **`scene create` can't embed `assets[]` directly, and `scene <id> <field> <json>` has no `assets` field**: `assets` isn't in the allowed-fields list for the generic field-setter (`allowedFields`: narrationRef, transitionIn, transitionOut, effects, background, camera, physics). Always add assets one at a time via `asset create <sceneId> <assetId> '<json>'` after the scene exists.
- **`durationInFrames` is not an authorable scene field**: omit it. A scene with no `narrationRef` falls back to `config.json`'s `defaultSceneDurationInFrames`; a scene with `narrationRef` gets its duration from the matching `manifest.narration.entries` item. Passing `durationInFrames` to `scene create` fails schema validation (`additionalProperties`).
- **`asset create` refuses to reuse an asset id already used in another scene** (`AlreadyExists`, ops.js) — correct for normal assets, but it makes `asset create` unusable for the SECOND half of a carried-asset pair (`transitionOut.params.carryAssetId`/`carryAssetIds`, e.g. `slideContinuity`/`pivotZoom`), which *requires* the same id in both the outgoing and incoming scene. No `--force`/`--allow-duplicate` flag exists. Workaround: author the first scene's asset normally via `asset create`, then hand-write the second scene's JSON file (`studio/manifest/<project>/scenes/<sceneId>.json`) with the matching duplicate id, keeping the rest of the shape identical to what `asset create` would have produced. Then run `project validate` to confirm the schema still accepts it (see next pitfall for why cross-scene duplicate ids specifically pass).
- **`project validate`'s cross-scene duplicate-id check understands carry-chains**: it flags a repeated asset id across scenes UNLESS the immediately preceding scene's `transitionOut.params.carryAssetId`/`carryAssetIds` declares that exact id as carried (scripts/lib/project.js). A duplicate id with no matching carry declaration on the scene right before it is still a real error, not a false positive.
- **Fresh `project-cli.js create` ships a near-empty theme**: `theme.json`'s `typography` map can start empty, so an authored `styleOverride.typography` token (e.g. `"heading1"`) resolves to nothing at render (`Unknown typography token`). Run `cli.js theme use default --replace` (or another preset from `discovery.mjs themes`) right after project creation if you're going to reference typography/color tokens.
- **`transitionOut.durationInFrames` must leave room in the scene**: the transition overlay renders for its full duration (registry default or the explicit one) regardless of scene length; too-short a scene (e.g. `defaultSceneDurationInFrames` left at a tiny placeholder value) can drive the composition's computed duration negative and crash the Remotion render with `durationInFrames ... must be positive`. Always pair an explicit `transitionOut.durationInFrames` with a scene duration comfortably longer than it.

## Verification
Always run: `node scripts/cli.js project validate`
