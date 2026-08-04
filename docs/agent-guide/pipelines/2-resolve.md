# Pipeline 2 — resolve

Turns the validated raw project into a fully-resolved JSON scene graph.
Every token → concrete value. Every anchor → `{left, top, transformOrigin}`
pixels. Every scene's timing attached. Every transition bundled with the
outgoing+incoming info it asked for. Output is plain JSON-serializable —
pipeline 3 never re-opens manifest/styles/registries.

Source: `src/pipelines/pipeline2-resolve/resolve.js`
        (`resolveProject`, `resolveScene`, `buildTransitionBundle`)

## Two passes

1. **Pass 1** — resolve each scene's own assets independently. For each
   asset: look up the asset manifest (`getAsset`), compute the asset's
   size (`styleOverride.width/height ?? manifest.defaultSize`), resolve the
   anchor to pixels (`resolveAnchor`), resolve the style
   (`resolveAssetStyle` → merges `defaultStyle` + override, resolves tokens)
   including a `backgroundColor` if `backgroundColorToken` is overridden,
   and attach `timing` (enter/exit frames derived from `enterAt`/`exitAt`
   fractions × scene duration).
2. **Pass 2** — for each adjacent scene pair, `buildTransitionBundle`
   snapshots the carried asset's resolved position+style on both sides and
   attaches `outgoing.transitionOut` / `incoming.transitionIn`.

## Errors and their causes

| thrown text (paraphrased) | cause | fix |
|---|---|---|
| `Unknown assetType "X". Available: ...` | `assetType` in a scene's asset isn't a folder under `studio/assets/` or `studio/graphics/` | fix the type name or add the asset (see `../assets/authoring-new.md`) |
| `Unknown anchor position "X". Valid: ...` | `anchor.position` not one of the 9 anchors | use a valid position (see `../reference/asset-spec.md`) |
| `Unknown color token "X". Known tokens: ...` | `background`, `backgroundColorToken`, or a typography `colorToken` not in `styles.colors` | add the token to `styles/theme.json` or use a literal |
| `Unknown typography token "X"` | `styleOverride.typography` or `defaultStyle.typography` not in `styles.typography` | add the token or fix the name |
| `Unknown easing token "X"` | easing ref not in `styles.easing` | add the token or fix the name |
| `TTS timing for "X" has non-positive duration (start=..., end=...)` | TTS provider returned start ≥ end for a narration id | re-run TTS or check the transcript; the provider's output is wrong |
| `No TTS timing resolved for narrationRef "X"` | a scene's `narrationRef` had no timing entry — usually the TTS provider didn't return that id | check `narration.entries[].id` spelling vs the TTS output |
| `Transition "X" on scene "Y" requested carryAssetId "Z" but it wasn't found in both the outgoing and incoming scene.` | continuity transition's `carryAssetId` missing from one side | add an asset with that id to both scenes, or drop the carry |

## Resolved output shape

```json
{
  "projectId": "...",
  "config": { "fps", "width", "height", "defaultSceneDurationInFrames" },
  "audioOverlay": [ ... ],
  "scenes": [
    {
      "id": "scene-001",
      "durationInFrames": 90,
      "background": "#0B0E14",                 // token resolved
      "assets": [
        {
          "id": "titleText",
          "assetType": "TextBlock",
          "componentPath": ".../TextBlock.jsx",
          "content": { "text": "..." },
          "resolvedPosition": { "position": "absolute", "left": ..., "top": ..., "transformOrigin": "..." },
          "resolvedStyle": { "typography": { ...resolved... }, "easing": { ...resolved... }, "width": ..., "height": ..., "backgroundColor"?: "..." },
          "timing": { "durationInFrames": 90, "enterAtFrame": 0, "exitAtFrame": 81 }
        }
      ],
      "transitionIn":  null | { type, durationInFrames, componentPath, props },
      "transitionOut": null | { type, durationInFrames, componentPath, props }
    }
  ]
}
```

Written to `resolved.json` at the repo root by default; pass a third CLI
arg to control the output path.

## Overlap warnings

Resolve also emits `[overlap-warning]` lines via
`src/pipelines/pipeline2-resolve/overlap_warn.js`. These are `console.warn`
(exits 0), not errors — render still proceeds, but two assets visibly overlap
on screen.

A warning means both assets are on screen at the same time AND their resolved
bounding rectangles intersect. Computation:

- Per asset pair, take the temporal overlap window (`max(enterAtFrame)` to
  `min(exitAtFrame)`); skip pairs that don't coexist in time.
- Build a rect `{left, top, width, height}` per asset from `resolvedPosition`
  + `resolvedStyle`.
- If rects intersect AND timing overlaps → warn. Area/percent is informational.

Root cause 9 in 10: `studio/assets/TextBlock/manifest.json` ships
`defaultSize: { width: 900, height: 200 }`. A text asset whose `styleOverride`
omits `width`/`height` gets a 900×200 box far larger than the actual text, so a
short kicker anchored `top-left` swallows a centered headline.

Fix: give the text asset explicit `styleOverride.width` + `height` matching the
rendered text. The override propagates into `resolveAnchor`, so the box nudges
with the asset. If boxes still overlap, nudge one asset's `offsetYPercent` (rarely
`offsetXPercent`) by ±2–4 percent (signed % of the 1920×1080 composition). Then
re-run resolve — validate does not check overlaps, only resolve does.

Trap: tightening sizes can push the box off the 1920×1080 frame. After patching,
check resolved `top`/`top+height` lie in `[0, 1080]` and `left`/`left+width`
lie in `[0, 1920]`. For `bottom-left` anchored assets a *positive* y% pushes the
anchor below the frame — use small **negative** `offsetYPercent` (e.g. -3 to -16).

See the `json-to-mp4-overlap-warnings` skill for the Python rect model that
catches second-order overlaps before re-running resolve, plus a worked
`packet-journey` case.

## CLI

```bash
node src/pipelines/pipeline2-resolve/resolve.js path/to/manifest.json [output.json]
```

Default manifest = `studio/manifest/example-project/manifest.toon`.
Default output = `resolved.json` at repo root.
