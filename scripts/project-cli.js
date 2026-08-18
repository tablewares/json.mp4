#!/usr/bin/env node
'use strict';

// scripts/project-cli.js
//
// Dedicated CLI for CREATING a new video project — separate from
// scripts/cli.js (mutation: scenes/assets/styles/config on an ALREADY
// created project) and scripts/discovery.mjs (read-only introspection).
// Delegates to the same underlying commands.project.projectCreate as
// `scripts/cli.js project create` (so both stay byte-identical in
// behavior — no duplicated scaffolding logic), then optionally chains
// straight into a render via scripts/render-project.mjs.
//
// Why a separate file instead of just `cli.js project create --render`:
// project creation is a distinct workflow shape (scaffold once, maybe
// render once, then hand off to the mutation-oriented cli.js for the
// actual scene/asset authoring loop) and keeping it its own entry point
// means `cli.js`'s help text stays about mutation, not scaffolding+render
// orchestration. cli.js still keeps `project create`/`set`/`current`/
// `validate` for backward compatibility (see its own printHelp note).
//
// Usage:
//   node scripts/project-cli.js create <projectId> [--width N] [--height N]
//       [--fps N] [--duration N] [--theme <name>] [--minify] [--set-active]
//       [--render [outputMp4]]
//   node scripts/project-cli.js list                          list existing project ids (delegates to discovery)
//   node scripts/project-cli.js render <projectId> [outputMp4] render an existing project (no creation)
//   node scripts/project-cli.js help
//
// Every command prints ONE JSON object to stdout on success (exit 0) or
// stderr on failure (exit 1) — same output contract as cli.js.

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLI_JS = path.join(__dirname, 'cli.js');
const RENDER_MJS = path.join(__dirname, 'render-project.mjs');
const DISCOVERY_MJS = path.join(__dirname, 'discovery.mjs');

function ok(payload) {
  process.stdout.write(JSON.stringify({ ok: true, ...payload }, null, 2) + '\n');
  process.exit(0);
}

function fail(code, message, extra = {}) {
  process.stderr.write(JSON.stringify({ ok: false, error: code, message, ...extra }, null, 2) + '\n');
  process.exit(1);
}

