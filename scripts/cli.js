#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { CliError } = require('./lib/errors');
const commands = require('./lib/commands');
const { runBatch } = require('./lib/batch');
const { setDefaultMinify } = require('./lib/fsutil');

function ok(payload) {
  process.stdout.write(JSON.stringify({ ok: true, ...payload }, null, 2) + '\n');
  process.exit(0);
}

function fail(err) {
  const payload =
    err instanceof CliError
      ? err.toJSON()
      : { ok: false, error: 'InternalError', message: String((err && err.message) || err) };
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(1);
}

// Pulls `--name value` pairs out of an argv array. Returns the flag
// values plus the remaining positional args (order-preserved).
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

// Pulls bare `--name` boolean switches (no value) out of an argv array.
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

function parsePairs(rest) {
  if (rest.length === 0 || rest.length % 2 !== 0) {
    throw new CliError('BadArguments', 'Expected alternating <field> <json> pairs.', { received: rest });
  }
  const pairs = [];
  for (let i = 0; i < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
  return pairs;
}

function handleProject(args) {
  const sub = args[0];
  if (sub === 'create') {
    const { flags, rest } = extractFlags(args.slice(1), ['width', 'height', 'fps', 'duration', 'theme']);
    const projectId = rest[0];
    const opts = {};
    for (const k of ['width', 'height', 'fps', 'duration']) {
      if (flags[k] !== undefined) opts[k] = Number(flags[k]);
    }
    if (flags.theme !== undefined) opts.theme = flags.theme;
    return ok(commands.project.projectCreate(projectId, opts));
  }
  if (sub === 'set') return ok(commands.project.projectSet(args[1]));
  if (sub === 'current') return ok(commands.project.projectCurrent());
  if (sub === 'validate') return ok(commands.project.projectValidate());
  throw new CliError('UnknownCommand', `Unknown "project" subcommand "${sub}".`, {
    allowed: ['create', 'set', 'current', 'validate'],
  });
}

function handleScene(args) {
  const sub = args[0];
  if (sub === 'create') return ok(commands.sceneCreate(args[1], args[2]));
  if (sub === 'delete') return ok(commands.sceneDelete(args[1]));
  if (sub === 'get') return ok(commands.sceneGet(args[1], args[2]));

  const sceneId = args[0];
  if (!sceneId) throw new CliError('BadArguments', 'scene requires a <sceneId>.');
  const pairs = parsePairs(args.slice(1));
  return ok(commands.sceneSetFields(sceneId, pairs));
}

function handleAsset(args) {
  const { flags, rest } = extractFlags(args, ['scene']);
  const sub = rest[0];
  if (sub === 'create') return ok(commands.assetCreate(rest[1], rest[2], rest[3]));
  if (sub === 'delete') return ok(commands.assetDelete(rest[1], flags.scene));
  if (sub === 'get') return ok(commands.assetGet(rest[1], flags.scene, rest[2]));

  const assetId = rest[0];
  if (!assetId) throw new CliError('BadArguments', 'asset requires an <assetId>.');
  const pairs = parsePairs(rest.slice(1));
  return ok(commands.assetSetFields(assetId, pairs, flags.scene));
}

function handleStyles(args) {
  const { flags, rest } = extractFlags(args, []);
  const replaceIdx = rest.indexOf('--replace');
  let replace = false;
  let positional = rest;
  if (replaceIdx !== -1) {
    replace = true;
    positional = rest.filter((_, i) => i !== replaceIdx);
  }
  const pairs = parsePairs(positional);
  return ok(commands.stylesSetFields(pairs, replace));
}

function handleConfig(args) {
  if (!args[0]) throw new CliError('BadArguments', 'config requires a JSON object argument.');
  return ok(commands.configSet(args[0]));
}

function handleTheme(args) {
  const { switches, rest } = extractSwitches(args, ['overwrite', 'replace']);
  const sub = rest[0];
  if (sub === 'list') return ok(commands.theme.list());
  if (sub === 'show') return ok(commands.theme.show(rest[1]));
  if (sub === 'create') return ok(commands.theme.create(rest[1], rest[2], { overwrite: switches.overwrite }));
  if (sub === 'delete') return ok(commands.theme.delete(rest[1]));
  if (sub === 'use') return ok(commands.theme.use(rest[1], switches.replace));
  throw new CliError('UnknownCommand', `Unknown "theme" subcommand "${sub}".`, {
    allowed: ['list', 'show', 'create', 'delete', 'use'],
  });
}

function handleAlias(args) {
  const { switches, rest } = extractSwitches(args, ['overwrite']);
  const sub = rest[0];
  if (sub === 'list') return ok(commands.alias.list(rest[1]));
  if (sub === 'show') return ok(commands.alias.show(rest[1]));
  if (sub === 'create') return ok(commands.alias.create(rest[1], rest[2], rest[3], { overwrite: switches.overwrite }));
  if (sub === 'delete') return ok(commands.alias.delete(rest[1]));
  throw new CliError('UnknownCommand', `Unknown "alias" subcommand "${sub}".`, {
    allowed: ['list', 'show', 'create', 'delete'],
  });
}

function handleManifest(args) {
  const sub = args[0];
  if (sub === 'export') return ok(commands.manifestExport());
  throw new CliError('UnknownCommand', `Unknown "manifest" subcommand "${sub}".`, {
    allowed: ['export'],
  });
}

function handleBatch(args) {
  const { flags, rest } = extractFlags(args, ['file']);
  let raw;
  if (flags.file) {
    if (!fs.existsSync(flags.file)) throw new CliError('NotFound', `Batch file not found: ${flags.file}`);
    raw = fs.readFileSync(flags.file, 'utf8');
  } else if (rest[0] === '-' ) {
    raw = fs.readFileSync(0, 'utf8'); // stdin
  } else if (rest[0]) {
    raw = rest[0];
  } else {
    throw new CliError('BadArguments', 'batch requires a JSON array argument, --file <path>, or "-" to read stdin.');
  }
  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    throw new CliError('InvalidJSON', `Could not parse batch JSON: ${e.message}`);
  }
  return ok(runBatch(items));
}

