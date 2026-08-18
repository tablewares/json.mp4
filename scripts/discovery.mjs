#!/usr/bin/env node
// scripts/agent-cli.mjs
//
// Command-line surface for an agent building & rendering projects. Every
// command prints a compact text result to stdout and exits 0 on success, or
// prints an `error:` line and exits 1 on failure. This intentionally avoids
// large JSON payloads so the output stays context-efficient for LLM agents.
//
// Discovery commands (no file navigation needed):
//   assets                                list every registered asset type
//   asset <assetType>                     full content/style schema for one asset type
//   transitions                           list every registered transition type
//   transition <transitionType>           full param schema for one transition type
//   anchors                               valid anchor.position values
//   envelope                              scene/asset/effect envelope field reference
//   manifest                              manifest.json top-level field reference (narration incl. silence blocks, audioOverlay, music, scenes)
//   pitfalls [topic]                      curated silent-misbehavior traps not derivable from schema (topic: an assetType, or "narration"/"transitions"; no arg lists topics)
//   aliases [category]                    list every registered alias, grouped by category (optional filter)
//   alias <name>                          full info + expanded shape for one alias
//   alias-categories                      list known category names (motion, camera, effects, timing, transition)
//   themes                                 list every named theme preset in studio/library/themes/ (colorTokens/typographyTokens/easingTokens counts)
//   theme <name>                          full JSON for one theme preset
//   collections                           list every asset-library collection workflow
//   collection <collectionType>           full command + output contract for one collection workflow
//   projects                              list existing project ids
//   show <projectId>                      dump the full built project tree
//   list-assets <projectId> [sceneId]     viewer: assets currently in the project (or one scene)
//   list-transitions <projectId>          viewer: each scene's current transitionOut (or null)
//
// File-system organization (auto-group visible assets & collection outputs):
//   fs-status                              scan public/ + studio/manifest: visible assets, project references, orphaned files
//   group-public '<json>'                  move loose public/assets & public/audio files into named group subdirs; rewrite manifest paths across all projects ('<json>': { groups: {assets?, audio?}, files?: {assets?, audio?}, dryRun?: true })
//   ungroup-public '<json>'                flatten <bin>/<group>/* back to <bin>/* and rewrite manifest paths back ('<json>': { group, dryRun?: true })
//   assign-project '<json>'               copy/move visible files referenced by a project into a project-scoped group subdir; rewrite that project's manifest paths ('<json>': { projectId, files?: [...], group?, copy?: true, dryRun?: true })
//   auto-project [limit]                  list orphaned visible files (referenced by no project) + suggested group — read-only, non-prescriptive
//
//
// Verify / render:
//   timeline <projectId>                  resolve + build the global-frame timeline (read-only)
//   describe-frame <projectId> <frame>    "what's on screen at this global frame" — active scene/assets/effects/audio
//   open-ranges <projectId> <sceneId> ['<opts>']  "where's a safe gap in this scene" — frame ranges not covered by an asset/effect; opts: { minGapFrames?, includeEffects? }
//   inject-effects <projectId> '<rules>'  fan sfx/visual effects out across matching asset SEGMENTS or every scene boundary — writes them to the DETACHED scene.effects[] array with an exact scene-local `frame` (no percent math), after first resolving + reading the project's timeline.
//   validate <projectId>                  schema + cross-reference check (no render)
//   render <projectId> [outputMp4]        validate -> registry -> resolve -> render
//
// Any '<json>' argument may be the literal JSON text, or "-" to read JSON
// from stdin (use this for large contentOverride payloads to avoid shell
// quoting problems).
//
// Examples:
//   node scripts/agent-cli.mjs assets
//   node scripts/agent-cli.mjs asset NumberStat
//   node scripts/agent-cli.mjs init '{"projectId":"demo","narration":{"entries":[{"id":"n1","text":"Hello."}],"fullTranscript":"Hello."}}'
//   node scripts/agent-cli.mjs add-scene demo '{"id":"scene-001","narrationRef":"n1","transitionOut":{"type":"default"}}'
//   node scripts/agent-cli.mjs add-asset demo scene-001 '{"assetType":"TextBlock","anchor":{"position":"center"},"contentOverride":{"text":"Hello."}}'
//   node scripts/agent-cli.mjs update-asset demo scene-001 TextBlock-1 '{"contentOverride":{"text":"Hello again."}}'
//   node scripts/agent-cli.mjs list-assets demo
//   node scripts/agent-cli.mjs timeline demo
//   node scripts/agent-cli.mjs inject-effects demo '[{"match":{"assetType":"KineticText"},"anchor":"enter","effect":{"id":"kt-whoosh","kind":"sfx","path":"audio/sfx.mp3","volume":0.6}}]'
//   node scripts/agent-cli.mjs render demo out/demo.mp4

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectBuilder } from "./builder/ProjectBuilder.js";
import {
  listAssetTypes,
  describeAsset,
  listTransitionTypes,
  describeTransition,
  listAnchorPositions,
  describeSceneEnvelope,
  describeManifestEnvelope,
  describePitfalls,
  listAssetCollections,
  describeAssetCollection,
} from "./builder/introspect.js";

