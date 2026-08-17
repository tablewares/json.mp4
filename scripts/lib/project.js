'use strict';

const fs = require('fs');
const path = require('path');
const { CliError } = require('./errors');
const { MANIFEST_ROOT, rel } = require('./paths');
const { readJSON } = require('./fsutil');
const state = require('./state');
const { Workspace } = require('./workspace');
const { validateRef } = require('./schema');
const { assertValid } = require('./ops');

const DEFAULT_COLORS = {
  shade1: '#0B0E14',
  shade2: '#161B26',
  main1: '#F5F7FA',
  main2: '#8B93A7',
  accentBg: '#3D7BFD',
};

function projectCreate(id, opts = {}) {
  if (!id) throw new CliError('BadArguments', 'project create requires a <projectId>.');
  const projectDir = path.join(MANIFEST_ROOT, id);
  if (fs.existsSync(projectDir)) {
    throw new CliError('AlreadyExists', `Project "${id}" already exists at studio/manifest/${id}.`, { projectId: id });
  }

  const config = {
    fps: opts.fps ?? 30,
    width: opts.width ?? 1920,
    height: opts.height ?? 1080,
    defaultSceneDurationInFrames: opts.duration ?? 150,
  };
  for (const [k, v] of Object.entries(config)) {
    if (typeof v !== 'number') throw new CliError('BadArguments', `--${k} must be a number.`, { field: k, received: v });
  }

  const styles = {
    colors: DEFAULT_COLORS,
    typography: {},
    spacing: { sceneMargin: 96, gutter: 32 },
  };
  assertValid('style.schema.json', styles, 'styles');

  // Note: manifest.schema.json requires scenes.length >= 1, which a brand
  // new project can't satisfy yet. Full manifest validation (including
  // that constraint) is deferred to `project validate`, run once at least
  // one scene has been added via `scene create`.
  const manifest = { projectId: id, config: 'config.json', styles: 'styles/theme.json', scenes: [] };

  const ws = new Workspace(id);
  ws.setNew(ws.manifestPath(), manifest);
  ws.setNew(path.join(projectDir, 'config.json'), config);
  ws.setNew(path.join(projectDir, 'styles/theme.json'), styles);
  const written = ws.commit();

  state.setProjectId(id);

  return { projectId: id, active: true, manifest, config, styles, filesWritten: written };
}

function projectSet(id) {
  if (!id) throw new CliError('BadArguments', 'project set requires a <projectId>.');
  const projectDir = path.join(MANIFEST_ROOT, id);
  if (!fs.existsSync(projectDir)) {
    throw new CliError('ProjectNotFound', `No project "${id}" at studio/manifest/${id}. Use \`project create ${id}\` first.`, {
      projectId: id,
    });
  }
  const manifestPath = path.join(projectDir, 'manifest.json');
  const manifest = readJSON(manifestPath);
  state.setProjectId(id);
  return { projectId: id, active: true, manifest };
}

function projectCurrent() {
  const id = state.getProjectId();
  if (!id) return { active: false, projectId: null };
  const projectDir = path.join(MANIFEST_ROOT, id);
  if (!fs.existsSync(projectDir)) {
    return { active: false, projectId: id, note: `Active project "${id}" is set but no longer exists on disk.` };
  }
  const manifest = readJSON(path.join(projectDir, 'manifest.json'));
  return { active: true, projectId: id, manifest };
}

function projectValidate() {
  const id = state.requireProjectId();
  const projectDir = path.join(MANIFEST_ROOT, id);
  const issues = [];
  const manifestPath = path.join(projectDir, 'manifest.json');

  let manifest;
  try {
    manifest = readJSON(manifestPath);
    const { valid, errors } = validateRef('manifest.schema.json', manifest);
    if (!valid) issues.push({ file: rel(manifestPath), errors });
  } catch (e) {
    issues.push({ file: rel(manifestPath), errors: [{ message: e.message }] });
    return { projectId: id, ok: false, issues };
  }

  try {
    const configPath = path.join(projectDir, manifest.config);
    readJSON(configPath); // no formal schema; existence + parseability only
  } catch (e) {
    issues.push({ file: manifest.config, errors: [{ message: e.message }] });
  }

  try {
    const stylesPath = path.join(projectDir, manifest.styles);
    const styles = readJSON(stylesPath);
    const { valid, errors } = validateRef('style.schema.json', styles);
    if (!valid) issues.push({ file: rel(stylesPath), errors });
  } catch (e) {
    issues.push({ file: manifest.styles, errors: [{ message: e.message }] });
  }

  const seenAssetIds = new Map(); // assetId -> sceneId
  for (const entry of manifest.scenes || []) {
    const scenePath = path.join(projectDir, entry.path);
    let scene;
    try {
      scene = readJSON(scenePath);
    } catch (e) {
      issues.push({ file: entry.path, errors: [{ message: e.message }] });
      continue;
    }
    const { valid, errors } = validateRef('scene.schema.json', scene);
    if (!valid) issues.push({ file: rel(scenePath), errors });
    for (const asset of scene.assets || []) {
      if (!asset.id) continue;
      if (seenAssetIds.has(asset.id)) {
        issues.push({
          file: rel(scenePath),
          errors: [
            {
              message: `Duplicate asset id "${asset.id}" also used in scene "${seenAssetIds.get(asset.id)}". Asset ids must be unique across the project for CLI addressing to stay unambiguous.`,
            },
          ],
        });
      } else {
        seenAssetIds.set(asset.id, entry.id);
      }
    }
  }

  return { projectId: id, ok: issues.length === 0, issues };
}

module.exports = { projectCreate, projectSet, projectCurrent, projectValidate };
