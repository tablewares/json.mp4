# Composition Design Principles for Scene Layout & Pacing

Classic design theory, translated into concrete `anchor` / `offsetXPercent`
/ `offsetYPercent` / `enterAt` / `exitAt` recipes for this system. The
canvas is 1920×1080 (16:9); all percentages below are relative to that
frame, matching how `offsetXPercent`/`offsetYPercent` actually work
(percent of composition size, anchored from the chosen `position`).

---

## 1. Rule of thirds — where things should actually sit

Divide the frame into a 3×3 grid. The four intersections ("power points")
and the four dividing lines are where the eye naturally rests — not dead
center, not flush to an edge.

- The third-lines sit at **33.3%** and **66.7%** of width/height.
- From `position: "center"`, that's **±16.7%** offset on either axis.
- From `position: "top-left"`, the first vertical third-line is at
  `offsetXPercent: 33`; the first horizontal third-line is
  `offsetYPercent: 33`.

**Recipe:** a hero subject (portrait, chart, product shot) reads stronger
sitting on a power point than centered. Anchor `center`, offset one axis
by `±16–17%` — e.g. a face or focal object at `offsetXPercent: -16,
offsetYPercent: -16` (upper-left power point) rather than `0, 0`.
Reserve true dead-center (`0,0` offset) for symmetrical, single-subject
beats — a logo reveal, a stat card, a full-bleed title — where you *want*
the stillness of perfect symmetry.

Headlines and kickers already lean into this in the shipped scenes: a
kicker anchored `top-left` with `8% / 10%` offset sits just inside the
frame's upper third, not flush to the corner — small margin keeps it
grid-aligned rather than clipped.

---

## 2. Golden ratio / golden spiral — asymmetric weight

Where thirds gives you an even 3-way split, the golden ratio (φ ≈ 1.618)
gives an asymmetric one that reads as more organic: the section point
sits at **38.2% / 61.8%** of the frame, not 33/67.

- From `center`, that's **±11.8%** offset.
- A golden-spiral composition nests progressively smaller focal areas
  toward one corner — useful for a hero image + supporting text pairing:
  put the larger element (image) in the ~61.8% zone, the smaller
  supporting element (caption, stat) in the remaining ~38.2% zone on the
  opposite side.

**Recipe:** two-element scenes (hero image + text block) read best when
the split isn't 50/50. Anchor the dominant visual at `right` or
`left` with `offsetXPercent: ±8` (inside the 61.8% half), and anchor the
supporting text on the opposite side with a *smaller* box — this mirrors
what `scene-001.toon` already does: `titleText` at `top-left` (8%) paired
with `heroImage` at `right` (-8%), giving the image the larger half of an
asymmetric split rather than splitting the frame evenly.

---

## 3. Visual hierarchy & the single focal point

A viewer's eye should have exactly one obvious "first thing to look at"
per scene, established through **size, contrast, and entry timing** —
not by fighting over the same power point at the same time.

- **Size hierarchy:** if two text elements share a scene, they should
  differ meaningfully in `typography` token (a `heading*` vs. a
  `body*`/`caption*`), not just position. Two same-sized text blocks
  compete; a headline + a caption cooperate.
- **Timing hierarchy:** the intended focal element should `enterAt`
  first (or at `0`), with supporting elements entering later
  (`0.1–0.3+`) — sequential entry tells the eye where to look *first*,
  which is a cheaper hierarchy signal than layout alone. This matches
  the shipped pattern: kicker at `enterAt: 0`, headline at `~0.05`,
  supporting stat/body content at `0.2–0.6`.
- **One focal point per beat.** If a scene needs two things emphasized
  equally, that's usually a sign it should be two scenes with a
  transition between them, not one crowded frame.

---

## 4. Balance — symmetry vs. asymmetry, and when to use each

- **Symmetrical balance** (centered, mirrored, `offset 0/0`) reads as
  stable, formal, authoritative — good for a title card, a single stat
  reveal, a closing seal/logo.
- **Asymmetrical balance** (rule-of-thirds/golden-ratio offset, elements
  distributed unevenly but with matched *visual weight*) reads as
  dynamic, editorial — good for narrative/explainer scenes with a
  hero + supporting text.
