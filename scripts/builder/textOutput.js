// scripts/builder/textOutput.js
//
// Shared stdout-formatting + tiny CLI plumbing used by every agent-facing
// entry point under scripts/ (discovery.mjs, timeline-cli.mjs, ...). Split
// out so each CLI file stays focused on its own command table instead of
// re-defining the same renderText/ok/fail/parseJsonArg/readStdinSync four
// times — a bug fix (e.g. a rendering edge case) now lands in one place for
// every CLI that shares this output contract: one compact text result to
// stdout and exit 0 on success, or `error: <message>` to stdout and exit 1
// on failure.

import fs from "node:fs";

export function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

export function parseJsonArg(raw, label) {
  if (raw === undefined) throw new Error(`missing required JSON argument: ${label}`);
  const text = raw === "-" ? readStdinSync() : raw;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`invalid JSON for ${label}: ${e.message}`);
  }
}

/**
 * Compact, indentation-based text renderer (not JSON) — deliberately
 * terser than JSON.stringify for LLM-agent consumption: no braces/quotes/
 * commas, `undefined` values omitted entirely rather than printed, empty
 * arrays/objects stay inline instead of dropping to their own line.
 */
export function renderText(value, indent = 0) {
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

export function ok(value) {
  console.log(renderText(value));
  process.exit(0);
}

export function fail(err) {
  console.log(`error: ${err.message ?? String(err)}`);
  process.exit(1);
}

/** Re-emits a CLI file's own top-of-file `//` header comment as help text. */
export function printHelpFromSource(fileUrl) {
  const src = fs.readFileSync(new URL(fileUrl), "utf-8");
  const header = src.split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, ""));
  console.log(header.join("\n"));
  process.exit(0);
}
