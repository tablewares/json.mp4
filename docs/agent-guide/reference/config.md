# config.json

Render settings. Small, fixed shape. Imported by `validate` (pass-through)
and consumed by `resolve` (for composition size + fallback timing) and
`render` (fps flows through Remotion).

Source: `src/pipelines/pipeline2-resolve/resolve.js` (reads `config.fps`,
        `config.width`, `config.height`, `config.defaultSceneDurationInFrames`)
        `src/pipelines/pipeline3-render/render.js` (Remotion inherits fps
        from the composition, which is built from this config)

## Shape

```json
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "defaultSceneDurationInFrames": 90
}
```

## Keys

| key | required | type | notes |
|---|---|---|---|
| `fps` | required | number | Frames per second. Used to convert TTS seconds→frames and by Remotion. |
| `width` | required | number | Composition width in px. |
| `height` | required | number | Composition height in px. |
| `defaultSceneDurationInFrames` | optional | number | Fallback scene duration when a scene has no `narrationRef` or narration is absent. Default `90` if omitted. |

## Notes

- `defaultSceneDurationInFrames` only applies when no TTS timing is
  available for a scene. With narration present, the scene duration is
  `endFrame - startFrame` from the TTS result for that scene's
  `narrationRef`.
- Changing `fps` or dimensions mid-project is supported but will shift
  frame-anchored animations; prefer to set these once at project start.
