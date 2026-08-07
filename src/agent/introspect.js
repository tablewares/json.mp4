// src/agent/introspect.js
//
// Read-only introspection over the asset/transition registries and the
// anchor system, shaped for an LLM agent driving the pipeline via CLI
// commands. An agent should never need to open a manifest.json file by hand
// to discover what keys an asset or transition accepts — everything here is
// derived from the SAME manifest.json files src/registry/assetRegistry.js
// already scans, so this can never drift from what render actually supports.

import { loadAssetRegistry, loadTransitionRegistry } from "../registry/assetRegistry.js";
import { ANCHOR_POSITIONS } from "../templating/anchor.js";

function toContentEntry([key, def]) {
  return {
    key,
    type: def.type ?? (def.oneOf ? "oneOf" : def.enum ? "enum" : "any"),
    enum: def.enum,
    description: def.description,
    itemsDescription: def.items?.description,
  };
}

function summarizeContentSchema(schema) {
  if (!schema || schema.type !== "object") return { required: [], optional: [] };
  const required = new Set(schema.required ?? []);
  const props = schema.properties ?? {};
  return {
    required: Object.entries(props).filter(([k]) => required.has(k)).map(toContentEntry),
    optional: Object.entries(props).filter(([k]) => !required.has(k)).map(toContentEntry),
  };
}

function summarizeStyleSchema(schema, defaultStyle = {}) {
  if (!schema || schema.type !== "object") return [];
  const props = schema.properties ?? {};
  return Object.entries(props).map(([key, def]) => ({
    key,
    type: def.type ?? (def.enum ? "enum" : "any"),
    enum: def.enum,
    description: def.description,
    default: defaultStyle[key],
  }));
}

/** Cheap one-line-per-type summary. Always safe to dump in full. */
export function listAssetTypes() {
  const registry = loadAssetRegistry();
  return Object.entries(registry).map(([assetType, entry]) => ({
    assetType,
    description: entry.manifest.description,
    defaultSize: entry.manifest.defaultSize,
  }));
}

export function describeAsset(assetType) {
  const registry = loadAssetRegistry();
  const entry = registry[assetType];
  if (!entry) {
    throw new Error(`Unknown assetType "${assetType}". Available: ${Object.keys(registry).join(", ")}`);
  }
  const m = entry.manifest;
  return {
    assetType,
    description: m.description,
    defaultSize: m.defaultSize,
    defaultStyle: m.defaultStyle ?? {},
    content: summarizeContentSchema(m.contentOverrideSchema),
    style: summarizeStyleSchema(m.styleOverrideSchema, m.defaultStyle),
  };
}

export function listTransitionTypes() {
  const registry = loadTransitionRegistry();
  return Object.entries(registry).map(([transitionType, entry]) => ({
    transitionType,
    description: entry.manifest.description,
    defaultDurationInFrames: entry.manifest.defaultDurationInFrames,
  }));
}

export function describeTransition(transitionType) {
  const registry = loadTransitionRegistry();
  const entry = registry[transitionType];
  if (!entry) {
    throw new Error(`Unknown transitionType "${transitionType}". Available: ${Object.keys(registry).join(", ")}`);
  }
  const m = entry.manifest;
  const params = Object.entries(m.params ?? {}).map(([key, def]) => ({
    key,
    type: def.type,
    default: def.default,
    enum: def.enum,
    description: def.description,
  }));
  return {
    transitionType,
    description: m.description,
    defaultDurationInFrames: m.defaultDurationInFrames,
    consumes: m.consumes ?? {},
    params,
  };
}

export function listAnchorPositions() {
  return ANCHOR_POSITIONS;
}

/** Static reference for scene/asset/effect envelope fields that aren't tied
 * to any one asset/transition manifest. Lets the agent skip ever reading
 * scene.schema.json / manifest.schema.json by hand. */
export function describeSceneEnvelope() {
  return {
    scene: {
      id: "string, unique within the project",
      narrationRef: "optional: id into manifest.narration.entries — drives this scene's duration via TTS",
      background: "color token (e.g. 'shade1') or a literal style object",
      camera: "optional: { start, end, zoomStartPercent, zoomEndPercent, zoomPercent } — start/end are anchor specs",
      transitionOut: "optional: { type, durationInFrames?, params?, effects? } — omit for a hard cut",
      assets: "array of asset specs, see 'asset' below (managed via add-asset, not set directly)",
    },
    asset: {
      id: "optional (auto-generated if omitted), unique within the scene",
      assetType: "must be a registered asset type — see the 'assets' command",
      anchor: "{ position, offsetXPercent?, offsetYPercent? } — position is one of the 'anchors' command's output",
      contentOverride: "asset-specific — see `asset <type>` command's 'content' field",
      styleOverride: "asset-specific — see `asset <type>` command's 'style' field; width/height also settable here",
      enterAt: "fraction 0-1 of the scene's duration (default 0)",
      exitAt: "fraction 0-1 of the scene's duration (default 1)",
    },
    transitionEffect: {
      id: "optional",
      kind: "'sfx' or 'visual'",
      offsetPercent: "0 = scene's visible end frame; negative = earlier; positive = into the transition overlap",
      sfx: "additional keys: { path, volume?, durationInFrames? }",
      visual: "additional keys: { assetType, anchor?, contentOverride?, styleOverride?, durationInFrames? } — resolved like a normal asset",
    },
  };
}
