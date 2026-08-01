# Using a shipped asset

Assets live in `src/assets/<AssetName>/` as a `manifest.json` + a
`<AssetName>.jsx` component pair. The manifest is the contract an agent
_negotiates against_ when filling out a scene's `assets[]` entry. To use
one, open its manifest, read the two schemas, and author the override
accordingly.

## Shipped assets

| assetType | folder | one-line | contentOverride | styleOverride highlights |
|---|---|---|---|---|
| `TextBlock` | `src/assets/TextBlock/` | One block of text with own entrance/exit | `text` (req), — | `typography`, `backgroundColorToken`, `easing`, `align` (`left|center|right`) |
| `ImageReveal` | `src/assets/ImageReveal/` | Image revealed by a clip-path wipe + slight scale-in | `src` (req), `alt` | `borderRadius`, `easing`, `revealDirection` (`left-to-right|top-to-bottom|center-out`), `width`, `height` |

This table is the index. As new assets are added, append a row here and
(optionally) a dedicated `<AssetName>.md` next to this file for richer
notes; the table is the canonical shortlist.

## How to use one (always)

1. Open `src/assets/<AssetName>/manifest.json`.
2. Note `defaultStyle` — these are the values you get if you omit the
   corresponding `styleOverride` field. Any field you set in
   `styleOverride` overrides the default; anything you omit falls through.
3. Note `contentOverrideSchema.required` — those fields are mandatory in
   your scene's `contentOverride`. ⛔ Missing a required field fails
   validate (Ajv against the schema).
4. Note `styleOverrideSchema.properties` for the fields you can override.
   Unknown keys are silently ignored.

## Authoring the scene entry

Put it in the scene file under `assets[]` — see `../reference/asset-spec.md`
for the anchor/content/style/timing contract every asset shares. The asset
manifest only describes *its* content + style schemas; the surrounding
anchor/enterAt/exitAt shape is universal.

## Default sizes

Each asset manifest declares `defaultSize` (`width`, `height`). Your
`styleOverride.width`/`height` override it. The resolved size feeds the
anchor resolver (the box is centered on the anchor point), so changing
size shifts position predictably without breaking the anchor.
