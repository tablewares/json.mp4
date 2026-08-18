// src/agent/schemaIntrospect.js
//
// Generic, schema-folder-driven introspection. Unlike introspect.js (which
// hand-maintains per-asset-type / per-collection descriptions), this module
// derives EVERYTHING from the JSON Schema files under
// src/pipelines/pipeline1-validate/schema/ — $ref-dereferenced, recursively,
// including oneOf/anyOf/allOf branches, nested properties, enums,
// descriptions, and numeric constraints.
//
// The only maintenance burden this creates is the one that already exists:
// keep scene.schema.json / shared.schema.json / etc. accurate, and write a
// `description` on new fields. No adapter, no new introspect.js entry, no
// second source of truth to update when a schema changes — a new property,
// a new oneOf branch, a new definition all show up automatically the next
// time this module (or schema-cli.mjs) runs, because it reads the same
// files Ajv validates against in validate.js.
//
// This module never mutates or validates anything — it's read-only
// reflection over the schema files, safe to call from a CLI, from
// introspect.js, or from a future doc-generation script.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(__dirname, "../../src/pipelines/pipeline1-validate/schema");

const MAX_DEREF_DEPTH = 20;

/** Reads every *.json file directly under the schema folder into { filename -> parsed schema }. */
function loadSchemas(schemaDir = SCHEMA_DIR) {
  const byFile = {};
  for (const file of fs.readdirSync(schemaDir)) {
    if (!file.endsWith(".json")) continue;
    const raw = fs.readFileSync(path.join(schemaDir, file), "utf-8");
    try {
      byFile[file] = JSON.parse(raw);
    } catch (e) {
      throw new Error(`schemaIntrospect: failed to parse ${file}: ${e.message}`);
    }
  }
  if (Object.keys(byFile).length === 0) {
    throw new Error(`schemaIntrospect: no schema files found under ${schemaDir}`);
  }
  return byFile;
}

