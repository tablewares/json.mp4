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
//   validate <projectId>                  schema + cross-reference check (no render)
//   render <projectId> [outputMp4]        validate -> registry -> resolve -> render
//
// Timeline introspection + injection moved to scripts/timeline-cli.mjs
// (outline/scene/timeline/describe-frame/open-ranges/inject-effects) — this
// file stays about static registry/schema discovery; that one owns the
// dynamic per-project frame-axis queries.
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
//   node scripts/timeline-cli.mjs outline demo
//   node scripts/timeline-cli.mjs inject-effects demo '[{"match":{"assetType":"KineticText"},"anchor":"enter","effect":{"id":"kt-whoosh","kind":"sfx","path":"audio/sfx.mp3","volume":0.6}}]'

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
import { ok, fail, printHelpFromSource } from "./builder/textOutput.js";

// Registers studio/library/aliases/*.json into the same runtime registry
// the built-ins live in, BEFORE any `aliases`/`alias` discovery command
// below runs — so this CLI's alias listing always matches what resolve.js
// would actually expand a "$alias" reference to (resolve.js calls the same
// loader on its own path; see src/pipelines/pipeline2-resolve/resolve.js).
loadAliasLibrary();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --minify: only inject-effects (and any future mutating discovery.mjs
// command) actually writes files — same convention as cli.js/project-cli.js's
// global --minify switch. Stripped out of argv before positional parsing so
// it can appear anywhere, matching cli.js's extractSwitches() behavior.
// IMPORTANT: only set when the flag is actually present — passing an
// explicit `false` here (instead of leaving it undefined) would override
// ProjectIO's per-project config.json `jsonFormat` fallback (see
// projectio.js's _resolveMinify) with a hard "never minify", defeating the
// whole point of that fallback for every discovery.mjs call that doesn't
// pass --minify.
const minifyFlagIdx = process.argv.indexOf("--minify");
const minify = minifyFlagIdx !== -1 ? true : undefined;
if (minifyFlagIdx !== -1) process.argv.splice(minifyFlagIdx, 1);

const builder = new ProjectBuilder({ repoRoot, minify });

const [, , command, ...rest] = process.argv;

(async () => {
try {
  switch (command) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      printHelpFromSource(import.meta.url);
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

    default:
      throw new Error(`unknown command "${command}". Run with no arguments for help.`);
  }
} catch (e) {
  fail(e);
}
})();