import {
  listAliases,
  describeAlias,
  listAliasCategories,
} from "../src/registry/aliasRegistry.js";
import { loadAliasLibrary } from "../src/registry/aliasLibrary.js";
import { listThemes, describeTheme } from "../src/registry/themeLibrary.js";

// Registers studio/library/aliases/*.json into the same runtime registry
// the built-ins live in, BEFORE any `aliases`/`alias` discovery command
// below runs — so this CLI's alias listing always matches what resolve.js
// would actually expand a "$alias" reference to (resolve.js calls the same
// loader on its own path; see src/pipelines/pipeline2-resolve/resolve.js).
loadAliasLibrary();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const builder = new ProjectBuilder({ repoRoot });

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function parseJsonArg(raw, label) {
  if (raw === undefined) throw new Error(`missing required JSON argument: ${label}`);
  const text = raw === "-" ? readStdinSync() : raw;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`invalid JSON for ${label}: ${e.message}`);
  }
}

function renderText(value, indent = 0) {
  const pad = " ".repeat(indent);

  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.includes("\n") ? `"${value}"` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  // Handle Arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        // Primitive values in lists stay on one line
        if (typeof item !== "object" || item === null) {
          return `${pad}- ${renderText(item, 0)}`;
        }
        // Nested objects start on a new indented block
        return `${pad}-\n${renderText(item, indent + 2)}`;
      })
      .join("\n");
  }

  // Handle Objects. `undefined` values (e.g. a schema field with no
  // `description`/`enum`) are OMITTED entirely rather than printed as the
  // literal string "undefined" — a field simply not being present in the
  // schema shouldn't cost a line of noise on every discovery call.
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, val]) => val !== undefined);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, val]) => {
        if (val === null) return `${pad}${key}: ${val}`;

        // Handle nested primitives inline
        if (typeof val !== "object") {
          return `${pad}${key}: ${renderText(val, 0)}`;
        }

        // Empty array/object stays inline (`key: []` / `key: {}`) instead of
        // dropping to a lone bracket on its own line — matches how a
        // populated array/object already renders relative to its key.
        if (Array.isArray(val) && val.length === 0) return `${pad}${key}: []`;
        if (!Array.isArray(val) && Object.keys(val).length === 0) return `${pad}${key}: {}`;

        // Handle nested structures with clear clean indentation
        return `${pad}${key}:\n${renderText(val, indent + 2)}`;
      })
      .join("\n");
  }

  return String(value);
}

function ok(value) {
  console.log(renderText(value));
  process.exit(0);
}

function fail(err) {
  console.log(`error: ${err.message ?? String(err)}`);
  process.exit(1);
}

function printHelp() {
  // Re-emit the header comment block above as the help text.
  const src = fs.readFileSync(new URL(import.meta.url), "utf-8");
  const header = src.split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, ""));
  console.log(header.join("\n"));
  process.exit(0);
}

const [, , command, ...rest] = process.argv;

(async () => {
try {
  switch (command) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      printHelp();
      break;

    // -- discovery -----------------------------------------------------------
    case "assets":
      ok(listAssetTypes());
      break;
    case "asset":
      ok(describeAsset(rest[0]));
      break;
    case "transitions":
      ok(listTransitionTypes());
      break;
    case "transition":
      ok(describeTransition(rest[0]));
      break;
    case "anchors":
      ok(listAnchorPositions());
      break;
    case "envelope":
      ok(describeSceneEnvelope());
      break;
    case "manifest":
      ok(describeManifestEnvelope());
      break;
    case "pitfalls":
      ok(describePitfalls(rest[0]));
      break;
    case "aliases":
      ok(listAliases(rest[0]));
      break;
    case "alias":
      ok(describeAlias(rest[0]));
      break;
    case "alias-categories":
      ok(listAliasCategories());
      break;
    case "themes":
      ok(listThemes());
      break;
    case "theme":
      ok(describeTheme(rest[0]));
      break;
    case "collections":
      ok(listAssetCollections());
      break;
    case "collection":
      ok(describeAssetCollection(rest[0]));
      break;
    case "projects":
      ok(builder.listProjects());
      break;
    case "list-assets":
      ok(builder.listCurrentAssets(rest[0], rest[1]));
      break;
    case "list-transitions":
      ok(builder.listCurrentTransitions(rest[0]));
      break;



    // -- verify / render ---------------------------------------------------------
    case "timeline":
      ok(await builder.getTimeline(rest[0]));
      break;
    case "describe-frame":
      ok(await builder.describeFrame(rest[0], rest[1]));
      break;
    case "open-ranges":
      ok(await builder.findOpenFrameRanges(rest[0], rest[1], rest[2] !== undefined ? parseJsonArg(rest[2], "open-ranges opts") : undefined));
      break;
    case "inject-effects":
      ok(await builder.injectTimelineEffects(rest[0], parseJsonArg(rest[1], "effects rules array")));
      break;

    default:
      throw new Error(`unknown command "${command}". Run with no arguments for help.`);
  }
} catch (e) {
  fail(e);
}
})();
