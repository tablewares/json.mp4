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

function getRectFromAsset(asset) {
  return {
    left: asset.resolvedPosition.left,
    top: asset.resolvedPosition.top,
    width: asset.resolvedStyle.width,
    height: asset.resolvedStyle.height,
  };
}

export function collectSceneCompositionWarnings(
  sceneId,
  resolvedAssets,
  sceneDurationInFrames = 90,
  options = {},
) {
  const warnings = [];
  const compositionSize = options.compositionSize ?? { width: 1920, height: 1080 };
  const hasNarration = Boolean(options.hasNarration);

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

      const rectA = getRectFromAsset(a);
      const rectB = getRectFromAsset(b);
      const overlapArea = rectIntersectionArea(rectA, rectB);
      if (overlapArea <= 0) continue;

      const areaA = rectA.width * rectA.height;
      const areaB = rectB.width * rectB.height;
      const smallerArea = Math.min(areaA, areaB) || 1;
      const overlapPct = (overlapArea / smallerArea) * 100;

      warnings.push(
        `[overlap-warning] Scene "${sceneId}": asset "${a.id}" (${a.assetType}) and ` +
          `"${b.id}" (${b.assetType}) overlap by ${Math.round(overlapArea)}px² ` +
          `(${overlapPct.toFixed(1)}% of the smaller asset's area) during frames ` +
          `${Math.round(overlapStart)}-${Math.round(overlapEnd)}.`,
      );
    }
  }

  for (const asset of resolvedAssets) {
    const rect = getRectFromAsset(asset);
    const offScreenSides = [];
    if (rect.left < 0) offScreenSides.push("left");
    if (rect.top < 0) offScreenSides.push("top");
    if (rect.left + rect.width > compositionSize.width) offScreenSides.push("right");
    if (rect.top + rect.height > compositionSize.height) offScreenSides.push("bottom");

    if (offScreenSides.length > 0) {
      warnings.push(
        `[composition-warning] Scene "${sceneId}": asset "${asset.id}" (${asset.assetType}) is cut off by the composition bounds on the ${offScreenSides.join(", ")} side${offScreenSides.length > 1 ? "s" : ""}.`,
      );
    }

    const isExtremelySmall = rect.width < compositionSize.width * 0.04 || rect.height < compositionSize.height * 0.04;
    if (isExtremelySmall) {
      warnings.push(
        `[composition-warning] Scene "${sceneId}": asset "${asset.id}" (${asset.assetType}) is extremely small (${Math.round(rect.width)}x${Math.round(rect.height)}px) relative to the composition.`,
      );
    }

    const durationInFrames = Math.max(0, asset.timing.exitAtFrame - asset.timing.enterAtFrame);
    const shortDurationThreshold = Math.max(8, Math.round(sceneDurationInFrames * 0.08));
    if (durationInFrames <= shortDurationThreshold) {
      warnings.push(
        `[composition-warning] Scene "${sceneId}": asset "${asset.id}" (${asset.assetType}) lasts too short (${durationInFrames} frames) for the scene duration.`,
      );
    }
  }

  if (hasNarration) {
    const totalVisibleFrameTime = resolvedAssets.reduce(
      (sum, asset) => sum + Math.max(0, asset.timing.exitAtFrame - asset.timing.enterAtFrame),
      0,
    );
    const activityThreshold = Math.max(15, Math.round(sceneDurationInFrames * 0.25));
    if (totalVisibleFrameTime < activityThreshold) {
      warnings.push(
        `[composition-warning] Scene "${sceneId}": the composition has little visual activity during the narration window (${totalVisibleFrameTime}/${sceneDurationInFrames} frames of asset presence).`,
      );
    }
  }

  return warnings;
}

export function warnOnAssetOverlaps(sceneId, resolvedAssets, sceneDurationInFrames = 90, options = {}) {
  const warnings = collectSceneCompositionWarnings(sceneId, resolvedAssets, sceneDurationInFrames, options);
  warnings.forEach((warning) => console.warn(warning));
}