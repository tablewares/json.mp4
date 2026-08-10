#!/usr/bin/env node
// scripts/agent-plan.mjs
//
// Stage 2 of the topic-to-render pipeline. Takes a Stage 1 research brief and
// produces a build sequence that agent-batch.mjs can execute in Stage 3. The
// script introspects the live asset + transition registries via agent-cli.mjs
// and validates+assembles a plan the agent supplies via --plan <path>. The
// agent's editorial call (which asset/transition fits each scene) is expressed
// in the plan file; the script's job is to validate against the registry and
// emit a sound steps array.
//
// Optionally copies a boilerplate folder for a brand-new asset/transition:
//   --new-asset <PascalCaseName>="description text"   (repeatable)
//   --new-transition <PascalCaseName>="description"   (repeatable)
//
// Usage:
//   node scripts/agent-plan.mjs <brief-path|-> --plan <plan-path> [--new-asset ...] [--new-transition ...] [--anchor-strategy <pos>]
//
// Reads the brief from <path> or "-" for stdin. Reads the agent's per-scene
// plan from --plan <path> (a JSON file describing which assets/transitions go
// on which scene). Emits { ok, projectId, newAssets, newTransitions, steps }.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const CLI_SCRIPT = path.join(__dirname, "agent-cli.mjs");
const ASSETS_DIR = path.join(repoRoot, "studio", "assets");
const TRANSITIONS_DIR = path.join(repoRoot, "studio", "transitions");

// -- helpers ------------------------------------------------------------------

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function emit(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: message }, null, 2) + "\n");
  process.exit(1);
}

function runCli(command, ...args) {
  const proc = spawnSync("node", [CLI_SCRIPT, command, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  const out = (proc.stdout ?? "").trim();
  if (proc.status !== 0) {
    const err = (proc.stderr || "").trim() || out || `agent-cli ${command} exited ${proc.status}`;
    throw new Error(err);
  }
  return out;
}

// Parse the verbose-text output of `agent-cli.mjs assets` / `transitions` into
// structured records. renderText emits each object as a sequence of
// `-   <key>: <value>` lines, so EVERY field (assetType, description,
// defaultSize, width, height, ...) starts with a dash. Only the line whose key
// is `assetType` (resp. `transitionType`) marks the start of a new record; the
// following dashed/indented lines are that record's fields.
function parseTypeList(raw, keyField) {
  const lines = raw.split("\n");
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^\s*-\s*(\S+):\s*(.*)$/);
    if (m) {
      if (m[1] === keyField) {
        if (cur) out.push(cur);
        cur = { [keyField]: m[2], description: "", extras: {} };
      } else if (cur && m[1] === "description") {
        cur.description = m[2];
      } else if (cur) {
        cur.extras[m[1]] = m[2];
      }
    } else if (cur) {
      const mm = line.match(/^\s+([A-Za-z]+):\s*(.*)$/);
      if (mm) cur.extras[mm[1]] = mm[2];
    }
  }
  if (cur) out.push(cur);
  return out;
}

function loadRegistry() {
  const assets = parseTypeList(runCli("assets"), "assetType");
  const transitions = parseTypeList(runCli("transitions"), "transitionType");
  return { assets, transitions };
}

// Fetch the full per-type schema for one asset/transition (raw text). The agent
// (caller) inspects this when making editorial calls. Returned as a string so
// the agent can read it without us guessing the exact inner shape.
function describeAsset(assetType) {
  return runCli("asset", assetType);
}
function describeTransition(transitionType) {
  return runCli("transition", transitionType);
}

// -- boilerplate copy + rename ------------------------------------------------

function renameExport(source, fromName, toName) {
  // Rename `fromName` identifier → `toName` in `source`. Conservative: word
  // boundary match, replaces the default-export and any inline reference.
  return source.replace(new RegExp(`\\b${fromName}\\b`, "g"), toName);
}

function copyNewAsset(name, description) {
  if (!/^[A-Z][A-Za-z0-9]+$/.test(name)) {
    fail(`--new-asset "${name}" must be a PascalCase identifier (^[A-Z][A-Za-z0-9]+$)`);
  }
  const dest = path.join(ASSETS_DIR, name);
  if (fs.existsSync(dest)) fail(`--new-asset "${name}": ${dest} already exists`);
  const src = path.join(ASSETS_DIR, "AssetBoilerplate");
  if (!fs.existsSync(src)) fail(`AssetBoilerplate not found at ${src}`);
  fs.cpSync(src, dest, { recursive: true });

  // Rename AssetBoilerplate.jsx -> <Name>.jsx and rewrite identifiers.
  const oldJsx = path.join(dest, "AssetBoilerplate.jsx");
  const newJsx = path.join(dest, `${name}.jsx`);
  if (fs.existsSync(oldJsx)) {
    let body = fs.readFileSync(oldJsx, "utf-8");
    body = renameExport(body, "AssetBoilerplate", name);
    fs.writeFileSync(newJsx, body);
    fs.rmSync(oldJsx);
  }

  // Update manifest.json: assetType + component.
  const manifestPath = path.join(dest, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    m.assetType = name;
    m.component = name;
    if (description) m.description = description;
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
  }

  // Emit the 5-step adaptation guide inline (the README lives in the boilerplate).
  const readme = path.join(dest, "README.md");
  if (fs.existsSync(readme)) {
    process.stderr.write(`[${name}] copied to ${dest}\n`);
    process.stderr.write(`[${name}] README adaptation checklist:\n${fs.readFileSync(readme, "utf-8")}\n`);
  }
}

