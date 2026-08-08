# SVG substrate (`src/svg/`)

A drawing + motion layer for the asset library. Lets an asset render crisp
gradients, masked/draw-on geometry, glow, and per-glyph text — none of which
the old flat-CSS-div primitives could do. The pipeline contract is untouched:
this is a set of React components assets *import*, exactly like they import
from `remotion`.

## The contract the framework already gives you

Every asset receives four props (see `resolve.js` ->
`resolveScene`, and `Composition.jsx`):
  - `resolvedPosition` — `{ position:'absolute', left, top, transformOrigin }`
                     from `anchor.js`. Spread onto the host element.
  - `resolvedStyle`    — resolved style object; `width`/`height` are baked in.
  - `content`         — the merged contentOverride.
  - `timing`          — `{ durationInFrames, enterAtFrame, exitAtFrame }`. The
                        ONLY animation budget the asset gets.

SvgStage consumes `resolvedPosition` (for layout), `resolvedStyle` (for the
svg box size + optional `easing`), and `timing` (which it feeds to useReveal
inside RevealContext). Children draw in the stage's local `0 0 width height`
viewBox — never composition pixels, never the camera transform.

## One animation budget, shared

`useReveal(timing, options)` returns `{ reveal, enter, exitOpacity, frame,
fps, localFrame, duration }`. `reveal` is the single 0..1 value a primitive
should drive its draw/opacity from; it GUARANTEED lands ~1 before the exit
blind (last 15% of the window) starts, so figures finish landing then leave.
Anything that staggers (bars, words) calls useReveal again with its own
`enterFrame` — same contract, just shifted.

The old flat-div assets each re-implemented their own spring+fade. This is
the thing that made every output visually uniform. Now the whole substrate
shares one easing source and one exit policy.

## Minimal asset

```jsx
import { SvgStage, Bar, Text, LinearGradient, Glow } from "../../svg/index.jsx";

export function MyChart({ resolvedPosition, resolvedStyle, content, timing }) {
  const w = resolvedStyle.width ?? 600;
  const h = resolvedStyle.height ?? 300;
  return (
    <SvgStage resolvedPosition={resolvedPosition} resolvedStyle={resolvedStyle} timing={timing}>
      <LinearGradient id="myg" from="#3D7BFD" to="#C04CFD" angle={90} />
      <Glow id="myglow" strength={8} color="#3D7BFD" />
      <Bar x={40} y={20} width={120} height={h - 60} grow="up"
           fill="url(#myg)" rx={8} style={{ filter: "url(#myglow)" }} />
      <Text x={w - 24} y={h - 24} text={content.label} anchor="end" stagger />
    </SvgStage>
  );
}
```

No `useCurrentFrame`, no `spring`, no inline-div styling in the asset itself:
the substrate owns all of that. The asset just composes geometry.

## Adding new primitives

A primitive reads `useRevealContext()` for `{ reveal, frame, timing,
viewBox }` (anything passed `reveal` explicitly wins — that's the stagger
escape hatch), then animates from `reveal`. Keep primitives pixel-geometry
pure — no composition deps. Put new ones in `primitives.jsx` and export
through `index.jsx`.
