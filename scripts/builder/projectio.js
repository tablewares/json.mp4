// src/agent/projectIO.js
//
// Filesystem layer for ProjectBuilder: the path helpers that resolve
// every manifest/config/style/scene file under studio/manifest, plus
// the low-level JSON read/write primitives every mutating ProjectBuilder
// method calls through.
//
// Split out of ProjectBuilder.js so every read-modify-write path in the
// builder goes through one identifiable place. The ProjectBuilder class
// holds a single ProjectIO instance; delegating _readJson / _writeJson
// / _readManifest / _readScene / _writeScene straight through keeps
// every write a real disk write against the same path scripts/render-
// project.mjs consumes (the top-of-file comment in ProjectBuilder.js
// explains why there's never a separate in-memory model that could
// drift from disk).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../..");

// scripts/lib/fsutil.js is CommonJS; ProjectIO is ESM (this file). Bridge
// via createRequire so ProjectIO's writes go through the SAME atomic
// temp-file+rename + minify-aware writer scripts/cli.js's Workspace uses —
// previously this file called fs.writeFileSync directly with a hardcoded
// JSON.stringify(obj, null, 2), which meant every write made through
// ProjectBuilder (discovery.mjs's add-scene/add-asset/update-asset/
// set-transition/inject-effects/etc.) was always pretty-printed and never
// atomic, independent of whatever --minify state cli.js had set. Now both
// CLIs' writes share one code path and one minify default.
const require = createRequire(import.meta.url);
const { writeJSONAtomic, getDefaultMinify } = require("../lib/fsutil.js");

export class ProjectIO {
  constructor({ repoRoot = DEFAULT_REPO_ROOT, minify } = {}) {
    this.repoRoot = repoRoot;
    this.manifestRoot = path.join(repoRoot, "studio/manifest");
    // Per-instance override; falls back to the process-wide default
    // (scripts/lib/fsutil.js's setDefaultMinify(), set from a --minify
    // flag) when omitted, so a caller that never sets it behaves exactly
    // like every other writer in the repo.
    this._minify = minify;
  }

  // -- path helpers ----------------------------------------------------------

  projectDir(projectId) {
    return path.join(this.manifestRoot, projectId);
  }
  manifestPath(projectId) {
    return path.join(this.projectDir(projectId), "manifest.json");
  }
  configPath(projectId) {
    return path.join(this.projectDir(projectId), "config.json");
  }
  stylePath(projectId) {
    return path.join(this.projectDir(projectId), "styles/theme.json");
  }
  scenePath(projectId, sceneId) {
    return path.join(this.projectDir(projectId), "scenes", `${sceneId}.json`);
  }

  // -- low-level IO ------------------------------------------------------------

  readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  writeJson(p, obj) {
    writeJSONAtomic(p, obj, { minify: this._resolveMinify(p) });
  }

  // Same three-tier precedence Workspace._resolveMinify() uses in
  // scripts/lib/workspace.js, kept in sync deliberately: an explicit
  // per-instance `minify` (from discovery.mjs's --minify flag) wins;
  // otherwise fall back to the WRITE TARGET's own project's config.json
  // `jsonFormat` (set at `project create` time) so a project created
  // `--minify` via cli.js stays minified even when later touched through
  // discovery.mjs/ProjectBuilder with no flag; otherwise the process-wide
  // default. Reads config.json directly (not through a cache) since
  // ProjectIO has no read-modify-write session concept the way Workspace
  // does — every call here is already a fresh read of whatever's on disk.
  _resolveMinify(targetPath) {
    if (this._minify !== undefined) return this._minify;
    try {
      const projectId = path.relative(this.manifestRoot, targetPath).split(path.sep)[0];
      if (!projectId) return getDefaultMinify();
      const configPath = this.configPath(projectId);
      if (!fs.existsSync(configPath)) return getDefaultMinify();
      const config = this.readJson(configPath);
      if (config.jsonFormat === "minified") return true;
      if (config.jsonFormat === "pretty") return false;
    } catch {
      // Malformed/missing config, or targetPath isn't under manifestRoot
      // (shouldn't happen for any real caller) — fall through.
    }
    return getDefaultMinify();
  }
  readManifest(projectId) {
    const p = this.manifestPath(projectId);
    if (!fs.existsSync(p)) {
      throw new Error(`No project "${projectId}" (expected ${p}). Call createProject() first.`);
    }
    return this.readJson(p);
  }
  readScene(projectId, sceneId) {
    const p = this.scenePath(projectId, sceneId);
    if (!fs.existsSync(p)) {
      throw new Error(`No scene "${sceneId}" in project "${projectId}" (expected ${p}). Call addScene() first.`);
    }
    return this.readJson(p);
  }
  writeScene(projectId, sceneId, scene) {
    this.writeJson(this.scenePath(projectId, sceneId), scene);
  }
}