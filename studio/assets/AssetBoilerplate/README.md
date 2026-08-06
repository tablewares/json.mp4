# Asset boilerplate

Copy this folder when you need a new visual asset that follows the project contract:

1. Rename the folder to your asset name (for example `NumberStat`).
2. Update the manifest `assetType`, `component`, and `description`.
3. Rename the exported component to match the asset type.
4. Replace the sample title/body content with the behavior you need.
5. Adjust the default size, default style, and schema to match your asset.

The component receives:
- `resolvedPosition`: computed layout from anchor + nudge
- `resolvedStyle`: token-resolved style + width/height
- `content`: the resolved content override
- `timing`: enter/exit frame window, plus any narration timing data
