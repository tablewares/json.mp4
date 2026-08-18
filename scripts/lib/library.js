'use strict';

// scripts/lib/library.js
//
// CommonJS mutation-side counterpart to src/registry/themeLibrary.js /
// src/registry/aliasLibrary.js (both ESM, read-only). Owns writes to
// studio/library/{themes,aliases}/*.json so `scripts/cli.js theme *` /
// `scripts/cli.js alias *` and `scripts/discovery.mjs themes|theme|
// aliases|alias` always read/write the exact same on-disk files — no
// separate schema, no drift between "what the agent can select" and
// "what the agent can create".

const fs = require('fs');
const path = require('path');
const { CliError } = require('./errors');
const { THEME_LIBRARY_DIR, ALIAS_LIBRARY_DIR, rel } = require('./paths');
const { readJSON, writeJSONAtomic } = require('./fsutil');
const { assertValid } = require('./ops');

// ---------------------------------------------------------------------
// themes
// ---------------------------------------------------------------------

function themePath(name) {
  return path.join(THEME_LIBRARY_DIR, `${name}.json`);
}

function themeListNames() {
  if (!fs.existsSync(THEME_LIBRARY_DIR)) return [];
  return fs
    .readdirSync(THEME_LIBRARY_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length));
}

function themeList() {
  return themeListNames().map((name) => {
    const theme = readJSON(themePath(name));
    return {
      name,
      colorTokens: Object.keys(theme.colors || {}).length,
      typographyTokens: Object.keys(theme.typography || {}).length,
      easingTokens: Object.keys(theme.easing || {}).length,
    };
  });
}

function themeShow(name) {
  if (!name) throw new CliError('BadArguments', 'theme show requires a <name>.');
  const p = themePath(name);
  if (!fs.existsSync(p)) {
    throw new CliError('NotFound', `No theme preset "${name}".`, { name, available: themeListNames() });
  }
  return { name, theme: readJSON(p) };
}

// `theme create <name> ['<json>']` — with json: validate + save as a new
// named preset. Without json: snapshot the ACTIVE project's current
// styles/theme.json into the library (the common "I like this look, save
// it for reuse" flow) — caller supplies the already-read styles object.
function themeCreate(name, themeJsonOrObject, { overwrite = false } = {}) {
  if (!name) throw new CliError('BadArguments', 'theme create requires a <name>.');
  const p = themePath(name);
  if (fs.existsSync(p) && !overwrite) {
    throw new CliError('AlreadyExists', `Theme preset "${name}" already exists. Pass --overwrite to replace it.`, { name });
  }
  let theme = themeJsonOrObject;
  if (typeof theme === 'string') {
    try {
      theme = JSON.parse(theme);
    } catch (e) {
      throw new CliError('InvalidJSON', `Could not parse theme JSON: ${e.message}`);
    }
  }
  if (typeof theme !== 'object' || theme === null || Array.isArray(theme)) {
    throw new CliError('BadArguments', 'theme create JSON must be an object (style.schema.json shape).', { received: theme });
  }
  assertValid('style.schema.json', theme, 'theme');
  writeJSONAtomic(p, theme);
  return { name, file: rel(p), theme };
}

function themeDelete(name) {
  if (!name) throw new CliError('BadArguments', 'theme delete requires a <name>.');
  const p = themePath(name);
  if (!fs.existsSync(p)) {
    throw new CliError('NotFound', `No theme preset "${name}".`, { name, available: themeListNames() });
  }
  fs.unlinkSync(p);
  return { name, deleted: true };
}

// ---------------------------------------------------------------------
// aliases
// ---------------------------------------------------------------------
//
// All custom aliases live in ONE file (studio/library/aliases/custom.json)
// keyed by "category.name" -> { description?, vars?, expansion }. Multiple
// files are still supported for read (aliasLibrary.js scans every *.json
// in the dir) in case an agent/human wants to hand-organize by category,
// but the CLI always writes to custom.json for a predictable single
// mutation target.

const CUSTOM_ALIAS_FILE = 'custom.json';

function aliasCustomPath() {
  return path.join(ALIAS_LIBRARY_DIR, CUSTOM_ALIAS_FILE);
}

function readAllAliasFiles() {
  if (!fs.existsSync(ALIAS_LIBRARY_DIR)) return [];
  return fs
    .readdirSync(ALIAS_LIBRARY_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, path: path.join(ALIAS_LIBRARY_DIR, f), data: readJSON(path.join(ALIAS_LIBRARY_DIR, f)) }));
}

function aliasList(category) {
  const out = {};
  for (const { data } of readAllAliasFiles()) {
    for (const [name, entry] of Object.entries(data)) {
      const dot = name.indexOf('.');
      const cat = dot === -1 ? name : name.slice(0, dot);
      if (category && cat !== category) continue;
      if (!out[cat]) out[cat] = [];
      out[cat].push({ name, description: entry.description || '', vars: entry.vars || [], source: 'custom' });
    }
  }
  return out;
}

function aliasShow(name) {
  if (!name) throw new CliError('BadArguments', 'alias show requires a <name> ("category.shortName").');
  for (const { file, data } of readAllAliasFiles()) {
    if (name in data) return { name, file: `studio/library/aliases/${file}`, ...data[name] };
  }
  throw new CliError('NotFound', `No custom alias "${name}". (Built-in aliases live in code — see \`node scripts/discovery.mjs aliases\`.)`, { name });
}

function validateAliasName(name) {
  const dot = name.indexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    throw new CliError('BadArguments', `Alias name "${name}" must be "category.shortName" (e.g. "motion.myPreset").`, { name });
  }
}

// alias create <category.name> '<expansion-json>' ['<description>'] --vars a,b
function aliasCreate(name, expansionJson, description, opts = {}) {
  if (!name) throw new CliError('BadArguments', 'alias create requires a <category.name>.');
  validateAliasName(name);
  if (expansionJson === undefined) throw new CliError('BadArguments', 'alias create requires an expansion JSON argument (object or array).');

  let expansion = expansionJson;
  if (typeof expansion === 'string') {
    try {
      expansion = JSON.parse(expansion);
    } catch (e) {
      throw new CliError('InvalidJSON', `Could not parse alias expansion JSON: ${e.message}`);
    }
  }
  if (typeof expansion !== 'object' || expansion === null) {
    throw new CliError('BadArguments', 'alias expansion must be a JSON object or array.', { received: expansion });
  }

  const file = aliasCustomPath();
  const data = fs.existsSync(file) ? readJSON(file) : {};
  if (name in data && !opts.overwrite) {
    throw new CliError('AlreadyExists', `Custom alias "${name}" already exists. Pass --overwrite to replace it.`, { name });
  }
  data[name] = {
    description: description || '',
    vars: opts.vars || [],
    expansion,
  };
  writeJSONAtomic(file, data);
  return { name, file: rel(file), entry: data[name] };
}

function aliasDelete(name) {
  if (!name) throw new CliError('BadArguments', 'alias delete requires a <category.name>.');
  for (const { path: filePath, data } of readAllAliasFiles()) {
    if (name in data) {
      delete data[name];
      writeJSONAtomic(filePath, data);
      return { name, deleted: true, file: rel(filePath) };
    }
  }
  throw new CliError('NotFound', `No custom alias "${name}".`, { name });
}

module.exports = {
  themeList,
  themeShow,
  themeCreate,
  themeDelete,
  aliasList,
  aliasShow,
  aliasCreate,
  aliasDelete,
};
