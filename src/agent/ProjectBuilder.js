// src/agent/ProjectBuilder.js
//
// Programmatic, file-system-owning interface for an agent to build and
// render a project without ever opening a manifest/scene/style file by
// hand. The agent supplies minimal JSON (an id, an assetType, the content
// it actually cares about); this module fills in every structural default
// (config, theme, anchor, enterAt/exitAt, scenes[] wiring in manifest.json)
// and writes valid files that pipeline1's validateProject() already knows
// how to read — JSON, not TOON, since it's trivial to generate correctly
// and loadStructuredFile() in pipeline1-validate/validate.js accepts both.
//
// Every write is also a read-modify-write against the SAME files
// scripts/render-project.mjs consumes, so `render()` at the end is always
// working off exactly what the agent asked for — no separate in-memory
// model that could drift from disk.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Ajv from "ajv";
import addFormats from "ajv-formats";

import { loadAssetRegistry, loadTransitionRegistry } from "../registry/assetRegistry.js";
import { validateProject } from "../pipelines/pipeline1-validate/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Sensible defaults — an agent only overrides what it cares about. Colors,
// typography, spacing, easing are merged key-by-key (mergeTheme), so e.g.
// passing colors: { accentBg: "#FF0000" } keeps every other token intact.
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  fps: 30,
  width: 1920,
  height: 1080,
  defaultSceneDurationInFrames: 150,
};

export const DEFAULT_THEME = {
  colors: {
    shade1: "#0B0E14",
    shade2: "#161B26",
    main1: "#F5F7FA",
    main2: "#8B93A7",
    accentBg: "#3D7BFD",
    accentGreen: "#16C784",
    accentRed: "#EA3943",
    accentViolet: "#C04CFD",
    accentWarm: "#FFD166",
    transparent: "#00000000",
  },
  typography: {
    heading1: { fontFamily: "Inter, sans-serif", fontSize: 84, fontWeight: 800, lineHeight: 1.05, colorToken: "main1" },
    heading2: { fontFamily: "Inter, sans-serif", fontSize: 56, fontWeight: 700, lineHeight: 1.1, colorToken: "main1" },
    body1: { fontFamily: "Inter, sans-serif", fontSize: 36, fontWeight: 400, lineHeight: 1.35, colorToken: "main1" },
    caption1: { fontFamily: "Inter, sans-serif", fontSize: 28, fontWeight: 600, lineHeight: 1.2, colorToken: "main2" },
    kicker1: { fontFamily: "Inter, sans-serif", fontSize: 24, fontWeight: 700, lineHeight: 1.1, colorToken: "accentBg" },
  },
  spacing: { sceneMargin: 96, gutter: 32 },
  easing: {
    gentleSpring: { damping: 16, mass: 0.7, stiffness: 110 },
    snappySpring: { damping: 12, mass: 0.4, stiffness: 180 },
  },
};

function mergeTheme(base, overrides = {}) {
  const merged = {
    colors: { ...base.colors },
    typography: { ...base.typography },
    spacing: { ...base.spacing },
    easing: { ...base.easing },
  };
  for (const category of ["colors", "typography", "spacing", "easing"]) {
    if (overrides[category]) Object.assign(merged[category], overrides[category]);
  }
  return merged;
}

function checkAgainstSchema(schema, value) {
  if (!schema) return [];
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateFn = ajv.compile(schema);
  if (validateFn(value)) return [];
  return validateFn.errors.map((e) => `${e.instancePath || "(root)"} ${e.message}`);
}

// Backfills `durationInFrames` from the transition registry's
// `defaultDurationInFrames` when the agent omits it — so a
// `{"type":"default"}`-style spec produces a `{"type":"default", ...
// "durationInFrames":18}` on disk that matches what the renderer will
// actually play. Without this, resolve.js's scene-padding computation
// (resolve.js:211-213) reads `scene.transitionOut?.durationInFrames ?? 0`,
// gets 0, and the scene runs back-to-back with no pad — but the
// transition-overlay itself still plays for the registry default 18
// frames, silently eating the next scene's first 18 frames for the cut.
function normalizeTransitionOut(spec, registry) {
  const reg = registry ?? loadTransitionRegistry();
  const type = spec?.type;
  const entry = reg[type];
  if (!entry) {
    throw new Error(`Unknown transitionType "${type}". Available: ${Object.keys(reg).join(", ")}`);
  }
  const out = { ...spec };
  if (out.durationInFrames === undefined) {
    const def = entry.manifest?.defaultDurationInFrames;
    if (typeof def === "number" && def > 0) out.durationInFrames = def;
  }
  return out;
}

