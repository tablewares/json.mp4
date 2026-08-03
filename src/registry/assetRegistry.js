import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_ASSET_ROOTS = ["../../studio/assets", "../../studio/graphics"];
const DEFAULT_TRANSITION_ROOTS = ["../../studio/transitions"];

function resolveRoot(root) {
  return path.isAbsolute(root) ? root : path.join(__dirname, root);
}

/**
 * Scan one directory: every immediate subfolder with a manifest.json becomes
 * one registry entry. `rootIndex` is this root's position in the roots array
 * passed to scanFolders — it's the only piece of positional information the
 * Webpack side needs, since require.context() must be given a literal
 * directory per root and can't be driven by a variable at build time. That
 * one constraint is why Composition.jsx still declares its own array of
 * require.context() calls; everything else — parsing manifests, computing
 * assetType/transitionType, duplicate-name detection — happens only here.
 */
function scanFolder(dir, registry, rootLabel, rootIndex) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return; // missing root is fine: nothing to scan
    throw e;
  }
  for (const name of names) {
    const folder = path.join(dir, name);
    if (!fs.statSync(folder).isDirectory()) continue;
    const manifestPath = path.join(folder, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    // registry key = assetType/transitionType if declared, else folder name —
    // this fallback rule now lives in exactly one place.
    const key = manifest.assetType || manifest.transitionType || name;
    const entryFile = manifest.component || `${name}.jsx`;

    if (registry[key]) {
      throw new Error(
        `Duplicate registry entry "${key}" found under "${rootLabel}" (${folder}). ` +
          `Folder/type names must be unique across all roots. ` +
          `Already registered from "${registry[key].root}".`
      );
    }
    if (!fs.existsSync(path.join(folder, entryFile))) {
      throw new Error(
        `Registry entry "${key}" (${rootLabel}): manifest.component "${entryFile}" not found under ${folder}`
      );
    }

    registry[key] = {
      manifest,
      folderName: name,
      entryFile,
      componentPath: path.join(folder, entryFile),
      root: rootLabel,
      rootIndex,
    };
  }
}

function scanFolders(roots, labelFor) {
  const registry = {};
  roots.forEach((root, rootIndex) => {
    const abs = resolveRoot(root);
    scanFolder(abs, registry, abs, rootIndex);
  });
  return registry;
}

function normalize(roots, fallback) {
  if (roots == null) return fallback;
  return Array.isArray(roots) ? roots : [roots];
}

export function loadAssetRegistry(roots = DEFAULT_ASSET_ROOTS) {
  return scanFolders(normalize(roots, DEFAULT_ASSET_ROOTS), "asset");
}

export function loadTransitionRegistry(roots = DEFAULT_TRANSITION_ROOTS) {
  return scanFolders(normalize(roots, DEFAULT_TRANSITION_ROOTS), "transition");
}

export function getAsset(registry, assetType) {
  const entry = registry[assetType];
  if (!entry) {
    throw new Error(`Unknown assetType "${assetType}". Available: ${Object.keys(registry).join(", ")}`);
  }
  return entry;
}

export { DEFAULT_ASSET_ROOTS, DEFAULT_TRANSITION_ROOTS };