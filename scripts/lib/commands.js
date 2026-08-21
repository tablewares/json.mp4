'use strict';

const fs = require('fs');
const path = require('path');
const state = require('./state');
const { Workspace } = require('./workspace');
const ops = require('./ops');
const project = require('./project');
const library = require('./library');

function withWorkspace(fn) {
  const projectId = state.requireProjectId();
  const ws = new Workspace(projectId);
  const result = fn(ws);
  const filesWritten = ws.commit();
  return { projectId, ...result, filesWritten };
}

// ---- scene --------------------------------------------------------------

function sceneCreate(sceneId, initialJson) {
  return withWorkspace((ws) => ops.sceneCreate(ws, sceneId, initialJson));
}

function sceneDelete(sceneId) {
  const projectId = state.requireProjectId();
  const ws = new Workspace(projectId);
  const scenePath = ws.getScenePath(sceneId); // validates it exists first
  const result = ops.sceneDelete(ws, sceneId);
  const filesWritten = ws.commit();
  // Only remove the scene's JSON file once the manifest rewrite has
  // actually landed on disk.
  if (fs.existsSync(scenePath)) fs.unlinkSync(scenePath);
  return { projectId, ...result, filesWritten };
}

function sceneGet(sceneId, field) {
  const projectId = state.requireProjectId();
  const ws = new Workspace(projectId);
  return { projectId, ...ops.sceneGet(ws, sceneId, field) };
}

function sceneSetFields(sceneId, pairs) {
  return withWorkspace((ws) => ops.sceneSetFields(ws, sceneId, pairs));
}

// ---- asset ----------------------------------------------------------------

function assetCreate(sceneId, assetId, json) {
  return withWorkspace((ws) => ops.assetCreate(ws, sceneId, assetId, json));
}

function assetDelete(assetId, sceneHint) {
  return withWorkspace((ws) => ops.assetDelete(ws, assetId, sceneHint));
}

function assetGet(assetId, sceneHint, field) {
  const projectId = state.requireProjectId();
  const ws = new Workspace(projectId);
  return { projectId, ...ops.assetGet(ws, assetId, sceneHint, field) };
}

function assetSetFields(assetId, pairs, sceneHint) {
  return withWorkspace((ws) => ops.assetSetFields(ws, assetId, pairs, sceneHint));
}

// ---- styles / config --------------------------------------------------

function stylesSetFields(pairs, replace) {
  return withWorkspace((ws) => ops.stylesSetFields(ws, pairs, replace));
}

function configSet(json) {
  return withWorkspace((ws) => ops.configSet(ws, json));
}

// ---- narration --------------------------------------------------------
//
// manifest.narration — { entries: [...], fullTranscript }. `set` merges
// (shallow, entries/fullTranscript each replace wholesale — same "field
// wins on conflict" contract `styles`/`config` use); `clear` removes the
// block entirely (falls back to config.defaultSceneDurationInFrames per
// scene, same as a project that never had narration).

function narrationSet(json) {
  return withWorkspace((ws) => ops.narrationSet(ws, json));
}

function narrationClear() {
  return withWorkspace((ws) => ops.narrationClear(ws));
}

// ---- theme library ------------------------------------------------------
//
// Named, reusable style presets that live OUTSIDE any one project (see
// studio/library/README.md), discoverable via `scripts/discovery.mjs
// themes|theme <name>`. `theme use` is the only one that touches the
// ACTIVE project (merges/replaces its styles/theme.json from a preset);
// list/show/create/delete operate on the library itself and don't need an
// active project.

function themeList() {
  return { themes: library.themeList() };
}

function themeShow(name) {
  return library.themeShow(name);
}

// `theme create <name> ['<json>']` — with json: save it as a new preset.
// Without json: snapshot the ACTIVE project's current styles/theme.json.
function themeCreate(name, json, opts) {
  if (json !== undefined) return library.themeCreate(name, json, opts);
  const projectId = state.requireProjectId();
  const ws = new Workspace(projectId);
  const styles = ws.getStyles();
  return { projectId, ...library.themeCreate(name, styles, opts) };
}

function themeDelete(name) {
  return library.themeDelete(name);
}

// `theme use <name> [--replace]` — pulls a saved preset into the ACTIVE
// project's styles/theme.json. Default merges token-category by
// token-category (same semantics as `styles <field> <json>`, so existing
// tokens not present in the preset survive); --replace wipes first.
function themeUse(name, replace) {
  const preset = library.themeShow(name).theme;
  const pairs = ['colors', 'typography', 'spacing', 'easing', 'textures']
    .filter((k) => preset[k] !== undefined)
    .map((k) => [k, preset[k]]);
  const result = withWorkspace((ws) => ops.stylesSetFields(ws, pairs, !!replace));
  return { themeUsed: name, ...result };
}

// ---- alias library --------------------------------------------------------
//
// Custom "$alias" presets (studio/library/aliases/*.json), loaded into the
// SAME runtime registry the built-ins live in by
// src/registry/aliasLibrary.js — see that file + resolve.js for the
// resolve-time wiring. This CLI only owns the on-disk JSON; it never
// touches the in-process registry (this process is short-lived CommonJS,
// the registry lives in the ESM pipeline).

function aliasList(category) {
  return { aliases: library.aliasList(category) };
}

function aliasShow(name) {
  return library.aliasShow(name);
}

function aliasCreate(name, expansionJson, description, opts) {
  return library.aliasCreate(name, expansionJson, description, opts);
}

function aliasDelete(name) {
  return library.aliasDelete(name);
}

// ---- manifest export (minified project snapshot) --------------------------
//
// Reads the active project's full manifest/config/styles/scene tree and
// returns it as one in-memory object — the "give me the whole thing as
// minified JSON" request. Doesn't touch disk (existing per-file JSON stays
// pretty-printed unless the project itself was created/regenerated with
// --minify); this is purely a read-side convenience so an agent doesn't
// have to stitch N file reads together by hand.
function manifestExport() {
  const projectId = state.requireProjectId();
  const ws = new Workspace(projectId);
  const manifest = ws.getManifest();
  const config = ws.getConfig();
  const styles = ws.getStyles();
  const scenes = ws.listSceneIds().map((id) => ws.getScene(id));
  return { projectId, manifest, config, styles, scenes };
}

module.exports = {
  sceneCreate,
  sceneDelete,
  sceneGet,
  sceneSetFields,
  assetCreate,
  assetDelete,
  assetGet,
  assetSetFields,
  stylesSetFields,
  configSet,
  narration: { set: narrationSet, clear: narrationClear },
  project,
  theme: { list: themeList, show: themeShow, create: themeCreate, delete: themeDelete, use: themeUse },
  alias: { list: aliasList, show: aliasShow, create: aliasCreate, delete: aliasDelete },
  manifestExport,
};