export class ProjectBuilder {
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

  _readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  _writeJson(p, obj) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
  }
  _readManifest(projectId) {
    const p = this.manifestPath(projectId);
    if (!fs.existsSync(p)) {
      throw new Error(`No project "${projectId}" (expected ${p}). Call createProject() first.`);
    }
    return this._readJson(p);
  }
  _readScene(projectId, sceneId) {
    const p = this.scenePath(projectId, sceneId);
    if (!fs.existsSync(p)) {
      throw new Error(`No scene "${sceneId}" in project "${projectId}" (expected ${p}). Call addScene() first.`);
    }
    return this._readJson(p);
  }
  _writeScene(projectId, sceneId, scene) {
    this._writeJson(this.scenePath(projectId, sceneId), scene);
  }

  // -- project lifecycle ------------------------------------------------------

  listProjects() {
    if (!fs.existsSync(this.manifestRoot)) return [];
    return fs
      .readdirSync(this.manifestRoot)
      .filter((name) => fs.existsSync(path.join(this.manifestRoot, name, "manifest.json")));
  }

  /**
   * Creates a project on disk: config.json, styles/theme.json, manifest.json
   * (scenes: []). Only projectId is required — everything else defaults.
   *
   * @param {{
   *   projectId: string,
   *   fps?: number, width?: number, height?: number,
   *   defaultSceneDurationInFrames?: number, ttsProvider?: string,
   *   colors?: object, typography?: object, spacing?: object, easing?: object,
   *   narration?: { entries?: {id,text}[], fullTranscript?: string },
   *   overwrite?: boolean,
   * }} spec
   */
  createProject(spec) {
    const { projectId, overwrite = false } = spec;
    if (!projectId) throw new Error("createProject requires projectId");
    if (!overwrite && fs.existsSync(this.projectDir(projectId))) {
      throw new Error(`Project "${projectId}" already exists at ${this.projectDir(projectId)}. Pass overwrite: true to replace it.`);
    }

    const config = {
      fps: spec.fps ?? DEFAULT_CONFIG.fps,
      width: spec.width ?? DEFAULT_CONFIG.width,
      height: spec.height ?? DEFAULT_CONFIG.height,
      defaultSceneDurationInFrames: spec.defaultSceneDurationInFrames ?? DEFAULT_CONFIG.defaultSceneDurationInFrames,
      ...(spec.ttsProvider ? { ttsProvider: spec.ttsProvider } : {}),
    };
    const styles = mergeTheme(DEFAULT_THEME, {
      colors: spec.colors,
      typography: spec.typography,
      spacing: spec.spacing,
      easing: spec.easing,
    });
    const manifest = {
      projectId,
      config: "config.json",
      styles: "styles/theme.json",
      scenes: [],
    };
    if (spec.narration) {
      manifest.narration = {
        entries: spec.narration.entries ?? [],
        fullTranscript: spec.narration.fullTranscript ?? "",
      };
    }

    this._writeJson(this.configPath(projectId), config);
    this._writeJson(this.stylePath(projectId), styles);
    this._writeJson(this.manifestPath(projectId), manifest);
    return manifest;
  }
  addMusic(projectId, entry = {}) {
    const manifest = this._readManifest(projectId);
    if (!Array.isArray(manifest.music)) manifest.music = [];

    const musicEntry = { ...entry };
    if (!musicEntry.path && musicEntry.src) musicEntry.path = musicEntry.src;
    delete musicEntry.src;

    if (!musicEntry.id || !musicEntry.path) {
      throw new Error("addMusic requires { id, path } (src is accepted as a shorthand for path)");
    }

    manifest.music.push(musicEntry);
    this._writeJson(this.manifestPath(projectId), manifest);
    return manifest.music;
  }


  /**
   * Adds a scene (initially with assets: []) and wires it into manifest.scenes.
   * @param {{id, narrationRef?, background?, camera?, transitionOut?, overwrite?}} spec
   */
  addScene(projectId, spec) {
    const { id, overwrite = false } = spec;
    if (!id) throw new Error("addScene requires id");
    const manifest = this._readManifest(projectId);
    if (!overwrite && fs.existsSync(this.scenePath(projectId, id))) {
      throw new Error(`Scene "${id}" already exists in project "${projectId}". Pass overwrite: true to replace it.`);
    }

    const scene = {
      id,
      background: spec.background ?? "shade1",
      assets: [],
    };
    if (spec.narrationRef !== undefined) scene.narrationRef = spec.narrationRef;
    if (spec.camera) scene.camera = spec.camera;
    if (spec.transitionOut) scene.transitionOut = normalizeTransitionOut(spec.transitionOut);

    this._writeScene(projectId, id, scene);

    if (!manifest.scenes.some((s) => s.id === id)) {
      manifest.scenes.push({ id, path: `scenes/${id}.json` });
      this._writeJson(this.manifestPath(projectId), manifest);
    }
    return scene;
  }

  /**
   * Appends an asset to a scene. assetType is checked against the live
   * registry; contentOverride is checked (non-fatally — returned as
   * `warnings`) against that asset's own contentOverrideSchema, so the
   * agent gets feedback immediately instead of waiting for a render.
   *
   * @param {{id?, assetType, anchor?, contentOverride?, styleOverride?, enterAt?, exitAt?}} spec
   */
  addAsset(projectId, sceneId, spec) {
    const { assetType } = spec;
    if (!assetType) throw new Error("addAsset requires assetType");

    const registry = loadAssetRegistry();
    const entry = registry[assetType];
    if (!entry) {
      throw new Error(`Unknown assetType "${assetType}". Available: ${Object.keys(registry).join(", ")}`);
    }

    const scene = this._readScene(projectId, sceneId);
    const id = spec.id ?? `${assetType}-${scene.assets.length + 1}`;
    if (scene.assets.some((a) => a.id === id)) {
      throw new Error(`Asset id "${id}" already exists in scene "${sceneId}"`);
    }

    const asset = {
      id,
      assetType,
      anchor: spec.anchor ?? { position: "center", offsetXPercent: 0, offsetYPercent: 0 },
      contentOverride: spec.contentOverride ?? {},
      styleOverride: spec.styleOverride ?? {},
      enterAt: spec.enterAt ?? 0,
      exitAt: spec.exitAt ?? 1,
    };

    const warnings = checkAgainstSchema(entry.manifest.contentOverrideSchema, asset.contentOverride);

    scene.assets.push(asset);
    this._writeScene(projectId, sceneId, scene);
    return { asset, warnings };
  }

  removeAsset(projectId, sceneId, assetId) {
    const scene = this._readScene(projectId, sceneId);
    const before = scene.assets.length;
    scene.assets = scene.assets.filter((a) => a.id !== assetId);
    this._writeScene(projectId, sceneId, scene);
    return { removed: before !== scene.assets.length };
  }

  /**
   * Patches an existing asset in place — a shallow merge, not a replace:
   * `anchor`/`contentOverride`/`styleOverride` in the patch are merged key
   * by key over the existing values (so e.g. patching just
   * `{ contentOverride: { text: "..." } }` on a TextBlock leaves any other
   * contentOverride keys untouched), `enterAt`/`exitAt` are overwritten
   * wholesale when present. Changing `assetType` is allowed (re-validates
   * against the new type's registry entry) but does NOT clear
   * contentOverride/styleOverride — prefer removeAsset + addAsset if you're
   * swapping to an unrelated asset type rather than patching one in place.
   *
   * @param {{assetType?, anchor?, contentOverride?, styleOverride?, enterAt?, exitAt?}} patch
   */
  updateAsset(projectId, sceneId, assetId, patch = {}) {
    const scene = this._readScene(projectId, sceneId);
    const asset = scene.assets.find((a) => a.id === assetId);
    if (!asset) {
      throw new Error(
        `No asset "${assetId}" in scene "${sceneId}". Known ids: ${scene.assets.map((a) => a.id).join(", ") || "(none)"}`,
      );
    }

    const registry = loadAssetRegistry();
    if (patch.assetType) {
      if (!registry[patch.assetType]) {
        throw new Error(`Unknown assetType "${patch.assetType}". Available: ${Object.keys(registry).join(", ")}`);
      }
      asset.assetType = patch.assetType;
    }
    if (patch.anchor) asset.anchor = { ...asset.anchor, ...patch.anchor };
    if (patch.contentOverride) asset.contentOverride = { ...asset.contentOverride, ...patch.contentOverride };
    if (patch.styleOverride) asset.styleOverride = { ...asset.styleOverride, ...patch.styleOverride };
    if (patch.enterAt !== undefined) asset.enterAt = patch.enterAt;
    if (patch.exitAt !== undefined) asset.exitAt = patch.exitAt;

    const entry = registry[asset.assetType];
    const warnings = checkAgainstSchema(entry.manifest.contentOverrideSchema, asset.contentOverride);

    this._writeScene(projectId, sceneId, scene);
    return { asset, warnings };
  }

  /** Sets a scene's outgoing transition from scratch (replaces any existing one). */
  setTransitionOut(projectId, sceneId, transitionSpec) {
    const { type } = transitionSpec ?? {};
    if (!type) throw new Error("setTransitionOut requires type");
    const registry = loadTransitionRegistry();
    if (!registry[type]) {
      throw new Error(`Unknown transitionType "${type}". Available: ${Object.keys(registry).join(", ")}`);
    }
    const scene = this._readScene(projectId, sceneId);
    scene.transitionOut = normalizeTransitionOut(transitionSpec, registry);
    this._writeScene(projectId, sceneId, scene);
    return scene.transitionOut;
  }

  /**
   * Patches an existing transitionOut in place. `type` is swapped wholesale
   * (re-validated against the registry); `durationInFrames` is overwritten
   * when present; `params` is merged key by key (so tweaking one param
   * doesn't drop the others); `effects` is replaced wholesale when present
   * — use addTransitionEffect for appending a single effect instead.
   * Throws if the scene has no transitionOut yet — use setTransitionOut to
   * create one first.
   *
   * @param {{type?, durationInFrames?, params?, effects?}} patch
   */
  updateTransitionOut(projectId, sceneId, patch = {}) {
    const scene = this._readScene(projectId, sceneId);
    if (!scene.transitionOut) {
      throw new Error(`Scene "${sceneId}" has no transitionOut yet. Use setTransitionOut to create one.`);
    }
    if (patch.type) {
      const registry = loadTransitionRegistry();
      if (!registry[patch.type]) {
        throw new Error(`Unknown transitionType "${patch.type}". Available: ${Object.keys(registry).join(", ")}`);
      }
      scene.transitionOut.type = patch.type;
    }
    if (patch.durationInFrames !== undefined) scene.transitionOut.durationInFrames = patch.durationInFrames;
    if (patch.params) scene.transitionOut.params = { ...(scene.transitionOut.params ?? {}), ...patch.params };
    if (patch.effects) scene.transitionOut.effects = patch.effects;

    this._writeScene(projectId, sceneId, scene);
    return scene.transitionOut;
  }

  /** Removes a scene's transitionOut entirely (falls back to a hard cut). */
  removeTransitionOut(projectId, sceneId) {
    const scene = this._readScene(projectId, sceneId);
    const had = Boolean(scene.transitionOut);
    delete scene.transitionOut;
    this._writeScene(projectId, sceneId, scene);
    return { removed: had };
  }

  /** Appends one boundary effect (sfx | visual) to a scene's transitionOut. */
  addTransitionEffect(projectId, sceneId, effectSpec) {
    const scene = this._readScene(projectId, sceneId);
    if (!scene.transitionOut) {
      scene.transitionOut = { type: "default" };
    }
    if (!Array.isArray(scene.transitionOut.effects)) scene.transitionOut.effects = [];
    scene.transitionOut.effects.push(effectSpec);
    this._writeScene(projectId, sceneId, scene);
    return scene.transitionOut.effects;
  }

  /** Adds (or updates, if id already exists) a narration entry. */
  addNarrationEntry(projectId, { id, text }) {
    if (!id || text === undefined) throw new Error("addNarrationEntry requires { id, text }");
    const manifest = this._readManifest(projectId);
    if (!manifest.narration) manifest.narration = { entries: [], fullTranscript: "" };
    const existing = manifest.narration.entries.find((e) => e.id === id);
    if (existing) existing.text = text;
    else manifest.narration.entries.push({ id, text });
    this._writeJson(this.manifestPath(projectId), manifest);
    return manifest.narration;
  }

  setFullTranscript(projectId, text) {
    const manifest = this._readManifest(projectId);
    if (!manifest.narration) manifest.narration = { entries: [], fullTranscript: "" };
    manifest.narration.fullTranscript = text;
    this._writeJson(this.manifestPath(projectId), manifest);
    return manifest.narration;
  }

  /** Adds a manifest-level audioOverlay entry. Ignored once narration
   * produces real TTS audio (see resolve.js) — only meaningful for
   * non-narrated projects. */
  addAudioOverlay(projectId, entry) {
    const manifest = this._readManifest(projectId);
    if (!Array.isArray(manifest.audioOverlay)) manifest.audioOverlay = [];
    manifest.audioOverlay.push(entry);
    this._writeJson(this.manifestPath(projectId), manifest);
    return manifest.audioOverlay;
  }

  /** Assembles the full in-memory project tree (manifest + config + styles
   * + every scene) purely from what's on disk — lets the agent inspect what
   * it has built so far via one call instead of reading files. */
  getProject(projectId) {
    const manifest = this._readManifest(projectId);
    const config = this._readJson(this.configPath(projectId));
    const styles = this._readJson(this.stylePath(projectId));
    const scenes = manifest.scenes.map((s) => this._readScene(projectId, s.id));
    return { manifest, config, styles, scenes };
  }

  /**
   * Viewer: lists the assets actually placed so far, grouped by scene (or
   * just one scene's, if sceneId is given). This is the "what's in the
   * project right now" view — use it before add/update calls instead of
   * guessing state or opening a scene file.
   */
  listCurrentAssets(projectId, sceneId) {
    const manifest = this._readManifest(projectId);
    const sceneIds = sceneId ? [sceneId] : manifest.scenes.map((s) => s.id);
    return sceneIds.map((id) => {
      const scene = this._readScene(projectId, id);
      return { sceneId: id, assets: scene.assets };
    });
  }

  /**
   * Viewer: lists each scene's outgoing transition (or null for a hard
   * cut), in scene order. Use before setTransitionOut/updateTransitionOut
   * to see current state without opening a scene file.
   */
  listCurrentTransitions(projectId) {
    const manifest = this._readManifest(projectId);
    return manifest.scenes.map((s) => {
      const scene = this._readScene(projectId, s.id);
      return { sceneId: s.id, transitionOut: scene.transitionOut ?? null };
    });
  }

  /** Runs the real schema + cross-reference validation (Ajv, narrationRef
   * checks, etc.) that render-project.mjs would run as stage 1. */
  validateProjectFiles(projectId) {
    try {
      const result = validateProject(this.manifestPath(projectId));
      return { ok: true, sceneCount: result.scenes.length, projectId: result.manifest.projectId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Spawns `node scripts/render-project.mjs <manifest> [output]` — the
   * one command that actually turns the JSON on disk into an mp4. */
  render(projectId, outputMp4) {
    const script = path.join(this.repoRoot, "scripts/render-project.mjs");
    const args = [script, this.manifestPath(projectId)];
    if (outputMp4) args.push(outputMp4);
    const result = spawnSync("node", args, { cwd: this.repoRoot, encoding: "utf-8" });
    return {
      ok: result.status === 0,
      code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

export default ProjectBuilder;