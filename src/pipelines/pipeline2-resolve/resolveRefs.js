/**
 * Asset-to-asset reference resolution within one already-pass-1-resolved
 * scene — the intra-scene twin of `resolve.js`'s cross-scene
 * `buildTransitionBundle` (the `carryAssetId` trick), just scoped to one
 * scene's own resolved assets instead of two adjacent scenes.
 *
 * Pass 1 of `resolveScene` resolves every asset in isolation — geometry
 * and timing derive only from each asset's own anchor/spec + the scene
 * frame. This module is pass 2: for any asset that declares a reference
 * (`contentOverride.refAssetId`, `fromAssetId`/`toAssetId` for connectors,
 * etc.), look it up in the pass-1 result map and compute derived geometry
 * / timing from that target. The output is written back into the same
 * resolved-asset objects that the renderer already consumes — so the set
 * of fields the renderer reads doesn't change, only one more pass fills
 * some of them in.
 *
 * Ordering constraint: a referencing asset must be authored (and thus
 * resolved) AFTER its target within `scene.assets`. Targets therefore
 * exist in the incoming pass-1 map before any referencing asset is asked
 * for them — no topological sort is needed, and a forward reference
 * throws with a clear message instead of silently producing an
 * unresolved-against-zero target (consistent with how `carryAssetId`
 * already requires the carried asset to exist in both scenes' asset
 * arrays). `ProjectBuilder.addAsset` mirrors the same check at authoring
 * time.
 *
 * This module owns exactly that one job — camera math stays in
 * `camera.js`, effect-frame math stays in `effectTiming.js`. It produces
 * resolved-asset-side payload; nothing about the renderer changes.
 */

/**
 * Builds the pass-1 id -> resolved asset map. Pass 2 reads from this.
 *
 * @param {Array} resolvedAssets  output of resolveScene's pass-1 .map()
 * @returns {Record<string, object>}
 */
export function indexAssetsById(resolvedAssets) {
  const byId = {};
  for (const a of resolvedAssets) {
    if (a?.id != null) byId[a.id] = a;
  }
  return byId;
}

function assetCenter(asset) {
  const { left, top } = asset.resolvedPosition ?? { left: 0, top: 0 };
  const w = asset.resolvedStyle?.width ?? 0;
  const h = asset.resolvedStyle?.height ?? 0;
  return { x: left + w / 2, y: top + h / 2, left, top, width: w, height: h };
}

function requireTarget(byId, id, sceneId) {
  const t = byId[id];
  if (!t) {
    throw new Error(
      `Asset reference "${id}" in scene "${sceneId ?? "?"}" could not be resolved. ` +
        `Known asset ids: ${Object.keys(byId).join(", ") || "(none)"}. ` +
        `A referencing asset must be authored AFTER its target within scene.assets.`,
    );
  }
  return t;
}

/**
 * Resolves one intra-scene asset reference. Mutates and returns the
 * referencing asset's `content`/`timing` fields in place, by reading the
 * referenced target out of the pass-1 map.
 *
 * Supported shapes (additive; an asset with no recognized ref key is a
 * no-op):
 *
 *   contentOverride.refAssetId  — "I track asset X":
 *     if the target produced `timing.words` (e.g. a KineticText with
 *     narration-matched text), copy that array onto the referencing
 *     asset's `timing.words` so the renderer can drive its own per-word
 *     motion off the target's real spoken timestamps. Also exposes the
 *     target's resolved center/box on `content._refTarget` for downstream
 *     positioning (the highlighter-trails-KineticText case).
 *
 *   contentOverride.fromAssetId + contentOverride.toAssetId — connector:
 *     resolves both endpoints' centers and writes them into
 *     `content.points` as `[{x,y}, {x,y}]` (the curvy-line / LeaderLine
 *     case). Identical intent to how `carryFrom`/`carryTo` are handed to
 *     `TransitionBoilerplate`, just within one scene.
 *
 * @param {object} asset     resolved asset (mutated in place)
 * @param {Record<string, object>} byId
 * @param {{sceneId?: string}=} opts
 * @returns {object} the same asset, for chaining
 */
export function resolveOneRef(asset, byId, opts = {}) {
  if (!asset || asset.assetType == null) return asset;
  const content = asset.content ?? {};
  const sceneId = opts.sceneId;

  // Trailing/highlighting a single target — read words + center.
  if (typeof content.refAssetId === "string") {
    const target = requireTarget(byId, content.refAssetId, sceneId);
    if (Array.isArray(target.timing?.words) && target.timing.words.length > 0) {
      asset.timing = {
        ...(asset.timing ?? {}),
        words: target.timing.words.map((w) => ({ ...w })),
      };
    }
    asset.content = {
      ...content,
      _refTarget: assetCenter(target),
    };
    return asset;
  }

  // Connector between two targets — resolve both endpoints → content.points.
  const fromId = content.fromAssetId;
  const toId = content.toAssetId;
  if (typeof fromId === "string" && typeof toId === "string") {
    const a = assetCenter(requireTarget(byId, fromId, sceneId));
    const b = assetCenter(requireTarget(byId, toId, sceneId));
    asset.content = {
      ...content,
      from: a,
      to: b,
      points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
    };
    return asset;
  }

  return asset;
}

/**
 * Pass 2: resolve every intra-scene asset reference against the pass-1 map.
 * Mutates resolvedAssets in place (each asset's `content`/`timing` may be
 * enriched) and returns the same array.
 *
 * @param {Array} resolvedAssets
 * @param {{sceneId?: string}=} opts
 * @returns {Array} the same array, with references resolved
 */
export function resolveSceneRefs(resolvedAssets, opts = {}) {
  if (!Array.isArray(resolvedAssets) || resolvedAssets.length === 0) return resolvedAssets;
  const byId = indexAssetsById(resolvedAssets);
  for (const asset of resolvedAssets) {
    resolveOneRef(asset, byId, opts);
  }
  return resolvedAssets;
}
