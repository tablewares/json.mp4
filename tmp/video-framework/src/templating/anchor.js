/**
 * Resolves an { position, offsetXPercent, offsetYPercent } anchor spec, plus an
 * asset's own declared width/height, into concrete pixel coordinates + a CSS
 * transform-origin appropriate for that anchor. Agents author "corner + nudge";
 * this is the only place raw pixels get computed.
 */

const ANCHOR_ALIGN = {
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
 * @param {object} anchor - { position, offsetXPercent = 0, offsetYPercent = 0 }
 * @param {{width:number, height:number}} composition - full frame size in px
 * @param {{width:number, height:number}} assetSize - the asset's own box size in px
 * @returns {{ left: number, top: number, transformOrigin: string, position: 'absolute' }}
 */
export function resolveAnchor(anchor, composition, assetSize) {
  const { position, offsetXPercent = 0, offsetYPercent = 0 } = anchor;
  const align = ANCHOR_ALIGN[position];
  if (!align) {
    throw new Error(`Unknown anchor position "${position}". Valid: ${Object.keys(ANCHOR_ALIGN).join(", ")}`);
  }

  // Anchor point in the composition, then nudge by the signed % offsets
  // (percentages are relative to composition dimensions, not asset size —
  // this keeps offsets predictable regardless of asset content).
  const anchorX = align.x * composition.width + (offsetXPercent / 100) * composition.width;
  const anchorY = align.y * composition.height + (offsetYPercent / 100) * composition.height;

  // Pull the asset's own box back so the *anchor point*, not its top-left
  // corner, lands where requested.
  const left = anchorX - align.x * assetSize.width;
  const top = anchorY - align.y * assetSize.height;

  return {
    position: "absolute",
    left,
    top,
    transformOrigin: `${align.x * 100}% ${align.y * 100}%`,
  };
}

export const ANCHOR_POSITIONS = Object.keys(ANCHOR_ALIGN);