function extractFlags(args, names) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const name = names.find((n) => a === `--${n}`);
    if (name) {
      flags[name] = args[i + 1];
      i++;
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

function extractSwitches(args, names) {
  const switches = {};
  const rest = [];
  for (const a of args) {
    const name = names.find((n) => a === `--${n}`);
    if (name) {
      switches[name] = true;
    } else {
      rest.push(a);
    }
  }
  return { switches, rest };
}

// Runs `node scripts/cli.js <args...>` as a subprocess and returns its
// parsed JSON stdout (throwing the same CliError-shaped payload on
// failure). Subprocess, not a direct require(), so project-cli.js and
// cli.js each keep their own independent process lifetime/exit code —
// mirrors how render-project.mjs is already invoked as a subprocess by
// nothing (it's run directly), and how this file shells to it below.
function runCli(args) {
  const res = spawnSync('node', [CLI_JS, ...args], { cwd: ROOT, encoding: 'utf-8' });
  let payload;
  try {
    payload = JSON.parse((res.status === 0 ? res.stdout : res.stderr) || '{}');
  } catch {
    payload = { ok: false, error: 'InternalError', message: (res.stderr || res.stdout || '').trim() || `cli.js exited ${res.status}` };
  }
  if (res.status !== 0 || payload.ok === false) {
    const err = new Error(payload.message || `cli.js ${args.join(' ')} failed`);
    err.payload = payload;
    throw err;
  }
  return payload;
}

function runDiscovery(args) {
  const res = spawnSync('node', [DISCOVERY_MJS, ...args], { cwd: ROOT, encoding: 'utf-8' });
  if (res.status !== 0) {
    throw new Error(res.stdout?.trim() || `discovery.mjs ${args.join(' ')} failed`);
  }
  return res.stdout;
}

// Runs the full validate -> registry -> resolve -> render pipeline for one
// project by shelling to render-project.mjs (ESM; this file is CommonJS,
// so a subprocess is the simplest boundary rather than a dynamic import()
// dance). Streams child stdout/stderr straight through so render progress
// ([1/4] validate, [2/4] registry, ...) is visible live, not buffered.
function runRender(projectId, outputMp4) {
  const manifestPath = path.join(ROOT, 'studio/manifest', projectId, 'manifest.json');
  const args = [manifestPath];
  if (outputMp4) args.push(outputMp4);
  const res = spawnSync('node', [RENDER_MJS, ...args], { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`render failed (exit ${res.status}) for project "${projectId}"`);
  }
  const resolvedOutput = outputMp4 ? path.resolve(ROOT, outputMp4) : path.join(ROOT, 'out', `${projectId}.mp4`);
  return { rendered: true, output: path.relative(ROOT, resolvedOutput) };
}

function handleCreate(args) {
  const { flags, rest } = extractFlags(args, ['width', 'height', 'fps', 'duration', 'theme', 'render']);
  const { switches, rest: rest2 } = extractSwitches(rest, ['minify', 'set-active']);
  const projectId = rest2[0];
  if (!projectId) fail('BadArguments', 'project-cli create requires a <projectId>.');

  const createArgs = [];
  if (switches.minify) createArgs.push('--minify');
  createArgs.push('project', 'create', projectId);
  for (const k of ['width', 'height', 'fps', 'duration', 'theme']) {
    if (flags[k] !== undefined) createArgs.push(`--${k}`, flags[k]);
  }

  let created;
  try {
    created = runCli(createArgs);
  } catch (e) {
    return fail(e.payload?.error || 'CreateFailed', e.message, e.payload);
  }

  // cli.js's projectCreate() always sets the created project active as a
  // side effect (see scripts/lib/project.js) — that's the historical
  // single-active-project model `cli.js` and `discovery.mjs` both assume.
  // --set-active is accepted here for explicitness/symmetry with a future
  // multi-project workflow, but is currently a no-op beyond what create
  // already does; NOT passing it does not leave the project inactive.
  void switches['set-active'];

  const result = { ...created };

  if (flags.render !== undefined || args.includes('--render')) {
    const outputArgIdx = args.indexOf('--render');
    const explicitOutput = outputArgIdx !== -1 ? args[outputArgIdx + 1] : undefined;
    const outputMp4 = explicitOutput && !explicitOutput.startsWith('--') ? explicitOutput : undefined;
    try {
      result.render = runRender(projectId, outputMp4);
    } catch (e) {
      return fail('RenderFailed', e.message, { projectId });
    }
  }

  return ok(result);
}

function handleList() {
  let stdout;
  try {
    stdout = runDiscovery(['projects']);
  } catch (e) {
    return fail('DiscoveryFailed', e.message);
  }
  const projects = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2));
  return ok({ projects });
}

function handleRender(args) {
  const projectId = args[0];
  if (!projectId) fail('BadArguments', 'project-cli render requires a <projectId>.');
  const outputMp4 = args[1];
  try {
    const result = runRender(projectId, outputMp4);
    return ok({ projectId, ...result });
  } catch (e) {
    return fail('RenderFailed', e.message, { projectId });
  }
}

function printHelp() {
  console.log(`project-cli — dedicated CLI for creating (and optionally rendering) a video project

  create <projectId> [flags]
      --width N --height N --fps N --duration N   config.json overrides (defaults: 1920x1080, 30fps, 150-frame scenes)
      --theme <name>    seed styles/theme.json from studio/library/themes/<name>.json
                        (see \`node scripts/discovery.mjs themes\`); omit for the built-in default
      --minify          write manifest/config/theme files with no whitespace (see cli.js --minify)
      --render [outputMp4]
                        immediately validate -> registry -> resolve -> render after creating
                        (streams render-project.mjs's own progress output live)

  list
      list existing project ids (delegates to \`discovery.mjs projects\`)

  render <projectId> [outputMp4]
      render an EXISTING project (no creation) — same pipeline \`create --render\` chains into

  help

After creation, use \`node scripts/cli.js\` for scene/asset/style authoring
(it auto-activates whatever project this command created — no need to
\`project set\` again), and \`node scripts/discovery.mjs\` for read-only
introspection (asset types, timeline queries, theme/alias library).

Every command prints ONE JSON object to stdout on success (exit 0) or
stderr on failure (exit 1).
`);
  process.exit(0);
}

function main() {
  const argv = process.argv.slice(2);
  const top = argv[0];
  if (!top || top === 'help' || top === '--help' || top === '-h') return printHelp();

  switch (top) {
    case 'create':
      return handleCreate(argv.slice(1));
    case 'list':
      return handleList();
    case 'render':
      return handleRender(argv.slice(1));
    default:
      return fail('UnknownCommand', `Unknown command "${top}".`, { allowed: ['create', 'list', 'render', 'help'] });
  }
}

main();
