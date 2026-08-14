Here's a composition-plugin system for pipeline2, plus one plugin (`similarSceneGuard`) that throws — not just warns — when too many visually-similar scenes appear back to back. It follows the same additive/no-op conventions as the rest of pipeline2: absent `config.compositionPlugins` means zero behavior change for every existing project.

One thing to flag: `config.json` has no Ajv schema in what you've shared (only `manifest.schema.json` / `style.schema.json` / `scene.schema.json` / `camera.schema.json` / `transition.schema.json` / `shared.schema.json` exist, and `manifest.schema.json` only treats `config` as a path string). So adding `compositionPlugins` to `config.json` needs no schema change — I'm assuming that's correct based on what's in context; if there actually is a config schema you didn't share, it'll need `compositionPlugins` added there too.

## New file: `src/pipelines/pipeline2-resolve/plugins/similarSceneGuard.js`

```javascript
/**
 * Composition plugin: flags runs of consecutive scenes that are visually
 * near-identical. Unlike overlap_warn.js (which only ever console.warns),
 * this plugin defaults to severity "error" — enforceCompositionPlugins()
 * throws when it fires, aborting resolve/render. The intent is to make an
 * LLM-driven authoring loop *stop* and vary background/composition/camera/
 * transition instead of silently shipping five scenes that all look the
 * same.
 *
 * A scene's "signature" is a coarse fingerprint of the things a viewer
 * would actually register as "the same shot again": background, the set
 * of asset types on screen, camera movement pattern, and outgoing
 * transition style. Two adjacent scenes with an identical signature count
 * as one run; a run longer than `maxConsecutiveSimilar` is a finding.
 *
 * This intentionally does NOT compare asset content (text strings, image
 * paths) — two scenes both showing a single KineticText over shade1 with a
 * static camera are "the same shot" even if the words differ. That's the
 * whole point: it's a composition/blocking check, not a content check.
 */

const DEFAULT_OPTIONS = {
  // How many scenes may share a signature in a row before it's a finding.
  // 2 means "two in a row is fine, three in a row is not."
  maxConsecutiveSimilar: 2,
  // "error" -> enforceCompositionPlugins() throws (blocks resolve/render).
  // "warn"  -> logged via console.warn, resolve/render proceeds. Useful
  // while iterating before promoting to "error" for a final pass.
  severity: "error",
  compareBackground: true,
  compareAssetTypes: true,
  compareCamera: true,
  compareTransition: true,
};

function backgroundSignature(scene) {
  const bg = scene.background;
  if (bg == null) return "none";
  if (typeof bg === "string") return `color:${bg}`;
  return `color:${bg.color ?? ""}|texture:${bg.texturePath ?? ""}|blend:${bg.blendMode ?? ""}`;
}

function assetTypeSignature(scene) {
  return (scene.assets ?? [])
    .map((a) => a.assetType)
    .sort()
    .join(",");
}

function cameraSignature(scene) {
  const cam = scene.camera;
  if (!cam) return "static";
  const path = (cam.actions ?? [])
    .map((a) => (a.anchor?.followAssetId ? `follow:${a.anchor.followAssetId}` : a.anchor?.position ?? "?"))
    .join(">");
  const zoom = (cam.actions ?? []).map((a) => a.zoomPercent).join(">");
  return `${path}|zoom:${zoom}`;
}

function transitionSignature(scene) {
  return scene.transitionOut?.type ?? "cut";
}

function sceneSignature(scene, options) {
  const parts = [];
  if (options.compareBackground) parts.push(backgroundSignature(scene));
  if (options.compareAssetTypes) parts.push(assetTypeSignature(scene));
  if (options.compareCamera) parts.push(cameraSignature(scene));
  if (options.compareTransition) parts.push(transitionSignature(scene));
  return parts.join("||");
}

export const name = "similarSceneGuard";

/**
 * @param {Array} resolvedScenes  fully pass-2-resolved scenes (transitionOut
 *   must already be bundled — called after resolve.js's pass-2 loop)
 * @param {object} ctx            reserved for future cross-plugin context
 * @param {Partial<typeof DEFAULT_OPTIONS>} rawOptions
 * @returns {Array<{plugin:string, severity:string, sceneIds:string[], message:string}>}
 */
export function run(resolvedScenes, ctx = {}, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const findings = [];

  let runStart = 0;
  for (let i = 1; i <= resolvedScenes.length; i += 1) {
    const prevSig = sceneSignature(resolvedScenes[i - 1], options);
    const curSig = i < resolvedScenes.length ? sceneSignature(resolvedScenes[i], options) : null;
    const runContinues = curSig !== null && curSig === prevSig;

    if (!runContinues) {
      const runLength = i - runStart;
      if (runLength > options.maxConsecutiveSimilar) {
        const sceneIds = resolvedScenes.slice(runStart, i).map((s) => s.id);
        const comparedOn = [
          options.compareBackground && "background",
          options.compareAssetTypes && "asset types",
          options.compareCamera && "camera motion",
          options.compareTransition && "transition style",
        ].filter(Boolean).join(", ");
        findings.push({
          plugin: name,
          severity: options.severity,
          sceneIds,
          message:
            `Scenes [${sceneIds.join(", ")}] repeat the same ${comparedOn} ${runLength} times in a row ` +
            `(limit: ${options.maxConsecutiveSimilar}). Vary at least one of: background, which asset types ` +
            `are on screen, camera movement, or the outgoing transition, between consecutive scenes.`,
        });
      }
      runStart = i;
    }
  }

  return findings;
}
```

