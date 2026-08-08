import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

export function BicycleAsset({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  // 1. Entrance & Exit Timing (Matching your pipeline logic)
  const enterProgress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle?.easing ?? { damping: 14, mass: 0.6, stiffness: 120 },
  });

  const framesUntilExit = exitAtFrame - frame;
  const exitProgress = interpolate(framesUntilExit, [0, Math.min(15, durationInFrames * 0.15)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const progress = Math.min(enterProgress, exitProgress);
  const opacity = progress;
  const translateY = interpolate(progress, [0, 1], [30, 0]);

  // 2. Wheel Rotation Logic (Continuous spin based on video frame)
  const speed = content?.speed ?? 8; // Degrees per frame
  const wheelRotation = (frame * speed) % 360;

  // 3. Dynamic Metallic Glint Sweep
  const glintOffset = interpolate(frame % 60, [0, 60], [-50, 150]);

  const width = resolvedStyle?.width ?? 600;
  const height = resolvedStyle?.height ?? 360;

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        opacity,
        transform: `translateY(${translateY}px)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        viewBox="0 0 500 320"
        width="100%"
        height="100%"
        style={{ overflow: "visible" }}
      >
        <defs>
          {/* Silver Chrome Gradient for Frame */}
          <linearGradient id="silverChrome" x1={`${glintOffset}%`} y1="0%" x2={`${glintOffset + 50}%`} y2="100%">
            <stop offset="0%" stopColor="#8a95a5" />
            <stop offset="25%" stopColor="#cfd6df" />
            <stop offset="50%" stopColor="#ffffff" /> {/* Specular Highlight */}
            <stop offset="75%" stopColor="#9ba5b3" />
            <stop offset="100%" stopColor="#5a6370" />
          </linearGradient>

          {/* Dark Metallic Steel Gradient */}
          <linearGradient id="darkSteel" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4e545c" />
            <stop offset="50%" stopColor="#8a929e" />
            <stop offset="100%" stopColor="#2c3036" />
          </linearGradient>

          {/* Wheel Rim Radial Gradient */}
          <radialGradient id="rimShine" cx="50%" cy="50%" r="50%">
            <stop offset="70%" stopColor="#bdc5d1" />
            <stop offset="90%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#4a5059" />
          </radialGradient>
        </defs>

        {/* --- REAR WHEEL --- */}
        <g transform="translate(100, 210)">
          {/* Tire & Rim */}
          <circle r="75" fill="none" stroke="#1a1d20" strokeWidth="10" />
          <circle r="70" fill="none" stroke="url(#rimShine)" strokeWidth="5" />
          
          {/* Rotating Spokes & Hub */}
          <g style={{ transform: `rotate(${wheelRotation}deg)`, transformOrigin: "0px 0px" }}>
            <circle r="12" fill="url(#darkSteel)" />
            {[0, 30, 60, 90, 120, 150].map((deg) => (
              <line
                key={deg}
                x1="-68"
                y1="0"
                x2="68"
                y2="0"
                stroke="#d6dce5"
                strokeWidth="1.5"
                opacity="0.85"
                transform={`rotate(${deg})`}
              />
            ))}
          </g>
        </g>

        {/* --- FRONT WHEEL --- */}
        <g transform="translate(380, 210)">
          {/* Tire & Rim */}
          <circle r="75" fill="none" stroke="#1a1d20" strokeWidth="10" />
          <circle r="70" fill="none" stroke="url(#rimShine)" strokeWidth="5" />
          
          {/* Rotating Spokes & Hub */}
          <g style={{ transform: `rotate(${wheelRotation}deg)`, transformOrigin: "0px 0px" }}>
            <circle r="12" fill="url(#darkSteel)" />
            {[0, 30, 60, 90, 120, 150].map((deg) => (
              <line
                key={deg}
                x1="-68"
                y1="0"
                x2="68"
                y2="0"
                stroke="#d6dce5"
                strokeWidth="1.5"
                opacity="0.85"
                transform={`rotate(${deg})`}
              />
            ))}
          </g>
        </g>

        {/* --- METALLIC FRAME --- */}
        <g stroke="url(#silverChrome)" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* Chainstay & Seatstay */}
          <path d="M 100 210 L 220 210 L 150 110 Z" strokeWidth="8" />
          {/* Main Triangle */}
          <path d="M 220 210 L 330 100 L 170 100 Z" strokeWidth="10" />
          {/* Front Fork & Handlebar Post */}
          <path d="M 380 210 L 340 80 L 320 60" strokeWidth="9" />
          {/* Seat Post */}
          <path d="M 220 210 L 160 80" strokeWidth="9" />
        </g>

        {/* --- ACCENTS (Saddle & Pedals) --- */}
        {/* Saddle */}
        <path d="M 135 80 Q 160 70 185 80 Z" fill="#222" />
        
        {/* Bottom Bracket / Crankset */}
        <g transform="translate(220, 210)">
          <circle r="22" fill="url(#darkSteel)" />
          <circle r="18" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.5" />
          {/* Rotating Pedals */}
          <g style={{ transform: `rotate(${wheelRotation * 0.4}deg)`, transformOrigin: "0px 0px" }}>
            <line x1="0" y1="-30" x2="0" y2="30" stroke="url(#silverChrome)" strokeWidth="6" strokeLinecap="round" />
            <rect x="-12" y="-35" width="24" height="6" rx="2" fill="#111" />
            <rect x="-12" y="29" width="24" height="6" rx="2" fill="#111" />
          </g>
        </g>
      </svg>
    </div>
  );
}