import React from "react";
import { AbsoluteFill, interpolate } from "remotion";

/**
 * Starter transition template. Adapt the direction/distance logic to create
 * a new transition without reworking the Remotion presentation contract.
 */
export function TransitionBoilerplate({
  children,
  presentationProgress,
  presentationDirection,
  direction = "left",
  distance = 32,
}) {
  const isEntering = presentationDirection === "entering";
  const opacity = isEntering
    ? interpolate(presentationProgress, [0, 1], [0, 1])
    : interpolate(presentationProgress, [0, 1], [1, 0]);

  let translate = 0;
  if (direction === "right") {
    translate = isEntering
      ? interpolate(presentationProgress, [0, 1], [distance * -1, 0])
      : interpolate(presentationProgress, [0, 1], [0, distance]);
  } else if (direction === "up") {
    translate = isEntering
      ? interpolate(presentationProgress, [0, 1], [distance, 0])
      : interpolate(presentationProgress, [0, 1], [0, distance * -1]);
  } else if (direction === "down") {
    translate = isEntering
      ? interpolate(presentationProgress, [0, 1], [distance * -1, 0])
      : interpolate(presentationProgress, [0, 1], [0, distance]);
  } else {
    translate = isEntering
      ? interpolate(presentationProgress, [0, 1], [distance, 0])
      : interpolate(presentationProgress, [0, 1], [0, distance * -1]);
  }

  const transform = direction === "up" || direction === "down"
    ? `translateY(${translate}px)`
    : `translateX(${translate}px)`;

  return (
    <AbsoluteFill style={{ opacity, transform }}>
      {children}
    </AbsoluteFill>
  );
}
