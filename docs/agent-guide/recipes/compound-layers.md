# Compound layers — layer and reuse assets inside one container

A `Compound` asset is a container that layers and times other registered
assets inside its own box + timing window. It exists to make two patterns
trivially authorable without writing a new asset each time:

1. **Highlighter trailing kinetic text** — a highlighter stroke that draws
   out slightly *behind* the words of a KineticText. Both pieces are separate
   registered assets (Highlighter, KineticText) reused inside a Compound with
   `z` set so the highlight paints behind the text.

2. **Crumpled paper unfolding to reveal something else** — a solid "cover"
   layer that exits early (`exitAt: 0.4`) and a "reveal" layer behind it that
   enters just before (`enterAt: 0.38`). The eye reads the cover
   peeling/crumpling away to expose the content.

Both patterns are just `enterAt`/`exitAt`/`z` on layers — no extra plumbing,
no special-case assets. You declare layers in `contentOverride.layers`, each
layer shaped exactly like a scene's `assets[]` entry.

## How it works

- The Compound is itself a registered asset, so it lives at scene scope with
  its own `anchor`, `enterAt`/`exitAt`, and `styleOverride.width`/`height`. It
  gets the same anchor + token + timing resolution every scene asset gets.
- Each layer's `anchor` is resolved **relative to the Compound's box**, not
  the composition frame — `bottom-left` means the bottom-left of the
  Compound. This is `src/templating/subasset.js`, the compound-asset twin of
  `src/templating/anchor.js`: the same corner + nudge anchor model, re-rooted
  to the container.
- Each layer's `enterAt`/`exitAt` are fractions of the Compound's own window,
  resolved to frames inside `[Compound.enterAtFrame, Compound.exitAtFrame]`,
  auto-clamped so a layer can never run past the container's exit — the same
  fraction → frame contract scene assets use, just re-rooted.
- Each layer's `styleOverride` and `contentOverride` go through the same
  token + style registry pipeline as scene assets, so
  `typography: "heading1"` resolves inside a layer exactly as it does at scene
  scope.
- Layer paint order is `z`: lower `z` first (further from viewer), higher `z`
  on top. Default `0`. Same rule `Composition.jsx`'s SceneLayer uses for scene
  assets.

## Layer spec shape

```
{
  id:           "hl",                       # optional; auto-assigned if absent
  assetType:    "Highlighter",              # any registered assetType
  anchor:       { position, offsetXPercent?, offsetYPercent? },  # relative to Compound box
  enterAt:      0.0,                        # fraction of Compound window [0,1]
  exitAt:       0.85,                       # fraction of Compound window [0,1]
  z:           -1,                          # paints behind a z:0 layer
  contentOverride: { ...asset content },
  styleOverride:    { ...asset style }
}
```

If you know how to author a scene asset, you know how to author a compound
layer — same fields, same schema, same defaults.

## Recipe 1 — highlighter trailing kinetic text

`studio/manifest/compound-demo/scenes/scene-001.toon`:

```toon
id: scene-001
background: shade2
assets[1]:
  - id: headlineCompound
    assetType: Compound
    anchor:
      position: top
      offsetXPercent: 0
      offsetYPercent: 6
    styleOverride:
      width: 1280
      height: 220
    enterAt: 0
    exitAt: 1
    contentOverride:
      layers[2]:
        - id: hl
          assetType: Highlighter
          anchor:
            position: bottom-left
            offsetXPercent: 4
            offsetYPercent: -8
          enterAt: 0
          exitAt: 0.85
          z: -1
          styleOverride:
            width: 980
            thickness: 44
            markerFill: "#FFE066"
            fillOpacity: 0.6
            blendMode: multiply
            easing: snappySpring
        - id: kt
          assetType: KineticText
          anchor:
            position: bottom-left
            offsetXPercent: 4
          enterAt: 0.08
          exitAt: 1
          z: 0
          contentOverride:
            text: "compound layers reuse assets"
          styleOverride:
            typography: heading1
            staggerFrames: 6
            wordPopScale: 1.18
            align: left
            useNarrationTiming: false
```

Why this reads as "trailing":
- The Highlighter is `z: -1` (paints behind), KineticText `z: 0` (on top).
- The Highlighter `enterAt: 0` starts first; KineticText `enterAt: 0.08`
  starts ~10% later. The wipe lands ahead of the words.
