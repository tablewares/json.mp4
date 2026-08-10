# Discover

List/describe types + schemas before building.

```bash
node scripts/agent-cli.mjs assets                   # every asset type + one-line desc
node scripts/agent-cli.mjs asset <Type>             # contentOverride/styleOverride schema + defaults for one type
node scripts/agent-cli.mjs transitions              # every transition type + one-line desc
node scripts/agent-cli.mjs transition <Type>         # params schema + defaults for one type
node scripts/agent-cli.mjs anchors                  # valid anchor.position values
node scripts/agent-cli.mjs envelope                 # scene/asset/transitionEffect field reference (anchor, enterAt/exitAt, effects shape)
node scripts/agent-cli.mjs collections              # every asset-library collection workflow
node scripts/agent-cli.mjs collection <Name>        # command + destination + output fields for one workflow
node scripts/agent-cli.mjs projects                 # existing project ids
node scripts/agent-cli.mjs show <projectId>                 # full built tree (manifest+config+styles+scenes)
node scripts/agent-cli.mjs list-assets <projectId>          # every placed asset, grouped by scene
node scripts/agent-cli.mjs list-assets <projectId> <sceneId> # one scene's assets
node scripts/agent-cli.mjs list-transitions <projectId>     # each scene's current transitionOut (or null = hard cut)
```

`list-assets` / `list-transitions` = "what's in this project now" — run before any `update-*`/`remove-*`, don't guess ids.

`asset <Type>` returns `{ description, defaultSize, defaultStyle, content:{required,optional}, style:[...] }`. `content.required` = exact `contentOverride` keys you must supply; rest has working default. Call `asset <Type>` for every type you use this session, even one used in prior run. Same for `transition <Type>` before setting `params`.

`collections` / `collection <Name>` mirror `docs/skills/assetlibrary/` as CLI discovery: exact command, destination, required tools, output fields, linked docs. Use before manual shell/browser workflows — especially YouTube search, yt-dlp download, SFX slicing, Yandex image discovery.

Can discover types not in registry yet — see `authoring-new.md`.