## New file: `src/pipelines/pipeline2-resolve/plugins/index.js`

```javascript
/**
 * Plugin registry + runner for pipeline2 composition checks. This is the
 * "include or not" seam: a project's config.compositionPlugins (absent by
 * default) is the only thing that turns any of this on. No entry here is
 * ever imported into resolveScene.js/resolve.js's hot per-asset path — it
 * runs exactly once, after all scenes are fully resolved (pass 2 done, so
 * transitionOut bundles are already in place).
 *
 * Plugin contract: a module exporting
 *   { name: string, run(resolvedScenes, ctx, options) => Finding[] }
 * where Finding = { plugin, severity: "error"|"warn", sceneIds, message }.
 * Add a new plugin by writing one such module and registering it below —
 * nothing else in pipeline2 needs to change.
 */
import * as similarSceneGuard from "./similarSceneGuard.js";

const REGISTRY = {
  similarSceneGuard,
};

function normalizePluginEntry(entry) {
  if (typeof entry === "string") return { name: entry, enabled: true, options: {} };
  return { name: entry.name, enabled: entry.enabled !== false, options: entry.options ?? {} };
}

/**
 * Runs every enabled plugin in config.compositionPlugins against the
 * resolved scene graph and returns their combined findings, unfiltered.
 *
 * @param {Array} resolvedScenes
 * @param {Array<string|{name:string, enabled?:boolean, options?:object}>=} pluginsConfig
 */
export function runCompositionPlugins(resolvedScenes, pluginsConfig) {
  if (!Array.isArray(pluginsConfig) || pluginsConfig.length === 0) return [];

  const findings = [];
  for (const raw of pluginsConfig) {
    const { name: pluginName, enabled, options } = normalizePluginEntry(raw);
    if (!enabled) continue;
    const plugin = REGISTRY[pluginName];
    if (!plugin) {
      throw new Error(
        `Unknown composition plugin "${pluginName}". Available: ${Object.keys(REGISTRY).join(", ")}`,
      );
    }
    findings.push(...plugin.run(resolvedScenes, {}, options));
  }
  return findings;
}

/**
 * Runs the plugins and enforces the result: "warn"-severity findings are
 * console.warn'd (same UX as overlap_warn.js) and resolve proceeds;
 * "error"-severity findings are collected and thrown as one combined
 * Error, aborting resolve/render — this is the "more enforced than
 * overlap_warn" behavior the plugin system exists for.
 *
 * @returns {{warnings: Array, errors: Array}}
 */
export function enforceCompositionPlugins(resolvedScenes, pluginsConfig) {
  const findings = runCompositionPlugins(resolvedScenes, pluginsConfig);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity !== "error");

  warnings.forEach((w) => console.warn(`[composition-plugin:${w.plugin}] ${w.message}`));

  if (errors.length > 0) {
    const message = errors.map((e) => `  - [${e.plugin}] ${e.message}`).join("\n");
    throw new Error(`Composition plugin check failed:\n${message}`);
  }

  return { warnings, errors };
}

export { REGISTRY as AVAILABLE_COMPOSITION_PLUGINS };
```

