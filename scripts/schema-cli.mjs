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
//   schema <file|id>                 full $ref-dereferenced description of one schema file's top-level shape
//   definitions <file|id>            list the named `definitions` entries inside one schema file
//   definition <file|id> <name>      full $ref-dereferenced description of one definition (e.g. cameraSpec, motionSpec, timingAnchor)
//   search <term>                    free-text search across every schema file's keys/descriptions/enum values
//
// `<file|id>` accepts any of: the filename ("camera.schema.json"), the bare
// name ("camera"), or the schema's own $id (identical to the filename in
// this repo, but resolved either way).
//
// Examples:
//   node scripts/schema-cli.mjs schemas
//   node scripts/schema-cli.mjs schema scene
//   node scripts/schema-cli.mjs definitions scene.schema.json
//   node scripts/schema-cli.mjs definition scene.schema.json motionSpec
//   node scripts/schema-cli.mjs definition camera cameraSpec
//   node scripts/schema-cli.mjs definition shared timingAnchor
//   node scripts/schema-cli.mjs search relativeToWord

import fs from "node:fs";

import {
  listSchemas,
  describeSchema,
  listDefinitions,
  describeDefinition,
  searchSchemas,
} from "./schema-lib/schemaIntrospect.js";

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

const [, , command, ...rest] = process.argv;

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
    case "schema":
      ok(describeSchema(rest[0]));
      break;
    case "definitions":
      ok(listDefinitions(rest[0]));
      break;
    case "definition":
      ok(describeDefinition(rest[0], rest[1]));
      break;
    case "search":
      ok(searchSchemas(rest[0]));
      break;

    default:
      throw new Error(`unknown command "${command}". Run with no arguments for help.`);
  }
} catch (e) {
  fail(e);
}
