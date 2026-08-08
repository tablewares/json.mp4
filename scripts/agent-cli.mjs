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
//   collections                           list every asset-library collection workflow
//   collection <collectionType>           full command + output contract for one collection workflow
//   projects                              list existing project ids
//   show <projectId>                      dump the full built project tree
//   list-assets <projectId> [sceneId]     viewer: assets currently in the project (or one scene)
//   list-transitions <projectId>          viewer: each scene's current transitionOut (or null)
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
//   add-effect <projectId> <sceneId> '<json>'      append a transitionOut effect
//   add-narration <projectId> '<json>'             add/update a narration entry {id,text}
//   set-transcript <projectId> '<json>'            set narration.fullTranscript {text}
//   add-audio <projectId> '<json>'                 append a manifest.audioOverlay entry
//
// Verify / render:
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
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        const rendered = renderText(item, indent + 2).split("\n").map((line) => `${pad}- ${line}`).join("\n");
        return rendered;
      })
      .join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, item]) => {
        const rendered = renderText(item, indent + 2);
        const prefix = `${pad}${key}: `;
        if (rendered.includes("\n")) {
          return `${prefix}${rendered.split("\n").join(`\n${" ".repeat(prefix.length)}`)}`;
        }
        return `${prefix}${rendered}`;
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
