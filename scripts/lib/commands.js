'use strict';

const fs = require('fs');
const path = require('path');
const state = require('./state');
const { Workspace } = require('./workspace');
const ops = require('./ops');
const project = require('./project');

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
  project,
};
