'use strict';

const fs = require('fs');
const { CliError } = require('./errors');
const { STATE_FILE, MANIFEST_ROOT } = require('./paths');
const { writeJSONAtomic } = require('./fsutil');
const path = require('path');

function readState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    throw new CliError('MalformedState', `${STATE_FILE} does not contain valid JSON: ${e.message}`);
  }
}

function writeState(state) {
  // Tiny file (just { projectId, ... }), but routed through the same
  // atomic + minify-aware writer as every project file so there's no
  // "one JSON file in the repo that's always pretty and never atomic"
  // exception. Minify has no real size benefit here, but consistency
  // means fsutil.js stays the single place this behavior is decided.
  writeJSONAtomic(STATE_FILE, state);
}

function getProjectId() {
  return readState().projectId || null;
}

function setProjectId(id) {
  const state = readState();
  state.projectId = id;
  writeState(state);
}

// Every command except `project create` / `project set` / `project current`
// needs an active project. This is the single choke point that enforces
// "agent sets a project id once, then every other command works in that
// project."
function requireProjectId() {
  const id = getProjectId();
  if (!id) {
    throw new CliError(
      'NoActiveProject',
      'No active project. Run `project create <projectId>` or `project set <projectId>` first.'
    );
  }
  const dir = path.join(MANIFEST_ROOT, id);
  if (!fs.existsSync(dir)) {
    throw new CliError(
      'ActiveProjectMissing',
      `Active project "${id}" no longer exists on disk at studio/manifest/${id}. Run \`project set <projectId>\` to point at a different project, or \`project create ${id}\` to recreate it.`,
      { projectId: id }
    );
  }
  return id;
}

module.exports = { readState, writeState, getProjectId, setProjectId, requireProjectId };
