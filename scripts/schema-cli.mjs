#!/usr/bin/env node
// scripts/schema-cli.mjs
//
// Read-only discovery CLI over src/pipelines/pipeline1-validate/schema/.
// Every answer is derived live from the JSON Schema files Ajv already
// validates against (see validate.js) — there is no second, hand-maintained
// description to keep in sync. Unlike agent-cli.mjs's `asset <type>` /
// `transition <type>` commands (which read the asset/transition registry,
// i.e. studio/assets/*/manifest.json), this CLI only ever reads
// src/pipelines/pipeline1-validate/schema/*.json. Adding a new schema file,
// a new property, or a new oneOf branch shows up here automatically the
// next time it runs — no new adapter, no new introspect.js entry, no new
// context to write. The only maintenance this asks for is what schema
// authoring already requires: keep the schema accurate, and put a
// `description` on new fields.
//
// Commands:
//   schemas                          list every schema file in the folder ($id, required, top-level properties, definitions)
//   fields <file|id>                 CHEAPEST overview: just this file's top-level property names + required flags + one-line descriptions, no nested expansion
//   field <file|id> <name> [<name>...]   full $ref-dereferenced description of ONE OR MORE top-level fields (e.g. `field scene background enterAt z`) — prefer this over `schema` when you know the field name
//   asset-fields                     cheapest overview of scene.assets[].* fields only (id, assetType, anchor, z, motion, ...)
//   asset-field <name> [<name>...]   same as `field scene.schema.json <name>`, scoped to per-asset fields (scene.assets[].*) — e.g. `asset-field z motion enterAt`
//   schema <file|id> [--depth N]      full $ref-dereferenced description of one schema file's top-level shape. Large (scene.schema.json can print 1000+ lines) — pass --depth to cap nesting, or use `fields`/`field` instead
//   definitions <file|id>            list the named `definitions` entries inside one schema file
//   definition <file|id> <name> [<name>...] [--depth N]   full $ref-dereferenced description of one or more definitions (e.g. cameraSpec, motionSpec, timingAnchor)
//   search <term> [<term>...]        free-text search across every schema file's keys/descriptions/enum values; multiple terms run as separate searches in one process/one tool call
//   vocab [term]                     CENTRALIZED index of every enum (closed value list, e.g. easing curve names, anchor positions) and default anywhere in the schema folder — "what values can I pass for X" / "what's the default", one command instead of grepping every schema file. Optional term filters by path/description/value substring (e.g. `vocab easing`). NOTE: theme-level spring easing tokens (gentleSpring/snappySpring, in studio's theme.json under styles.easing) are a SEPARATE vocabulary from the enum curve names (linear/easeIn/easeOut/easeInOut) this surfaces — check `discovery.mjs theme <name>` for those, they don't live in the schema files.
//
// `<file|id>` accepts any of: the filename ("camera.schema.json"), the bare
// name ("camera"), or the schema's own $id (identical to the filename in
// this repo, but resolved either way).
//
// Efficiency notes (read this before dumping a whole schema file):
//   - `fields <file>` first to see what's there cheaply, THEN `field <file> <name>`
//     for the one you need — this is almost always cheaper in both tokens and
//     tool calls than `schema <file>` on anything but the small schema files
//     (transition.schema.json, physics.schema.json's top level, etc).
//   - `field`/`definition`/`search` all accept MULTIPLE names/terms in one
//     invocation — batch your lookups into one process spawn instead of one
//     tool call per field.
//   - `--depth N` on `schema`/`definition` truncates nested $ref expansion at
//     N levels (a `{ note }` marker replaces anything deeper) — use a small
//     depth (2-3) to sanity-check a shape's outline before paying for a full
//     expansion.
//
// Examples:
//   node scripts/schema-cli.mjs schemas
//   node scripts/schema-cli.mjs fields scene
//   node scripts/schema-cli.mjs field scene background z enterAt
//   node scripts/schema-cli.mjs schema scene --depth 2
//   node scripts/schema-cli.mjs definitions scene.schema.json
//   node scripts/schema-cli.mjs definition scene.schema.json motionSpec
//   node scripts/schema-cli.mjs definition camera cameraSpec
//   node scripts/schema-cli.mjs definition shared timingAnchor
//   node scripts/schema-cli.mjs search relativeToWord carryAssetId

