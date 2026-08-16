# Alias registry

Named presets grouped by category (`motion`, `camera`, `effects`, `timing`, `transition`) that expand into full authored shapes at resolve time. Injected into pipeline2 (`resolve.js`) before sub-resolvers run.

Source: `src/registry/aliasRegistry.js`, `src/pipelines/pipeline2-resolve/resolve.js`.

Any `$alias` key in scene body, transition effects, asset motion/timing/effects, or camera is expanded recursively (depth cap: 10).

## CLI discovery

```bash
node scripts/agent-cli.mjs aliases                 # every alias grouped by category
node scripts/agent-cli.mjs aliases motion          # one category only
node scripts/agent-cli.mjs alias <name>            # full info + expanded (default-vars) shape
node scripts/agent-cli.mjs alias-categories        # known category names
```

- `aliases`: Returns `name`, `shortName`, `description`, and `vars`.
- `alias <name>`: Returns `expanded` (object/array with defaults).

### Standalone discovery script (`scripts/alias-discovery.mjs`)

Same surface plus:
- `show --vars '{ "key": "val" }'`: Preview variant.
- `expand '{"$alias":"..."}'`: Resolve one `$alias` object deep.

## Authoring shape

**Bare:**
`"enterAt": { "$alias": "timing.withPreviousExit", "assetId": "heroImage" }`
→ `{ "relativeToAsset": "heroImage", "edge": "exit", "offsetFrames": 0 }`

**Nested:**
`"motion": { "$alias": "motion.spinIn", "toDeg": 180 }`
→ `{ "in": "fade", "rotateDeg": 0, "rotate": { "toDeg": 180, ... } }`

**Multiple:**
```json
{
  "assetType": "ImageReveal",
  "enterAt": { "$alias": "timing.withPreviousEnter", "assetId": "titleText" },
  "motion":  { "$alias": "motion.fadeInOut", "direction": "up", "outDirection": "down" },
  "effects": { "$alias": "effects.oldComputer", "grayscale": 0.9 }
}
```

`$alias` is the discriminator. Other keys in the object are passed as input variables to the alias function.

## Built-in aliases

### `motion`
- `motion.fadeIn`: `direction` → `{ in: "fade..." }`
- `motion.fadeInHalf`: — → `{ in: { alias: "fade", durationInFrames: 9 } }`
- `motion.fadeInOut`: `direction`, `outDirection` → entrance + exit
- `motion.spinIn`: `in`, `fromDeg`, `toDeg`, `durationInFrames`, `easing` → fade in + rotate
- `motion.clearIn`: `out`, `fromDeg`, `toDeg`, `durationInFrames`, `easing` → exit + reverse-spin
- `motion.settle`: `inDuration`, `rotateDuration`, `fromDeg`, `toDeg` → fadeUp + settle wobble

### `camera`
- `camera.dollyIn`: `startAnchor`, `endAnchor`, `zoomStart`, `zoomEnd` → `{ start, end, zoomStartPercent: 1, zoomEndPercent: 1.25, easeZoom: true }`
- `camera.overshootHold`: `startAnchor`, `zoomStart`, `zoomEnd`, `durationInFrames`, `actionIndex` → zoom in → pause/action → zoom 1.0

### `effects`
- `effects.oldComputer`: `grayscale`, `contrast`, `brightness`, `sepia`, `grainIntensity`, `scanlineOpacity`, `scanlineHeight` → filter + grain + scanlines
- `effects.warmPhoto`: `sepia`, `contrast`, `brightness` → warm sepia filter
- `effects.coldMonochrome`: `grayscale`, `contrast`, `brightness`, `scanlineOpacity` → cold grayscale + scanlines

### `timing`
- `timing.withPreviousExit`: `assetId` (req), `offsetFrames` → fire when target exits
- `timing.withPreviousEnter`: `assetId` (req), `offsetFrames` → fire when target enters
- `timing.atCameraAction`: `actionIndex` (req), `offsetFrames` → fire relative to camera action
- `timing.atSceneEnd`: `offsetFrames` → fire relative to scene end
