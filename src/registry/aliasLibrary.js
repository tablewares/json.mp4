// src/registry/aliasLibrary.js
//
// Loads project-agnostic, file-based alias presets from
// studio/library/aliases/*.json and registers them into the SAME runtime
// registry src/registry/aliasRegistry.js exposes ("$alias" resolution at
// pipeline2, plus the `aliases`/`alias` discovery commands). This is the
// on-disk, agent/human-editable counterpart to the code-defined built-ins
// registered at the bottom of aliasRegistry.js — no code change needed to
// add a new static alias, just a JSON file entry.
//
// File shape (studio/library/aliases/<file>.json):
//   {
//     "category.name": {
//       "description": "...",
//       "vars": ["..."],          // documentation only — see caveat below
//       "expansion": { ... } | [ ... ]
//     },
//     ...
//   }
//
// Caveat: unlike code-registered aliases (whose `fn` can be a function that
// reads `vars` at resolve time — e.g. built-in `motion.fadeIn` reading
// `v.direction`), a JSON file can only hold a static value. So a
// file-based alias's `expansion` is registered as a CONSTANT — every
// "$alias" reference to it expands identically regardless of any extra
// keys passed alongside "$alias" in the manifest. `vars` in the file is
// therefore documentation-only (surfaced by `describeAlias`/list commands)
// unless a future version adds a tiny expression language. For a
// variable-taking alias, register it in code via `registerAlias` in
// aliasRegistry.js instead.
//
// Idempotent + safe to call multiple times (e.g. once from resolve.js, once
// from the CLI) — registerAlias() overwrites by name, so a re-load just
// re-applies the same constant.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerAlias } from "./aliasRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ALIAS_LIBRARY_DIR = path.resolve(__dirname, "../../studio/library/aliases");

let _loaded = false;

/**
 * Reads every *.json file in `dir` and registers each top-level key as an
 * alias ("category.name" -> constant expansion). Missing directory is a
 * strict no-op (a repo checkout with no custom aliases yet works exactly
 * like before this module existed).
 *
 * @param {{ dir?: string, force?: boolean }} [opts]
 *   dir: override the library directory (mainly for tests).
 *   force: re-scan and re-register even if already loaded once this process.
 * @returns {{ dir: string, files: string[], names: string[] }}
 */
export function loadAliasLibrary(opts = {}) {
  const dir = opts.dir ?? DEFAULT_ALIAS_LIBRARY_DIR;
  if (_loaded && !opts.force && !opts.dir) {
    return { dir, files: [], names: [], cached: true };
  }

  const names = [];
  const files = [];
  if (!fs.existsSync(dir)) {
    _loaded = true;
    return { dir, files, names };
  }

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const full = path.join(dir, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
    } catch (e) {
      throw new Error(`aliasLibrary: could not parse ${full}: ${e.message}`);
    }
    files.push(file);
    for (const [name, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== "object" || !("expansion" in entry)) {
        throw new Error(
          `aliasLibrary: alias "${name}" in ${file} is missing an "expansion" key. ` +
            `Expected { description?, vars?, expansion }.`,
        );
      }
      const expansion = entry.expansion;
      registerAlias(name, () => expansion, {
        description: entry.description ?? "",
        vars: entry.vars ?? [],
        source: "custom",
      });
      names.push(name);
    }
  }

  _loaded = true;
  return { dir, files, names };
}

/** Force a fresh re-scan (e.g. after `alias create`/`alias delete` writes a file mid-process). */
export function reloadAliasLibrary(opts = {}) {
  return loadAliasLibrary({ ...opts, force: true });
}