import fs from "node:fs";

import {
  listSchemas,
  listFields,
  describeField,
  listAssetFields,
  describeAssetField,
  describeSchema,
  listDefinitions,
  describeDefinition,
  searchSchemas,
  listVocabulary,
} from "./schema-lib/schemaIntrospect.mjs";

function renderText(value, indent = 0) {
  const pad = " ".repeat(indent);

  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.includes("\n") ? `"${value}"` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (typeof item !== "object" || item === null) {
          return `${pad}- ${renderText(item, 0)}`;
        }
        return `${pad}-\n${renderText(item, indent + 2)}`;
      })
      .join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, val]) => {
        if (val === null || val === undefined) return `${pad}${key}: ${val}`;
        if (typeof val !== "object") return `${pad}${key}: ${renderText(val, 0)}`;
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
  const src = fs.readFileSync(new URL(import.meta.url), "utf-8");
  const header = src.split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, ""));
  console.log(header.join("\n"));
  process.exit(0);
}

/** Pulls `--depth N` out of an args array (any position), returning
 *  { depth, rest }. Absent flag -> depth undefined (schemaIntrospect's own
 *  default, effectively unlimited up to its internal cap). */
function extractDepth(args) {
  const idx = args.findIndex((a) => a === "--depth");
  if (idx === -1) return { depth: undefined, rest: args };
  const value = Number(args[idx + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--depth must be a non-negative number, got "${args[idx + 1]}"`);
  }
  const rest = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { depth: value, rest };
}

const [, , command, ...rawRest] = process.argv;

try {
  switch (command) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      printHelp();
      break;

    case "schemas":
      ok(listSchemas());
      break;

    case "fields": {
      const [fileOrId] = rawRest;
      if (!fileOrId) throw new Error("usage: fields <file|id>");
      ok(listFields(fileOrId));
      break;
    }

    case "field": {
      const { depth, rest } = extractDepth(rawRest);
      const [fileOrId, ...names] = rest;
      if (!fileOrId || names.length === 0) throw new Error("usage: field <file|id> <name> [<name>...] [--depth N]");
      ok(names.length === 1 ? describeField(fileOrId, names[0], undefined, depth) : names.map((n) => describeField(fileOrId, n, undefined, depth)));
      break;
    }

    case "asset-fields":
      ok(listAssetFields());
      break;

    case "asset-field": {
      const { depth, rest } = extractDepth(rawRest);
      if (rest.length === 0) throw new Error("usage: asset-field <name> [<name>...] [--depth N]");
      ok(rest.length === 1 ? describeAssetField(rest[0], undefined, depth) : rest.map((n) => describeAssetField(n, undefined, depth)));
      break;
    }

    case "schema": {
      const { depth, rest } = extractDepth(rawRest);
      ok(describeSchema(rest[0], undefined, depth));
      break;
    }

    case "definitions":
      ok(listDefinitions(rawRest[0]));
      break;

    case "definition": {
      const { depth, rest } = extractDepth(rawRest);
      const [fileOrId, ...names] = rest;
      if (!fileOrId || names.length === 0) throw new Error("usage: definition <file|id> <name> [<name>...] [--depth N]");
      ok(names.length === 1 ? describeDefinition(fileOrId, names[0], undefined, depth) : names.map((n) => describeDefinition(fileOrId, n, undefined, depth)));
      break;
    }

    case "search": {
      if (rawRest.length === 0) throw new Error("usage: search <term> [<term>...]");
      ok(rawRest.length === 1 ? searchSchemas(rawRest[0]) : Object.fromEntries(rawRest.map((term) => [term, searchSchemas(term)])));
      break;
    }

    case "vocab":
    case "vocabulary":
      ok(listVocabulary(undefined, rawRest[0]));
      break;

    default:
      throw new Error(`unknown command "${command}". Run with no arguments for help.`);
  }
} catch (e) {
  fail(e);
}
