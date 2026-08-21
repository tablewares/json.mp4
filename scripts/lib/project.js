'use strict';

const fs = require('fs');
const path = require('path');
const { CliError } = require('./errors');
const { MANIFEST_ROOT, rel } = require('./paths');
const { readJSON, isMinifyExplicit, getDefaultMinify } = require('./fsutil');
const state = require('./state');
const { Workspace } = require('./workspace');
const { validateRef } = require('./schema');
const { assertValid } = require('./ops');
const library = require('./library');

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
  // Persist the chosen JSON format as a per-project SETTING (not just a
  // one-off flag on this invocation) — Workspace._resolveMinify() reads
  // this on every later scene/asset/styles/batch command for this project,
  // so `--minify` at creation time means "this project stays minified"
  // rather than something that has to be repeated on every future command.
  // Reads the SAME global --minify state cli.js's main() set via
  // setDefaultMinify() (falling back to opts.minify for callers that pass
  // it directly, e.g. tests) — only persisted when the invocation actually
  // opted in one way or the other, so an untouched project falls through
  // to the process-wide default (pretty) exactly like before this setting
  // existed.
  const minifyChoice = opts.minify !== undefined ? opts.minify : (isMinifyExplicit() ? getDefaultMinify() : undefined);
  if (minifyChoice !== undefined) {
    config.jsonFormat = minifyChoice ? 'minified' : 'pretty';
  }

  // Theme sourcing: --theme <name> pulls a preset from
  // studio/library/themes/<name>.json (discoverable via
  // `scripts/discovery.mjs themes` / `scripts/cli.js theme list`) instead
  // of the hardcoded 3-token/no-typography default. Falls back to the
  // historical inline default when omitted, so `project create` with no
  // flags is byte-identical to before this option existed.
  let styles;
  if (opts.theme) {
    styles = library.themeShow(opts.theme).theme;
  } else {
    styles = {
      colors: DEFAULT_COLORS,
      typography: {},
      spacing: { sceneMargin: 96, gutter: 32 },
    };
  }
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

  return { projectId: id, active: true, manifest, config, styles, themeUsed: opts.theme ?? null, filesWritten: written };
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
  let prevScene = null;
  let prevSceneId = null;
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

    // An id carried from the immediately preceding scene via
    // transitionOut.params.carryAssetId / carryAssetIds (slideContinuity,
    // pivotZoom, ...) is INTENTIONALLY reused - that's the whole mechanism
    // (resolveTransitions.js's buildTransitionBundle matches by id across
    // both scenes to interpolate position/style through the cut). Don't
    // flag those as accidental duplicates; only a same-id reuse the
    // previous scene's transition doesn't declare is still a real
    // ambiguous-CLI-addressing bug.
    const carryParams = prevScene?.transitionOut?.params;
    const carriedIds = new Set([
      ...(typeof carryParams?.carryAssetId === 'string' ? [carryParams.carryAssetId] : []),
      ...(Array.isArray(carryParams?.carryAssetIds) ? carryParams.carryAssetIds : []),
    ]);

    for (const asset of scene.assets || []) {
      if (!asset.id) continue;
      if (seenAssetIds.has(asset.id)) {
        if (seenAssetIds.get(asset.id) === prevSceneId && carriedIds.has(asset.id)) {
          seenAssetIds.set(asset.id, entry.id); // keep tracking through a carry chain
          continue;
        }
        issues.push({
          file: rel(scenePath),
          errors: [
            {
              message: `Duplicate asset id "${asset.id}" also used in scene "${seenAssetIds.get(asset.id)}". Asset ids must be unique across the project for CLI addressing to stay unambiguous (unless the preceding scene's transitionOut.params.carryAssetId/carryAssetIds declares this id as carried).`,
            },
          ],
        });
      } else {
        seenAssetIds.set(asset.id, entry.id);
      }
    }

    prevScene = scene;
    prevSceneId = entry.id;
  }

  return { projectId: id, ok: issues.length === 0, issues };
}

module.exports = { projectCreate, projectSet, projectCurrent, projectValidate };