- **Radial balance** (elements arranged around a center, like
  `SignalBloom`'s node field) reads as ambient/generative — good for
  backgrounds or transitional beats, not information-carrying content.

Don't mix: a scene with one centered symmetric element and one
thirds-offset element usually just looks unbalanced rather than
intentional. Pick one balance mode per scene.

---

## 5. Proximity & grouping

Elements that belong together conceptually should sit close together in
both **space and time**; unrelated elements need separation in one or
both.

- A label/value pair (e.g. `NumberStat`'s `label` + `value`) is one
  visual unit — don't split a stat's label and number into two separate
  assets at different anchors; use the asset's own `labelPosition`
  instead so proximity is guaranteed.
- Multiple related stats (e.g. "9 holds" / "3 dissents") should share
  the *same* vertical or horizontal band (same `offsetYPercent`, mirrored
  `offsetXPercent`) so they read as one comparison, not two unrelated
  facts. `scene-002.toon` (fed-2026) does this: both stats sit at
  `offsetYPercent: 12`, mirrored left/right.
- Grouped elements should also enter close together in time
  (`enterAt` within ~0.05–0.1 of each other); a large timing gap between
  two spatially-grouped elements reads as a bug, not a design choice.

---

## 6. Whitespace / negative space

Every shipped scene leaves margin — nothing sits at `offsetXPercent: 0`
against a true edge. Treat **6–14% of composition size as the minimum
edge margin** for any anchor touching a frame boundary (`top`, `bottom`,
`left`, `right`, and the four corners).

- Dense scenes (many stats, a long list) need *more* margin, not less —
  crowding the edges on an already-busy frame compounds the clutter.
- Whitespace is also temporal: don't chain three assets' `enterAt` back
  to back with no breathing room. A beat of ~0.05–0.1 (of scene duration)
  between unrelated entries gives the eye time to register the last
  thing before the next arrives.
- A scene doesn't need to fill the frame. A single centered stat on an
  otherwise empty background is a valid, often stronger, composition
  than padding the frame with filler content.

---

## 7. Alignment & consistency (the invisible grid)

Elements that don't share a logical group should still share an
**alignment line** with something else in the frame — a shared
`offsetXPercent` or `offsetYPercent` with another element (even across
scenes) reads as intentional; arbitrary, unique offsets per element read
as noise.

- Reuse the same offset values across a project's scenes for the same
  *role* — e.g. every kicker at `top-left, 8%/10%`, every caption at
  `bottom, 0%/8%`. The shipped `fed-2026` project does exactly this:
  every scene's kicker uses `offsetXPercent: 8`, every closing caption
  sits at `offsetYPercent` in the same narrow band. This is what makes a
  multi-scene video feel like one designed system instead of six
  separate slides.
- When two assets in the same scene are meant to feel like a pair (dual
  stats, before/after), mirror their offsets exactly (`+X` / `-X`) rather
  than picking independent numbers that happen to look similar.

---

## 8. Contrast — what actually separates foreground from background

Contrast is what makes hierarchy *readable*, not just structurally
present:

- **Color contrast:** foreground typography tokens should resolve
  against a background with clearly different lightness — check a
  scene's `background` token against the typography's `colorToken`
  before finalizing (e.g. `ink`-colored text needs a `canvas`/light
  background; `onDark`/`main1`-style light text needs a `shade*`/`surfaceDark*`
  background).
- **Size contrast:** a headline and its supporting caption should differ
  by more than one typography step — jumping straight from `heading1` to
  `body1` reads more clearly than adjacent sizes like `heading2` →
  `titleLg`.
- **Motion contrast:** not every element needs the same entrance energy.
  A `snappySpring` pop reads as emphasis; pair it with `gentleSpring`
  elsewhere in the same scene so the snappy element actually stands out
  instead of everything feeling uniformly energetic.

---

## 9. Reading flow — Z-pattern and F-pattern

For frames with multiple text elements, viewers scan in predictable
paths:

- **Z-pattern** (good for a single hero beat): top-left → top-right →
  diagonal down to bottom-left → bottom-right. Use for kicker (top-left)
  + date/tag (top-right) + headline (center/diagonal) + CTA-equivalent
  or stat (bottom) — this is the exact shape `fed-2026`'s hook scene
  uses: `kicker` top-left, `dateKicker` top-right, `headline` center,
  `fedSeal` bottom-center.
- **F-pattern** (good for list/data-heavy scenes): strong top band
  (kicker + headline), then left-aligned content reading downward
  (a `ListReveal` or stacked `NumberStat`s anchored to the left). Avoid
  F-pattern layouts for single-focal-point emotional beats — it's a
  utility pattern for information density, not drama.

Pick the pattern *before* placing elements, not after — it should decide
your anchors, not get retrofitted to justify them.

---

## 10. Motion pacing — animation principles adapted to timing fractions

Classic animation principles (Disney's 12, condensed) map directly onto
`enterAt`/`exitAt` fractions:

- **Anticipation:** the most important element in a scene should not be
  the very first thing to move. A small kicker or label entering first
  (`enterAt: 0`) primes the eye before the headline lands (`~0.05–0.1`)
  — the shipped scenes already do this; don't invert it by making the
  headline enter at `0`.
- **Staging (one idea at a time):** stagger `enterAt` so only one new
  element appears within any ~0.1 window when possible. Simultaneous
  multi-element entrances read as a slide, not a directed reveal.
- **Slow in / slow out:** this is handled by the spring configs
  (`gentleSpring` vs `snappySpring`) — use `gentleSpring` for
  emotionally weighted or large elements, `snappySpring` for small,
  punchy, high-frequency reveals (word pops, list items, stat ticks).
  Don't use `snappySpring` on a full-frame hero image; the overshoot
  reads as jittery at that scale.
- **Follow-through / overlap:** exits don't all need to happen at the
  same `exitAt`. Letting a background/ambient element (title, kicker)
  linger slightly past a foreground element's exit avoids everything
  vanishing in one synchronized blink.
- **Three-act pacing within a scene:** treat a scene's `[0, 1]` timeline
  as setup (`0–0.15`, primary elements enter) / hold (`0.15–0.8`, content
  is legible and static-ish) / release (`0.8–1`, exit fades begin). Don't
  spread entrances evenly across the whole duration — front-load them so
  there's a genuine "hold" where the frame is fully composed and
  readable before anything starts leaving.

---

## 11. Repetition & rhythm across a project

A multi-scene video should feel authored as one system:

- Reuse the **same transition type** for the same *kind* of beat (e.g.
  `shatterWipe` only on hard topic changes, `slideContinuity` only when
  an element is meant to persist, `default` for everything else) —
  mixing transition types without a semantic reason breaks rhythm.
- Reuse **anchor roles** consistently (see §7) — a kicker's position
  shouldn't move scene to scene unless the content genuinely demands it.
- Vary **pacing**, not **vocabulary** — a fast scene and a slow scene can
  still share the same anchor/typography conventions; what changes is
  `enterAt`/`exitAt` spread and `staggerFrames`, not the visual language.

---

## 12. Frame-specific concerns (16:9, 1920×1080)

- Keep critical content inside a **safe-margin band** — roughly 5% in
  from every edge (~96px at 1080p, which is exactly the
  `spacing.sceneMargin` token already used in every shipped theme) —
  since some playback contexts crop slightly.
- Wide, short elements (tickers, kickers) belong near the top or bottom
  thirds; tall, narrow elements (stat stacks, lists) belong left- or
  right-anchored — matching element aspect ratio to the frame's own
  aspect ratio avoids awkward empty gutters next to a box that's the
  "wrong" shape for its anchor.

---

## Quick recipe table

| Goal | Anchor | Offset | Notes |
|---|---|---|---|
| Rule-of-thirds power point | `center` | `±16–17%` on one or both axes | main subject, not text |
| Golden-ratio split | `center` / `left` / `right` | `±11.8%` | asymmetric two-element pairing |
| Symmetrical hero beat | `center` | `0% / 0%` | title card, single stat, logo |
| Kicker / eyebrow | `top-left` | `8% / 8–12%` | enters first, `enterAt: 0` |
| Headline | `center` or `top` | `0% / -6 to -8%` | enters second, `~0.05–0.1` |
| Bottom caption | `bottom` | `0% / 6–8%` | enters last, `~0.6+` |
| Mirrored stat pair | `bottom-left` / `bottom-right` | matching `±14–18%` | same `offsetYPercent`, staggered `enterAt` ~0.1 apart |
