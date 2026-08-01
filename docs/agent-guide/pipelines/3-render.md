# Pipeline 3 — render

Bundles `src/index.jsx` via Remotion, selects the `"Video"` composition, and
renders to `.mp4` (h264). Pipeline 3 assumes `resolved.json` already exists
on disk — `index.jsx` imports it directly at bundle time.

Source: `src/pipelines/pipeline3-render/render.js` (`main`)
        `src/pipelines/pipeline3-render/Composition.jsx` (`VideoComposition`)
        `src/index.jsx` (Remotion entry — registers the `"Video"` composition)

## Contract

- **Input**: `resolved.json` (produced by pipeline 2). Pipeline 3 never
  opens `manifest.json`, `styles/theme.json`, or any asset/transition
  manifest. Everything it renders is already sitting in the resolved
  graph: component paths are absolute, styles are resolved, anchors are
  pixels, timing is in frames.
- **Output**: an `.mp4` (h264 codec).

## Failure modes

Pipeline 3 errors almost always come from the Remotion bundle/render step,
not from the framework's own code. Common causes:

| symptom | cause | fix |
|---|---|---|
| `Cannot find module '...'` during bundle | a resolved `componentPath` doesn't exist on disk | check the asset/transition folder wasn't moved/deleted since resolve; re-run pipeline 2 |
| wrong/missing visual | `resolved.json` is stale — you edited a scene but didn't re-run pipeline 2 | re-run `resolve.js`, then `render.js` |
| composition absent | `index.jsx` didn't register `"Video"` or the entry was moved | don't move `src/index.jsx`; the composition id is hardcoded in `render.js` |
| Remotion bundling error on a component | an asset/transition component imports something not installed | add the dep to `package.json` (this is a component-author concern — see `../assets/authoring-new.md`) |

## CLI

```bash
node src/pipelines/pipeline3-render/render.js [output.mp4]
```

Default output = `out/video.mp4` under the repo root.

## Iteration tip

Re-render without re-bundling only by changing `resolved.json` and re-
running — but Remotion bundles on every `render.js` invocation, so this
isn't a meaningful cycle-saver today. The expensive step is the bundle,
and it runs regardless. For faster iteration while authoring content
(scene/style tweaks), iterate against `validate` + `resolve` (fast) and
only render once the resolved graph looks right.
