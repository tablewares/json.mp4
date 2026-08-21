# Visual QA report — composition-showcase.mp4

Duration: 15.59s. Stream: 1920x1080 @ 30/1fps. Samples: 6.

## Automated checks (no vision model)

- Black-frame events: 0 — none.
- Freeze/stuck-frame events: 13
  - starts 0.266667s, 0.766667s long
  - starts 1.033333s, 1.066667s long
  - starts 2.1s, 1.066667s long
  - starts 3.166667s, 0.733333s long
  - starts 3.9s, 0.6s long
  - starts 4.5s, 0.566667s long
  - starts 5.066667s, 0.5s long
  - starts 7.533333s, 1.2s long
  - starts 8.733333s, 1.333333s long
  - starts 10.2s, 0.966667s long
  - starts 11.166667s, 1.1s long
  - starts 12.266667s, 1.466667s long
  - starts 13.733333s, 1.433333s long
- Near-uniform / possibly-blank frames: 2
  - s1_depth_push@0.08 (0.64s): stdBrightness=48.28, dominantColorShare=0.87 -> tmp/qa/composition-showcase/frames/f000_s1_depth_push_0.64s.png
  - s2_image_panel@0.08 (8.64s): stdBrightness=30.91, dominantColorShare=0.9136 -> tmp/qa/composition-showcase/frames/f003_s2_image_panel_8.64s.png
- Scene-transition visual-change check:
  - s1_depth_push -> s2_image_panel: pixelDiff=0.1636 ok

## Next step: actual visual review

This script cannot judge composition, overlap, color harmony, or "does this look good" —
those need a vision-capable pass. One image covers every sampled frame:

```
vision_analyze("tmp/qa/composition-showcase/contact_sheet.png")
# or, if unavailable this session, open it directly:
# tmp/qa/composition-showcase/contact_sheet.png
```

Ask it to check, per labeled tile: overlapping/colliding elements, dead/empty
space, text legibility against background, color clash, and whether each
scene reads as visually distinct from its neighbors.