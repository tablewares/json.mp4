# Camera

The camera system lets a scene define a pan/zoom motion as a percentage-based transform. It is authored per scene and resolved into a frame-aware transform for Remotion.

## Contract

A scene can include an optional `camera` block. The simplest form is still a start/end pair, but the system also supports a sequence of actions keyed by normalized scene progress values from `0` to `1`.

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

```json
{
  "camera": {
    "actions": [
      { "at": 0.0, "anchor": { "position": "center", "offsetXPercent": 0, "offsetYPercent": 0 }, "zoomPercent": 100 },
      { "at": 0.2, "anchor": { "position": "top-left", "offsetXPercent": 4, "offsetYPercent": 4 }, "zoomPercent": 102 },
      { "at": 0.7, "anchor": { "position": "top-left", "offsetXPercent": 8, "offsetYPercent": 8 }, "zoomPercent": 106 },
      { "at": 1.0, "anchor": { "position": "left", "offsetXPercent": 12, "offsetYPercent": 10 }, "zoomPercent": 110 }
    ]
  }
}
```

### Fields

- `start`: legacy camera anchor at the beginning of the scene
- `end`: legacy camera anchor at the end of the scene
- `actions`: multi-step camera path. Each action uses `at` in the range `0.0` to `1.0`, representing normalized scene progress.
- `durationInFrames`: optional override for how long the camera motion lasts; when omitted it follows the scene timing
- `speed`: optional multiplier for camera motion; values above `1` make it travel faster, values below `1` make it slower
- `zoomStartPercent`: legacy zoom at the start of the scene (100 = no zoom)
- `zoomEndPercent`: legacy zoom at the end of the scene
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
