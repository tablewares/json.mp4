# A-Roll / B-Roll Composition Guide

This document translates what the video-agent-cli framework can do into the
structure of an **A-roll / B-roll** sequence — the documentary / explainer
editing pattern where the primary narration track (A-roll) is intercut with
supporting visuals (B-roll) that illustrate, contextualize, or emotionally
color what the narrator is saying.

The framework has no native concept of "A-roll" or "B-roll." Both are just
scenes in the same Remotion composition. The A/B structure is something you
author by choosing which asset types and transitions go on which scenes, and
by timing scene durations against the narration windows. This guide describes
the contract the CLI gives you and how to map the A/B pattern onto it.


## 1. What the framework gives you

Everything below is reachable through `node scripts/agent-cli.mjs <command>`
from the repo root. None of it is invented — run the command to confirm the
current registry before relying on a schema.

### Scenes
- A project is a tree of scenes under `studio/manifest/<projectId>/`.
- Each scene carries an optional `narrationRef` pointing at an entry in the
  project's narration array; when present, TTS is the source of truth for that
  scene's duration (see `docs/agent-guide/conventions/timing-from-tts.md`).
- Each scene has one `transitionOut` describing how it hands off to the next
  scene. `null` (or absent) means a hard cut.
- Scenes are ordered; the rendered mp4 is the scenes played in order, each
  cross-fading into the next over its `transitionOut` window.

### Assets
- Every scene holds zero or more assets positioned via `anchor` (one of 8
  positions + `center`) plus optional `offsetXPercent` / `offsetYPercent`
  nudges and a `depth` multiplier for the 2.5D parallax camera.
- An asset's visible window inside its scene is `enterAt..exitAt` expressed as
  fractions of the resolved scene duration (0..1), not frame numbers. Default
  is the full scene (0..1).
- `add-asset` returns `{ asset, warnings }`. Read `warnings`; an empty array
  means the `contentOverride` passed the asset type's own schema.

### Transitions
- Live on the *outgoing* scene (`scene.transitionOut`). The incoming scene has
  no incoming transition — continuity is a property of the cut, modeled as the
  previous scene's exit.
- Several transitions support `carryAssetId`: they read a named asset's
  resolved position/color across the cut so it "becomes" the next scene's
  version of itself, instead of cutting and re-entering. This is the closest
  the framework gets to a true match-cut.

### Narration + timing
- Narration is optional. Omit it entirely for a project with no voiceover.
- When present, each scene's `narrationRef` must match an `entries[].id`, and
  `fullTranscript` must contain every word the TTS synthesizes, in order.
- TTS humanization (pitch jitter, pacing variance, micro-pauses, breathiness)
  is on by default; override via raw `config.json` `ttsHumanize`.

### Audio layering (three independent concerns)
- Manifest-level `audioOverlay` (the `add-audio` command) — hand-authored
  non-TTS beds/SFX. Ignored the moment TTS narration exists.
- `music` — a separate raw `manifest.json` array of looping background tracks
  with their own fades, independent of TTS timing. No CLI command yet.
- `ttsHumanize` — provider-level humanization applied before WhisperX
  alignment so word timestamps match the shipped audio.

### Post pass
- `config.postEffects` (raw `config.json`): `vignette`, `grain`,
  `colorGrade`, `letterbox`. Each independently optional; applied as a second
  ffmpeg pass over the finished mp4. Strict no-op when absent.


## 2. Mapping the A-roll / B-roll pattern

The classic pattern:

- **A-roll** — the talking-head / narration-bearing beat. The voice carries
  the argument; the visual is supportive (a face, a title, a single key word,
  a chart that the voice is explaining directly).
- **B-roll** — the illustrative cutaway. The voice continues underneath, but
  the visual leaves the speaker and shows something else — a location, a
  process, a diagram, archival material — that contextualizes or amplifies
  what's being said.
- **Return** — cut back to A-roll. The viewer re-anchors to the speaker
  before the next B-roll beat. The cycle continues.

In this framework that becomes a scene-cadence rule, not a special asset type:

