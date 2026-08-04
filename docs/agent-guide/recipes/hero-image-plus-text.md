# Recipe: hero image + headline

The workhorse layout: a headline on one side, a hero image revealed on
the other. Adapted from `studio/manifest/example-project/scenes/scene-001.toon`.

## Scene file

```json
{
  "id": "scene-001",
  "narrationRef": "n1",
  "background": "shade1",
  "transitionOut": {
    "type": "slideContinuity",
    "durationInFrames": 24,
    "params": { "carryAssetId": "heroImage" }
  },
  "assets": [
    {
      "id": "titleText",
      "assetType": "TextBlock",
      "anchor": { "position": "top-left", "offsetXPercent": 6, "offsetYPercent": 10 },
      "contentOverride": { "text": "Why most AI videos look like slideshows" },
      "styleOverride": { "typography": "heading1", "align": "left" },
      "enterAt": 0,
      "exitAt": 0.9
    },
    {
      "id": "heroImage",
      "assetType": "ImageReveal",
      "anchor": { "position": "right", "offsetXPercent": -8, "offsetYPercent": 0 },
      "contentOverride": { "src": "", "alt": "hero" },
      "styleOverride": {
        "borderRadius": 32,
        "revealDirection": "left-to-right",
        "width": 640,
        "height": 640
      },
      "enterAt": 0.05,
      "exitAt": 1
    }
  ]
}
```

## Notes

- The image is anchored `right` with `offsetXPercent: -8` — pulled 8% of
  the composition width inward from the right edge. With a 640px box this
  leaves a comfortable gutter without computing pixels.
- `revealDirection: "left-to-right"` + the right anchor means the wipe
  moves toward the edge — reads as "revealing into the frame".
- `enterAt: 0.05` staggers the image 5% behind the text so they don't
  feel simultaneous.
- `heroImage` is the carried asset for the outgoing transition (see
  `continuity-carry.md`) — its `id` must stay stable if you intend to
  carry it.

## Filling `src`

`ImageReveal` requires `src` (per its `contentOverrideSchema`). Use a
URL or a path relative to the manifest dir. Empty `src` will fail the
schema's `required` check at validate time; the example file leaves it
empty only because it hasn't been filled in yet — when you adapt this,
populate it.
