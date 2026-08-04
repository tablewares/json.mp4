// scripts/render-project.mjs
//
// One-shot orchestrator: validate -> generate registry -> resolve -> render
// against a single project manifest. Mirrors `npm run build` but targets
// whichever project you pass, instead of the hardcoded default.
//
// Usage:
//   node scripts/render-project.mjs <manifestPath> [outputMp4]
//   node scripts/render-project.mjs                                    # default = example-project
//   node scripts/render-project.mjs studio/manifest/render-demo-toon/manifest.toon out/render-demo-toon.mp4
//
// Stages run in order; the first failure aborts with a non-zero exit code.
// A stale resolved.json is never rendered: resolve always re-runs and
// overwrites studio/resolved.json before render reads it.
//
// Run from the repo root so relative paths resolve the same way they do
// for `npm run build`:
//   cd /home/tablewares/json.mp4 && node scripts/render-project.mjs ...

import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateProject } from "../src/pipelines/pipeline1-validate/validate.js";
import { resolveProject } from "../src/pipelines/pipeline2-resolve/resolve.js";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --- args --------------------------------------------------------------------

const argv = process.argv.slice(2);

// Flag parsing: only --help is supported; everything else is positional.
const wantsHelp = argv.includes("-h") || argv.includes("--help");
if (wantsHelp) {
  console.log(`Usage: node scripts/render-project.mjs <manifestPath> [outputMp4]

Orchestrates validate -> generate registry -> resolve -> render for ONE project manifest.

Positional:
  manifestPath   Path to a manifest.toon or manifest.json. Default:
                 studio/manifest/example-project/manifest.toon
  outputMp4       Where to write the MP4. Default:
                 out/<projectId>.mp4  (falls back to out/video.mp4 if unknown)

Stages:
  1. validate   - schema + cross-reference check (validateProject)
  2. registry   - re-scan studio/{assets,graphics,transitions} into
                  studio/generated/registry.generated.json (subprocess; no export)
  3. resolve    - token->value, anchor->pixels, timing, transition bundles
                  -> studio/resolved.json
  4. render     - bundle src/index.jsx and render the "Video" composition

Exit code is non-zero on the first failing stage. Renders against the freshly
resolved graph only — never a stale resolved.json.`);
  process.exit(0);
}

const positional = argv.filter((a) => !a.startsWith("-"));

const defaultManifest = path.join(
  repoRoot,
  "studio/manifest/example-project/manifest.toon"
);
const manifestPath = path.resolve(
  positional[0] ? path.resolve(process.cwd(), positional[0]) : defaultManifest
);
if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  process.exit(1);
}

// --- stage 1: validate -------------------------------------------------------

const relManifest = path.relative(repoRoot, manifestPath);
process.stdout.write(`[1/4] validate  ${relManifest}\n`);
let result;
try {
  result = validateProject(manifestPath);
} catch (e) {
  console.error(`\nvalidate FAILED:\n${e.message}`);
  process.exit(1);
}
console.log(`OK: ${result.scenes.length} scene(s) validated for project "${result.manifest.projectId}"`);

// --- stage 2: generate registry (subprocess — script has no exported main) ----

process.stdout.write(`[2/4] registry  studio/{assets,graphics,transitions}\n`);
const gen = spawnSync(
  "node",
  [path.join(repoRoot, "src/registry/generateRegistryManifest.js")],
  { cwd: repoRoot, encoding: "utf-8" }
);
if (gen.status !== 0) {
  console.error(`\nregistry FAILED (exit ${gen.status}):\n${gen.stdout}\n${gen.stderr}`);
  process.exit(1);
}
// The script's own log line is enough — drop it on stdout verbatim.
process.stdout.write(gen.stdout);

// --- stage 3: resolve --------------------------------------------------------

process.stdout.write(`[3/4] resolve   -> studio/resolved.json\n`);
let resolved;
try {
  resolved = await resolveProject(manifestPath);
} catch (e) {
  console.error(`\nresolve FAILED:\n${e.message}`);
  process.exit(1);
}
const resolvedPath = path.join(repoRoot, "studio/resolved.json");
fs.writeFileSync(resolvedPath, JSON.stringify(resolved, null, 2));
console.log("done");

// --- stage 4: render ---------------------------------------------------------

const projectId = result.manifest.projectId ?? "video";
const outputMp4 = positional[1]
  ? path.resolve(process.cwd(), positional[1])
  : path.join(repoRoot, "out", `${projectId}.mp4`);
fs.mkdirSync(path.dirname(outputMp4), { recursive: true });

process.stdout.write(`[4/4] render    -> ${path.relative(repoRoot, outputMp4) || outputMp4}\n`);
const entryPoint = path.join(repoRoot, "src/index.jsx");
try {
  console.log("Bundling...");
  const bundleLocation = await bundle({ entryPoint });

  console.log("Selecting composition...");
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "Video",
  });

  console.log(`Rendering to ${outputMp4} ...`);
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputMp4,
  });
} catch (e) {
  // Remotion's HeadlessBrowser teardown can log a "Target closed"/"Protocol
  // error" trace *after* a successful render — guard against it specifically:
  // only treat as failure if renderMedia itself threw before printing "Done.".
  console.error(`\nrender FAILED:\n${e.stack || e.message}`);
  process.exit(1);
}
console.log("Done.");
