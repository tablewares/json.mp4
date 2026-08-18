// src/agent/checkAssetRefs.js
//
// Enforces the in-scene reference ordering rule (plan.md §1): an asset
// that references another asset via contentOverride.refAssetId /
// fromAssetId / toAssetId must be authored AFTER its target within
// scene.assets — pass 2's resolveSceneRefs reads the pass-1 map, which
// the target must already populate. Same intent as transitionOut's
// `carryAssetId` requiring the asset to exist in both adjacent scenes.
//
// Used by both addAsset (against the existing scene.assets) and
// updateAsset (after a contentOverride patch may have introduced new
// refs). The asset being checked is allowed to already exist in
// scene.assets (updateAsset case); its own listing is excluded from
// the "valid earlier target" set so an asset can't reference itself.
//
// Split out of ProjectBuilder.js because it is pure logic over two
// plain objects — no fs, no path, no registry — so it is trivial to
// reuse from tests or from a future JSON-only build path that never
// hits the filesystem.

/**
 * @param {{id?:string, contentOverride?:object}} asset  asset being checked
 * @param {{assets?:Array}} scene
 * @param {string} sceneId
 * @throws {Error} when any referenced id isn't found earlier in scene.assets
 */
export function checkAssetRefs(asset, scene, sceneId) {
  const contentOverride = asset?.contentOverride ?? {};
  const refIds = [
    contentOverride.refAssetId,
    contentOverride.fromAssetId,
    contentOverride.toAssetId,
  ].filter((v) => typeof v === "string" && v.length > 0);
  if (refIds.length === 0) return;

  const knownIds = new Set(
    (scene?.assets ?? []).map((a) => a.id).filter((x) => x != null && x !== asset?.id),
  );
  const missing = refIds.filter((ref) => !knownIds.has(ref));
  if (missing.length > 0) {
    throw new Error(
      `Asset "${asset?.id ?? "?"}" (scene "${sceneId}") references ${missing.map((m) => `"${m}"`).join(", ")} ` +
        `but that target hasn't been added to the scene yet. Author the target first with addAsset() (referenced assets must appear EARLIER in scene.assets than the asset that references them). ` +
        `Known asset ids in this scene: ${[...knownIds].join(", ") || "(none)"}.`,
    );
  }
}