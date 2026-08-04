/**
 * Warns (never throws) when two assets in the same scene both occupy
 * overlapping screen space AND overlapping timing windows. Spatial overlap
 * alone isn't a problem — an asset that exits before another enters can
 * legitimately share the same coordinates. Only flag it when a viewer could
 * actually see both at once.
 */
export function rectIntersectionArea(a, b) {
  const ax2 = a.left + a.width;
  const ay2 = a.top + a.height;
  const bx2 = b.left + b.width;
  const by2 = b.top + b.height;
  const xOverlap = Math.max(0, Math.min(ax2, bx2) - Math.max(a.left, b.left));
  const yOverlap = Math.max(0, Math.min(ay2, by2) - Math.max(a.top, b.top));
  return xOverlap * yOverlap;
}

export function warnOnAssetOverlaps(sceneId, resolvedAssets) {
  for (let i = 0; i < resolvedAssets.length; i += 1) {
    for (let j = i + 1; j < resolvedAssets.length; j += 1) {
      const a = resolvedAssets[i];
      const b = resolvedAssets[j];

      const aWindowStart = a.timing.enterAtFrame;
      const aWindowEnd = a.timing.exitAtFrame;
      const bWindowStart = b.timing.enterAtFrame;
      const bWindowEnd = b.timing.exitAtFrame;
      const overlapStart = Math.max(aWindowStart, bWindowStart);
      const overlapEnd = Math.min(aWindowEnd, bWindowEnd);
      const hasTemporalOverlap = overlapStart < overlapEnd;
      if (!hasTemporalOverlap) continue;

      const rectA = {
        left: a.resolvedPosition.left,
        top: a.resolvedPosition.top,
        width: a.resolvedStyle.width,
        height: a.resolvedStyle.height,
      };
      const rectB = {
        left: b.resolvedPosition.left,
        top: b.resolvedPosition.top,
        width: b.resolvedStyle.width,
        height: b.resolvedStyle.height,
      };

      const overlapArea = rectIntersectionArea(rectA, rectB);
      if (overlapArea <= 0) continue;

      const areaA = rectA.width * rectA.height;
      const areaB = rectB.width * rectB.height;
      const smallerArea = Math.min(areaA, areaB) || 1;
      const overlapPct = (overlapArea / smallerArea) * 100;

      console.warn(
        `[overlap-warning] Scene "${sceneId}": asset "${a.id}" (${a.assetType}) and ` +
          `"${b.id}" (${b.assetType}) overlap by ${Math.round(overlapArea)}px² ` +
          `(${overlapPct.toFixed(1)}% of the smaller asset's area) during frames ` +
          `${Math.round(overlapStart)}-${Math.round(overlapEnd)}.`
      );
    }
  }
}