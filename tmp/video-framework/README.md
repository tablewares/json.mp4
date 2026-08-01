# json-to-mp4 framework

Built on Remotion. Exists to stop AI-generated videos from looking like a PowerPoint
export. The core idea: an LLM agent should never hand-place pixels or write one giant
JSON blob. It fills out small, typed override files, and the framework resolves them
into motion.

## Why not one big JSON file

A single manifest.json is a bad interface for an agent: it's easy to produce a
document that's *structurally* valid but semantically wrong (wrong style token,
wrong asset id, off-screen offset), and hard to diff/patch incrementally. Instead:

```
manifest.json          <- points at everything below, nothing else
  ├─ scenes/*.json      <- one file per scene (or logical group)
  ├─ styles/*.json      <- the style registry (global tokens)
  └─ config.json        <- fps, resolution, output settings
```

An agent (or a human) edits one scene file or the style registry without touching
anything else. The manifest is just a router.

## Global override + registry pattern

Every visual property (color, size, spacing, easing) can be one of:
1. A **token** from the style registry (`"shade1"`, `"main1"`, `"accentBg"`) — this
   is the default path. Change `shade1` in one place, every scene using it updates.
2. A **literal override** (`{ "color": "#112233" }`) for the rare one-off case.

This is what keeps output visually coherent across a whole video instead of looking
like each slide was styled independently.

## Anchor + offset templating (no hand-placed pixels)

Assets are never given raw x/y. They're given:

```json
{
  "anchor": "top-left",       // or center, top, bottom, left, right, top-right, bottom-right, bottom-left
  "offsetXPercent": 4,        // signed %, relative to the anchor point, of composition width
  "offsetYPercent": 6
}
```

`src/templating/anchor.js` resolves this + the asset's own measured/declared size
into final pixel coordinates at render time. Agents reason in "corner + nudge", not
pixels — which is both easier for an LLM to produce correctly and impossible to get
subtly-off-screen.

## Assets and transitions are folders, not switch statements

```
src/assets/<AssetName>/manifest.json   <- declares accepted contentOverride/styleOverride schema
src/assets/<AssetName>/<AssetName>.jsx <- the component; owns its own entrance/idle/exit animation

src/transitions/<Name>/manifest.json   <- declares what asset/style info it consumes
src/transitions/<Name>/<Name>.jsx      <- a Remotion @remotion/transitions presentation
```

New visual = new folder. The asset registry scans these folders at resolve-time;
nothing is hardcoded into the renderer. An asset owns its own behavior (how it
animates in/out, how it reacts to being resized) — the renderer just gives it a
resolved position and lets it run.

## Continuity-aware transitions

Before every scene boundary, pipeline2 collects the exact styles + assets used by
the outgoing and incoming scene and hands that bundle to a transition function
(default, or a scene-specified custom one). The transition decides how to carry an
asset's color/shape/position across the cut, instead of a generic crossfade — that
continuity is most of what separates "AI slideshow" from "video".

## Timing comes from TTS, not guesses

`src/timing/ttsTiming.js` wraps the existing TTS timing function. Input is just
`[{ id, text }]` + the full transcript; it returns `[{ id, start, end }]` in
seconds. Every scene's animations and transitions are budgeted to resolve *within*
that window — nothing free-runs past its audio.

Final audio overlay ([{ id, start, end, path }]) is applied in
`src/audio/overlay.js`, which places `<Audio>` sequences at the right frame ranges;
Remotion composites the mix during render, no separate mux step needed.

## The three pipelines

| Pipeline | Contract in | Contract out |
|---|---|---|
| **1. validate** | manifest + all referenced scene/style/config files | throws with a precise path-level error, or passes through untouched |
| **2. resolve** | validated raw scene graph | a fully-resolved scene graph: every token resolved to a value, every anchor resolved to `{x,y}`, every scene's timing attached, transitions bundled with the asset/style info they need |
| **3. render** | resolved scene graph (a plain JSON blob, no further lookups needed) | .mp4 via Remotion's `renderMedia` |

Each pipeline only trusts the contract of the one before it. Pipeline 3 never opens
a manifest file or a style registry — by the time it runs, everything it needs is
already sitting in the resolved graph.
