# Recipe: single text scene

The minimal renderable scene. One `TextBlock`, anchored top-left, using
existing tokens. Adapted from `studio/manifest/example-project/scenes/scene-001.toon`
(stripped to essentials).

## Required project context

- `styles/theme.json` defines `shade1` (color) and `heading1` (typography).
  See `../reference/styles.md`.
- `config.json` has fps/width/height/defaultSceneDurationInFrames.
- `manifest.json` lists this scene under `scenes` with matching `id`.

## Scene file

```json
{
  "id": "scene-001",
  "narrationRef": "n1",
  "background": "shade1",
  "assets": [
    {
      "id": "titleText",
      "assetType": "TextBlock",
      "anchor": { "position": "top-left", "offsetXPercent": 6, "offsetYPercent": 10 },
      "contentOverride": { "text": "Why most AI videos look like slideshows" },
      "styleOverride": { "typography": "heading1", "align": "left" },
      "enterAt": 0,
      "exitAt": 0.9
    }
  ]
}
```

## Notes

- `enterAt: 0, exitAt: 0.9` → text enters at the scene start and leaves
  10% of the scene as tail. Tune `exitAt` down if the next scene's
  transition needs clear frames.
- `narrationRef: "n1"` ties the scene's duration to the `n1` narration
  entry. Drop both `narrationRef` and the manifest's `narration` block to
  use `defaultSceneDurationInFrames` instead.
- If you add nothing else, this validates and renders as-is.

## Validate + render

```bash
node src/pipelines/pipeline1-validate/validate.js my-project/manifest.json
node src/pipelines/pipeline2-resolve/resolve.js  my-project/manifest.json
node src/pipelines/pipeline3-render/render.js   out/video.mp4
```
