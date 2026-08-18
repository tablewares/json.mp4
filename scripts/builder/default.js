// src/agent/defaults.js
//
// Sensible defaults for an agent only overrides what it cares about.
// Colors, typography, spacing, and easing are merged key-by-key
// (mergeTheme), so e.g. passing colors: { accentBg: "#FF0000" }
// keeps every other token intact.
//
// Split out of ProjectBuilder.js so the constants + the deep-merge
// helper live in a place that has no runtime side-effects and no
// dependency on fs / path / registries — an importer that only wants
// DEFAULT_THEME for a sprite never pulls in the AJV / IO machinery.

export const DEFAULT_CONFIG = {
  fps: 30,
  width: 1920,
  height: 1080,
  defaultSceneDurationInFrames: 150,
};

export const DEFAULT_THEME = {
  colors: {
    shade1: "#0B0E14",
    shade2: "#161B26",
    main1: "#F5F7FA",
    main2: "#8B93A7",
    accentBg: "#3D7BFD",
    accentGreen: "#16C784",
    accentRed: "#EA3943",
    accentViolet: "#C04CFD",
    accentWarm: "#FFD166",
    transparent: "#00000000",
  },
  typography: {
    heading1: { fontFamily: "Inter, sans-serif", fontSize: 84, fontWeight: 800, lineHeight: 1.05, colorToken: "main1" },
    heading2: { fontFamily: "Inter, sans-serif", fontSize: 56, fontWeight: 700, lineHeight: 1.1, colorToken: "main1" },
    body1: { fontFamily: "Inter, sans-serif", fontSize: 36, fontWeight: 400, lineHeight: 1.35, colorToken: "main1" },
    caption1: { fontFamily: "Inter, sans-serif", fontSize: 28, fontWeight: 600, lineHeight: 1.2, colorToken: "main2" },
    kicker1: { fontFamily: "Inter, sans-serif", fontSize: 24, fontWeight: 700, lineHeight: 1.1, colorToken: "accentBg" },
  },
  spacing: { sceneMargin: 96, gutter: 32 },
  easing: {
    gentleSpring: { damping: 16, mass: 0.7, stiffness: 110 },
    snappySpring: { damping: 12, mass: 0.4, stiffness: 180 },
  },
};

export function mergeTheme(base, overrides = {}) {
  const merged = {
    colors: { ...base.colors },
    typography: { ...base.typography },
    spacing: { ...base.spacing },
    easing: { ...base.easing },
  };
  for (const category of ["colors", "typography", "spacing", "easing"]) {
    if (overrides[category]) Object.assign(merged[category], overrides[category]);
  }
  return merged;
}