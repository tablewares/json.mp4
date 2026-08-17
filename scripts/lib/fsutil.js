'use strict';

const fs = require('fs');
const path = require('path');
const { CliError } = require('./errors');
const { rel } = require('./paths');

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
function writeJSONAtomic(absPath, obj) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absPath)}.tmp-${process.pid}-${Date.now()}`);
  const text = JSON.stringify(obj, null, 2) + '\n';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, absPath);
}

module.exports = { readJSON, writeJSONAtomic };
