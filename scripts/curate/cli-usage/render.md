# Pipeline 3 — render

Turns the resolved JSON scene graph into an MP4 via Remotion. Final step of the pipeline.

Source: `src/pipelines/pipeline3-render/render.js`, `src/pipelines/pipeline3-render/Composition.jsx`.

## The render process

1. **Bundle** — Remotion bundles project (JSX, styles, assets) into production build.
2. **Frame-by-frame render** — Remotion renders each frame to PNG, then ffmpeg stitches to MP4.

## CLI

```bash
node src/pipelines/pipeline3-render/render.js [output.mp4]
# or 
npm run build -- studio/manifest/<project-id>/manifest.json 
```


Default output: `out/video.mp4` at repo root.

## Iteration tip

Remotion bundles on every `render.js` invocation. For faster iteration on content (scenes/styles), iterate against `validate` + `resolve` (fast) and render only once resolved graph is correct.
