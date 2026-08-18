// src/agent/transitions.js
//
// Backfills `durationInFrames` from the transition registry's
// `defaultDurationInFrames` when the agent omits it — so a
// `{"type":"default"}`-style spec produces a `{"type":"default", ...
// "durationInFrames":18}` on disk that matches what the renderer will
// actually play. Without this, resolve.js's scene-padding computation
// (resolve.js:211-213) reads `scene.transitionOut?.durationInFrames ?? 0`,
// gets 0, and the scene runs back-to-back with no pad — but the
// transition-overlay itself still plays for the registry default 18
// frames, silently eating the next scene's first 18 frames for the cut.
//
// Split out of ProjectBuilder.js: the only dependency is the transition
// registry loader, and both setTransitionOut and addScene call this on
// the hot path, so isolating it keeps the ProjectBuilder surface thin.

import { loadTransitionRegistry } from "../../src/registry/assetRegistry.js";

export function normalizeTransitionOut(spec, registry) {
  const reg = registry ?? loadTransitionRegistry();
  const type = spec?.type;
  const entry = reg[type];
  if (!entry) {
    throw new Error(`Unknown transitionType "${type}". Available: ${Object.keys(reg).join(", ")}`);
  }
  const out = { ...spec };
  if (out.durationInFrames === undefined) {
    const def = entry.manifest?.defaultDurationInFrames;
    if (typeof def === "number" && def > 0) out.durationInFrames = def;
  }
  return out;
}