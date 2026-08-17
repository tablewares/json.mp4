'use strict';

const path = require('path');
const { CliError } = require('./errors');
const { rel } = require('./paths');
const {
  validateRef,
  SCENE_FIELDS,
  ASSET_FIELDS,
  resolveAssetField,
  sceneFieldRef,
  assetFieldRef,
} = require('./schema');

function parseJson(raw, label) {
  if (typeof raw !== 'string') return raw; // already a JS value (batch mode)
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new CliError('InvalidJSON', `Could not parse JSON for "${label}": ${e.message}`, {
      field: label,
      raw,
    });
  }
}

function assertValid(ref, value, label, extra = {}) {
  const { valid, errors } = validateRef(ref, value);
  if (!valid) {
    throw new CliError('ValidationError', `Invalid value for "${label}".`, {
      field: label,
      received: value,
      schemaRef: ref,
      errors,
      ...extra,
    });
  }
}

// ---- scenes ---------------------------------------------------------

function sceneCreate(ws, sceneId, initialJson) {
  if (!sceneId) throw new CliError('BadArguments', 'scene create requires a <sceneId>.');
  if (ws.findSceneEntry(sceneId)) {
    throw new CliError('AlreadyExists', `Scene "${sceneId}" already exists.`, { sceneId });
  }

  const initial = initialJson ? parseJson(initialJson, 'scene') : {};
  if (typeof initial !== 'object' || initial === null || Array.isArray(initial)) {
    throw new CliError('BadArguments', 'Initial scene JSON must be an object.', { received: initial });
  }

  const scene = { ...initial, id: sceneId, assets: initial.assets || [] };
  assertValid('scene.schema.json', scene, 'scene');

  const manifest = ws.getManifest();
  const scenePath = `scenes/${sceneId}.json`;
  manifest.scenes = manifest.scenes || [];
  manifest.scenes.push({ id: sceneId, path: scenePath });
  ws.markDirty(ws.manifestPath());

  const absScenePath = path.join(ws.projectDir, scenePath);
  ws.setNew(absScenePath, scene);

  return { sceneId, scene, file: rel(absScenePath) };
}

function sceneDelete(ws, sceneId) {
  const manifest = ws.getManifest();
  const idx = (manifest.scenes || []).findIndex((s) => s.id === sceneId);
  if (idx === -1) {
    throw new CliError('SceneNotFound', `No scene "${sceneId}" in this project's manifest.`, {
      sceneId,
      knownScenes: ws.listSceneIds(),
    });
  }
  const [removed] = manifest.scenes.splice(idx, 1);
  ws.markDirty(ws.manifestPath());
  // Note: the scene's JSON file itself is left on disk (not deleted) so a
  // batch that fails later can still be aborted with nothing lost; the
  // caller unlinks it only after a successful commit (see commands.js).
  return { sceneId, removedEntry: removed, remainingScenes: manifest.scenes.map((s) => s.id) };
}

function sceneGet(ws, sceneId, field) {
  const scene = ws.getScene(sceneId);
  if (field) {
    if (!(field in scene)) {
      throw new CliError('UnknownField', `Scene "${sceneId}" has no field "${field}".`, {
        sceneId,
        field,
        presentFields: Object.keys(scene),
      });
    }
    return { sceneId, field, value: scene[field] };
  }
  return { sceneId, scene };
}

function sceneSetFields(ws, sceneId, pairs) {
  const scene = ws.getScene(sceneId); // throws SceneNotFound if missing
  const scenePath = ws.getScenePath(sceneId);

  if (pairs.length === 0) {
    throw new CliError('BadArguments', 'Expected at least one <field> <json> pair.');
  }

  const applied = [];
  for (const [field, raw] of pairs) {
    if (!SCENE_FIELDS.includes(field)) {
      throw new CliError('UnknownField', `Unknown scene field "${field}".`, {
        field,
        allowedFields: SCENE_FIELDS,
      });
    }
    const value = parseJson(raw, field);
    assertValid(sceneFieldRef(field), value, field, { sceneId });
    applied.push([field, value]);
  }

  for (const [field, value] of applied) scene[field] = value;

  assertValid('scene.schema.json', scene, 'scene', { sceneId, note: 'combined result failed full scene validation' });

  ws.markDirty(scenePath);
  return { sceneId, changedFields: applied.map(([f]) => f), scene, file: rel(scenePath) };
}

// ---- assets -----------------------------------------------------------

function locateAssetOrThrow(ws, assetId, sceneHint) {
  const matches = ws.locateAsset(assetId, sceneHint);
  if (matches.length === 0) {
    throw new CliError('AssetNotFound', `No asset "${assetId}" found${sceneHint ? ` in scene "${sceneHint}"` : ' in any scene'}.`, {
      assetId,
      scene: sceneHint || null,
      searchedScenes: sceneHint ? [sceneHint] : ws.listSceneIds(),
    });
  }
  if (matches.length > 1) {
    throw new CliError(
      'AmbiguousAsset',
      `Asset id "${assetId}" exists in multiple scenes: ${matches.map((m) => m.sceneId).join(', ')}. Pass --scene to disambiguate.`,
      { assetId, scenes: matches.map((m) => m.sceneId) }
    );
  }
  return matches[0];
}

