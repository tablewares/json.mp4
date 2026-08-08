import React from "react";
import {
  Composition,
  Folder,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  AbsoluteFill,
  registerRoot,
} from "remotion";

// ==========================================
// 1. BICYCLE ASSET COMPONENT
// ==========================================
export function BicycleAsset({
  resolvedPosition,
  resolvedStyle,
  content,
  timing,
}: {
  resolvedPosition?: React.CSSProperties;
  resolvedStyle?: {
    width?: number;
    height?: number;
    easing?: { damping?: number; mass?: number; stiffness?: number };
  };
  content?: { speed?: number };
  timing: {
    durationInFrames: number;
    enterAtFrame?: number;
    exitAtFrame?: number;
  };
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const {
    durationInFrames,
    enterAtFrame = 0,
    exitAtFrame = durationInFrames,
  } = timing;

  // Entrance & Exit Timing
  const enterProgress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle?.easing ?? { damping: 14, mass: 0.6, stiffness: 120 },
  });

  const framesUntilExit = exitAtFrame - frame;
  const exitProgress = interpolate(
    framesUntilExit,
    [0, Math.min(15, durationInFrames * 0.15)],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const progress = Math.min(enterProgress, exitProgress);
  const opacity = progress;
  const translateY = interpolate(progress, [0, 1], [30, 0]);

  // Wheel Rotation Logic
  const speed = content?.speed ?? 8;
  const wheelRotation = (frame * speed) % 360;

  // Dynamic Metallic Glint Sweep
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
          <linearGradient
            id="silverChrome"
            x1={`${glintOffset}%`}
            y1="0%"
            x2={`${glintOffset + 50}%`}
            y2="100%"
          >
            <stop offset="0%" stopColor="#8a95a5" />
            <stop offset="25%" stopColor="#cfd6df" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="75%" stopColor="#9ba5b3" />
            <stop offset="100%" stopColor="#5a6370" />
          </linearGradient>

          <linearGradient id="darkSteel" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4e545c" />
            <stop offset="50%" stopColor="#8a929e" />
            <stop offset="100%" stopColor="#2c3036" />
          </linearGradient>

          <radialGradient id="rimShine" cx="50%" cy="50%" r="50%">
            <stop offset="70%" stopColor="#bdc5d1" />
            <stop offset="90%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#4a5059" />
          </radialGradient>
        </defs>

        {/* REAR WHEEL */}
        <g transform="translate(100, 210)">
          <circle r="75" fill="none" stroke="#1a1d20" strokeWidth="10" />
          <circle r="70" fill="none" stroke="url(#rimShine)" strokeWidth="5" />
          <g
            style={{
              transform: `rotate(${wheelRotation}deg)`,
              transformOrigin: "0px 0px",
            }}
          >
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

        {/* FRONT WHEEL */}
        <g transform="translate(380, 210)">
          <circle r="75" fill="none" stroke="#1a1d20" strokeWidth="10" />
          <circle r="70" fill="none" stroke="url(#rimShine)" strokeWidth="5" />
          <g
            style={{
              transform: `rotate(${wheelRotation}deg)`,
              transformOrigin: "0px 0px",
            }}
          >
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

        {/* METALLIC FRAME */}
        <g
          stroke="url(#silverChrome)"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <path d="M 100 210 L 220 210 L 150 110 Z" strokeWidth="8" />
          <path d="M 220 210 L 330 100 L 170 100 Z" strokeWidth="10" />
          <path d="M 380 210 L 340 80 L 320 60" strokeWidth="9" />
          <path d="M 220 210 L 160 80" strokeWidth="9" />
        </g>

        {/* SADDLE & PEDALS */}
        <path d="M 135 80 Q 160 70 185 80 Z" fill="#222" />
        <g transform="translate(220, 210)">
          <circle r="22" fill="url(#darkSteel)" />
          <circle
            r="18"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            opacity="0.5"
          />
          <g
            style={{
              transform: `rotate(${wheelRotation * 0.4}deg)`,
              transformOrigin: "0px 0px",
            }}
          >
            <line
              x1="0"
              y1="-30"
              x2="0"
              y2="30"
              stroke="url(#silverChrome)"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <rect x="-12" y="-35" width="24" height="6" rx="2" fill="#111" />
            <rect x="-12" y="29" width="24" height="6" rx="2" fill="#111" />
          </g>
        </g>
      </svg>
    </div>
  );
}

// ==========================================
// 2. PREVIEW SCENE ENVIRONMENT
// ==========================================
export function BicyclePreviewScene() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Subtle ground line pattern shift to emphasize motion
  const roadOffset = (frame * 12) % 60;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0d1117",
        color: "#ffffff",
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Background Studio Light Grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            radial-gradient(circle at 50% 30%, rgba(255,255,255,0.08) 0%, transparent 70%),
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "100% 100%, 40px 40px, 40px 40px",
        }}
      />

      {/* Moving Road Surface */}
      <div
        style={{
          position: "absolute",
          bottom: 280,
          width: "100%",
          height: 2,
          backgroundColor: "#30363d",
          boxShadow: "0 0 10px rgba(255,255,255,0.2)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 260,
          width: "100%",
          height: 4,
          backgroundImage:
            "repeating-linear-gradient(90deg, #58a6ff 0px, #58a6ff 30px, transparent 30px, transparent 60px)",
          backgroundPosition: `-${roadOffset}px 0px`,
          opacity: 0.3,
        }}
      />

      {/* Asset under test */}
      <BicycleAsset
        resolvedPosition={{ position: "relative", zIndex: 10 }}
        resolvedStyle={{ width: 700, height: 420 }}
        content={{ speed: 10 }}
        timing={{
          durationInFrames,
          enterAtFrame: 10,
          exitAtFrame: durationInFrames - 15,
        }}
      />

      {/* Ground Contact Shadow */}
      <div
        style={{
          position: "absolute",
          bottom: 270,
          width: 580,
          height: 18,
          backgroundColor: "rgba(0,0,0,0.6)",
          borderRadius: "50%",
          filter: "blur(8px)",
        }}
      />

      {/* On-screen Telemetry Overlay */}
      <div
        style={{
          position: "absolute",
          top: 40,
          left: 40,
          padding: "12px 20px",
          backgroundColor: "rgba(22, 27, 34, 0.8)",
          border: "1px solid #30363d",
          borderRadius: 8,
          fontSize: 14,
          lineHeight: 1.6,
          color: "#8b949e",
        }}
      >
        <div style={{ color: "#58a6ff", fontWeight: 700, marginBottom: 4 }}>
          ASSET INSPECTOR
        </div>
        <div>
          Frame: <span style={{ color: "#fff" }}>{frame}</span>
        </div>
        <div>
          Status:{" "}
          <span style={{ color: "#3fb950" }}>
            {frame < 10
              ? "Entering"
              : frame > durationInFrames - 15
              ? "Exiting"
              : "Active"}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ==========================================
// 3. REMOTION ROOT REGISTRATION
// ==========================================
export function RemotionRoot() {
  return (
    <Folder name="Asset-Viewer">
      <Composition
        id="BicycleViewer"
        component={BicyclePreviewScene}
        durationInFrames={180}
        fps={30}
        width={1280}
        height={720}
      />
    </Folder>
  );
}


registerRoot(RemotionRoot);
    