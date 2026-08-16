import React from "react";

export function PhysicsShape({ resolvedPosition, resolvedStyle }) {
  const { width, height } = resolvedStyle;
  const shape = resolvedStyle.shape ?? "circle";
  const fill = resolvedStyle.fillColorToken ?? "#3D7BFD";
  const stroke = resolvedStyle.strokeColorToken ?? "transparent";
  const strokeWidth = resolvedStyle.strokeWidth ?? 0;

  return (
    <div style={{ ...resolvedPosition, left: 0, top: 0, width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {shape === "circle" ? (
          <circle
            cx={width / 2}
            cy={height / 2}
            r={Math.min(width, height) / 2 - strokeWidth / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        ) : (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={width - strokeWidth}
            height={height - strokeWidth}
            rx={resolvedStyle.borderRadius ?? 0}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        )}
      </svg>
    </div>
  );
}