- Highlighter `exitAt: 0.85` leaves slightly before the text does — the stroke
  vanishes while the words are still legible, avoiding a sudden simultaneous
  disappearance.

`Highlighter` is a standalone reusable asset too — you can use it at scene
scope (as its own asset with `z` below a sibling text asset), not only inside a
Compound.

## Recipe 2 — cover lifts to reveal

`studio/manifest/compound-demo/scenes/scene-002.toon` — same two-layer shape,
flipped so the cover is *on top* and exits early, not behind and trailing:

```toon
layers[2]:
  # reveal layer BEHIND — the content the viewer actually wants to read
  - id: reveal
    assetType: TextReveal
    anchor: { position: center }
    enterAt: 0.2       # enters just before the cover finishes leaving
    exitAt: 1
    z: 0
    contentOverride: { text: "the crumpled cover lifts" }
    styleOverride:
      typography: body1
      revealMode: fade
      align: center
      easing: gentleSpring

  # cover layer ABOVE — a solid bar that wipes out early (the "paper")
  - id: cover
    assetType: Highlighter       # Highlighter sized as a solid block works as a cover
    anchor: { position: center }
    enterAt: 0
    exitAt: 0.45                 # cover leaves at ~45% of the Compound window
    z: 1                         # paints on top of z:0
    styleOverride:
      width: 900
      thickness: 220
      markerFill: "#3D7BFD"
      fillOpacity: 1
      blendMode: normal
      borderRadius: 16
      easing: gentleSpring
```

The eye reads cover-then-reveal as one motion because the reveal enters at
0.20 (24 frames into a 120-frame window) while the cover exits at 0.45 (54
frames) — a small overlap, not a clean hand-off.

This is the same shape as recipe 1, just with the timing flipped. To get the
visual to actually read as paper *crumpling*, swap the Highlighter cover for
an `ImageReveal` with a paper texture (`content.src: "assets/paper.png"`,
`revealDirection: "left-to-right"`) and let its `exitAt` (~0.4) drive the
"unfolding": the ImageReveal's clip-path wipe is the unfolding motion. The
underlying TextReveal/whatever sits at `z: 0`, behind the image.

## Pipeline internals (for agents debugging resolve.js)

- `src/templating/subasset.js` — `resolveLayers(layers, ctx)` is the
  compound-asset twin of `src/templating/anchor.js`. Same `ANCHOR_ALIGN` map,
  same corner-minus-nudge math; only the reference frame changes (container
  box instead of composition frame). Same token + style resolution via
  `resolveAssetStyle` + the `backgroundColorToken` inline branch that
  `resolve.js`'s `resolveScene` already applies to scene assets.
- `src/pipelines/pipeline2-resolve/resolve.js` calls `resolveCompoundLayers`
  (= `resolveLayers`) for any asset whose `assetType === "Compound"` and
  stores the resolved layers in `content._resolvedLayers`. Each layer ends up
  shaped exactly like a resolved scene asset, so the Compound renderer can
  stay trivial — it just renders already-resolved descriptors in `z`-order.
- `studio/assets/Compound/Compound.jsx` — the renderer. Loads each layer's
  component lazily through the generated registry manifest (same mechanism as
  `Composition.jsx`), then mounts them inside an `overflow: hidden` box.
- `studio/assets/Highlighter/Highlighter.jsx` — the standalone highlighter
  stroke asset. Reusable at scene scope OR as a Compound layer.

## What NOT to do

- Don't author raw `content.layers` at render time. Reaching into
  `content._resolvedLayers` from a Compound is correct; reaching into
  `content.layers` (the authored spec) is wrong — those tokens haven't been
  resolved against the styles map and will throw.
- Don't size the Compound box smaller than the largest layer. The container
  is `overflow: hidden`; layers that extend beyond the box are clipped. Size
  the Compound to fit, not the other way around.
- Don't expect narration-synced word timing on a KineticText *inside* a
  Compound — the narration-timing resolver (resolve.js's
  `resolveKineticWordTimings`) keys off a *scene*-level narration match, and
  layers live below that scope. Layers fall back to even-stagger
  (`useNarrationTiming: false` is the safe default for layer KineticText).
