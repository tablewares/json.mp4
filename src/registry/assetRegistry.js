import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "../assets");
const TRANSITIONS_DIR = path.join(__dirname, "../transitions");

function scanFolder(dir) {
  const registry = {};
  for (const name of fs.readdirSync(dir)) {
    const folder = path.join(dir, name);
    if (!fs.statSync(folder).isDirectory()) continue;
    const manifestPath = path.join(folder, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    registry[name] = {
      manifest,
      componentPath: path.join(folder, manifest.component),
    };
  }
  return registry;
}

/** { TextBlock: { manifest, componentPath }, ImageReveal: {...}, ... } */
export function loadAssetRegistry() {
  return scanFolder(ASSETS_DIR);
}

/** { default: { manifest, componentPath }, slideContinuity: {...}, ... } */
export function loadTransitionRegistry() {
  return scanFolder(TRANSITIONS_DIR);
}

export function getAsset(registry, assetType) {
  const entry = registry[assetType];
  if (!entry) {
    throw new Error(`Unknown assetType "${assetType}". Available: ${Object.keys(registry).join(", ")}`);
  }
  return entry;
}
