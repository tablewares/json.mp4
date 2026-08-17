'use strict';

const path = require('path');

// scripts/lib/paths.js -> repo root is two levels up.
const ROOT = path.resolve(__dirname, '..', '..');

const SCHEMA_DIR = path.join(ROOT, 'src/pipelines/pipeline1-validate/schema');
const MANIFEST_ROOT = path.join(ROOT, 'studio/manifest');
const STATE_FILE = path.join(ROOT, '.agent-cli-state.json');

function rel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

module.exports = { ROOT, SCHEMA_DIR, MANIFEST_ROOT, STATE_FILE, rel };
