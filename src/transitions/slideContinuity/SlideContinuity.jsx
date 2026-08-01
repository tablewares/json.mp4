import React from "react";
import { AbsoluteFill, interpolate } from "remotion";

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Renders the outgoing and incoming scenes underneath (via `children`, as
 * usual), then draws a single "carried" box on top that morphs in position,
 * size, and background color from where it sat in the outgoing scene to
 * where it sits in the incoming scene. This is what makes the cut read as
 * continuous motion rather than two unrelated slides.
 *
 * `props.carryFrom` / `props.carryTo` are populated by pipeline2 from the
 * resolved position + style of the asset named by `carryAssetId` in each
 * scene — this component never looks anything up itself.
 */
function SlideContinuityComponent({ children, presentationProgress, carryFrom, carryTo }) {
  if (!carryFrom || !carryTo) return <AbsoluteFill>{children}</AbsoluteFill>;

  const t = presentationProgress;
  const left = lerp(carryFrom.left, carryTo.left, t);
  const top = lerp(carryFrom.top, carryTo.top, t);
  const width = lerp(carryFrom.width, carryTo.width, t);
  const height = lerp(carryFrom.height, carryTo.height, t);
  const borderRadius = lerp(carryFrom.borderRadius ?? 0, carryTo.borderRadius ?? 0, t);

  return (
    <AbsoluteFill>
      {children}
      <div
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          borderRadius,
          background: carryFrom.backgroundColor,
          opacity: interpolate(t, [0, 0.1, 0.9, 1], [0, 1, 1, 0]),
        }}
      />
    </AbsoluteFill>
  );
}

/** Factory: `<TransitionSeries.Transition presentation={slideContinuity({carryFrom, carryTo})} .../>` */
export function slideContinuity(props) {
  return { component: SlideContinuityComponent, props };
}