| Pattern role | Authored as | What goes on it |
|---|---|---|
| A-roll | A scene whose `narrationRef` points at a narration entry and whose anchor asset is the "speaker-equivalent" — a `TextBlock` headline, a `KineticText` beat synced word-for-word to the narration, or a single focal `ImageReveal` / `BarChartRace` the voice is directly narrating. | One anchor asset at `depth: 1`; optionally UI-layer labels at `depth: 0`. |
| B-roll | A scene (still `narrationRef`'d, or a short no-narration palette-cleanser) whose assets *aren't* the speaker — `ImageReveal`, `CodeBlock`, `SignalBloom`, `WavyLine`, a second `BarChartRace`, etc. The narration keeps playing underneath via the shared TTS timeline. | Multiple depth layers (background `0.3-0.6`, subject `1`, accent `1.2-1.5`) for the 2.5D push; see `curate/asset/parallax.md`. |
| Return | The next A-roll scene. | Same anchor-asset treatment as the first A-roll; reuse the same `assetType` and anchor so the viewer recognizes "we're back." |

The narration timeline is shared — you do **not** mute B-roll scenes. They
keep the same `narrationRef` family or follow the A-roll's narration entry in
sequence; the TTS audio plays continuously across the cut because the
framework layers every scene's narration onto one audio timeline.


## 3. Sequencing rules

1. Alternate, don't flitter. A-run-of-three A-roll scenes with no B-roll
   reads as a talking-head monologue; a run of three B-roll scenes reads as a
   montage with lost narration. Aim for **A → B → A → B …**, breaking the
   pattern only for deliberate emphasis (a cold-open on B-roll, a long A-roll
   close).
2. Time scenes by narration, not by feels. When a scene has `narrationRef`,
   its duration is the TTS window for that entry — so the A/B cadence is really
   authored by how you **split the transcript into `entries`**. Shorter
   entries → more scenes → more frequent A/B swings. Longer entries → each
   scene holds longer.
3. Pick transitions that match the cut's intent:
   - **A → B (leave the speaker):** `WhipPan` (energetic exit), `ShapeWipe`
     (the speaker's image collapses into the B-roll focal point), or
     `default` (a quiet fade+slide when the B-roll is contemplative).
   - **B → A (return to speaker):** `slideContinuity` with `carryAssetId` on a
     title/text asset that appears in *both* scenes — the title slides back
     in as the viewer re-anchors. This is the closest thing to a true
     match-cut the framework offers.
   - **B → B (continued cutaway, same idea):** `pivotZoom` with
     `carryAssetId` on a shared element to "push through" one visual into the
     next, keeping the viewer inside the B-roll world.
   - **Hard cuts:** `remove-transition` on the outgoing scene. Use
     deliberately, not as a default.
4. Reserve `depth` layering for B-roll. A-roll scenes usually want one focal
   asset at `depth: 1` and nothing else competing. B-roll scenes are where the
   2.5D map-push recipe (background 0.3-0.6 with `blurPx`, subject 1, accent
   1.2-1.5, UI labels 0) earns its keep.
5. `exitAt < 1` is for assets that should leave early. An A-roll anchor asset
   riding the full narration window should use the default `exitAt: 1` —
   otherwise the last word(s) play against an empty board (see "Things to
   avoid" in `scripts/SKILL.md`).
6. Validate before render (`agent-cli.mjs validate <projectId>`). An A/B
   sequence with three+ scenes and multiple assets each is exactly the case
   where a cheap validate catches a stale `narrationRef` or bad anchor before
   an expensive render fails.


## 4. Minimal example shape

Replace `<…>` from the run's external design context. This is the *structure*
of an A → B → A sequence; the asset types, anchors, and palette all come from
whatever design context the run supplies, not from this file.

```bash
node scripts/agent-batch.mjs '[
  ["init", {"projectId":"<id>", "narration":{"entries":[
    {"id":"n_a1","text":"<the speaker's first beat>"},
    {"id":"n_b1","text":"<the cutaway's narration underneath>"},
    {"id":"n_a2","text":"<the return beat>"}
  ],"fullTranscript":"<every word, in order>"}}],

  ["add-scene", "<id>", {"id":"a1","narrationRef":"n_a1","background":"<token>",
    "transitionOut":{"type":"WhipPan"}}],
  ["add-asset",  "<id>", "a1", {"assetType":"<Type>","anchor":{"position":"center"},
    "contentOverride":{}}],

  ["add-scene", "<id>", {"id":"b1","narrationRef":"n_b1","background":"<token>",
    "transitionOut":{"type":"slideContinuity","params":{"carryAssetId":"<Type>-1"}}}],
  ["add-asset",  "<id>", "b1", {"assetType":"<B-rollType>","anchor":{"position":"center"},
    "styleOverride":{"depth":0.4}}],

  ["add-scene", "<id>", {"id":"a2","narrationRef":"n_a2","background":"<token>"}}],
  ["add-asset",  "<id>", "a2", {"assetType":"<Type>","anchor":{"position":"center"},
    "contentOverride":{}}],

  ["validate", "<id>"]
]'
```

Notes on the example:
- `a1` (A-roll) cuts out via `WhipPan` — an energetic exit when leaving the
  speaker for B-roll.
- `b1` (B-roll) returns via `slideContinuity` carrying `"<Type>-1"` (the
  auto-id of the `a1` anchor asset) so the return reads as the same element
  settling back in.
- `a2` (return A-roll, no `transitionOut`) hard-cuts at the end. Add one if a
  next beat exists.
- All three scenes share the narration timeline via their `narrationRef`; the
  TTS plays continuously across the cuts — the framework layers scene
  narration onto one audio timeline, so you do not mute B-roll.


## 5. What this framework does *not* give you

So you don't go looking for it:
- **No native speaker/camera talking-head asset.** There is no `TalkingHead`
  asset type. A-roll "speaker" is just whatever anchor asset the run's design
  context picks — typically `TextBlock` or `KineticText`. If a real video
  face is wanted, author a new asset component from `AssetBoilerplate` (see
  "Authoring a new asset or transition" in `scripts/SKILL.md`).
- **No separate A-roll / B-roll track.** Both are scenes in one timeline.
  The distinction is editorial, not structural.
- **No auto-alternation.** The CLI places scenes in the order you `add-scene`
  them; there is no "make this B-roll alternate with my A-roll" command.
- **No "music ducks under B-roll" automation.** `music` is a manifest-level
  bed with its own volume/fades; sidechain ducking under narration isn't in
  the pipeline. If you need it, set `music[].volume` low (0.15-0.25) for the
  whole run and rely on the A/B visual cadence to carry the dynamic feel.
- **No multi-cam / multi-angle switcher.** One composition, one timeline.


## 6. Where to look when something breaks

- `docs/agent-guide/CONTEXT.md` — high-level mental model and router.
- `docs/agent-guide/conventions/timing-from-tts.md` — the narration timing
  contract (load this the first time an A/B scene's duration is wrong).
- `docs/agent-guide/conventions/token-vs-literal.md` — when a `background` or
  color key wants a theme token vs a raw hex.
- `curate/asset/parallax.md` — the 2.5D depth recipe for B-roll scenes.
- `curate/asset/highlight.md` — the highlighter style override for callouts.
- `scripts/SKILL.md` — the authoritative skill; the "Things to avoid" and
  "Overlap / composition diagnostics" sections apply to every A/B sequence.
