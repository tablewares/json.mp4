# Quickstart

Goal: go from zero to a rendered `.mp4` with the smallest possible set of
edits. Everything below is demonstrated in
`studio/manifest/example-project/` — open it side by side.

## The four files you author

A project is a directory containing exactly these files (names are fixed;
the manifest references them by relative path):

```
my-project/
  manifest.json      # router: points at scenes/, styles, config, narration, audio
  config.json        # fps, width, height, defaultSceneDurationInFrames
  styles/theme.json  # the style registry: color/typography/spacing/easing tokens
  scenes/
    scene-001.json   # one file per scene
    scene-002.json
    ...
```

That's it. The manifest never contains scene/style content itself — only
paths and the narration entries + audio overlay timeline.

## The three commands

From the repo root:

```bash
# 1. validate  — schema + cross-reference check; throws with a file-scoped error
node src/pipelines/pipeline1-validate/validate.js my-project/manifest.json

# 2. resolve   — produces resolved.json: tokens→values, anchors→pixels, timing attached
node src/pipelines/pipeline2-resolve/resolve.js  my-project/manifest.json

# 3. render    — bundles + renders resolved.json → out/video.mp4 (h264)
node src/pipelines/pipeline3-render/render.js    out/video.mp4
```

Pipeline 3 reads `resolved.json` (written to the repo root by step 2 by
default — pass a third arg to `resolve.js` to control where). It never
re-opens the manifest.

> Tip: while iterating, you only need to re-run step 1 when you change
> structure (added a scene, renamed a token, changed fps). Step 2 must
> re-run on any content/form/style change. Step 3 must re-run only on
> changes that affect the *resolved* graph or the components themselves.

## What to put in each file

This is the 1-line version. The precise contract for every field is in
`../reference/<file>.md` — load it when you actually fill a file out.

- `manifest.json` — `projectId`, `config` (path), `styles` (path), optional
  `narration` (`entries[]` + `fullTranscript`), optional `audioOverlay[]`
  (`id,start,end,path`), and `scenes[]` (`id` + `path`).
- `config.json` — `{ fps, width, height, defaultSceneDurationInFrames }`.
- `styles/theme.json` — `colors`, `typography` (each entry has a
  `colorToken` pointing into `colors`), `spacing`, `easing`.
- `scenes/<id>.json` — `id`, optional `narrationRef` (must match a
  narration entry id), optional `background` (color token), optional
  `transitionOut`, and `assets[]`.

## The smallest possible scene

A scene with one text block, anchored top-left with a small nudge, using
only existing tokens — nothing invented:

```json
{
  "id": "scene-001",
  "background": "shade1",
  "assets": [
    {
      "id": "title",
      "assetType": "TextBlock",
      "anchor": { "position": "top-left", "offsetXPercent": 6, "offsetYPercent": 10 },
      "contentOverride": { "text": "Hello world" },
      "styleOverride": { "typography": "heading1" },
      "enterAt": 0,
      "exitAt": 1
    }
  ]
}
```

If `shade1` and `heading1` exist in `styles/theme.json` and `TextBlock`
exists under `studio/assets/` (or `studio/graphics/`), the above validates
and renders. Everything else the framework offers — narration-driven timing,
transitions, image assets, continuity carries — is layered on top of this
shape.

## Next

- Run through `minimal-checklist.md` before `validate`.
- For the full field-by-field contract, see `../reference/`.
- For copy-pasteable scene patterns, see `../recipes/`.