/** JSON-Pointer resolution (RFC 6901), e.g. "/definitions/cameraSpec". */
function resolvePointer(schema, pointer) {
  if (!pointer || pointer === "/") return schema;
  const parts = pointer
    .replace(/^\//, "")
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node = schema;
  for (const part of parts) {
    if (node == null) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Resolves a `$ref` string against the loaded schema set. Supports both
 * cross-file refs ("shared.schema.json#/definitions/timingAnchor") and
 * same-file refs ("#/definitions/cameraSpec") — same two shapes every
 * schema file in this repo already uses.
 */
function resolveRef(ref, currentFile, byFile) {
  const hashIdx = ref.indexOf("#");
  const filePart = hashIdx === -1 ? ref : ref.slice(0, hashIdx);
  const pointerPart = hashIdx === -1 ? "" : ref.slice(hashIdx + 1);
  const file = filePart || currentFile;
  const schema = byFile[file];
  if (!schema) {
    throw new Error(
      `schemaIntrospect: $ref "${ref}" (from "${currentFile}") points at unknown schema file "${file}". ` +
        `Known files: ${Object.keys(byFile).join(", ")}`,
    );
  }
  const node = resolvePointer(schema, pointerPart);
  if (node === undefined) {
    throw new Error(`schemaIntrospect: $ref "${ref}" (from "${currentFile}") did not resolve to anything in "${file}".`);
  }
  return { node, file };
}

const PASSTHROUGH_KEYS = [
  "type",
  "description",
  "enum",
  "default",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
];

/**
 * Recursively dereferences one schema node into a plain, JSON-safe
 * description: $refs are inlined, oneOf/anyOf/allOf branches are each
 * described, object properties are described with a `required` flag, and
 * array `items` are described. Cycle-safe (a $ref chain that loops back on
 * itself is reported instead of recursing forever) and depth-capped.
 */
function describeNode(node, currentFile, byFile, depth = 0, seen = new Set()) {
  if (node == null || typeof node !== "object") return node;
  if (depth > MAX_DEREF_DEPTH) return { note: "max dereference depth reached" };

  if (typeof node.$ref === "string") {
    const key = `${currentFile}::${node.$ref}`;
    if (seen.has(key)) return { $ref: node.$ref, note: "circular reference, not expanded further" };
    const { node: resolved, file } = resolveRef(node.$ref, currentFile, byFile);
    const nextSeen = new Set(seen);
    nextSeen.add(key);
    return describeNode(resolved, file, byFile, depth + 1, nextSeen);
  }

  const out = {};
  for (const key of PASSTHROUGH_KEYS) {
    if (node[key] !== undefined) out[key] = node[key];
  }
  if (node.additionalProperties === false) out.additionalProperties = false;

  for (const combinator of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(node[combinator])) {
      out[combinator] = node[combinator].map((n) => describeNode(n, currentFile, byFile, depth + 1, seen));
    }
  }

  if (node.items) {
    out.items = describeNode(node.items, currentFile, byFile, depth + 1, seen);
  }

  if (node.properties && typeof node.properties === "object") {
    const required = new Set(node.required ?? []);
    out.properties = {};
    for (const [key, propSchema] of Object.entries(node.properties)) {
      out.properties[key] = {
        required: required.has(key),
        ...describeNode(propSchema, currentFile, byFile, depth + 1, seen),
      };
    }
  }

  return out;
}

/** Accepts a filename ("scene.schema.json"), a bare name ("scene"), or a
 *  literal $id, and resolves it to the loaded file key. */
function resolveFileName(fileOrId, byFile) {
  if (byFile[fileOrId]) return fileOrId;
  const withExt = fileOrId.endsWith(".json") ? fileOrId : `${fileOrId}.schema.json`;
  if (byFile[withExt]) return withExt;
  const byId = Object.entries(byFile).find(([, s]) => s.$id === fileOrId);
  if (byId) return byId[0];
  throw new Error(`Unknown schema "${fileOrId}". Available: ${Object.keys(byFile).join(", ")}`);
}

/** One-line-per-file summary: every schema currently in the folder, its
 *  $id, top-level required/properties, and any definitions it exposes for
 *  other schemas to $ref. Always safe to dump in full — this is the
 *  "what schemas exist" entry point, the schema-folder equivalent of
 *  introspect.js's listAssetTypes(). */
export function listSchemas(schemaDir = SCHEMA_DIR) {
  const byFile = loadSchemas(schemaDir);
  return Object.entries(byFile).map(([file, schema]) => ({
    file,
    id: schema.$id ?? file,
    type: schema.type,
    description: schema.description,
    required: schema.required ?? [],
    topLevelProperties: schema.properties ? Object.keys(schema.properties) : [],
    definitions: schema.definitions ? Object.keys(schema.definitions) : [],
  }));
}

/** Full, $ref-dereferenced description of one schema file's top-level shape. */
export function describeSchema(fileOrId, schemaDir = SCHEMA_DIR) {
  const byFile = loadSchemas(schemaDir);
  const file = resolveFileName(fileOrId, byFile);
  const schema = byFile[file];
  return { file, id: schema.$id ?? file, ...describeNode(schema, file, byFile) };
}

/** Names of every `definitions` entry in one schema file (its internal,
 *  $ref-able building blocks — e.g. camera.schema.json's "cameraSpec"). */
export function listDefinitions(fileOrId, schemaDir = SCHEMA_DIR) {
  const byFile = loadSchemas(schemaDir);
  const file = resolveFileName(fileOrId, byFile);
  return Object.keys(byFile[file].definitions ?? {});
}

/** Full, $ref-dereferenced description of one named definition within one
 *  schema file — e.g. describeDefinition("camera.schema.json", "cameraSpec"). */
export function describeDefinition(fileOrId, defName, schemaDir = SCHEMA_DIR) {
  const byFile = loadSchemas(schemaDir);
  const file = resolveFileName(fileOrId, byFile);
  const schema = byFile[file];
  const def = schema.definitions?.[defName];
  if (!def) {
    throw new Error(
      `No definition "${defName}" in "${file}". Known: ${Object.keys(schema.definitions ?? {}).join(", ") || "(none)"}`,
    );
  }
  return { file, definition: defName, ...describeNode(def, file, byFile) };
}

/** Full, $ref-dereferenced description of one top-level scene.schema.json
 *  field (e.g. "camera", "physics", "background", "transitionOut",
 *  "effects", "narrationRef") — the schema-driven replacement for
 *  hand-maintained field docs. Backs the CLI's `scene-field <name>`. */
export function describeSceneField(field, schemaDir = SCHEMA_DIR) {
  const full = describeSchema("scene.schema.json", schemaDir);
  const node = full.properties?.[field];
  if (!node) {
    throw new Error(
      `Unknown scene field "${field}". Known: ${Object.keys(full.properties ?? {}).join(", ") || "(none)"}`,
    );
  }
  return { field, ...node };
}

/** Same as describeSceneField, scoped to one per-asset field (e.g.
 *  "motion", "physics", "enterAt", "effects"). Backs `asset-field <name>`. */
export function describeAssetField(field, schemaDir = SCHEMA_DIR) {
  const full = describeSchema("scene.schema.json", schemaDir);
  const assetProps = full.properties?.assets?.items?.properties ?? {};
  const node = assetProps[field];
  if (!node) {
    throw new Error(`Unknown asset field "${field}". Known: ${Object.keys(assetProps).join(", ") || "(none)"}`);
  }
  return { field, ...node };
}

/** Free-text search across every schema file's keys/values (property names,
 *  descriptions, enum members, $id) — lets an agent find "where is X
 *  authored" without reading raw JSON or knowing which file to open. */
export function searchSchemas(term, schemaDir = SCHEMA_DIR) {
  if (!term) throw new Error("searchSchemas requires a non-empty term");
  const byFile = loadSchemas(schemaDir);
  const needle = term.toLowerCase();
  const hits = [];

  function walk(node, file, pointerPath) {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, file, `${pointerPath}[${i}]`));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const nextPath = `${pointerPath}/${key}`;
      const keyMatches = key.toLowerCase().includes(needle);
      const valueMatches = typeof value === "string" && value.toLowerCase().includes(needle);
      if (keyMatches || valueMatches) {
        hits.push({ file, path: nextPath, key, value: typeof value === "object" ? undefined : value });
      }
      if (value && typeof value === "object") walk(value, file, nextPath);
    }
  }

  for (const [file, schema] of Object.entries(byFile)) {
    walk(schema, file, "");
  }
  return hits;
}