function printHelp() {
  process.stdout.write(
    `agent-cli — generate/edit a video project manifest (scenes, assets, camera, effects, physics, styles)

Global flags (any position):
  --minify    write every JSON file this invocation touches with no
              whitespace (JSON.stringify(obj), no indent) instead of the
              default pretty-printed 2-space format. Cuts on-disk/regen
              size ~30-40% on typical scene files; still plain valid JSON.
              Affects only files WRITTEN by this invocation — doesn't
              reformat untouched files.

  project create <projectId> [--width N] [--height N] [--fps N] [--duration N] [--theme <name>]
      --theme seeds styles/theme.json from studio/library/themes/<name>.json
              instead of the hardcoded default (see \`theme list\`).
  project set <projectId>
  project current
  project validate

  scene create <sceneId> ['<json>']
  scene delete <sceneId>
  scene get <sceneId> [field]
  scene <sceneId> <field> '<json>' [<field> '<json>' ...]
      fields: narrationRef, transitionIn, transitionOut, effects, background, camera, physics

  asset create <sceneId> <assetId> '<json>'
  asset delete <assetId> [--scene <sceneId>]
  asset get <assetId> [--scene <sceneId>] [field]
  asset <assetId> <field> '<json>' [<field> '<json>' ...] [--scene <sceneId>]
      fields: position (alias for anchor), anchor, assetType, contentOverride, styleOverride,
              enterAt, exitAt, z, motion, physics, effects

  styles <field> '<json>' [<field> '<json>' ...] [--replace]
      fields: colors, typography, spacing, easing, textures  (merged into existing tokens unless --replace)

  config '<json>'
      merges keys into config.json, e.g. '{"fps":60}'

  theme list
      list every named theme preset in studio/library/themes/
  theme show <name>
      full JSON for one theme preset
  theme create <name> ['<json>'] [--overwrite]
      save a new theme preset; omit the JSON to snapshot the ACTIVE
      project's current styles/theme.json
  theme delete <name>
  theme use <name> [--replace]
      merge (default) or replace (--replace) the ACTIVE project's
      styles/theme.json with a saved preset

  alias list [category]
      list every custom alias (studio/library/aliases/*.json), optionally
      filtered by category. Built-in code aliases: \`node scripts/discovery.mjs aliases\`.
  alias show <category.name>
  alias create <category.name> '<expansion-json>' ['<description>'] [--overwrite]
      registers a new "$alias": "<category.name>" usable in any scene JSON
      immediately (resolve.js loads studio/library/aliases/*.json on every run)
  alias delete <category.name>

  manifest export
      dump the ACTIVE project's full manifest+config+styles+scenes tree as
      one JSON object (read-only; combine with --minify for a compact
      single-blob snapshot instead of stitching N file reads)

  batch '<json-array>' | --file <path> | -
      one Workspace, one commit: every command must validate before anything is written.
      item shapes:
        {"type":"scene.create","sceneId":"...","value":{...}}
        {"type":"scene.delete","sceneId":"..."}
        {"type":"scene.setFields","sceneId":"...","fields":{"camera":{...},"effects":[...]}}
        {"type":"asset.create","sceneId":"...","assetId":"...","value":{...}}
        {"type":"asset.delete","assetId":"...","scene":"..."}
        {"type":"asset.setFields","assetId":"...","fields":{"position":{...}},"scene":"..."}
        {"type":"styles.setFields","fields":{"colors":{...}},"replace":false}
        {"type":"config.set","value":{...}}

Every command prints a single JSON object to stdout on success (exit 0) or stderr on failure (exit 1).

Note: project CREATION now has its own dedicated CLI, \`scripts/project-cli.js\`
(scaffold + optional immediate render). This cli.js still owns \`project create\`
for backward compatibility (same underlying commands.project.projectCreate),
but prefer project-cli.js for new scaffolding work — see \`node scripts/project-cli.js help\`.
`
  );
}

function main() {
  const argvRaw = process.argv.slice(2);
  const { switches: globalSwitches, rest: argv } = extractSwitches(argvRaw, ['minify']);
  setDefaultMinify(globalSwitches.minify);

  const top = argv[0];
  if (!top || top === 'help' || top === '--help' || top === '-h') return printHelp();

  switch (top) {
    case 'project':
      return handleProject(argv.slice(1));
    case 'scene':
      return handleScene(argv.slice(1));
    case 'asset':
      return handleAsset(argv.slice(1));
    case 'styles':
      return handleStyles(argv.slice(1));
    case 'config':
      return handleConfig(argv.slice(1));
    case 'theme':
      return handleTheme(argv.slice(1));
    case 'alias':
      return handleAlias(argv.slice(1));
    case 'manifest':
      return handleManifest(argv.slice(1));
    case 'batch':
      return handleBatch(argv.slice(1));
    default:
      throw new CliError('UnknownCommand', `Unknown command "${top}".`, {
        allowed: ['project', 'scene', 'asset', 'styles', 'config', 'theme', 'alias', 'manifest', 'batch', 'help'],
      });
  }
}

try {
  main();
} catch (e) {
  fail(e);
}

