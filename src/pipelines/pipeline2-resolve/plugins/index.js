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
  console.log("composition plugin findings:", findings.length, "total,", warnings.length, "warnings,", errors.length, "errors");
  warnings.forEach((w) => console.warn(`[composition-plugin:${w.plugin}] ${w.message}`));

  if (errors.length > 0) {
    const message = errors.map((e) => `  - [${e.plugin}] ${e.message}`).join("\n");
    throw new Error(`Composition plugin check failed:\n${message}`);
  }

  return { warnings, errors };
}

export { REGISTRY as AVAILABLE_COMPOSITION_PLUGINS };
