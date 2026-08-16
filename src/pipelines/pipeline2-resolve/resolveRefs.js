import { resolveAnchorPoint } from "../../templating/anchor.js";
import { resolveWavyPath } from "../../templating/wavyPath.js";

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
 * Endpoint resolution uses the SAME templating resolver as
 * src/templating/anchor.js (`resolveAnchorPoint`): each endpoint is
 * authored in the "named corner + composition-space % nudge" or
 * "follow another asset + nudge" vocabulary, then resolved to
 * composition-space pixels here. Raw `{x, y}` pixels are still accepted
 * verbatim for backward compatibility. This is the no-op-by-default rule:
 * every existing manifest keeps byte-identical output, only newly-authored
 * endpoint specs gain templated resolution.
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
 * Resolves one WavyLine endpoint spec to a composition-space {x, y} point,
 * using the same templating resolver as src/templating/anchor.js
 * (`resolveAnchorPoint`), not raw coordinate-space points directly.
 *
 * Accepted shapes (in priority order):
 *
 *   - null / undefined / {}  -> null (no endpoint authored; caller skips)
 *
 *   - { x, y }               -> passthrough. Backward compatibility for
 *                              manifests authored before this templating
 *                              change. Treated as already-resolved
 *                              composition-space pixels.
 *
 *   - { followAssetId, offsetXPercent?, offsetYPercent? }
 *                            -> the camera-anchor "track an asset's center"
 *                              shape: resolved to the followed asset's
 *                              resolved center, nudged by composition-space %.
 *                              Equivalent authoring to the connector's
 *                              `fromAssetId` / `toAssetId` shorthand but
 *                              expressed per-endpoint.
 *
 *   - { position, offsetXPercent?, offsetYPercent? }
 *                            -> the named-corner vocabulary every asset's
 *                              `anchor` uses. Resolved against the
 *                              composition frame (NOT the asset box). Lets an
 *                              author pin a standalone line endpoint to e.g.
 *                              "top-left + nudge" without binding to a
 *                              specific asset.
 *
 * `composition` and `byId`/`sceneId` (for followAssetId lookups + errors)
 * come from the pass-2 caller.
 *
 * @param {object|null|undefined} spec
 * @param {{width:number, height:number}} composition
 * @param {{byId: Record<string, object>, sceneId?: string}} ctx
 * @returns {{x:number, y:number}|null}
 */
