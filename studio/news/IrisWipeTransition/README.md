# motion.js

Reusable animation math shared by assets and transitions. Pure functions
of `(frame, fps, ...)` — no hooks, no JSX — so any component can import
what it needs after calling its own `useCurrentFrame()`/`useVideoConfig()`.

- **Spring presets**: `SPRING_PRESETS`, `resolveSpringConfig(nameOrConfig)`
- **Enter/exit**: `enterExitProgress(...)`, `computeExitOpacity(...)`, `popIn(...)`
- **Stagger**: `narrationAwareStagger(...)` — the same word/item timing logic KineticText uses today, generalized for reuse by future word- or item-based assets
- **Loops**: `pulse(...)`, `pulseBetween(...)` — for badges, glow rings, live indicators; independent of enter/exit timing
- **Clip-path reveals**: `CLIP_REVEALS`, `clipReveal(direction, progress)` — adds `"iris"` alongside the directions ImageReveal already supports locally
- **Easing curves**: `EASE_CURVES`, `easeCurve(name)`, `shapeProgress(progress, name)` — for transitions that want a shaped, non-spring curve

Existing components (KineticText, AssetBoilerplate, ImageReveal, the
default transition) keep their own inline math untouched — nothing here
changes their behavior. GlowPulse (asset) and irisWipe (transition) are
the first consumers, pulling shared math from here instead of
re-deriving it.
