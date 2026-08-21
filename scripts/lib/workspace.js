'use strict';

const fs = require('fs');
const path = require('path');
const { CliError } = require('./errors');
const { readJSON, writeJSONAtomic, getDefaultMinify, isMinifyExplicit } = require('./fsutil');
const { MANIFEST_ROOT, rel } = require('./paths');

class Workspace {
  constructor(projectId) {
    this.projectId = projectId;
    this.projectDir = path.join(MANIFEST_ROOT, projectId);
    this.cache = new Map(); // absPath -> parsed JSON (mutated in place)
    this.dirty = new Set(); // absPaths that need writing on commit()
  }

  _load(absPath) {
    if (!this.cache.has(absPath)) {
      this.cache.set(absPath, readJSON(absPath));
    }
    return this.cache.get(absPath);
  }

  // Register a brand-new object (one that doesn't exist on disk yet, e.g.
  // a freshly created scene) directly into the cache and mark it dirty.
  setNew(absPath, obj) {
    this.cache.set(absPath, obj);
    this.dirty.add(absPath);
  }

  markDirty(absPath) {
    this.dirty.add(absPath);
  }

  manifestPath() {
    return path.join(this.projectDir, 'manifest.json');
  }

  getManifest() {
    return this._load(this.manifestPath());
  }

  getConfigPath() {
    return path.join(this.projectDir, this.getManifest().config);
  }

  getConfig() {
    return this._load(this.getConfigPath());
  }

  getStylesPath() {
    return path.join(this.projectDir, this.getManifest().styles);
  }

  getStyles() {
    return this._load(this.getStylesPath());
  }

  findSceneEntry(sceneId) {
    const m = this.getManifest();
    return (m.scenes || []).find((s) => s.id === sceneId);
  }

  listSceneIds() {
    return (this.getManifest().scenes || []).map((s) => s.id);
  }

  getScenePath(sceneId) {
    const entry = this.findSceneEntry(sceneId);
    if (!entry) {
      throw new CliError('SceneNotFound', `No scene "${sceneId}" in this project's manifest.`, {
        sceneId,
        knownScenes: this.listSceneIds(),
      });
    }
    return path.join(this.projectDir, entry.path);
  }

  getScene(sceneId) {
    return this._load(this.getScenePath(sceneId));
  }

  // Search every scene in the manifest for an asset with this id.
  // Returns [{ sceneId, index }, ...] (may be 0, 1, or many entries).
  locateAsset(assetId, sceneHint) {
    const sceneIds = sceneHint ? [sceneHint] : this.listSceneIds();
    const matches = [];
    for (const sceneId of sceneIds) {
      const scene = this.getScene(sceneId);
      const idx = (scene.assets || []).findIndex((a) => a.id === assetId);
      if (idx !== -1) matches.push({ sceneId, index: idx });
    }
    return matches;
  }

  // Writes every dirty file. All-or-nothing in the sense that nothing is
  // written until every operation queued in this workspace has already
  // validated successfully (callers throw before calling commit()).
  //
  // Format precedence per write: this invocation's --minify flag (if
  // explicitly passed) > this project's config.json `jsonFormat` (set at
  // `project create` time, see lib/project.js) > the process-wide default
  // (false / pretty). This makes minify a per-project *setting* instead of
  // something that has to be remembered on every single cli.js call — a
  // project created with `--minify` stays minified across every later
  // `scene`/`asset`/`styles`/`batch` command without repeating the flag,
  // while an existing pretty-printed project is untouched unless asked.
  commit() {
    const written = [];
    const minify = this._resolveMinify();
    for (const absPath of this.dirty) {
      writeJSONAtomic(absPath, this.cache.get(absPath), { minify });
      written.push(rel(absPath));
    }
    return written;
  }

  // Resolves the effective minify setting for this commit. Reads
  // config.json's `jsonFormat` ("minified" | "pretty") without going
  // through the normal dirty-tracking `_load` path issue: config.json may
  // itself be one of the files this same commit is about to write (e.g.
  // `project create`), so this reads straight from cache-or-disk rather
  // than requiring the config to already be loaded.
  _resolveMinify() {
    if (isMinifyExplicit()) return getDefaultMinify();
    try {
      const configPath = this.getConfigPath();
      const config = this.cache.has(configPath) ? this.cache.get(configPath) : readJSON(configPath);
      if (config && config.jsonFormat === 'minified') return true;
      if (config && config.jsonFormat === 'pretty') return false;
    } catch {
      // No manifest/config yet (shouldn't happen mid-commit) or config
      // unreadable — fall through to the process-wide default below.
    }
    return getDefaultMinify();
  }
}

module.exports = { Workspace };
