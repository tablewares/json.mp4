# Camera

The camera system lets a scene define a pan/zoom motion as a percentage-based transform. It is authored per scene and resolved into a frame-aware transform for Remotion.

## Contract

A scene can include an optional `camera` block:

```json
{
  "camera": {
    "start": { "position": "center", "offsetXPercent": 0, "offsetYPercent": 0 },
    "end": { "position": "top-left", "offsetXPercent": 6, "offsetYPercent": 8 },
    "zoomStartPercent": 100,
    "zoomEndPercent": 108
  }
}
```

### Fields

- `start`: the camera anchor at the beginning of the scene
- `end`: the camera anchor at the end of the scene
- `zoomStartPercent`: zoom level at the start of the scene (100 = no zoom)
- `zoomEndPercent`: zoom level at the end of the scene
- `zoomPercent`: shortcut when both start and end zoom should be the same

## Anchor model

Camera anchors use the same percentage-based positioning model as asset anchors:

- `position`: one of `center`, `top`, `bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left`, `bottom-right`
- `offsetXPercent`: signed horizontal nudge, relative to the composition width
- `offsetYPercent`: signed vertical nudge, relative to the composition height

This keeps the motion authored in a compositional, resolution-independent way.

## How it works

1. The scene schema validates the `camera` block.
2. Pipeline 2 resolves it into a scene-level camera object.
3. Pipeline 3 applies a transform over the scene’s frame range.

The transform interpolates between `start` and `end` across the scene duration and blends zoom between `zoomStartPercent` and `zoomEndPercent`.

## Notes

- If no `camera` block is present, the scene behaves normally with no movement.
- The motion is expressed as a percentage-based focus point, so it is easy to reuse across different compositions.
- The implementation is intentionally simple: it is meant for cinematic pans and gentle zooms rather than complex camera rigs.