function assetCreate(ws, sceneId, assetId, json) {
  if (!sceneId || !assetId) {
    throw new CliError('BadArguments', 'asset create requires <sceneId> and <assetId>.');
  }
  const scene = ws.getScene(sceneId); // throws SceneNotFound if missing
  const scenePath = ws.getScenePath(sceneId);

  const existing = ws.locateAsset(assetId);
  if (existing.length > 0) {
    throw new CliError('AlreadyExists', `Asset id "${assetId}" is already used in scene "${existing[0].sceneId}". Asset ids must be unique across the whole project.`, {
      assetId,
      existingScene: existing[0].sceneId,
    });
  }

  const parsed = parseJson(json, 'asset');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError('BadArguments', 'Asset JSON must be an object.', { received: parsed });
  }
  if (parsed.position && !parsed.anchor) {
    parsed.anchor = parsed.position;
    delete parsed.position;
  }
  const asset = { ...parsed, id: assetId };

  assertValid('scene.schema.json#/properties/assets/items', asset, 'asset', { sceneId, assetId });

  scene.assets = scene.assets || [];
  scene.assets.push(asset);
  ws.markDirty(scenePath);

  return { sceneId, assetId, asset, file: rel(scenePath) };
}

function assetDelete(ws, assetId, sceneHint) {
  const { sceneId, index } = locateAssetOrThrow(ws, assetId, sceneHint);
  const scene = ws.getScene(sceneId);
  const scenePath = ws.getScenePath(sceneId);
  const [removed] = scene.assets.splice(index, 1);
  ws.markDirty(scenePath);
  return { sceneId, assetId, removedAsset: removed, file: rel(scenePath) };
}

function assetGet(ws, assetId, sceneHint, field) {
  const { sceneId, index } = locateAssetOrThrow(ws, assetId, sceneHint);
  const scene = ws.getScene(sceneId);
  const asset = scene.assets[index];
  if (field) {
    const resolved = resolveAssetField(field);
    if (!(resolved in asset)) {
      throw new CliError('UnknownField', `Asset "${assetId}" has no field "${field}".`, {
        assetId,
        field,
        presentFields: Object.keys(asset),
      });
    }
    return { sceneId, assetId, field, value: asset[resolved] };
  }
  return { sceneId, assetId, asset };
}

function assetSetFields(ws, assetId, pairs, sceneHint) {
  const { sceneId, index } = locateAssetOrThrow(ws, assetId, sceneHint);
  const scene = ws.getScene(sceneId);
  const scenePath = ws.getScenePath(sceneId);
  const asset = scene.assets[index];

  if (pairs.length === 0) {
    throw new CliError('BadArguments', 'Expected at least one <field> <json> pair.');
  }

  const applied = [];
  for (const [rawField, raw] of pairs) {
    const field = resolveAssetField(rawField);
    if (!ASSET_FIELDS.includes(field)) {
      throw new CliError('UnknownField', `Unknown asset field "${rawField}".`, {
        field: rawField,
        allowedFields: ['position', ...ASSET_FIELDS.filter((f) => f !== 'anchor')],
      });
    }
    const value = parseJson(raw, rawField);
    assertValid(assetFieldRef(field), value, rawField, { assetId, sceneId });
    applied.push([field, value]);
  }

  for (const [field, value] of applied) asset[field] = value;

  assertValid('scene.schema.json#/properties/assets/items', asset, 'asset', {
    assetId,
    sceneId,
    note: 'combined result failed full asset validation',
  });

  ws.markDirty(scenePath);
  return { sceneId, assetId, changedFields: applied.map(([f]) => f), asset, file: rel(scenePath) };
}

// ---- styles / config ----------------------------------------------------

const STYLE_FIELDS = ['colors', 'typography', 'spacing', 'easing', 'textures'];

function stylesSetFields(ws, pairs, replace) {
  const styles = ws.getStyles();
  const stylesPath = ws.getStylesPath();

  if (pairs.length === 0) {
    throw new CliError('BadArguments', 'Expected at least one <field> <json> pair.');
  }

  const applied = [];
  for (const [field, raw] of pairs) {
    if (!STYLE_FIELDS.includes(field)) {
      throw new CliError('UnknownField', `Unknown styles field "${field}".`, { field, allowedFields: STYLE_FIELDS });
    }
    const value = parseJson(raw, field);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new CliError('BadArguments', `styles.${field} must be a JSON object (a set of tokens).`, { field, received: value });
    }
    applied.push([field, value]);
  }

  for (const [field, value] of applied) {
    styles[field] = replace ? value : { ...(styles[field] || {}), ...value };
  }

  assertValid('style.schema.json', styles, 'styles', { note: 'combined result failed full style validation' });

  ws.markDirty(stylesPath);
  return { changedFields: applied.map(([f]) => f), mode: replace ? 'replace' : 'merge', styles, file: rel(stylesPath) };
}

function configSet(ws, json) {
  const config = ws.getConfig();
  const configPath = ws.getConfigPath();
  const parsed = parseJson(json, 'config');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError('BadArguments', 'config must be a JSON object.', { received: parsed });
  }
  const next = { ...config, ...parsed };
  for (const key of ['fps', 'width', 'height', 'defaultSceneDurationInFrames']) {
    if (key in next && typeof next[key] !== 'number') {
      throw new CliError('ValidationError', `config.${key} must be a number.`, { field: key, received: next[key] });
    }
  }
  ws.cache.set(configPath, next);
  ws.markDirty(configPath);
  return { config: next, file: rel(configPath) };
}

module.exports = {
  parseJson,
  assertValid,
  sceneCreate,
  sceneDelete,
  sceneGet,
  sceneSetFields,
  assetCreate,
  assetDelete,
  assetGet,
  assetSetFields,
  locateAssetOrThrow,
  stylesSetFields,
  configSet,
  STYLE_FIELDS,
};
