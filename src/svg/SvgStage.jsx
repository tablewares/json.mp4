import React from "react";
import { StageReveal } from "./RevealContext.jsx";

/**
 * SvgStage — the SVG drawing substrate for the asset library.
 *
 * OLD pattern (the thing that capped every asset at "flat div + spring"):
 *   each asset spread `resolvedPosition` onto a <div>, styled with inline
 *   CSS, and re-implemented its own spring/opacity fade. No gradients, no
 *   masks, no filters, no per-glyph anything — exactly because CSS divs
 *   don't expose those primitives cheaply.
 *
 * THIS pattern: an asset spreads `resolvedPosition` onto SvgStage's host
 * <div> (the established layout convention — resolveAnchor already
 * returns { position:'absolute', left, top, transformOrigin }), and
 * SvgStage renders a sized <svg viewBox="0 0 width height"> inside it. All
 * children draw in the stage's LOCAL integer coordinate space; nobody
 * touches composition pixels or knows the camera transform (that lives on
 * the parent AbsoluteFill in Composition.jsx, untouched here).
 *
 * Props (drop-in compatible with the existing asset contract):
 *   resolvedPosition - { position, left, top, transformOrigin } from anchor.js
 *   resolvedStyle    - resolved style; reads width/height (defaults 720x360)
 *                      and easing (a remotion spring config, optional)
 *   timing           - { durationInFrames, enterAtFrame, exitAtFrame }
 *   content          - unused by the stage itself; assets read it above
 *
 * Children run inside <RevealContext.Provider>, so every primitive below
 * gets `reveal`/`enter`/`exitOpacity`/`frame`/`fps`/`viewBox` for free. A
 * primitive that wants to stagger still calls useReveal itself with its own
 * enterFrame; the context value is the stage-wide default.
 *
 * viewBox policy: width/height come from resolvedStyle (resolve.js already
 * merges defaultSize + styleOverride.width/height into resolvedStyle). We
 * trap to >=1 so a 0-size asset (malformed manifest) can't NaN the viewBox.
 */
export function SvgStage({
  resolvedPosition,
  resolvedStyle = {},
  timing,
  content,
  children,
  ...rest
}) {
  const width = Math.max(1, Number(resolvedStyle.width ?? 720));
  const height = Math.max(1, Number(resolvedStyle.height ?? 360));
  const easing = resolvedStyle.easing ?? undefined;
  const viewBox = { width, height };

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        // SVG owns its own box; the host div is just the layout shell.
        ...(rest.style ?? {}),
      }}
    >
      <StageReveal timing={timing} easing={easing} viewBox={viewBox}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block", overflow: "visible" }}
        >
          {children}
        </svg>
      </StageReveal>
    </div>
  );
}

export default SvgStage;
