'use strict';

const fs = require('fs');
const path = require('path');
const { CliError } = require('./errors');
const { rel } = require('./paths');

// Global default JSON write format for this process. `project-cli.js` /
// `cli.js` set this once from a `--minify` flag before any write happens;
// everything downstream (Workspace.commit -> writeJSONAtomic) picks it up
// without threading an option through every call site. Per-call `minify`
// arguments (if ever passed explicitly) still win over this default.
let _defaultMinify = false;

function setDefaultMinify(minify) {
  _defaultMinify = !!minify;
}

function getDefaultMinify() {
  return _defaultMinify;
}

function readJSON(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new CliError('NotFound', `File not found: ${rel(absPath)}`, { path: rel(absPath) });
  }
  let raw;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    throw new CliError('ReadError', `Could not read ${rel(absPath)}: ${e.message}`, { path: rel(absPath) });
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new CliError('MalformedFile', `${rel(absPath)} does not contain valid JSON: ${e.message}`, {
      path: rel(absPath),
    });
  }
}

// Atomic-ish write: write to a sibling tmp file, then rename over the
// target. Prevents a crash mid-write from leaving a truncated/corrupt
// JSON file on disk.
//
// `minify` (defaults to the process-wide setDefaultMinify() value):
//   false (default) — JSON.stringify(obj, null, 2), human-diffable, the
//     historical on-disk format every existing project uses.
//   true — JSON.stringify(obj) with no whitespace at all. Cuts file size
//     ~30-40% on a typical scene file (no indentation, no newlines between
//     keys) — meaningful when a project is regenerated/read back into an
//     LLM agent's context repeatedly. Still valid JSON `loadStructuredFile()`
//     reads byte-identically either way; nothing downstream cares about
//     whitespace.
function writeJSONAtomic(absPath, obj, opts = {}) {
  const minify = opts.minify !== undefined ? opts.minify : _defaultMinify;
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absPath)}.tmp-${process.pid}-${Date.now()}`);
  const text = (minify ? JSON.stringify(obj) : JSON.stringify(obj, null, 2)) + '\n';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, absPath);
}

module.exports = { readJSON, writeJSONAtomic, setDefaultMinify, getDefaultMinify };
