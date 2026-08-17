'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { CliError } = require('./errors');
const { SCHEMA_DIR } = require('./paths');

let _ajv = null;
let _sceneSchema = null;
const _compiledCache = new Map();

function loadAjv() {
  if (_ajv) return _ajv;

  if (!fs.existsSync(SCHEMA_DIR)) {
    throw new CliError(
      'SchemaDirMissing',
      `Schema directory not found: ${SCHEMA_DIR}. This tool expects to run inside the repo, next to src/pipelines/pipeline1-validate/schema.`
    );
  }

  const files = fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'));
  if (files.length === 0) {
    throw new CliError('SchemaDirEmpty', `No *.schema.json files found in ${SCHEMA_DIR}.`);
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const f of files) {
    const full = path.join(SCHEMA_DIR, f);
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      throw new CliError('SchemaParseError', `Could not parse schema file ${f}: ${e.message}`);
    }
    if (!obj.$id) {
      throw new CliError('SchemaMissingId', `Schema file ${f} has no $id; cannot register it.`);
    }
    ajv.addSchema(obj, obj.$id);
    if (obj.$id === 'scene.schema.json') _sceneSchema = obj;
  }

  if (!_sceneSchema) {
    throw new CliError('SchemaMissing', `scene.schema.json was not found in ${SCHEMA_DIR}.`);
  }

  _ajv = ajv;
  return _ajv;
}

function getSceneSchema() {
  loadAjv();
  return _sceneSchema;
}

// Validate `data` against a $ref pointing into the already-registered
// schema set, e.g. "scene.schema.json#/properties/camera" or
// "scene.schema.json#/properties/assets/items". Everything routes
// through here so validation always reflects the real schema files on
// disk, never a hand-copied duplicate.
function validateRef(ref, data) {
  const ajv = loadAjv();
  let validateFn = _compiledCache.get(ref);
  if (!validateFn) {
    validateFn = ajv.compile({ $ref: ref });
    _compiledCache.set(ref, validateFn);
  }
  const valid = validateFn(data);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors || []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message,
    keyword: e.keyword,
    params: e.params,
  }));
  return { valid: false, errors };
}

// Scene-level fields the CLI is allowed to set with `scene <id> <field> <json>`.
// Sourced from scene.schema.json's own top-level properties (minus id/assets,
// which have their own dedicated commands).
const SCENE_FIELDS = ['narrationRef', 'transitionIn', 'transitionOut', 'effects', 'background', 'camera', 'physics'];

// Asset-level fields the CLI is allowed to set with `asset <id> <field> <json>`.
// Sourced from scene.schema.json's assets[].item properties (minus id/assetType-
// which is included, and anchor, which is included via the "position" alias).
const ASSET_FIELDS = ['anchor', 'assetType', 'contentOverride', 'styleOverride', 'enterAt', 'exitAt', 'z', 'motion', 'physics', 'effects'];

// "position" is the ergonomic name for the schema's "anchor" property.
const ASSET_FIELD_ALIASES = { position: 'anchor' };

function resolveAssetField(name) {
  return ASSET_FIELD_ALIASES[name] || name;
}

function sceneFieldRef(field) {
  return `scene.schema.json#/properties/${field}`;
}

function assetFieldRef(field) {
  return `scene.schema.json#/properties/assets/items/properties/${field}`;
}

module.exports = {
  loadAjv,
  getSceneSchema,
  validateRef,
  SCENE_FIELDS,
  ASSET_FIELDS,
  ASSET_FIELD_ALIASES,
  resolveAssetField,
  sceneFieldRef,
  assetFieldRef,
};
