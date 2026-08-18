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
//
// ---------------------------------------------------------------------------
// Architecture: this module is the facade. Concerns that used to live in
// one 1000+ line file are split into sibling modules under src/agent/:
//
//   defaults.js      — DEFAULT_CONFIG / DEFAULT_THEME / mergeTheme
//   projectIO.js     — ProjectIO: path helpers + low-level JSON read/write
// validators.js      — checkAgainstSchema / checkCameraSpec /
//                      checkMotionSpec / checkMotionAliases (lazy Ajv)
//  checkAssetRefs.js — checkAssetRefs (in-scene reference ordering rule)
//   transitions.js   — normalizeTransitionOut (registry duration backfill)
//
// ProjectBuilder holds a ProjectIO and forwards its private _readJson /
// _writeJson / _readManifest / _readScene / _writeScene aliases straight
// through to it, so the method bodies below read identically to the old
// monolith — they still touch the same files via the same paths.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadAssetRegistry, loadTransitionRegistry } from "../../src/registry/assetRegistry.js";
import {
  buildTimeline,
  findAssetSegments,
  describeFrame,
  findOpenFrameRanges,
} from "./buildTimeline.js";

import { DEFAULT_REPO_ROOT, ProjectIO } from "./projectio.js";
import { DEFAULT_CONFIG, DEFAULT_THEME, mergeTheme } from "./default.js";
import { checkAssetRefs } from "./checkAssetRef.js";
import { normalizeTransitionOut } from "./transition.js";
import { resolveProject } from "../../src/pipelines/pipeline2-resolve/resolve.js";



// Re-exported for backward compatibility — the old monolith exported
// DEFAULT_CONFIG / DEFAULT_THEME at module top level; keep that surface so
// any importer (including tests or scripts that destructure them) keeps
// working without a second import. builders built before the split
// imported { DEFAULT_CONFIG } from "./ProjectBuilder.js" directly.
export { DEFAULT_CONFIG, DEFAULT_THEME };

/**
 * Constructs a detached `scene.effects[]` entry from an `injectTimelineEffects`
 * rule's `effect` descriptor and its computed exact scene-local `frame`.
 *
 * The shape mirrors `effects.schema.json`'s `sfxEffect` / `visualEffect`:
 *   - Both kinds carry the explicit `frame` (and optional `durationInFrames`).
 *   - sfx additionally carries `path` + optional `volume`.
 *   - visual additionally carries `assetType` + optional `anchor` /
 *     `contentOverride` / `styleOverride`.
 *
 * Only the keys actually present on the user's `effect` are spread in, so an
 * omitted `volume` leaves the default (1) to the resolver rather than forcing
 * `undefined` into the on-disk JSON. The caller-supplied `id` wins over any
 * `effect.id` — `injectTimelineEffects` derives a per-segment / per-scene id
 * so the idempotent replace-by-id flush tracks per-target, not per-rule.
 */
function buildInjectedEffect(effect, id, frame) {
  if (effect.kind === "sfx") {
    return {
      id,
      kind: "sfx",
      frame,
      path: effect.path,
      ...(effect.volume !== undefined ? { volume: effect.volume } : {}),
      ...(effect.durationInFrames !== undefined ? { durationInFrames: effect.durationInFrames } : {}),
    };
  }
  // kind === "visual"
  return {
    id,
    kind: "visual",
    frame,
    assetType: effect.assetType,
    ...(effect.anchor ? { anchor: effect.anchor } : {}),
    ...(effect.contentOverride ? { contentOverride: effect.contentOverride } : {}),
    ...(effect.styleOverride ? { styleOverride: effect.styleOverride } : {}),
    ...(effect.durationInFrames !== undefined ? { durationInFrames: effect.durationInFrames } : {}),
  };
}

