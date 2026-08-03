import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default asset + transition roots, relative to this file. Each entry is a
// directory whose immediate subfolders are scanned for a manifest.json.
// To add a new root, append its absolute-or-relative path here (or pass an
// array to loadAssetRegistry / loadTransitionRegistry). Both registries are
// the union of every root; a folder name (assetType / transitionType) must be
// unique across all roots or scanFolders throws.
const DEFAULT_ASSET_ROOTS = ["../../studio/assets", "../../studio/graphics"];
const DEFAULT_TRANSITION_ROOTS = ["../../studio/transitions"];

function resolveRoot(root) {
  return path.isAbsolute(root) ? root : path.join(__dirname, root);
}

/**
 * Scan one directory: every immediate subfolder that contains a manifest.json
 * becomes one entry keyed by the folder name. Returns a fresh {} — does not
 * mutate the accumulator.
 */
function scanFolder(dir, registry, rootLabel) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return; // missing root is fine: nothing to scan
    throw e;
  }
  console.log("scanfolder", dir)
  for (const name of names) {
    const folder = path.join(dir, name);
    if (!fs.statSync(folder).isDirectory()) continue;
    const manifestPath = path.join(folder, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (registry[name]) {
      throw new Error(
        `Duplicate registry entry "${name}" found under "${rootLabel}" (${folder}). ` +
          `Folder names (assetType / transitionType) must be unique across all roots. ` +
          `Already registered from "${registry[name].root}".`
      );
    }
    registry[name] = {
      manifest,
      componentPath: path.join(folder, manifest.component),
      root: rootLabel,
    };
  }
}

/**
 * Scan multiple asset/transition roots and merge into one registry. A folder
 * name must be unique across all roots. Returns { Name: { manifest,
 * componentPath, root } }.
 */
function scanFolders(roots, labelFor) {
  const registry = {};
  for (const root of roots) {
    const abs = resolveRoot(root);
    scanFolder(abs, registry, abs);
  }
  return registry;
}

function normalize(roots, fallback) {
  if (roots == null) return fallback;
  return Array.isArray(roots) ? roots : [roots];
}

/**
 * Asset registry — the union of every asset root. `roots` is one path or an
 * array of paths (relative paths resolve against this file). Defaults to
 * ["../assets"]. Result: { TextBlock: { manifest, componentPath, root }, ... }.
 */
export function loadAssetRegistry(roots = DEFAULT_ASSET_ROOTS) {
  return scanFolders(normalize(roots, DEFAULT_ASSET_ROOTS), "asset");
}

/**
 * Transition registry — same shape/contract as loadAssetRegistry. Has the same
 * multi-root support so transition packs can live in their own directory.
 * Result: { default: {...}, slideContinuity: {...}, ... }.
 */
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
