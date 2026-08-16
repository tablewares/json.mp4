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
//   aliases [category]                    list every registered alias, grouped by category (optional filter)
//   alias <name>                          full info + expanded shape for one alias
//   alias-categories                      list known category names (motion, camera, effects, timing, transition)
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
// Build commands (write files automatically):
//   init '<json>'                                  create a project
//   add-scene <projectId> '<json>'                 add a scene
//   add-asset <projectId> <sceneId> '<json>'       add an asset to a scene
//   update-asset <projectId> <sceneId> <assetId> '<json>'   patch an existing asset (shallow merge)
//   remove-asset <projectId> <sceneId> <assetId>   remove an asset
//   set-transition <projectId> <sceneId> '<json>'  set scene.transitionOut (replaces any existing one)
//   update-transition <projectId> <sceneId> '<json>'        patch an existing transitionOut (merges params)
//   remove-transition <projectId> <sceneId>        clear a scene's transitionOut (hard cut)
//   add-effect <projectId> <sceneId> '<json>'      append a scene-level effect (scene.effects[]). Frame-first shape: `{ id, kind, frame, ... }` (sfx | visual). Legacy `timing`/`offsetPercent` keys still accepted by the schema for backward compatibility.
//   set-camera <projectId> <sceneId> '<json>'      set scene.camera (replaces any existing one); null clears it
//   update-camera <projectId> <sceneId> '<json>'   patch an existing scene.camera (shallow merge; actions replace)
//   add-camera-action <projectId> <sceneId> '<json>' append one action to scene.camera.actions[] (creates camera if needed)
//   remove-camera <projectId> <sceneId>            clear a scene's camera (static centered view)
//   add-narration <projectId> '<json>'             add/update a narration entry {id,text}
//   set-transcript <projectId> '<json>'            set narration.fullTranscript {text}
//   add-audio <projectId> '<json>'                 append a manifest.audioOverlay entry
//
// Verify / render:
//   timeline <projectId>                  resolve + build the global-frame timeline (read-only)
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

import { ProjectBuilder } from "../src/agent/ProjectBuilder.js";
import {
  listAssetTypes,
  describeAsset,
  listTransitionTypes,
  describeTransition,
  listAnchorPositions,
  describeSceneEnvelope,
  listAssetCollections,
  describeAssetCollection,
} from "../src/agent/introspect.js";

import {
  listAliases,
  describeAlias,
  listAliasCategories,
} from "../src/registry/aliasRegistry.js";

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

  // Handle Objects
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, val]) => {
        if (val === null || val === undefined) return `${pad}${key}: ${val}`;
        
        // Handle nested primitives inline
        if (typeof val !== "object") {
          return `${pad}${key}: ${renderText (val, 0)}`;
        }

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
    case "aliases":
      ok(listAliases(rest[0]));
      break;
    case "alias":
      ok(describeAlias(rest[0]));
      break;
    case "alias-categories":
      ok(listAliasCategories());
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
    case "show":
      ok(builder.getProject(rest[0]));
      break;
    case "list-assets":
      ok(builder.listCurrentAssets(rest[0], rest[1]));
      break;
    case "list-transitions":
      ok(builder.listCurrentTransitions(rest[0]));
      break;


    // -- build -----------------------------------------------------------------
    case "init":
      ok(builder.createProject(parseJsonArg(rest[0], "project spec")));
      break;
    case "add-scene":
      ok(builder.addScene(rest[0], parseJsonArg(rest[1], "scene spec")));
      break;
    case "add-asset":
      ok(builder.addAsset(rest[0], rest[1], parseJsonArg(rest[2], "asset spec")));
      break;
    case "update-asset":
      ok(builder.updateAsset(rest[0], rest[1], rest[2], parseJsonArg(rest[3], "asset patch")));
      break;
    case "remove-asset":
      ok(builder.removeAsset(rest[0], rest[1], rest[2]));
      break;
    case "set-transition":
      ok(builder.setTransitionOut(rest[0], rest[1], parseJsonArg(rest[2], "transition spec")));
      break;
    case "update-transition":
      ok(builder.updateTransitionOut(rest[0], rest[1], parseJsonArg(rest[2], "transition patch")));
      break;
    case "remove-transition":
      ok(builder.removeTransitionOut(rest[0], rest[1]));
      break;
    case "add-effect":
      ok(builder.addTransitionEffect(rest[0], rest[1], parseJsonArg(rest[2], "effect spec")));
      break;
    case "set-camera":
      ok(builder.setCamera(rest[0], rest[1], parseJsonArg(rest[2], "camera spec")));
      break;
    case "update-camera":
      ok(builder.updateCamera(rest[0], rest[1], parseJsonArg(rest[2], "camera patch")));
      break;
    case "add-camera-action":
      ok(builder.addCameraAction(rest[0], rest[1], parseJsonArg(rest[2], "camera action spec")));
      break;
    case "remove-camera":
      ok(builder.removeCamera(rest[0], rest[1]));
      break;
    case "add-narration":
      ok(builder.addNarrationEntry(rest[0], parseJsonArg(rest[1], "narration entry {id,text}")));
      break;
    case "set-transcript": {
      const { text } = parseJsonArg(rest[1], "{text}");
      ok(builder.setFullTranscript(rest[0], text));
      break;
    }
    case "add-music":
      ok(builder.addMusic(rest[0], parseJsonArg(rest[1], "music entry")));
      break;
    case "add-audio":
      ok(builder.addAudioOverlay(rest[0], parseJsonArg(rest[1], "audio overlay entry")));
      break;

    // -- verify / render ---------------------------------------------------------
    case "timeline":
      ok(await builder.getTimeline(rest[0]));
      break;
    case "inject-effects":
      ok(await builder.injectTimelineEffects(rest[0], parseJsonArg(rest[1], "effects rules array")));
      break;
    case "validate":
      ok(builder.validateProjectFiles(rest[0]));
      break;
    case "render":
      ok(builder.render(rest[0], rest[1]));
      break;

    default:
      throw new Error(`unknown command "${command}". Run with no arguments for help.`);
  }
} catch (e) {
  fail(e);
}
})();

