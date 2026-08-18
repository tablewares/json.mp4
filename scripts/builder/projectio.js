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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../..");

export class ProjectIO {
  constructor({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
    this.repoRoot = repoRoot;
    this.manifestRoot = path.join(repoRoot, "studio/manifest");
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
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
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