## Changed: `src/pipelines/pipeline2-resolve/resolve.js`

Add the import alongside the other pipeline2 imports:

```javascript
import { enforceCompositionPlugins } from "./plugins/index.js";
```

And call it right after the pass-2 loop, before `musicTracks` is built (so it runs against fully-bundled scenes, including `transitionOut`):

```javascript
  // Opt-in, config-driven composition checks (e.g. similarSceneGuard).
  // config.compositionPlugins is absent on every existing project, so
  // this is a strict no-op — runCompositionPlugins short-circuits on an
  // empty/missing array and enforceCompositionPlugins never throws.
  enforceCompositionPlugins(resolvedScenes, config.compositionPlugins);

  const musicTracks = (manifest.music ?? []).map((m) => ({
```

Because this lives inside `resolveProject()`, it fires for every caller — `render.js`, `ProjectBuilder.render` (via the spawned script), and `ProjectBuilder.getTimeline`/`injectTimelineEffects`. That's deliberate: an agent calling `getTimeline` to plan its next move gets the same enforcement signal immediately, rather than only discovering it at final render.

## Optional: config example (`config.json`)

```json
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "compositionPlugins": [
    {
      "name": "similarSceneGuard",
      "options": {
        "maxConsecutiveSimilar": 2,
        "severity": "error"
      }
    }
  ]
}
```

Omit `compositionPlugins` entirely (the default) and nothing changes.

## Optional: `ProjectBuilder` convenience setter

If you want the agent to toggle this without hand-editing `config.json`, add to `src/agent/ProjectBuilder.js`:

```javascript
  /** Sets (replaces wholesale) config.compositionPlugins — the include-or-not
   * switch for pipeline2's composition plugin system (see
   * src/pipelines/pipeline2-resolve/plugins/index.js). Pass an empty array
   * or omit entirely to disable all composition enforcement. */
  setCompositionPlugins(projectId, pluginsConfig = []) {
    const config = this._readJson(this.configPath(projectId));
    config.compositionPlugins = pluginsConfig;
    this._writeJson(this.configPath(projectId), config);
    return config.compositionPlugins;
  }
```

## Optional: discoverability in `src/agent/introspect.js`

So the CLI can tell an agent what's available without reading source:

```javascript
import { AVAILABLE_COMPOSITION_PLUGINS } from "../pipelines/pipeline2-resolve/plugins/index.js";

export function listCompositionPlugins() {
  return Object.keys(AVAILABLE_COMPOSITION_PLUGINS).map((name) => ({
    name,
    description:
      name === "similarSceneGuard"
        ? "Flags runs of consecutive scenes sharing the same background/asset types/camera/transition; throws by default when the run exceeds maxConsecutiveSimilar."
        : undefined,
  }));
}
```

Flagging an assumption: I didn't see `scripts/render-project.mjs` in context, so I can't confirm it calls `resolveProject` directly vs. some wrapper — if it goes through a different resolve path, the `enforceCompositionPlugins` call in `resolve.js` won't reach it and you'd need the same call added there too.