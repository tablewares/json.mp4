'use strict';

const fs = require('fs');
const path = require('path');
const { CliError } = require('./errors');
const { readJSON, writeJSONAtomic } = require('./fsutil');
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
  commit() {
    const written = [];
    for (const absPath of this.dirty) {
      writeJSONAtomic(absPath, this.cache.get(absPath));
      written.push(rel(absPath));
    }
    return written;
  }
}

module.exports = { Workspace };
