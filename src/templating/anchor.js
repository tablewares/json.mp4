/**
 * Resolves an { position, offsetXPercent, offsetYPercent } anchor spec, plus an
 * asset's own declared width/height, into concrete pixel coordinates + a CSS
 * transform-origin appropriate for that anchor. Agents author "corner + nudge";
 * this is the only place raw pixels get computed.
 */

export const ANCHOR_ALIGN = {
  center: { x: 0.5, y: 0.5 },
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  "top-left": { x: 0, y: 0 },
  "top-right": { x: 1, y: 0 },
  "bottom-left": { x: 0, y: 1 },
  "bottom-right": { x: 1, y: 1 },
};

/**
 * @param {object} anchor - { position, offsetXPercent = 0, offsetYPercent = 0, followAssetId?, anchorEdge? }
 * @param {{width:number, height:number}} composition - full frame size in px
 * @param {{width:number, height:number}} assetSize - the asset's own box size in px
 * @param {{resolvedAssetsById?: Record<string, object>, sceneId?: string}=} ctx
 *   Only needed when anchor.followAssetId is set — same shape resolveAnchorPoint
 *   already accepts for camera followAssetId anchors.
 * @returns {{ left: number, top: number, transformOrigin: string, position: 'absolute' }}
 */
export function resolveAnchor(anchor, composition, assetSize, ctx) {
  const { position, offsetXPercent = 0, offsetYPercent = 0 } = anchor;
  const align = ANCHOR_ALIGN[position];
  if (!align) {
    throw new Error(`Unknown anchor position "${position}". Valid: ${Object.keys(ANCHOR_ALIGN).join(", ")}`);
  }

  // followAssetId: the anchor *point* is computed relative to another
  // resolved asset's box (via the shared resolveAnchorPoint, same code path
  // camera anchors use) instead of a frame corner. offsetXPercent/YPercent
  // still nudge from that point, in composition-space %, exactly as before.
  let anchorX;
  let anchorY;
  if (typeof anchor.followAssetId === "string") {
    const point = resolveAnchorPoint(
      { followAssetId: anchor.followAssetId, anchorEdge: anchor.anchorEdge, offsetXPercent, offsetYPercent },
      composition,
      ctx,
    );
    anchorX = point.x;
    anchorY = point.y;
  } else {
    // Anchor point in the composition, then nudge by the signed % offsets
    // (percentages are relative to composition dimensions, not asset size —
    // this keeps offsets predictable regardless of asset content).
    anchorX = align.x * composition.width + (offsetXPercent / 100) * composition.width;
    anchorY = align.y * composition.height + (offsetYPercent / 100) * composition.height;
  }

  // Pull the asset's own box back so the *anchor point*, not its top-left
  // corner, lands where requested. `position` still controls this pull-back
  // alignment on the asset's OWN box even when followAssetId supplies the
  // anchor point itself.
  const left = anchorX - align.x * assetSize.width;
  const top = anchorY - align.y * assetSize.height;

  return {
    position: "absolute",
    left,
    top,
    transformOrigin: `${align.x * 100}% ${align.y * 100}%`,
  };
}

/**
 * Resolves one of two equivalent anchor specs to a composition-space *point*
 * (not a box left/top):
 *
 *  A. { position, offsetXPercent, offsetYPercent }  — the named-corner +
 *     composition-space % nudge vocabulary every asset's `anchor` uses
 *     (the same math `resolveAnchor` does for its anchorX/Y, minus the
 *     asset-box pull-back).
 *
 *  B. { followAssetId, anchorEdge?, offsetXPercent, offsetYPercent (... edge) }  — the
 *     camera-anchor "track an asset's center" shape: resolve to the followed
 *     asset's resolved box (center by default, or the point named by
 *     anchorEdge — same ANCHOR_ALIGN vocabulary as `position` below), then
 *     nudge by composition-space % offsets.
 *
 * This is the shared resolver underpinning both camera anchors (camera.js's
 * `resolveAnchorPoint`) and any other templated coordinate — e.g. WavyLine
 * endpoints, which author in the same "named corner + nudge" or
 * "follow another asset + nudge" vocabulary rather than raw composition
 * pixels. Returns composition-space { x, y }.
 *
 * `ctx` mirrors the shape `resolveCameraTransform` already passes for camera
 * usage: { resolvedAssetsById, sceneId } for `followAssetId` lookups. A bare
 * (no ctx) call still works for the composition-frame branch — only the
 * follow branch needs ctx.
 *
 * @param {{ position?: string, followAssetId?: string, offsetXPercent?: number, offsetYPercent?: number, edge?: string }} anchor
 * @param {{width:number, height:number}} composition
 * @param {{resolvedAssetsById?: Record<string, object>, sceneId?: string}=} ctx
 * @returns {{ x: number, y: number }}
 */
export function resolveAnchorPoint(anchor, composition, ctx) {
  const position = anchor?.position;
  const offsetXPercent = anchor?.offsetXPercent ?? 0;
  const offsetYPercent = anchor?.offsetYPercent ?? 0;

  // followAssetId: resolve to the target asset's resolved center, then nudge
  // by composition-space %. Identical math to the composition-frame branch —
  // offsets are always a % of the composition, not the asset, so nudges read
  // predictably regardless of asset content size. A missing target throws
  // with the same shape as camera.js' followAssetId error.
  if (typeof anchor?.followAssetId === "string") {
    const target = ctx?.resolvedAssetsById?.[anchor.followAssetId];
    if (!target) {
      throw new Error(
        `Anchor follows asset "${anchor.followAssetId}" but no such asset was resolved ` +
          `in scene "${ctx?.sceneId ?? "?"}". Known: ${
            Object.keys(ctx?.resolvedAssetsById ?? {}).join(", ") || "(none)"
          }. A followed asset must appear earlier in scene.assets than the referencing asset.`,
      );
    }
    const pos = target.resolvedPosition ?? { left: 0, top: 0 };
    const w = target.resolvedStyle?.width ?? 0;
    const h = target.resolvedStyle?.height ?? 0;

    // anchorEdge picks a point on the TARGET's own box (top-left/bottom/etc,
    // the same ANCHOR_ALIGN vocabulary the composition-frame branch below
    // uses) instead of always the target's center. Default "center" means
    // every { followAssetId } anchor authored before this field existed
    // resolves to the identical point it always has.
    const edgeAlign = ANCHOR_ALIGN[anchor.anchorEdge ?? "center"];
    if (!edgeAlign) {
      throw new Error(
        `Unknown anchorEdge "${anchor.anchorEdge}" on a followAssetId anchor. Valid: ${Object.keys(ANCHOR_ALIGN).join(", ")}`,
      );
    }

    return {
      x: pos.left + edgeAlign.x * w + (offsetXPercent / 100) * composition.width,
      y: pos.top + edgeAlign.y * h + (offsetYPercent / 100) * composition.height,
    };
  }

  const align = ANCHOR_ALIGN[position ?? "center"];
  if (!align) {
    throw new Error(
      `Unknown anchor position "${position}". Valid: ${Object.keys(ANCHOR_ALIGN).join(", ")}`,
    );
  }
  return {
    x: align.x * composition.width + (offsetXPercent / 100) * composition.width,
    y: align.y * composition.height + (offsetYPercent / 100) * composition.height,
  };
}

export const ANCHOR_POSITIONS = Object.keys(ANCHOR_ALIGN);
