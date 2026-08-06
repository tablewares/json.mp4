#!/usr/bin/env node
// agent-project-interface.js
//
// Agent-callable CLI over the json.mp4 framework. Three execution modes
// (`create`, `batch`, `render`) plus two discovery modes (`list`, `inspect`)
// that surface the framework's granular, non-hardcoded override surface so
// an agent doesn't have to `ls`/`cat` its way around the repo.
//
// Usage:
//   node scripts/agent-project-interface.js create   <projectDir> [projectId] [--render] [--output <path>]
//   node scripts/agent-project-interface.js batch     <batchFile>  [--render] [--output <path>]
//   node scripts/agent-project-interface.js render   <projectDir> [outputPath]
//   node scripts/agent-project-interface.js list     [kind]            # assets|transitions|themes|configs|projects|all
//   node scripts/agent-project-interface.js inspect  <kind> <name>     # asset <assetType> | theme <projectId> | config <projectId>
//
// `npm run agent:project` (package.json) calls this with no args = help.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = [...argv];
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { help: true };
  }

  const positional = args.filter((arg) => !arg.startsWith('-'));
  const mode = positional[0];
  const target = positional[1];
  const projectId = positional[2];
  const render = args.includes('--render');
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;

  return { help: false, mode, target, projectId, render, outputPath };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeProjectDir(projectDir) {
  return path.resolve(process.cwd(), projectDir);
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Deep merge: for each key, if both sides are plain objects, recurse; else
// `src` wins. Arrays are replaced wholesale (correct for scenes/assets arrays).
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(dst, src) {
  if (!isPlainObject(src)) return src;
  const out = isPlainObject(dst) ? { ...dst } : {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = k in out && isPlainObject(out[k]) && isPlainObject(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

// Locate an asset/graphics folder's manifest.json by assetType name.
const assetRoots = ['studio/assets', 'studio/graphics'];
const transitionRoots = ['studio/transitions'];

function findAssetManifest(assetType) {
  for (const root of assetRoots) {
    const p = path.join(repoRoot, root, assetType, 'manifest.json');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function listAssetTypes() {
  const out = [];
  for (const root of assetRoots) {
    const dir = path.join(repoRoot, root);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (fs.existsSync(path.join(dir, name, 'manifest.json'))) out.push(name);
    }
  }
  return out;
}

function listTransitionTypes() {
  const out = [];
  for (const root of transitionRoots) {
    const dir = path.join(repoRoot, root);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (fs.existsSync(path.join(dir, name, 'manifest.json'))) out.push(name);
    }
  }
  return out;
}

// Enumerate existing project dirs under studio/manifest (one level deep,
// plus the legacy/* second level) that contain a manifest.{json,toon}.
function listProjects() {
  const root = path.join(repoRoot, 'studio', 'manifest');
  const out = [];
  function scan(dir, depth) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const child = path.join(dir, name);
      if (!fs.statSync(child).isDirectory()) continue;
      const hasJson = ['manifest.json', 'manifest.toon'].some((n) => fs.existsSync(path.join(child, n)));
      if (hasJson) {
        out.push(path.relative(root, child));
      } else if (depth === 0 && name === 'legacy') {
        scan(child, 1);
      }
    }
  }
  scan(root, 0);
  return out.sort();
}

function resolveProjectManifestDir(projectIdOrPath) {
  // Accept either a studio/manifest/<x> relative name or a filesystem path.
  const direct = path.resolve(process.cwd(), projectIdOrPath);
  if (fs.existsSync(direct)) return direct;
  const under = path.join(repoRoot, 'studio', 'manifest', projectIdOrPath);
  if (fs.existsSync(under)) return under;
  // legacy/*
  const legacy = path.join(repoRoot, 'studio', 'manifest', 'legacy', projectIdOrPath);
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

// ---------------------------------------------------------------------------
// per-asset override validation (granular, not hardcoded)
// ---------------------------------------------------------------------------
//
// Each asset/graphics folder ships a manifest.json with contentOverrideSchema
// and (optionally) styleOverrideSchema. We validate create-asset overrides
// against those schemas and throw a precise error before the slow render.
// This is the mechanism the framework ALREADY provides for "what can be
// edited per asset type" — the interface just hadn't been wired to it.

const ajv = new Ajv({ allErrors: true, strict: false });

function validateAssetOverrides(assetType, contentOverride, styleOverride) {
  const manifestPath = findAssetManifest(assetType);
  if (!manifestPath) {
    throw new Error(`Unknown assetType "${assetType}". Run \`list assets\` to see available types.`);
  }
  const manifest = readJson(manifestPath);
  const errors = [];
  if (contentOverride && manifest.contentOverrideSchema) {
    const validate = ajv.compile(manifest.contentOverrideSchema);
    if (!validate(contentOverride)) {
      errors.push(...(validate.errors || []).map(formatAjvError));
    }
  }
  if (styleOverride && manifest.styleOverrideSchema) {
    const validate = ajv.compile(manifest.styleOverrideSchema);
    if (!validate(styleOverride)) {
      errors.push(...(validate.errors || []).map(formatAjvError));
    }
  }
  if (errors.length) {
    throw new Error(`Asset "${assetType}" override validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

function formatAjvError(err) {
  const where = err.instancePath || '(root)';
  const extra = err.params && err.params.allowedValues
    ? ` (allowed: ${err.params.allowedValues.join(', ')})`
    : '';
  return `${where}: ${err.message}${extra}`;
}

// ---------------------------------------------------------------------------
// project / scene / asset construction
// ---------------------------------------------------------------------------

function createProject({ projectId, projectDir, config = {}, theme = {}, cloneThemeFrom, cloneConfigFrom }) {
  const resolvedDir = normalizeProjectDir(projectDir);
  const stylesDir = path.join(resolvedDir, 'styles');
  const scenesDir = path.join(resolvedDir, 'scenes');
  ensureDir(stylesDir);
  ensureDir(scenesDir);

  const defaultConfig = {
    fps: 30,
    width: 1920,
    height: 1080,
    defaultSceneDurationInFrames: 150,
  };

  const defaultTheme = {
    colors: {
      shade1: '#0B0E14',
      shade2: '#161B26',
      main1: '#F5F7FA',
      main2: '#8B93A7',
      accentBg: '#3D7BFD',
      transparent: '#00000000',
    },
    typography: {
      heading1: { fontFamily: 'Inter, sans-serif', fontSize: 72, fontWeight: 700, lineHeight: 1.1, colorToken: 'main1' },
      body1: { fontFamily: 'Inter, sans-serif', fontSize: 34, fontWeight: 400, lineHeight: 1.4, colorToken: 'main1' },
      caption1: { fontFamily: 'Inter, sans-serif', fontSize: 28, fontWeight: 600, lineHeight: 1.2, colorToken: 'main1' },
    },
    spacing: { sceneMargin: 96, gutter: 32 },
    easing: {
      gentleSpring: { damping: 16, mass: 0.7, stiffness: 110 },
      snappySpring: { damping: 12, mass: 0.4, stiffness: 180 },
    },
  };

  // Reuse: start from an existing finished look if requested. Deep-merge the
  // caller's partial `theme`/`config` over the cloned baseline so granular
  // edits (e.g. just bumping heading1.fontSize) don't drop sibling keys.
  let baseConfig = defaultConfig;
  let baseTheme = defaultTheme;

  if (cloneConfigFrom) {
    const cloned = readProjectConfig(cloneConfigFrom);
    if (cloned) baseConfig = cloned;
    else throw new Error(`cloneConfigFrom: no config found for "${cloneConfigFrom}"`);
  }
  if (cloneThemeFrom) {
    const cloned = readProjectTheme(cloneThemeFrom);
    if (cloned) baseTheme = cloned;
    else throw new Error(`cloneThemeFrom: no theme found for "${cloneThemeFrom}"`);
  }

  const mergedConfig = deepMerge(baseConfig, config);
  const mergedTheme = deepMerge(baseTheme, theme);

  writeJson(path.join(resolvedDir, 'config.json'), mergedConfig);
  writeJson(path.join(stylesDir, 'theme.json'), mergedTheme);

  const manifest = {
    projectId,
    config: 'config.json',
    styles: 'styles/theme.json',
    scenes: [
      { id: 'scene-default', path: 'scenes/scene-default.json' },
    ],
  };
  writeJson(path.join(resolvedDir, 'manifest.json'), manifest);
  writeJson(path.join(scenesDir, 'scene-default.json'), {
    id: 'scene-default',
    narrationRef: 'n1',
    background: 'shade1',
    assets: [],
  });
  return { resolvedDir, manifestPath: path.join(resolvedDir, 'manifest.json') };
}

function readProjectTheme(projectIdOrPath) {
  const dir = resolveProjectManifestDir(projectIdOrPath);
  if (!dir) return null;
  for (const rel of ['styles/theme.json', 'styles/theme.toon']) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) return readJson(p);
  }
  return null;
}

function readProjectConfig(projectIdOrPath) {
  const dir = resolveProjectManifestDir(projectIdOrPath);
  if (!dir) return null;
  const p = path.join(dir, 'config.json');
  return fs.existsSync(p) ? readJson(p) : null;
}

function updateManifest(projectDir, sceneId, scenePath) {
  const resolvedDir = normalizeProjectDir(projectDir);
  const manifestPath = path.join(resolvedDir, 'manifest.json');
  const manifest = readJson(manifestPath) || { projectId: path.basename(resolvedDir), config: 'config.json', styles: 'styles/theme.json', scenes: [] };
  const existingScene = manifest.scenes.find((scene) => scene.id === sceneId);
  if (!existingScene) {
    manifest.scenes.push({ id: sceneId, path: scenePath });
  } else {
    existingScene.path = scenePath;
  }
  writeJson(manifestPath, manifest);
}

function createScene({ projectDir, sceneId, scene = {} }) {
  const resolvedDir = normalizeProjectDir(projectDir);
  const scenePath = path.join(resolvedDir, 'scenes', `${sceneId}.json`);
  ensureDir(path.dirname(scenePath));

  // Deep-merge over an existing scene if present (lets a batch update just
  // `background` or `transitionOut` without restating all assets).
  const existing = readJson(scenePath) || {};
  const scenePayload = deepMerge(existing, {
    id: sceneId,
    narrationRef: scene.narrationRef ?? 'n1',
    background: scene.background ?? 'shade1',
    transitionOut: scene.transitionOut,
    assets: scene.assets,
  });
  // deepMerge above would replace assets[] with undefined if scene.assets
  // was omitted; restore from existing when the caller didn't supply one.
  if (scene.assets === undefined) delete scenePayload.assets;
  if (scenePayload.assets === undefined) scenePayload.assets = existing.assets || [];
  if (scenePayload.transitionOut === undefined) delete scenePayload.transitionOut;

  writeJson(scenePath, scenePayload);
  updateManifest(resolvedDir, sceneId, path.relative(resolvedDir, scenePath).replace(/\\/g, '/'));
  return scenePath;
}

function createAsset({ projectDir, sceneId, asset, validate = true }) {
  const resolvedDir = normalizeProjectDir(projectDir);
  const scenePath = path.join(resolvedDir, 'scenes', `${sceneId}.json`);
  if (!fs.existsSync(scenePath)) {
    throw new Error(`Scene ${sceneId} does not exist at ${scenePath}`);
  }
  if (!asset || !asset.assetType || !asset.id) {
    throw new Error(`create-asset needs { id, assetType } on \`asset\` (got: ${JSON.stringify(asset)})`);
  }
  if (!asset.anchor || !asset.anchor.position) {
    throw new Error(`Asset ${asset.id}: anchor.position is required (one of center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right).`);
  }

  if (validate !== false) {
    validateAssetOverrides(asset.assetType, asset.contentOverride, asset.styleOverride);
  }

  const scene = readJson(scenePath);
  const existingAsset = scene.assets.find((entry) => entry.id === asset.id);
  if (existingAsset) {
    Object.assign(existingAsset, asset);
  } else {
    scene.assets.push(asset);
  }
  writeJson(scenePath, scene);
  return scenePath;
}

// Heuristic scene builder. Hardcoded to {TextBlock, TickerTape, BarChartRace}
// by design — it's a *shortcut* for the common finance-update shape, NOT the
// only path. For any other asset type (NumberStat, CodeBlock, ListReveal,
// KineticText, ImageReveal, SignalBloom) use `create-scene` + `create-asset`
// and consult `list assets` for each type's override schema.
function createSceneFromPrompt({ projectDir, sceneId, prompt }) {
  const resolvedDir = normalizeProjectDir(projectDir);
  const scenePath = path.join(resolvedDir, 'scenes', `${sceneId}.json`);
  const lowerPrompt = (prompt || '').toLowerCase();

  const assets = [];
  const titleText = /title[:\s]+([^\n.]+)/i.exec(prompt)?.[1]?.trim() || 'Markets this quarter';
  const subtitleText = /subtitle[:\s]+([^\n.]+)/i.exec(prompt)?.[1]?.trim() || 'Revenue lines and tape of the week.';

  assets.push({
    id: 'title', assetType: 'TextBlock',
    anchor: { position: 'top-left', offsetXPercent: 6, offsetYPercent: 6 },
    contentOverride: { text: titleText },
    styleOverride: { typography: 'heading1', align: 'left' },
    enterAt: 0, exitAt: 0.95,
  });
  assets.push({
    id: 'subhead', assetType: 'TextBlock',
    anchor: { position: 'top-left', offsetXPercent: 6, offsetYPercent: 13 },
    contentOverride: { text: subtitleText },
    styleOverride: { typography: 'caption1', align: 'left' },
    enterAt: 0.03, exitAt: 0.95,
  });

  if (lowerPrompt.includes('ticker') || lowerPrompt.includes('stock')) {
    assets.push({
      id: 'ticker', assetType: 'TickerTape',
      anchor: { position: 'center', offsetXPercent: 0, offsetYPercent: -14 },
      contentOverride: {
        tickers: [
          { symbol: 'AAPL', price: 224.31, change: 1.42 },
          { symbol: 'MSFT', price: 421.07, change: -0.86 },
          { symbol: 'NVDA', price: 138.25, change: 6.17 },
        ],
      },
      styleOverride: { typography: 'caption1', width: 1500, trackHeight: 84, scrollPxPerSec: 110, borderLine: '#2A3142' },
      enterAt: 0.05, exitAt: 1,
    });
  }
  if (lowerPrompt.includes('bar') || lowerPrompt.includes('chart') || lowerPrompt.includes('revenue')) {
    assets.push({
      id: 'bars', assetType: 'BarChartRace',
      anchor: { position: 'bottom', offsetXPercent: 0, offsetYPercent: 6 },
      contentOverride: {
        bars: [
          { label: 'Cloud', value: 19000000000, fillStyle: '#3D7BFD' },
          { label: 'Search', value: 88000000000, fillStyle: '#16C784' },
          { label: 'Retail', value: 157000000000, fillStyle: '#F5A623' },
        ],
      },
      styleOverride: { typography: 'caption1', width: 1400, height: 560, valueFormat: 'compact', sortByValue: 'desc', staggerFrames: 8 },
      enterAt: 0.08, exitAt: 1,
    });
  }

  const scenePayload = { id: sceneId, narrationRef: 'n1', background: 'shade1', assets };
  writeJson(scenePath, scenePayload);
  updateManifest(resolvedDir, sceneId, path.relative(resolvedDir, scenePath).replace(/\\/g, '/'));
  return scenePath;
}

// ---------------------------------------------------------------------------
// batch
// ---------------------------------------------------------------------------

function applyBatch(batch) {
  const results = [];
  for (const item of batch) {
    if (item.op === 'create-project') {
      const result = createProject(item);
      results.push({ op: item.op, projectDir: result.resolvedDir, manifestPath: result.manifestPath });
      continue;
    }
    if (item.op === 'create-scene') {
      const scenePath = createScene(item);
      results.push({ op: item.op, scenePath });
      continue;
    }
    if (item.op === 'create-asset') {
      const scenePath = createAsset(item);
      results.push({ op: item.op, scenePath });
      continue;
    }
    if (item.op === 'create-scene-from-prompt') {
      const scenePath = createSceneFromPrompt(item);
      results.push({ op: item.op, scenePath });
      continue;
    }
    if (item.op === 'clone-theme' || item.op === 'clone-config') {
      // no-op stub ops: handled inside create-project via cloneThemeFrom /
      // cloneConfigFrom. Accept silently so a batch that includes them for
      // documentation purposes doesn't fail.
      results.push({ op: item.op, scenePath: null });
      continue;
    }
    throw new Error(`Unsupported operation: ${item.op}`);
  }
  return results;
}

// ---------------------------------------------------------------------------
// render (delegates to scripts/render-project.mjs)
// ---------------------------------------------------------------------------

function renderProject(projectDir, outputPath) {
  const resolvedDir = normalizeProjectDir(projectDir);
  const manifestPath = path.join(resolvedDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found for render target: ${manifestPath}`);
  }
  const renderScript = path.join(repoRoot, 'scripts', 'render-project.mjs');
  const output = outputPath ? path.resolve(process.cwd(), outputPath) : path.join(repoRoot, 'out', `${path.basename(resolvedDir)}.mp4`);
  const result = spawnSync(process.execPath, [renderScript, manifestPath, output], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Rendering failed with exit code ${result.status}`);
  }
  return { outputPath: output };
}

// ---------------------------------------------------------------------------
// discovery: `list` and `inspect`
// ---------------------------------------------------------------------------

function cmdList(kind) {
  kind = (kind || 'all').toLowerCase();
  const sections = [];

  if (kind === 'all' || kind === 'assets') {
    sections.push({ title: 'ASSET TYPES (assetType values)', body: listAssetsBlock() });
  }
  if (kind === 'all' || kind === 'transitions') {
    sections.push({ title: 'TRANSITION TYPES (transitionOut.type values)', body: listTransitionsBlock() });
  }
  if (kind === 'all' || kind === 'themes') {
    sections.push({ title: 'EXISTING THEMES (cloneThemeFrom values)', body: listThemesBlock() });
  }
  if (kind === 'all' || kind === 'configs') {
    sections.push({ title: 'EXISTING CONFIGS (cloneConfigFrom values)', body: listConfigsBlock() });
  }
  if (kind === 'all' || kind === 'projects') {
    sections.push({ title: 'EXISTING PROJECTS (render <projectDir>)', body: listProjectsBlock() });
  }

  if (sections.length === 0) {
    console.error(`Unknown list kind "${kind}". Try: assets | transitions | themes | configs | projects | all`);
    process.exit(1);
  }
  for (const s of sections) {
    console.log(`\n=== ${s.title} ===\n${s.body}`);
  }
}

function listAssetsBlock() {
  const lines = [];
  for (const name of listAssetTypes()) {
    const m = readJson(findAssetManifest(name));
    const contentReq = m?.contentOverrideSchema?.required?.join(',') || '';
    const styleKeys = m?.styleOverrideSchema?.properties ? Object.keys(m.styleOverrideSchema.properties) : [];
    lines.push(`- ${name}`);
    if (m?.description) lines.push(`    ${m.description}`);
    if (contentReq) lines.push(`    contentOverride required: ${contentReq}`);
    if (styleKeys.length) lines.push(`    styleOverride keys: ${styleKeys.join(', ')}`);
    lines.push(`    (full schema: \`inspect asset ${name}\`)`);
  }
  return lines.join('\n');
}

function listTransitionsBlock() {
  const lines = [];
  for (const name of listTransitionTypes()) {
    const p = path.join(repoRoot, 'studio/transitions', name, 'manifest.json');
    const m = readJson(p);
    lines.push(`- ${name} (default ${m?.defaultDurationInFrames ?? '?'} frames)`);
    if (m?.description) lines.push(`    ${m.description}`);
    if (m?.params) lines.push(`    params: ${Object.keys(m.params).join(', ')}`);
  }
  return lines.join('\n');
}

function listThemesBlock() {
  const lines = [];
  for (const proj of listProjects()) {
    const dir = path.join(repoRoot, 'studio', 'manifest', proj);
    const themeP = ['styles/theme.json', 'styles/theme.toon'].map((r) => path.join(dir, r)).find((p) => fs.existsSync(p));
    if (!themeP) continue;
    const m = readJson(themeP);
    const colors = m?.colors ? Object.keys(m.colors).join(', ') : '?';
    const typos = m?.typography ? Object.keys(m.typography).join(', ') : '?';
    const easings = m?.easing ? Object.keys(m.easing).join(', ') : '(none)';
    lines.push(`- ${proj}`);
    lines.push(`    colors: ${colors}`);
    lines.push(`    typography: ${typos}`);
    lines.push(`    easing: ${easings}`);
    lines.push(`    (full theme: \`inspect theme ${proj}\`)`);
  }
  return lines.join('\n') || '(none)';
}

function listConfigsBlock() {
  const lines = [];
  for (const proj of listProjects()) {
    const cfg = readProjectConfig(proj);
    if (!cfg) continue;
    lines.push(`- ${proj}: ${cfg.width ?? '?'}x${cfg.height ?? '?'} @ ${cfg.fps ?? '?'}fps, default ${cfg.defaultSceneDurationInFrames ?? '?'}f`);
  }
  return lines.join('\n') || '(none)';
}

function listProjectsBlock() {
  return listProjects().map((p) => `- ${p}`).join('\n') || '(none)';
}

function cmdInspect(kind, name) {
  kind = (kind || '').toLowerCase();
  if (!name) {
    console.error('inspect needs a name. Examples: `inspect asset NumberStat` | `inspect theme render-demo-toon` | `inspect config fed-2026`');
    process.exit(1);
  }
  if (kind === 'asset') {
    const p = findAssetManifest(name);
    if (!p) { console.error(`Unknown assetType "${name}". Run \`list assets\`.`); process.exit(1); }
    console.log(`# ${name} asset manifest\n${fs.readFileSync(p, 'utf8')}`);
    return;
  }
  if (kind === 'theme') {
    const dir = resolveProjectManifestDir(name);
    if (!dir) { console.error(`No project "${name}". Run \`list themes\`.`); process.exit(1); }
    const themeP = ['styles/theme.json', 'styles/theme.toon'].map((r) => path.join(dir, r)).find((p) => fs.existsSync(p));
    if (!themeP) { console.error(`No theme file in ${dir}.`); process.exit(1); }
    console.log(`# ${name} theme\n${fs.readFileSync(themeP, 'utf8')}`);
    return;
  }
  if (kind === 'config') {
    const cfg = readProjectConfig(name);
    if (!cfg) { console.error(`No config for "${name}". Run \`list configs\`.`); process.exit(1); }
    console.log(`# ${name} config\n${JSON.stringify(cfg, null, 2)}`);
    return;
  }
  console.error(`Unknown inspect kind "${kind}". Use asset | theme | config.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// help
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`agent-project-interface — agent CLI over the json.mp4 framework

USAGE
  node scripts/agent-project-interface.js create   <projectDir> [projectId] [--render] [--output <path>]
  node scripts/agent-project-interface.js batch     <batchFile>  [--render] [--output <path>]
  node scripts/agent-project-interface.js render   <projectDir> [outputPath]
  node scripts/agent-project-interface.js list     [assets|transitions|themes|configs|projects|all]
  node scripts/agent-project-interface.js inspect  <asset|theme|config> <name>

DISCOVERY (new — the framework's override surface is granular, not hardcoded)
  list assets        # every assetType + its content/style override keys
  inspect asset N    # full JSON Schema for \`\`N\`\`'s contentOverride + styleOverride
  list themes        # every existing finished look in the repo
  inspect theme P     # full theme.json/toon for project P
  list configs       # every existing config (fps/size/duration)
  inspect config P    # full config.json for project P

REUSE (new — view and select previously-made styles/configs)
  In create-project, pass cloneThemeFrom / cloneConfigFrom pointing at any
  project name from \`list themes\` / \`list configs\`:
    { "op": "create-project", "projectDir": "./studio/manifest/new",
      "projectId": "new",
      "cloneThemeFrom": "render-demo-toon",
      "cloneConfigFrom": "fed-2026",
      "theme": { "typography": { "heading1": { "fontSize": 96 } } }   // deep-merged
    }

GRANULAR EDITS (new — deep-merge, not replace)
  Partial theme/config/scene objects are deep-merged over the baseline (or
  the cloned baseline), so a single nested key edit never drops its siblings.

PER-ASSET VALIDATION (new — granular, not hardcoded)
  create-asset now validates contentOverride/styleOverride against that
  assetType's own manifest.json contentOverrideSchema/styleOverrideSchema,
  catching typos BEFORE the ~slow render. Set { "validate": false } on the
  op to skip (e.g. for assets whose schema you're intentionally extending).

EXAMPLES
  node scripts/agent-project-interface.js list assets
  node scripts/agent-project-interface.js inspect asset NumberStat
  node scripts/agent-project-interface.js create ./studio/manifest/demo demo --render --output ./out/demo.mp4
  node scripts/agent-project-interface.js batch ./requests.json --render
  node scripts/agent-project-interface.js render ./studio/manifest/legacy/finance-project ./out/demo.mp4

BATCH FORMAT (JSON array, executed in order)
  [
    { "op": "create-project", "projectId": "demo", "projectDir": "./studio/manifest/demo",
      "config": { "defaultSceneDurationInFrames": 210 },
      "theme": { "colors": { "accentWarm": "#FFD166" } },
      "cloneThemeFrom": "render-demo-toon" },
    { "op": "create-scene", "projectDir": "./studio/manifest/demo", "sceneId": "scene-open",
      "scene": { "assets": [] } },
    { "op": "create-asset", "projectDir": "./studio/manifest/demo", "sceneId": "scene-open",
      "asset": { "id": "kpi", "assetType": "NumberStat",
        "anchor": { "position": "center" },
        "contentOverride": { "value": 1250000, "label": "users", "fromValue": 0 },
        "styleOverride": { "valueFormat": "compact", "prefix": "$", "decimals": 1 },
        "enterAt": 0.05, "exitAt": 0.95 } },
    { "op": "create-scene-from-prompt", "projectDir": "./studio/manifest/demo",
      "sceneId": "scene-brief", "prompt": "Title: Markets this week. Subtitle: Tape and revenue lines. Ticker. Bar chart: Cloud Search Retail." }
  ]
`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const { help, mode, target, projectId, render, outputPath: outputPathParsed } = parseArgs(process.argv.slice(2));
  if (help) { printHelp(); return; }

  if (mode === 'list') { cmdList(target); return; }
  if (mode === 'inspect') { cmdInspect(target, projectId); return; }

  if (mode === 'create') {
    const projectDir = target || path.join(repoRoot, 'studio', 'manifest', 'generated-project');
    const resolvedProjectId = projectId || path.basename(projectDir);
    const project = createProject({ projectId: resolvedProjectId, projectDir });
    console.log(JSON.stringify({ ok: true, projectDir: project.resolvedDir, manifestPath: project.manifestPath }, null, 2));
    if (render) {
      const result = renderProject(projectDir, outputPathParsed);
      console.log(JSON.stringify({ ok: true, render: result }, null, 2));
    }
    return;
  }

  if (mode === 'batch') {
    if (!target) throw new Error('A batch file path is required');
    const batchFile = path.resolve(process.cwd(), target);
    if (!fs.existsSync(batchFile)) throw new Error(`Batch file not found: ${batchFile}`);
    const batch = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
    const results = applyBatch(batch);
    console.log(JSON.stringify({ ok: true, results }, null, 2));
    if (render) {
      // Render every distinct project created in this batch, not just the first.
      const projectDirs = results.filter((r) => r.projectDir).map((r) => r.projectDir);
      const unique = [...new Set(projectDirs)];
      if (unique.length === 0) {
        throw new Error('Batch --render requested but no create-project op ran; nothing to render.');
      }
      for (const dir of unique) {
        const renderResult = renderProject(dir, outputPathParsed);
        console.log(JSON.stringify({ ok: true, render: renderResult, projectDir: dir }, null, 2));
      }
    }
    return;
  }

  if (mode === 'render') {
    if (!target) throw new Error('A project directory is required');
    const outputPath = outputPathParsed ?? projectId ?? null;
    const result = renderProject(target, outputPath);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  printHelp();
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
