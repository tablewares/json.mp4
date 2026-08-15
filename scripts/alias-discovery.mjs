#!/usr/bin/env node
// scripts/alias-discovery.mjs
//
// Standalone discovery CLI for the central alias registry. Lists aliases,
// shows the expanded shape, inspects categories. Detached from agent-cli.mjs
// — can be called directly or imported as a module.
//
// Usage:
//   node scripts/alias-discovery.mjs                        list all aliases grouped by category
//   node scripts/alias-discovery.mjs list                   same as no-arg
//   node scripts/alias-discovery.mjs list --category motion filter to one category
//   node scripts/alias-discovery.mjs show motion.fadeIn      full info + expanded shape
//   node scripts/alias-discovery.mjs show effects.oldComputer --vars '{ "grayscale": 0.9 }'
//   node scripts/alias-discovery.mjs categories              list category names
//   node scripts/alias-discovery.mjs expand '{"$alias":"motion.fadeIn","direction":"up"}'
//                                                            resolve one $alias object (deep)
//
// Reads no arguments: prints a compact list of every alias grouped by
// category, with descriptions and declared variables.

import { listAliases, describeAlias, listAliasCategories, resolveAliasesDeep, resolveAlias } from "../src/registry/aliasRegistry.js";

const cmd = process.argv[2] ?? "list";
const arg = process.argv[3];

function renderText(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.map((item) => {
      const rendered = renderText(item, indent + 2).split("\n").map((line) => `${pad}- ${line}`).join("\n");
      return rendered;
    }).join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return entries.map(([key, item]) => {
      const rendered = renderText(item, indent + 2);
      const prefix = `${pad}${key}: `;
      if (rendered.includes("\n")) {
        return `${prefix}${rendered.split("\n").join(`\n${" ".repeat(prefix.length)}`)}`;
      }
      return `${prefix}${rendered}`;
    }).join("\n");
  }
  return String(value);
}

function parseJsonArg(raw, label) {
  if (raw === undefined) throw new Error(`missing required JSON argument: ${label}`);
  try { return JSON.parse(raw); } catch (e) { throw new Error(`invalid JSON for ${label}: ${e.message}`); }
}

function fail(err) {
  console.log(`error: ${err.message ?? String(err)}`);
  process.exit(1);
}

function ok(value) {
  console.log(renderText(value));
  process.exit(0);
}

try {
  switch (cmd) {
    case "list": {
      let category;
      if (arg === "--category") category = process.argv[4];
      else if (arg && !arg.startsWith("-")) category = arg;
      ok(listAliases(category));
      break;
    }
    case "categories":
      ok(listAliasCategories());
      break;
    case "show": {
      if (!arg) throw new Error("usage: show <alias-full-name>");
      // optional --vars '{...}' to override defaults in the expanded shape
      const varsIdx = process.argv.indexOf("--vars");
      let desc;
      if (varsIdx !== -1) {
        const varsJson = process.argv[varsIdx + 1];
        const vars = parseJsonArg(varsJson, "vars");
        // Re-implement describeAlias with custom vars: look up + resolve with vars
        const grouped = listAliases();
        const fullName = arg;
        // Use resolveAlias directly so vars override applies
        let expanded = null;
        let error = null;
        try {
          expanded = resolveAlias(fullName, vars);
        } catch (e) {
          error = e.message;
        }
        // Pull the static parts from describeAlias for meta fields:
        const staticDesc = describeAlias(fullName);
        ok({ name: staticDesc.name, category: staticDesc.category, shortName: staticDesc.shortName, description: staticDesc.description, vars: staticDesc.vars, expanded: expanded ?? error, varsApplied: vars });
      } else {
        desc = describeAlias(arg);
        ok(desc);
      }
      break;
    }
    case "expand": {
      if (!arg) throw new Error("usage: expand '<json-with-$alias>'");
      const parsed = parseJsonArg(arg, "input");
      ok(resolveAliasesDeep(parsed));
      break;
    }
    case undefined:
    case "-h":
    case "--help":
      console.log("usage: alias-discovery <list|categories|show|expand> [args]");
      console.log("  list [--category <cat>]  list aliases grouped (optionally filtered by category)");
      console.log("  categories               list known category names");
      console.log("  show <name> [--vars JSON] show full info + expanded shape");
      console.log('  expand \'<json>\'          resolve a $alias object deep');
      process.exit(0);
      break;
    default:
      fail(new Error(`Unknown command "${cmd}". See --help.`));
  }
} catch (e) {
  fail(e);
}
