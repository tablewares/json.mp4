# Visual QA report — piechart-test.mp4

Duration: 5.06s. Stream: 1920x1080 @ 30/1fps. Samples: 3.

## Automated checks (no vision model)

- Black-frame events: 1
  - 0s -> 1.166667s (1.166667s)
- Freeze/stuck-frame events: 1
  - starts 0s
- Near-uniform / possibly-blank frames: 3
  - s1_market_share@0.08 (0.4s): stdBrightness=10.67, dominantColorShare=0.9885 -> tmp/qa/piechart-test/frames/f000_s1_market_share_0.4s.png
  - s1_market_share@0.50 (2.5s): stdBrightness=30.65, dominantColorShare=0.9324 -> tmp/qa/piechart-test/frames/f001_s1_market_share_2.5s.png
  - s1_market_share@0.92 (4.6s): stdBrightness=32.17, dominantColorShare=0.9261 -> tmp/qa/piechart-test/frames/f002_s1_market_share_4.6s.png
- Scene-transition visual-change check:
  - only one scene / no transitions sampled.

## Next step: actual visual review

This script cannot judge composition, overlap, color harmony, or "does this look good" —
those need a vision-capable pass. One image covers every sampled frame:

```
vision_analyze("tmp/qa/piechart-test/contact_sheet.png")
# or, if unavailable this session, open it directly:
# tmp/qa/piechart-test/contact_sheet.png
```

Ask it to check, per labeled tile: overlapping/colliding elements, dead/empty
space, text legibility against background, color clash, and whether each
scene reads as visually distinct from its neighbors.