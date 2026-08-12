# Style registry (theme)

Project theme — the `styles` file referenced by `manifest.styles`. Schema:
`src/pipelines/pipeline1-validate/schema/style.schema.json`. Resolved by
`src/registry/styleRegistry.js`, consumed by every asset's `resolvedStyle`
and by scene `background`.

Set piecemeal on `init` — each top-level key overrides only that block:

```bash
node scripts/agent-cli.mjs init '{
  "projectId": "<projectId>",
  "colors":    { "accentBg": "#FF6600" },
  "typography": { "body": { "fontFamily": "Inter, sans-serif", "fontSize": 36, "fontWeight": 400, "lineHeight": 1.4 } },
  "spacing":   { "gutter": 24 },
  "easing":    { "gentleSpring": { "damping": 16, "mass": 0.7, "stiffness": 110 } },
  "textures":  { "paper": "assets/paper.jpg" }
}'
```

Anything not overridden stays at the working defaults. Per-key overrides
replace only that token within its block (e.g. `"colors": { "accentBg": ... }`
touches only `accentBg`). See `init.md` for the init command surface.

## 1. `colors`

Token registry of hex literals. **Required** (must be non-empty).

```json
{
  "shade1":  "#0B0E14",
  "shade2":  "#161B26",
  "main1":   "#F5F7FA",
  "main2":   "#8B93A7",
  "accentBg":"#FF6600"
}
```

Values must match `^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$` (6- or 8-digit hex).
8-digit (`#RRGGBBAA`) carries alpha.

Consumed by `resolveColorToken` whenever a style key contains `color`
(case-insensitive) and the value is a string. `asset <Type>` echoes which
style keys are color-bearing. Pass tokens (or literal hex when documented
raw) via `styleOverride`.

## 2. `typography`

Token registry of font specs. **Required.**

Each value is an object with:
- `fontFamily` (string) — **required.** A CSS `font-family` value.
- `fontSize` (number) — **required.** Px.
- `fontWeight` (number) — **required.** CSS weight (100–900).
- `lineHeight` (number) — optional. Unitless multiplier.
- `colorToken` (string) — optional. A key from `colors` (not a raw hex).

Consumed by `resolveTypographyToken` whenever an asset's `styleOverride.typography`
is a string token. The resolved `typography` block on the asset's
`resolvedStyle` carries `{ fontFamily, fontSize, fontWeight, lineHeight?, color? }`
— `color` is the resolved hex when `colorToken` was set.

```bash
# reference a typography token via styleOverride
node scripts/agent-cli.mjs add-asset <projectId> <sceneId> '{
  "assetType": "TextBlock",
  "anchor": { "position": "center" },
  "contentOverride": { "text": "..." },
  "styleOverride": { "typography": "body" }
}'
```

## 3. `spacing`

Token registry of numbers. **Required.** No shape constraint beyond number
values — pure authoring-time convenience for layouts that read spacing tokens.

Most asset `contentOverride` / `styleOverride` number fields accept a raw
number, not a spacing token; spacing tokens are consumed by layout helpers in
custom components. Add them when a component's manifest documents that it
reads from `spacing`.

## 4. `easing`

Token registry of spring presets (Remotion `spring` config). Each value:

```json
{
  "gentleSpring": { "damping": 16, "mass": 0.7, "stiffness": 110 },
  "snappy":       { "damping": 26, "mass": 0.4, "stiffness": 220 }
}
```

- `damping` (number) — spring damping. Higher = less bounce.
- `mass` (number) — spring mass. Higher = slower settle.
- `stiffness` (number) — spring stiffness. Higher = faster snap.

Consumed by `resolveEasingToken` when an asset's `styleOverride.easing` is a
string token. Falls through to the component as the resolved object; the
component hands it to `spring()` directly.

Override piecemeal on init:

```bash
node scripts/agent-cli.mjs init '{ "projectId": "<id>", "easing": { "snappy": { "damping": 26, "mass": 0.4, "stiffness": 220 } } }'
```

## 5. `textures`

Token registry of texture paths. **Optional.** Each value is a path relative
to `public/` (consumed by Remotion's `staticFile()`).

```json
{ "paper": "assets/paper.jpg", "bankVault": "assets/bank_vault.jpg" }
```

Consumed by `resolveTextureToken` and by `resolveBackground` for scene
backgrounds — see `backgrounds.md`. Pass the *token* (e.g. `"paper"`) in
`scene.background.texture`, not the raw path.

```bash
# set a scene background with a texture — authored at add-scene time
# (no update-scene command exists; see backgrounds.md)
node scripts/agent-cli.mjs add-scene <projectId> '{
  "id": "<sceneId>",
  "background": { "color": "shade1", "texture": "paper", "blendMode": "multiply", "opacity": 0.5 }
}'
```

## Token vs literal

Across `colors`, `typography`, `easing`, `textures`: a style key that
documents "token" takes a token name (looked up in the theme); one that
documents "raw hex" takes a literal `#RRGGBB`. Most color keys accept *either*
(`resolveColorToken` passes a literal hex through unchanged). Typography,
easing, and texture keys do *not* accept raw values — pass tokens.

Rule of thumb: when in doubt, `asset <Type>` echoes the exact shape of each
field. Don't invent keys the manifest doesn't read.

## Common pitfalls

- **`colors` / `typography` / `spacing` are required keys** — if you override
  `styles` on init, all three must be present in the override block (omit a
  block to keep the default; never pass an empty `colors: {}`).
- **`colorToken` on a typography entry is a key from `colors`, not a raw
  hex.** `resolveTypographyToken` resolves it via `resolveColorToken` — the
  resolved `typography.color` is hex by the time it reaches the component.
- **`textures` values are relative to `public/`, not absolute paths.**
  Remotion `staticFile()` resolves them; don't prefix with `/`.
- **Token names are arbitrary.** The defaults use `shade1`/`main1`/etc. but
  the schema imposes no vocabulary — name your tokens whatever your design
  system uses, then reference them consistently from `styleOverride`.
