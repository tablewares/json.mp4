#!/usr/bin/env node
// scripts/timeline-cli.mjs
//
// Dedicated CLI for timeline introspection + injection — split out of
// scripts/discovery.mjs so that file stays about static registry/schema
// discovery (assets/transitions/aliases/themes) while this one owns the
// dynamic, per-project "where does everything sit on the render's frame
// axis" queries. All commands resolve the project fresh from disk every
// call (never a stale studio/resolved.json), via ProjectBuilder's timeline
// methods (scripts/builder/ProjectBuilder.js -> scripts/builder/buildTimeline.js).
//
// Commands:
//   outline <projectId>                    compact hierarchical (DAG) timeline: scene -> {assets, effects, camera} with only local offsets + flags — READ THIS FIRST, far cheaper than `timeline`
//   scene <projectId> <sceneId>            full per-node detail (content/resolvedPosition/resolvedStyle/words) for ONE scene — the detail `outline` leaves out
//   timeline <projectId>                   resolve + build the FULL global-frame timeline (every scene/asset/effect, full payload) — read-only
//   describe-frame <projectId> <frame>     "what's on screen at this global frame" — active scene/assets/effects/audio
//   open-ranges <projectId> <sceneId> ['<opts>']  "where's a safe gap in this scene" — frame ranges not covered by an asset/effect; opts: { minGapFrames?, includeEffects? }
//   inject-effects <projectId> '<rules>'   fan sfx/visual effects out across matching asset SEGMENTS or every scene boundary — writes them to the DETACHED scene.effects[] array with an exact scene-local `frame` (no percent math), after first resolving + reading the project's timeline.
//
// Any '<json>' argument may be the literal JSON text, or "-" to read JSON
// from stdin (use this for large rules payloads to avoid shell quoting
// problems).
//
// Examples:
//   node scripts/timeline-cli.mjs outline demo
//   node scripts/timeline-cli.mjs scene demo scene-001
//   node scripts/timeline-cli.mjs timeline demo
//   node scripts/timeline-cli.mjs describe-frame demo 218
//   node scripts/timeline-cli.mjs open-ranges demo scene-001
//   node scripts/timeline-cli.mjs inject-effects demo '[{"match":{"assetType":"KineticText"},"anchor":"enter","effect":{"id":"kt-whoosh","kind":"sfx","path":"audio/sfx.mp3","volume":0.6}}]'

import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectBuilder } from "./builder/ProjectBuilder.js";
import { ok, fail, parseJsonArg, printHelpFromSource } from "./builder/textOutput.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --minify: only inject-effects (a mutating command) actually writes files —
// same convention as cli.js/project-cli.js/discovery.mjs's global --minify
// switch. Stripped out of argv before positional parsing so it can appear
// anywhere.
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

    case "outline":
      ok(await builder.getTimelineOutline(rest[0]));
      break;
    case "scene":
      ok(await builder.getTimelineScene(rest[0], rest[1]));
      break;
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