function copyNewTransition(name, description) {
  if (!/^[A-Z][A-Za-z0-9]+$/.test(name)) {
    fail(`--new-transition "${name}" must be a PascalCase identifier (^[A-Z][A-Za-z0-9]+$)`);
  }
  const dest = path.join(TRANSITIONS_DIR, name);
  if (fs.existsSync(dest)) fail(`--new-transition "${name}": ${dest} already exists`);
  const src = path.join(TRANSITIONS_DIR, "TransitionBoilerplate");
  if (!fs.existsSync(src)) fail(`TransitionBoilerplate not found at ${src}`);
  fs.cpSync(src, dest, { recursive: true });

  // Rename the component file + its two identifiers (factory function + default export).
  const oldJsx = path.join(dest, "TransitionBoilerplate.jsx");
  const newJsx = path.join(dest, `${name}.jsx`);
  if (fs.existsSync(oldJsx)) {
    let body = fs.readFileSync(oldJsx, "utf-8");
    body = renameExport(body, "TransitionBoilerplate", name);
    fs.writeFileSync(newJsx, body);
    fs.rmSync(oldJsx);
  }

  // Update manifest.json: transitionType + component.
  const manifestPath = path.join(dest, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    m.transitionType = name;
    m.component = name;
    if (description) m.description = description;
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
  }

  process.stderr.write(`[${name}] transition copied to ${dest}\n`);
  process.stderr.write(
    `[${name}] adaptation checklist: 1) edit ${name}.jsx (factory export). 2) adjust transitionType/component in manifest.json. 3) author params schema. 4) set defaultDurationInFrames. 5) run "node scripts/agent-cli.mjs transition ${name}" to confirm.\n`,
  );
}

// -- step validation ----------------------------------------------------------

function validateSteps(steps, registry, newAssets, newTransitions) {
  const assetTypes = new Set([...registry.assets.map((a) => a.assetType), ...newAssets]);
  const transitionTypes = new Set([...registry.transitions.map((t) => t.transitionType), ...newTransitions]);
  const issues = [];
  for (const [idx, step] of steps.entries()) {
    const cmd = step[0];
    if (cmd === "add-asset") {
      const spec = step[3] || {};
      if (!assetTypes.has(spec.assetType)) {
        issues.push(`step ${idx}: unknown assetType "${spec.assetType}"`);
      }
    } else if (cmd === "set-transition") {
      const spec = step[3] || {};
      if (spec.type && !transitionTypes.has(spec.type)) {
        issues.push(`step ${idx}: unknown transition type "${spec.type}"`);
      }
    }
  }
  return issues;
}

// -- entry point --------------------------------------------------------------

const argv = process.argv.slice(2);
let briefPath = null;
let planPath = null;
let anchorStrategy = "center";
const newAssets = [];
const newTransitions = [];

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--plan") {
    planPath = argv[++i];
  } else if (a === "--anchor-strategy") {
    anchorStrategy = argv[++i] || "center";
  } else if (a === "--new-asset") {
    const raw = argv[++i];
    if (!raw) fail("--new-asset requires a PascalCase name (with optional =\"description\")");
    const eq = raw.indexOf("=");
    if (eq === -1) {
      newAssets.push({ name: raw, description: "" });
    } else {
      newAssets.push({ name: raw.slice(0, eq), description: raw.slice(eq + 1) });
    }
  } else if (a === "--new-transition") {
    const raw = argv[++i];
    if (!raw) fail("--new-transition requires a PascalCase name (with optional =\"description\")");
    const eq = raw.indexOf("=");
    if (eq === -1) {
      newTransitions.push({ name: raw, description: "" });
    } else {
      newTransitions.push({ name: raw.slice(0, eq), description: raw.slice(eq + 1) });
    }
  } else if (!briefPath && !a.startsWith("--")) {
    briefPath = a;
  }
}

if (!briefPath) fail("missing required positional argument: brief (path to Stage 1 JSON, or '-' for stdin)");

