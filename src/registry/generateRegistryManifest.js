import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAssetRegistry,
  loadTransitionRegistry,
  DEFAULT_ASSET_ROOTS,
  DEFAULT_TRANSITION_ROOTS,
} from "./assetRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The one place that turns "folders with manifest.json" into a fact the
 * Webpack bundle can consume. Composition.jsx used to re-scan
 * studio/assets, studio/graphics, and studio/transitions itself via
 * require.context(/manifest\.json$/) — a second, independent implementation
 * of everything scanFolder() already does, including its own duplicate-key
 * check. That's what let an asset validate on the Node side and still throw
 * "No renderer registered" at render time if the two scans disagreed.
 *
 * Now: assetRegistry.js scans once, this script serializes the result, and
 * Composition.jsx only does lazy-loading of already-known component paths.
 *
 * Run via `node src/registry/generateRegistryManifest.js`. Wire this into
 * `prebuild` / `predev` in package.json so the generated file can never go
 * stale without a build noticing. In CI, running it and then `git diff
 * --exit-code studio/generated/` is a cheap way to catch a forgotten
 * regeneration after an asset folder is added/renamed.
 */

function serialize(registry) {
  const out = {};
  for (const [key, entry] of Object.entries(registry)) {
    out[key] = {
      folderName: entry.folderName,
      entryFile: entry.entryFile,
      rootIndex: entry.rootIndex,
    };
  }
  return out;
}

function main() {
  const assets = loadAssetRegistry();
  const transitions = loadTransitionRegistry();

  const manifest = {
    generatedAt: new Date().toISOString(),
    // Recorded so Composition.jsx can assert its own require.context root
    // list is the same length/order as what Node actually scanned, and fail
    // loudly instead of silently mis-mapping rootIndex -> directory.
    assetRoots: DEFAULT_ASSET_ROOTS,
    transitionRoots: DEFAULT_TRANSITION_ROOTS,
    assets: serialize(assets),
    transitions: serialize(transitions),
  };

  const outDir = path.join(__dirname, "../../studio/generated");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "registry.generated.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(
    `Wrote ${outPath} — ${Object.keys(manifest.assets).length} asset type(s), ` +
      `${Object.keys(manifest.transitions).length} transition type(s).`
  );
}

main();