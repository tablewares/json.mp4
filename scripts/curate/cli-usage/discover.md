# Discover

List/describe types + schemas before building.

```bash
node scripts/agent-cli.mjs assets                   # every asset type + one-line desc
node scripts/agent-cli.mjs asset <Type>             # contentOverride/styleOverride schema + defaults for one type
node scripts/agent-cli.mjs transitions              # every transition type + one-line desc
node scripts/agent-cli.mjs transition <Type>         # params schema + defaults for one type
node scripts/agent-cli.mjs anchors                  # valid anchor.position values
node scripts/agent-cli.mjs envelope                 # field reference (anchor, enterAt/exitAt, effects shape)
node scripts/agent-cli.mjs schemas                 # every pipeline schema file + required keys + def count
node scripts/agent-cli.mjs schema <filename>      # flatten one schema file's full contract (refs resolved)
node scripts/agent-cli.mjs definition <name>       # find a definition by name across all schemas
node scripts/agent-cli.mjs aliases [category]      # every alias grouped by category
node scripts/agent-cli.mjs alias <name>           # full info + expanded (default-vars) shape for one alias
node scripts/agent-cli.mjs alias-categories       # known alias category names
node scripts/agent-cli.mjs collections              # every asset-library collection workflow
node scripts/agent-cli.mjs collection <Name>        # command + destination + output fields for one workflow
node scripts/agent-cli.mjs projects                 # existing project ids
node scripts/agent-cli.mjs show <projectId>                 # full built tree (manifest+config+styles+scenes)
node scripts/agent-cli.mjs list-assets <projectId>          # every placed asset, grouped by scene
node scripts/agent-cli.mjs list-assets <projectId> <sceneId> # one scene's assets
node scripts/agent-cli.mjs list-transitions <projectId>     # each scene's current transitionOut
```

- `list-assets` / `list-transitions`: Use to check current project state before `update-*`/`remove-*`.
- `asset <Type>` / `transition <Type>`: Returns required `contentOverride` keys and defaults. Call for every type used this session.
- `collections` / `collection <Name>`: CLI discovery for `docs/skills/assetlibrary/`. Use for YouTube search, yt-dlp, SFX slicing, Yandex image discovery.
- `schemas` / `schema <filename>` / `definition <name>`: Flatten pipeline1 JSON schemas. Resolves `$ref`, expands unions, surfaces constraints. See `schema.md`.
- `aliases` / `alias <name>` / `alias-categories`: Surface alias registry. Named presets grouped by category. See `registry.md`.
- New types: See `authoring-new.md`.
