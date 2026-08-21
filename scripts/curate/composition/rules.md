# Composition rules

Read before laying out ANY scene with more than one asset, or sizing an
image/video asset. Referenced from `solutions/composition/b-roll-sequence.md`
and `solutions/composition/news-clip-silent-scene.md` — this file is the
shared pre-flight both point at.

Composition space is 1920x1080 (or whatever `config.json` sets) unless noted.
All sizes below are examples at 1920x1080 — scale proportionally for other
`config.width`/`config.height`.

## 1. Size scales inversely with asset count

A scene holding ONE image is not the same size as a scene holding FOUR. More
assets sharing the frame means less area per asset, tighter margins, and a
narrower total footprint so nothing crowds the frame edges.

Rough sizing budget per scene (1920x1080, `styleOverride.width`/`height`):

| assets in scene | per-asset size | placement |
|------------------|----------------|-----------|
| 1 | 1600-1920 wide, full-bleed OK (1920x1080, `borderRadius: 0`) | `anchor.position: center`, zero offset |
| 2 | 700-900 wide each | split left/right or top/bottom, symmetric offsets |
| 3 | 450-600 wide each | one row or an L-shape band, equal gaps |
| 4 | 380-480 wide each | 2x2 grid or vertical stack, tightest margins |
| 5+ | reconsider — split into 2 scenes instead of cramming | — |

A full-bleed 1920x1080 shot belongs ONLY to a single-asset scene. Never give
a multi-asset scene a full-bleed member — it will eclipse everything sharing
the frame. Shrink every asset in a multi-asset scene below what a lone asset
would use, in proportion to how many others it shares the beat with.

## 2. Center is priority — don't scatter assets to fill space

The center of frame is the viewer's primary focus. It is not "space to
avoid" or a slot to fill last — it's the anchor for whatever the scene's
narration beat is actually ABOUT.

- Single-thing scene: that thing sits `anchor.position: center`, not
  parked in a corner because "the corner was free."
- Multi-thing scene: the MOST important item (the one being named, the one
  narration is currently on) gets the position closest to center or the
  largest size. Supporting/secondary items go to `top-left`/`top-right`/
  `bottom-left`/`bottom-right` — never placed to the same visual weight as
  the center item.
- Do NOT place assets by "wherever fits" logic (top-right because nothing
  else is there yet, then bottom-left because that's free too). Every anchor
  choice should answer "why does the eye go here for this beat" — if the
  answer is "empty space," the layout is wrong.
- A scene with no clear focal point (everything the same size, evenly
  scattered across all 9 anchors) reads as noise, not information. If
  nothing in the scene deserves center, that's a sign the scene should be a
  full-bleed single-asset shot instead of a panel.

## 3. Multi-asset panels: band together, don't spray across the whole frame

When several assets share a scene (the "multi-thing panel" pattern from
`b-roll-sequence.md` step 6), keep them in one coherent band/cluster — not
spread edge-to-edge across all four corners. A tight cluster near center
(or one side, with the other side reserved for a title/kicker) reads as one
composed shot. Assets pinned to all four corners simultaneously reads as
four disconnected thumbnails.

- Stack vertically in a shared column, OR
- Row horizontally in a shared band, OR
- 2x2 grid centered as one unit (all four offsets small, symmetric around
  center) — NOT one asset per literal corner of the 1920x1080 frame.

## 4. Sequence, don't simultaneous-load

Never `enterAt` all assets in a multi-asset scene at the same instant (see
`solutions/pattern.md`). Time them one after another, matched to the
narration beat that names each one. A crowded frame that also all snaps
into existence at once compounds the "noise" problem from rule 2 —
sequencing gives the eye one new focal point at a time even inside a
tight panel.

## 5. Verify before render, not after

- Overlap: two assets occupying the frame at the same time with intersecting
  bounding boxes is a bug, not a style choice. Run
  `node src/pipelines/pipeline2-resolve/resolve.js <manifest>` with
  `overlapGuard` enabled in `config.compositionPlugins` — see the
  `json-to-mp4-overlap-warnings` skill for the fix workflow (undersized
  TextBlock default boxes are the #1 cause).
  \
  Quick manual check without a full resolve: use the Python rect model in
  that skill (`ANCHOR` dict + `resolve()`) to confirm bounding boxes for a
  planned layout don't intersect before you even author the JSON.
- On-frame: every asset's resolved `top`/`left` through `top+height`/
  `left+width` must land inside `[0, height] x [0, width]`. An anchor +
  offset combo that pushes a box off-frame is as wrong as an overlap.
- Gaps: leave real breathing room between panel members — a few percent of
  composition width/height, not pixel-touching edges. Overlap-guard also
  flags "tiny gap" cases if `checkTinySize`/spacing options are enabled.

## 6. Hyper-specific vs generic sizing has no separate rule

Whether an asset is a Pexels stock shot or a hyper-specific Yandex/named-
subject image, the sizing budget in rule 1 and the center-priority rule in
rule 2 apply identically — sourcing (see `scripts/SKILL.md`'s Yandex vs
Pexels section) decides WHERE the pixels come from, not how big the asset
is allowed to be on screen.
