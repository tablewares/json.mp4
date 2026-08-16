# Backgrounds

Per-scene background, authored on `scene.background` (`backgroundSpec` in
`shared.schema.json`). Resolved by `resolveBackground` in
`src/registry/styleRegistry.js` into the `background` field on the resolved
scene (`Composition.jsx` consumes it).

Three accepted forms; the resolver picks based on shape:
1. **Color token** — a project theme string, e.g. `"shade1"`. Resolved through
   `resolveColorToken` to a hex literal.
2. **Literal hex** — `"#0B0E14"`. Passed through unchanged.
3. **Object** — `{ color?, texture?, blendMode?, opacity? }`. Color resolves
   to a hex literal; `texture` resolves to a path under `public/` consumed by
   Remotion's `staticFile()`; the rest pass through.

No dedicated CLI command — `background` is a field on `add-scene`, set at
scene-creation time. There is no `update-scene`; to change a scene's
background after creation you have to remove and re-add the scene (which
drops its assets) or plan it up front. Pass it inline in the `add-scene`
JSON:

```bash
node scripts/agent-cli.mjs add-scene <projectId> '{
  "id": "<sceneId>",
  "narrationRef": "n1",
  "background": "shade1"
}'

# plain hex also valid
node scripts/agent-cli.mjs add-scene <projectId> '{ "id":"s2", "background":"#0B0E14" }'

# full object form
node scripts/agent-cli.mjs add-scene <projectId> '{
  "id": "vault",
  "background": { "color": "shade1", "texture": "paper", "blendMode": "multiply", "opacity": 0.5 }
}'
```

## Object form — full surface

```json
{
  "color":      "shade1",
  "texture":    "paper",
  "blendMode":  "multiply",
  "opacity":    0.5
}
```

- **`color`** (string, optional): color token or literal `#RRGGBB`. Resolved
  via `resolveColorToken`. The historical flat-color background.
- **`texture`** (string, optional): a texture token from `styles.textures`
  (a path relative to `public/`, e.g. `"assets/paper.jpg"`). Resolved to a
  renderer-relative path via `resolveTextureToken` and consumed by
  `staticFile()` at render time.
- **`blendMode`** (string, optional): a CSS `mix-blend-mode` applied to the
  texture overlay. Enum: `normal | multiply | screen | overlay | darken |
  lighten | color-dodge | color-burn | hard-light | soft-light | difference |
  exclusion | hue | saturation | color | luminosity`. Default `"normal"`.
- **`opacity`** (number, optional): opacity of the texture overlay, `[0, 1]`.
  Default 1. The `color` underneath is unaffected by `opacity`.

Omit `texture` for a flat color; omit `color` for texture-only (renders
against the page's default — usually not what you want).

## Resolved shape

The resolved `background` on the scene object is one of:
- a plain hex string (when authored as a token or literal string), or
- the object `{ color, texturePath, blendMode, opacity }` (when authored as
  an object). `texturePath` is `undefined` when no texture was authored;
  `Composition.jsx` treats an undefined `texturePath` as "no overlay" and
  renders the flat color.

The object form is the resolved shape `transition.outgoingSceneStyles.background`
and `incomingSceneStyles.background` hand to transition components — see
`to_be_indexed/style-transition.md`.

## Common pitfalls

- **`texture` is a token from `styles.textures`, not a raw path.** Add the
  path under your project's style registry's `textures` block first
  (`init`/override), then reference it by token. A bare `"assets/foo.jpg"`
  here won't resolve.
- **`opacity` lives on the texture overlay, not the color.** Setting
  `"opacity": 0.5` doesn't dim the color underneath; it dims the texture
  blended over it.
- **`blendMode: "normal"` with `opacity: 1` fully occludes the color.** Most
  texture looks want `multiply` / `overlay` / `soft-light` with `opacity` in
  `[0.3, 0.7]` so the color still reads through.
- **A plain-string background is byte-identical to pre-texture scenes.**
  Existing scenes without a `texture` resolve exactly as before — additive.
