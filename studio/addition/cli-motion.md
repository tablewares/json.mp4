Flagging up front: I don't have `scripts/agent-cli.mjs`, `commandRunner.js`, or `agent-script.mjs` in context, so the CLI portion below is a sketch built from the conventions your `addAsset`/`updateAsset`/`setCamera` commands already establish (JSON-blob flags for object-shaped fields, `checkAgainstSchema`-style non-fatal warnings) — not confirmed against the actual dispatcher. Please diff it against the real files before wiring it in.

## `src/agent/ProjectBuilder.js`

### 1. Import + cached validator (place near `checkCameraSpec`)

```js
import { resolveMotion } from "../motion/motion.js";
```

```js
/**
 * Caches a compiled `scene.schema.json#/definitions/motionSpec` validator,
 * standing parallel to checkCameraSpec. Returns [] when clean, or
 * human-readable error strings when not.
 */
let _cachedMotionValidator = null;
function checkMotionSpec(motionSpec) {
  if (motionSpec == null) return [];
  if (_cachedMotionValidator === null) {
    const schemaDir = path.join(
      __dirname,
      "../pipelines/pipeline1-validate/schema",
    );
    const sceneSchema = JSON.parse(
      fs.readFileSync(path.join(schemaDir, "scene.schema.json"), "utf-8"),
    );
    const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
    for (const sib of [
      "transition.schema.json",
      "shared.schema.json",
      "camera.schema.json",
    ]) {
      const sibPath = path.join(schemaDir, sib);
      if (!ajv.getSchema(sib)) {
        ajv.addSchema(JSON.parse(fs.readFileSync(sibPath, "utf-8")), sib);
      }
    }
    if (!ajv.getSchema("scene.schema.json")) {
      ajv.addSchema(sceneSchema, "scene.schema.json");
    }
    // motionSpec is defined inline in scene.schema.json (unlike cameraSpec,
    // which lives in camera.schema.json) — resolve against scene.schema.json's
    // own $id.
    _cachedMotionValidator = ajv.getSchema("scene.schema.json#/definitions/motionSpec");
  }
  if (_cachedMotionValidator(motionSpec)) return [];
  return (_cachedMotionValidator.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`);
}
```

Additionally, `resolveMotion()` itself throws on an unknown alias — a check `checkAgainstSchema`/`checkCameraSpec` alone won't catch if you ever loosen the schema's `enum`. So run both: schema check for shape, then a dry-run through `resolveMotion` for alias validity, same non-fatal-warnings contract.

```js
function checkMotionAliases(motionSpec) {
  if (motionSpec == null) return [];
  try {
    resolveMotion(motionSpec);
    return [];
  } catch (e) {
    return [e.message];
  }
}
```

### 2. `addAsset` — accept `spec.motion`

```js
    const asset = {
      id,
      assetType,
      anchor: spec.anchor ?? { position: "center", offsetXPercent: 0, offsetYPercent: 0 },
      contentOverride,
      styleOverride: spec.styleOverride ?? {},
      enterAt: spec.enterAt ?? 0,
      exitAt: spec.exitAt ?? 1,
    };
    if (spec.z !== undefined) asset.z = spec.z;
    // Optional; omitted entirely when not authored so pre-existing assets'
    // byte-shape is untouched (same rationale as `z` above).
    if (spec.motion !== undefined) asset.motion = spec.motion;

    const warnings = [
      ...checkAgainstSchema(entry.manifest.contentOverrideSchema, asset.contentOverride),
      ...checkMotionSpec(asset.motion),
      ...checkMotionAliases(asset.motion),
    ];
```

### 3. `updateAsset` — accept `patch.motion`

```js
    if (patch.anchor) asset.anchor = { ...asset.anchor, ...patch.anchor };
    if (patch.contentOverride) asset.contentOverride = { ...asset.contentOverride, ...patch.contentOverride };
    if (patch.styleOverride) asset.styleOverride = { ...asset.styleOverride, ...patch.styleOverride };
    if (patch.enterAt !== undefined) asset.enterAt = patch.enterAt;
    if (patch.exitAt !== undefined) asset.exitAt = patch.exitAt;
    if (patch.z !== undefined) asset.z = patch.z;
    // Shallow merge at the top level (in/out/rotateDeg), matching
    // contentOverride/styleOverride's merge behavior rather than z's
    // wholesale-overwrite — lets an agent patch just rotateDeg without
    // re-authoring in/out.
    if (patch.motion) asset.motion = { ...(asset.motion ?? {}), ...patch.motion };
```

...and extend the trailing warnings:

```js
    const entry = registry[asset.assetType];
    const warnings = [
      ...checkAgainstSchema(entry.manifest.contentOverrideSchema, asset.contentOverride),
      ...checkMotionSpec(asset.motion),
      ...checkMotionAliases(asset.motion),
    ];
```

No new top-level `setMotion`/`updateMotion` methods — unlike camera (which has scalars + an `actions[]` array needing separate append semantics), motion is a small three-key object that fits `addAsset`/`updateAsset`'s existing spec/patch shape cleanly, same as `z`.

---

## `scripts/agent-cli.mjs` / `commandRunner.js` (sketch — unverified against real dispatcher)

Given `add-asset` and `update-asset` already need to accept JSON-blob flags for `contentOverride`/`styleOverride`, the additive piece is one more optional JSON flag, `--motion`, parsed the same way and passed straight through as `spec.motion` / `patch.motion`:

```js
// Wherever add-asset's flag parsing builds its spec object:
const spec = {
  id: flags.id,
  assetType: flags.assetType,
  anchor: flags.anchor ? JSON.parse(flags.anchor) : undefined,
  contentOverride: flags.content ? JSON.parse(flags.content) : undefined,
  styleOverride: flags.style ? JSON.parse(flags.style) : undefined,
  enterAt: flags.enterAt !== undefined ? Number(flags.enterAt) : undefined,
  exitAt: flags.exitAt !== undefined ? Number(flags.exitAt) : undefined,
  z: flags.z !== undefined ? Number(flags.z) : undefined,
  motion: flags.motion ? JSON.parse(flags.motion) : undefined,
};
const { asset, warnings } = builder.addAsset(projectId, sceneId, spec);
```

```js
// update-asset's patch parsing, same pattern:
const patch = {
  ...(flags.anchor ? { anchor: JSON.parse(flags.anchor) } : {}),
  ...(flags.content ? { contentOverride: JSON.parse(flags.content) } : {}),
  ...(flags.style ? { styleOverride: JSON.parse(flags.style) } : {}),
  ...(flags.enterAt !== undefined ? { enterAt: Number(flags.enterAt) } : {}),
  ...(flags.exitAt !== undefined ? { exitAt: Number(flags.exitAt) } : {}),
  ...(flags.z !== undefined ? { z: Number(flags.z) } : {}),
  ...(flags.motion ? { motion: JSON.parse(flags.motion) } : {}),
};
```

Agent-facing usage, mirroring how `--content`/`--style` already read as inline JSON:

```
add-asset --scene intro --assetType KineticText --content '{"text":"Hello"}' --motion '{"in":"fadeUp","out":"fadeOutDown"}'
update-asset --scene intro --id kt-1 --motion '{"rotateDeg":-4}'
```

If `agent-script.mjs`'s line format instead uses positional/keyed tokens rather than `--flag value`, or if `commandRunner.js` validates a fixed allow-list of flag names per command, this needs the corresponding line added there too — I can't see that gate from here, so double check `add-asset`/`update-asset`'s current flag allow-list before shipping this.