// Load the brief.
let briefRaw;
try {
  briefRaw = briefPath === "-" ? readStdinSync() : fs.readFileSync(briefPath, "utf-8");
} catch (e) {
  fail(`could not read brief: ${e.message}`);
}
let brief;
try {
  brief = JSON.parse(briefRaw);
} catch (e) {
  fail(`brief is not valid JSON: ${e.message}`);
}
if (!brief || typeof brief !== "object" || !Array.isArray(brief.scenes)) {
  fail("brief must be a Stage 1 research object with `scenes`");
}
const projectId = brief.projectId;
if (!projectId) fail("brief is missing projectId");

// 1. Discover registry BEFORE creating new assets (so new ones are additive).
const registry = loadRegistry();

// 2. Perform any boilerplate copies.
const createdAssetNames = [];
const createdTransitionNames = [];
for (const na of newAssets) {
  copyNewAsset(na.name, na.description);
  createdAssetNames.push(na.name);
}
for (const nt of newTransitions) {
  copyNewTransition(nt.name, nt.description);
  createdTransitionNames.push(nt.name);
}

// Re-scan the registry after copies (registry is file-disk derived, so freshly
// copied folders are visible immediately — per the plan's confirmation in
// open-question #5). We re-list + re-fetch the full schema for every type the
// plan references so we can validate keys.
const regAfter = loadRegistry();

// Also dump per-type schemas for any assetType the plan references — surfaced to
// the agent in the output so the agent can verify the schema without re-querying.
// (We don't include all schemas; only ones referenced by the plan, resolved below.)

// 3. Load the agent's plan (--plan) describing per-scene picks.
let plan = null;
if (planPath) {
  try {
    plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  } catch (e) {
    fail(`could not read/parse --plan file "${planPath}": ${e.message}`);
  }
}

// 4. Assemble the steps array. Default behavior when no plan: emit scenes with
// a generic TextBlock per scene + `default` transition, all validated.
const steps = [];
steps.push([
  "init",
  {
    projectId,
    // The init spec is enriched by the AGENT (this script emits the steps that
    // agent-batch.mjs runs). We let the plan supply an optional `init` override
    // (e.g. narration, theme overrides, fps/width/height). If the plan provides
    // none, we forward the brief's narration so a narrated build works.
    ...(plan && plan.init ? plan.init : {}),
  },
]);
// If the init spec didn't carry narration, attach the brief's narration.
const initSpec = steps[0][1];
if (!initSpec.narration && brief.narration) {
  initSpec.narration = brief.narration;
}

// Per-scene steps.
const referredAssetTypes = new Set();
const referredTransitionTypes = new Set();
const planScenes = plan && Array.isArray(plan.scenes) ? plan.scenes : [];

for (let i = 0; i < brief.scenes.length; i += 1) {
  const scene = brief.scenes[i];
  const scenePlan = planScenes[i] || {};
  const sceneId = scene.id || `scene-${String(i + 1).padStart(3, "0")}`;
  const background = scenePlan.background || "shade1";
  const transitionOut = scenePlan.transitionOut || { type: "default" };
  steps.push([
    "add-scene",
    projectId,
    {
      id: sceneId,
      narrationRef: scene.id,
      background,
      transitionOut,
    },
  ]);

  // Per-scene assets from the plan. Default to one TextBlock if none supplied.
  const assets = Array.isArray(scenePlan.assets) ? scenePlan.assets : [];
  if (assets.length === 0 && !plan) {
    assets.push({
      assetType: "TextBlock",
      anchor: { position: anchorStrategy },
      contentOverride: { text: scene.narration || scene.headline || "" },
    });
  }
  for (const a of assets) {
    referredAssetTypes.add(a.assetType);
    steps.push(["add-asset", projectId, sceneId, a]);
  }
}

// 5. Append `validate` as the final step.
steps.push(["validate", projectId]);

// 6. Validate the steps array against the live registry.
const issues = validateSteps(steps, regAfter, createdAssetNames, createdTransitionNames);
if (issues.length) {
  for (const iss of issues) process.stderr.write(`warning: ${iss}\n`);
}

// 7. Resolve per-type schemas for referred asset/transition types and include
// them in the output, so the agent can verify the published schema without
// re-querying. Keep this lightweight — only what was referenced.
const schemas = {};
for (const t of referredAssetTypes) {
  try {
    schemas[`asset:${t}`] = describeAsset(t);
  } catch (e) {
    schemas[`asset:${t}`] = `error: ${e.message}`;
  }
}
for (const t of referredTransitionTypes) {
  try {
    schemas[`transition:${t}`] = describeTransition(t);
  } catch (e) {
    schemas[`transition:${t}`] = `error: ${e.message}`;
  }
}

emit({
  ok: true,
  projectId,
  newAssets: createdAssetNames,
  newTransitions: createdTransitionNames,
  schemas,
  steps,
});
process.exit(0);