export class ProjectBuilder {
  constructor({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
    this.repoRoot = repoRoot;
    this._io = new ProjectIO({ repoRoot });
    this.manifestRoot = this._io.manifestRoot;
  }

  // -- path helpers (forwarded to ProjectIO) ----------------------------------

  projectDir(projectId) {
    return this._io.projectDir(projectId);
  }
  manifestPath(projectId) {
    return this._io.manifestPath(projectId);
  }
  configPath(projectId) {
    return this._io.configPath(projectId);
  }
  stylePath(projectId) {
    return this._io.stylePath(projectId);
  }
  scenePath(projectId, sceneId) {
    return this._io.scenePath(projectId, sceneId);
  }

  // -- low-level IO (forwarded to ProjectIO) -----------------------------------

  _readJson(p) {
    return this._io.readJson(p);
  }
  _writeJson(p, obj) {
    return this._io.writeJson(p, obj);
  }
  _readManifest(projectId) {
    return this._io.readManifest(projectId);
  }
  _readScene(projectId, sceneId) {
    return this._io.readScene(projectId, sceneId);
  }
  _writeScene(projectId, sceneId, scene) {
    return this._io.writeScene(projectId, sceneId, scene);
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

  /**
   * Resolves the project (the same stage-2 pass `render` runs) and builds the
   * global-frame timeline from the resolved manifest via `buildTimeline`.
   *
   * This is the read-only "where does everything sit on the final render's
   * frame axis?" view: every scene's global startFrame/endFrame and every
   * asset's global enter/exit frames, plus the total composition duration.
   * Use it to decide *what* effect to inject *where* before calling
   * `injectTimelineEffects`.
   *
   * Resolving reads the same on-disk scene/config/manifest files every other
   * command here reads, so the timeline it returns always matches what a
   * subsequent `render` would produce — it never consults a stale
   * `studio/resolved.json`.
   */
  async getTimeline(projectId) {
    const manifestPath = this.manifestPath(projectId);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No project "${projectId}" (expected ${manifestPath}).`);
    }
    const resolved = await resolveProject(manifestPath);
    return buildTimeline(resolved);
  }

  /**
   * "What's on screen at this exact global frame" — resolves the project,
   * builds the timeline, and returns the active scene/assets/effects/audio
   * at `frame`. Use before placing a new asset/effect to check for
   * collisions instead of guessing from scene JSON.
   */
  async describeFrame(projectId, frame) {
    const timeline = await this.getTimeline(projectId);
    const numericFrame = Number(frame);
    if (!Number.isFinite(numericFrame)) {
      throw new Error(`describeFrame: frame must be a number (got "${frame}")`);
    }
    return describeFrame(timeline, numericFrame);
  }

  /**
   * "Where's a safe gap in this scene" — resolves the project, builds the
   * timeline, and returns frame ranges in `sceneId` not already covered by
   * an existing asset or effect. Use before authoring a new asset/effect's
   * enterAt/exitAt or frame to avoid an overlap.
   */
  async findOpenFrameRanges(projectId, sceneId, opts = {}) {
    const timeline = await this.getTimeline(projectId);
    return findOpenFrameRanges(timeline, sceneId, opts);
  }

  /**
   * Timeline-driven effect injection: harvests asset segments from the
   * resolved manifest and writes effects anchored to an *exact scene-local
   * frame* onto each matching scene's detached `scene.effects[]` — after
   * scenes are already built. Effects are no longer nested under
   * `transitionOut`; the resolution step (`resolveSceneEffects`) and the
   * renderer both read the scene-level `effects[]` array (see
   * `effects.schema.json`).
   *
   * This method always resolves + reads the project's timeline FIRST so the
   * frames it writes match what a subsequent `render` would actually play —
   * no stale `studio/resolved.json`, no percent math converting back to
   * frames at resolve time.
   *
   * Each rule selects which segments to target and what effect to drop:
   *   {
   *     match: { assetType: "KineticText" }
   *            | { scene: "all" }                         // every scene, by boundary
   *            | { predicate: "sceneEnd" | "sceneStart" } // alias of match.scene
   *     anchor: "enter" | "exit"  // which edge of the matched segment to
   *            // anchor the effect to; default "enter".
   *     effect: {
   *       kind: "sfx" | "visual",
   *       id: <effect id>,                     // required; used for idempotency
   *       // sfx:    { path, volume?, durationInFrames? }
   *       // visual: { assetType, anchor?, contentOverride?, styleOverride?, durationInFrames? }
   *       ...plus the kind-specific keys
   *     }
   *   }
   *
   * The effect's `frame` is computed directly from the resolved timeline:
   *   - `match.assetType` rule: the matched segment's `globalEnterFrame` /
   *     `globalExitFrame` is lifted into scene-local space by subtracting the
   *     timeline scene's `startFrame` (`anchor: "enter"` -> enter frame,
   *     `anchor: "exit"` -> exit frame). So a KineticText that enters at
   *     global frame 218 in a scene whose global startFrame is 88 lands at
   *     scene-local frame 130 — exactly where the asset becomes visible.
   *   - `match.scene: "all"` rule: `anchor: "enter"` -> `frame: 0` (scene
   *     start); `anchor: "exit"` -> `frame: scene.durationInFrames` (scene
   *     visible end). No percent math, no ambiguity.
   *
   * Idempotent: before writing, any existing effect whose `id` matches a
   * rule id is removed from that scene's `effects[]`. Re-running with the
   * same rules therefore updates rather than stacks. Scenes with no matching
   * segments are left untouched.
   *
   * @returns per-rule summary: how many rules ran, which scenes were written,
   *   and the per-scene effect lists that landed.
   */
  async injectTimelineEffects(projectId, rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new Error("injectTimelineEffects requires a non-empty rules array");
    }

    const manifestPath = this.manifestPath(projectId);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No project "${projectId}" (expected ${manifestPath}).`);
    }
    // Resolve first so the exact-frame numbers below match what `render`
    // would actually play — scenes are read from disk, never from a stale
    // studio/resolved.json. `buildTimeline` lifts scene + asset timing onto
    // the composition's global frame axis.
    const resolved = await resolveProject(manifestPath);
    const timeline = buildTimeline(resolved);

    // Per-scene accumulator: sceneId -> array of effects to append.
    // We resolve-then-write so each scene file is touched at most once.
    const pendingByScene = new Map();

    const clampFrame = (frame, sceneDurationInFrames) =>
      Math.max(0, Math.min(sceneDurationInFrames, Math.round(frame)));

    for (const rule of rules) {
      const { match = {}, anchor = "enter", effect } = rule;
      if (!effect || !effect.kind) throw new Error("injectTimelineEffects: each rule needs an `effect` with a `kind`");
      if (!effect.id) throw new Error("injectTimelineEffects: each rule's `effect` needs a string `id`");
      if (effect.kind !== "sfx" && effect.kind !== "visual") {
        throw new Error(`injectTimelineEffects: effect.kind must be "sfx" or "visual" (got "${effect.kind}")`);
      }
      if (anchor !== "enter" && anchor !== "exit") {
        throw new Error(`injectTimelineEffects: anchor must be "enter" or "exit" (got "${anchor}")`);
      }

      const { assetType, predicate = "enter", scene: sceneMatch } = match;

      // scene-boundary match path: place one effect per scene regardless of
      // which assets a scene contains. Bypasses findAssetSegments entirely;
      // the placement is the scene's own timeline boundary, not any asset's
      // enter/exit frame. The frame is exact scene-local:
      //   anchor === "enter" -> 0                       (scene start)
      //   anchor === "exit"  -> scene.durationInFrames   (scene visible end)
      const sceneBoundary = sceneMatch === "all" || predicate === "sceneEnd" || predicate === "sceneStart";
      if (sceneBoundary) {
        // predicate aliases: "sceneEnd" === "exit", "sceneStart" === "enter".
        // When match.scene === "all" and predicate isn't given, anchor is the
        // source of truth (defaults to "enter" per the rule-level default).
        const resolvedAnchor =
          predicate === "sceneEnd" ? "exit" : predicate === "sceneStart" ? "enter" : anchor;
        if (resolvedAnchor !== "enter" && resolvedAnchor !== "exit") {
          throw new Error(
            `injectTimelineEffects: scene-boundary match requires anchor "enter" or "exit" (got "${resolvedAnchor}")`,
          );
        }

        timeline.scenes.forEach((scene, sceneIndex) => {
          const frame = clampFrame(
            resolvedAnchor === "exit" ? scene.durationInFrames : 0,
            scene.durationInFrames,
          );
          const sceneEffectId = `${effect.id}-${sceneIndex}`;
          const effectEntry = buildInjectedEffect(effect, sceneEffectId, frame);
          const list = pendingByScene.get(scene.sceneId) ?? [];
          list.push(effectEntry);
          pendingByScene.set(scene.sceneId, list);
        });
        continue;
      }

      if (!assetType || typeof assetType !== "string") {
        throw new Error(`injectTimelineEffects: rule.match.assetType (string) is required (or use match.scene="all" for scene-boundary placement)`);
      }
      // predicate ("enter"|"exit"|"all", default "enter") documents which
      // edge of each segment the rule targets. Today every segment is
      // harvested by exact assetType; `anchor` then picks the segment edge
      // the effect's exact frame is read from.
      void predicate;

      const segments = findAssetSegments(
        timeline,
        (asset) => asset.assetType === assetType,
      );

      segments.forEach((segment, segIndex) => {
        // Lift the segment's global enter/exit frame into the scene's local
        // frame space by subtracting the timeline scene's startFrame — the
        // same coordinate space `scene.effects[].frame` and the resolver's
        // `enterAtFrame`/`exitAtFrame` use. No percent math: the frame is
        // exactly where the asset becomes visible / hides on the render axis.
        const timelineScene = timeline.scenes.find((s) => s.sceneId === segment.sceneId);
        const sceneDuration = timelineScene?.durationInFrames ?? 0;
        const sceneStart = timelineScene?.startFrame ?? 0;
        const globalEdge = anchor === "exit" ? segment.endFrame : segment.startFrame;
        const localFrame = clampFrame(globalEdge - sceneStart, sceneDuration);

        // When a rule matches N segments, each effect needs a unique id so
        // the idempotent replace-by-id (see flush below) tracks per-segment,
        // not per-rule. Append the segment index to the user-supplied id.
        const segId = `${effect.id}-${segIndex}`;
        const effectEntry = buildInjectedEffect(effect, segId, localFrame);

        const list = pendingByScene.get(segment.sceneId) ?? [];
        list.push(effectEntry);
        pendingByScene.set(segment.sceneId, list);
      });
    }

    // Flush: one read-modify-write per touched scene, with idempotent replace
    // by effect.id. Effects live on the detached scene-level `effects[]`
    // array (effects.schema.json#/definitions/effectsArray) — NOT on
    // transitionOut. A scene with no authored effects gets the array created
    // here, matching how resolve.js pass-2 reads `expandedScenes[i].effects`.
    const written = [];
    for (const [sceneId, effects] of pendingByScene) {
      const scene = this._readScene(projectId, sceneId);
      if (!Array.isArray(scene.effects)) scene.effects = [];

      const idsToReplace = new Set(effects.map((e) => e.id));
      scene.effects = scene.effects.filter((existing) => !idsToReplace.has(existing.id));
      scene.effects.push(...effects);
      this._writeScene(projectId, sceneId, scene);
      written.push({ sceneId, effects: scene.effects });
    }

    return {
      rules: rules.length,
      scenesWritten: written.length,
      scenes: written,
    };
  }


}

export default ProjectBuilder;