function resolveEndpoint(spec, composition, ctx) {
  if (spec == null) return null;
  if (typeof spec !== "object") return null;

  // Backward-compat: raw composition-space pixels pass through. An author
  // who already wrote [{x,y},{x,y}] (or a manifest resolved by an older
  // pipeline) gets byte-identical output.
  if (typeof spec.x === "number" && typeof spec.y === "number" && spec.position == null && spec.followAssetId == null) {
    return { x: spec.x, y: spec.y };
  }

  // No anchor vocabulary present (empty {} or unrecognized) -> nothing to
  // resolve. Caller treats null as "endpoint not authored".
  if (spec.followAssetId == null && spec.position == null) return null;

  return resolveAnchorPoint(spec, composition, {
    resolvedAssetsById: ctx.byId,
    sceneId: ctx.sceneId,
  });
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
 *     the two targets become the line's endpoints. Each endpoint is
 *     resolved through `resolveAnchorPoint` as `{ followAssetId }` specs
 *     (same vocabulary a standalone author would write), so the connector
 *     case shares one resolver with the templated-endpoint case instead of
 *     being a separate code path that bakes raw pixel centers. The
 *     resolved `[{x,y}, {x,y}]` is written into `content.points` — the
 *     renderer contract is unchanged from before this edit.
 *
 *   contentOverride.points (no fromAssetId/toAssetId) — standalone: each
 *     item is resolved through `resolveEndpoint`. A raw `{x,y}` item is
 *     passed through unchanged; a `{ position, offsetXPercent,
 *     offsetYPercent }` or `{ followAssetId, offsetXPercent,
 *     offsetYPercent }` item is templated. The resolved `[{x,y}, {x,y}]`
 *     is written back into `content.points`.
 *
 * @param {object} asset     resolved asset (mutated in place)
 * @param {Record<string, object>} byId
 * @param {{sceneId?: string, composition?: {width:number, height:number}}=} opts
 * @returns {object} the same asset, for chaining
 */
function bakeWavyPathSurface(asset) {
  const pts = asset.content?.points;
  if (!Array.isArray(pts) || pts.length < 2 || pts[0] == null || pts[1] == null) return;
  const curveAmount = asset.resolvedStyle?.curveAmount ?? 0;
  // smoothCurve must be honored here (not just in WavyLine.jsx) because the
  // baked `content._path.d` written by this pass is what the renderer reads
  // first — any flag dropped here is silently lost for any asset that goes
  // through pass-2 resolution (which is every WavyLine, standalone or else).
  const smoothCurve = Boolean(asset.resolvedStyle?.smoothCurve);
  asset.content = {
    ...asset.content,
    _path: resolveWavyPath(pts, curveAmount, smoothCurve),
  };
}

export function resolveOneRef(asset, byId, opts = {}) {
  if (!asset || asset.assetType == null) return asset;
  const content = asset.content ?? {};
  const sceneId = opts.sceneId;
  const composition = opts.composition;

  // Trailing/highlighting a single target — read words + center.
  if (typeof content.refAssetId === "string") {
    const target = requireTarget(byId, content.refAssetId, sceneId);
    if (Array.isArray(target.timing?.words) && target.timing.words.length > 0) {
      asset.timing = {
        ...(asset.timing ?? {}),
        words: target.timing.words.map((w) => ({ ...w })),
      };
    }
    const w = target.resolvedStyle?.width ?? 0;
    const h = target.resolvedStyle?.height ?? 0;
    const pos = target.resolvedPosition ?? { left: 0, top: 0 };
    asset.content = {
      ...content,
      _refTarget: { x: pos.left + w / 2, y: pos.top + h / 2, left: pos.left, top: pos.top, width: w, height: h },
    };
    return asset;
  }

  // Connector between two targets — resolve each endpoint through the
  // same `resolveAnchorPoint` resolver as standalone endpoints, then
  // write pixels into content.points. Identical intent to how
  // `carryFrom`/`carryTo` are handed to `TransitionBoilerplate`, just
  // within one scene.
  const fromId = content.fromAssetId;
  const toId = content.toAssetId;
  if (typeof fromId === "string" && typeof toId === "string") {
    requireTarget(byId, fromId, sceneId);
    requireTarget(byId, toId, sceneId);
    // fromEdge/toEdge (optional): which point on the TARGET's own box to
    // anchor to — the same ANCHOR_ALIGN vocabulary a normal asset `anchor`
    // uses (top-left, bottom, center, ...). Omitted = "center", identical
    // to the connector's behavior before this field existed.
    // fromOffsetXPercent/YPercent and toOffsetXPercent/YPercent nudge from
    // the resolved edge point in composition-space %, the same convention
    // every other anchor offset in the framework already uses.
    const fromPt = resolveEndpoint(
      {
        followAssetId: fromId,
        anchorEdge: content.fromEdge,
        offsetXPercent: content.fromOffsetXPercent,
        offsetYPercent: content.fromOffsetYPercent,
      },
      composition,
      { byId, sceneId },
    );
    const toPt = resolveEndpoint(
      {
        followAssetId: toId,
        anchorEdge: content.toEdge,
        offsetXPercent: content.toOffsetXPercent,
        offsetYPercent: content.toOffsetYPercent,
      },
      composition,
      { byId, sceneId },
    );
    const points = [fromPt, toPt];
    const extra = {};
    asset.content = {
      ...content,
      from: fromPt,
      to: toPt,
      points,
      ...extra,
    };
    bakeWavyPathSurface(asset);
    return asset;
  }

  // Standalone: resolve each authored endpoint through the templating
  // resolver. Raw {x,y} items pass through; anchor-vocabulary items get
  // resolved against the composition frame. Without a composition size we
  // can't run the resolver, so leave content.points untouched — the
  // renderer's existing behavior (pass-through of raw pixels) still works.
  if (Array.isArray(content.points) && composition) {
    const resolved = content.points
      .map((spec) => resolveEndpoint(spec, composition, { byId, sceneId }))
      .filter((p) => p != null);
    if (resolved.length > 0) {
      asset.content = { ...content, points: resolved };
    }
    bakeWavyPathSurface(asset);
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
 * @param {{sceneId?: string, composition?: {width:number, height:number}}=} opts
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
