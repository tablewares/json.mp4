# `inject-effects`

Timeline-driven bulk effect injection. Resolves the project + builds the
global-frame timeline FIRST, then writes one `sfx`/`visual` effect per matching
asset segment (or per scene, for scene-boundary rules) onto each scene's
detached `scene.effects[]` array — anchored to an **exact scene-local `frame`**
derived from the timeline. No `offsetPercent` lands on disk.

## Syntax

```bash
node scripts/agent-cli.mjs inject-effects <projectId> '<rules>'
```

`<rules>` is a JSON array of rule objects. May be literal JSON or `"-"` to
read from stdin (use `"-"` for large rule sets / nested `contentOverride`
payloads).

Each rule:

```json
{
  "match":  { "assetType": "<Type>" } | { "scene": "all" } | { "predicate": "sceneStart" | "sceneEnd" },
  "anchor": "enter" | "exit",
  "effect": {
    "kind": "sfx" | "visual",
    "id":   "<unique-id>",
    ...kind-specific keys
  }
}
```

## How the exact `frame` is computed

`inject-effects` reads the project's resolved timeline (`buildTimeline` lifts
every asset's enter/exit onto the composition's global frame axis), then writes
a scene-local `frame` per effect by lifting the matched edge back into the
scene's own timeline:

- **`match.assetType`** rule — for each scene that contains a matching asset,
  the matched segment's global enter/exit edge is lifted into scene-local
  space:
  `frame = (anchor === "exit" ? segment.endFrame : segment.startFrame) − timeline.scenes[i].startFrame`
  So a KineticText that enters at global frame 218 in a scene whose global
  startFrame is 88 writes `frame: 130` — exactly where the asset becomes
  visible. A scene with no matching-assetType asset is **skipped** (no
  wildcard, no fuzzy match).
- **`match.scene: "all"`** rule — iterates `timeline.scenes` directly and
  writes one effect per scene regardless of which (or whether any) assets each
  scene contains:
  - `anchor: "enter"` → `frame: 0` (scene start)
  - `anchor: "exit"`  → `frame: scene.durationInFrames` (scene visible end)

The frame is clamped to `[0, scene.durationInFrames]` defensively. The
authored `frame` survives on-disk verbatim and is honored first by
`resolveSceneEffects` (in
`src/pipelines/pipeline2-resolve/resolveTransitions.js`) — no percent math, no
conversion back through `offsetPercent` at resolve time.

## `match` modes

### 1. `match.assetType` (asset-segment anchored)

```json
{
  "match": { "assetType": "KineticText" },
  "anchor": "enter",
  "effect": { "kind": "sfx", "id": "kt-whoosh", "path": "audio/sfx.mp3", "volume": 0.6 }
}
```

`findAssetSegments` (`src/timing/buildTimeline.js`) walks every scene's assets
and returns segments whose `assetType` matches exactly. For each, the segment's
global enter/exit edge is converted to a scene-local `frame` as described above.

- A scene with no matching-assetType asset is **skipped**.
- `match.predicate` (`"enter"` | `"exit"` | `"all"`, default `"enter"`) is
  parsed and then discarded — it's `void`-ed in the implementation. Only
  `assetType` filters; `anchor` picks the segment edge.

### 2. `match.scene: "all"` (scene-boundary anchored)

```json
{
  "match": { "scene": "all" },
  "anchor": "exit",
  "effect": { "kind": "sfx", "id": "hit", "path": "audio/sfx.mp3", "volume": 0.6 }
}
```

Or equivalently via `predicate` aliases: `predicate: "sceneEnd"` ⇒
`anchor: "exit"`; `predicate: "sceneStart"` ⇒ `anchor: "enter"`. When both
`match.scene: "all"` and `predicate` are present, the explicit `predicate`
alias wins; otherwise the rule-level `anchor` (default `"enter"`) is the source
of truth.

Iterates `timeline.scenes` directly — does NOT consult `scene.assets` — so it
places an effect on every scene regardless of which (or whether any) assets each
scene contains. Each scene gets `${effect.id}-${sceneIndex}` so one rule can
target N scenes without id collisions.

## `effect` shape

Same shape `add-effect` accepts — built by `buildInjectedEffect` and always
carried with the explicit `frame` computed from the timeline.

- `kind`: `"sfx"` or `"visual"` (required)
- `id`: string (required; basis for idempotency + per-scene/per-segment suffix)
- sfx: `path` (relative to `public/`), `volume?: 0–1`, `durationInFrames?`
- visual: `assetType`, `anchor?`, `contentOverride?`, `styleOverride?`,
  `durationInFrames?`

Schema:
`src/pipelines/pipeline1-validate/schema/effects.schema.json#/definitions/effectsArray`.

## Idempotency

Before writing, any existing effect whose `id` matches a rule's
`${effect.id}-${segmentIndex}` / `${effect.id}-${sceneIndex}` id is removed
from that scene's `effects[]`. Re-running with the same rule set **updates**
rather than stacks. Ids unique per target are derived for you when a rule
matches N segments/scenes:

- `match.assetType` path → `${effect.id}-${segIndex}` (one per matched
  segment; the same assetType in two scenes gets two different segIndex-suffixed
  ids — both happen to be `${id}-0` for their own scene, but live in different
  scene files, so no collision).
- `match.scene: "all"` path → `${effect.id}-${sceneIndex}` (one per scene).

## Last-scene effects DO render (post-refactor)

Pipeline 2's pass-2 loop in
`src/pipelines/pipeline2-resolve/resolve.js` used to `if (!incoming) continue;`
which dropped the *last* scene's authored effects (no incoming scene to build
a transition bundle for, and the effects resolution line was inside the same
skipped block). That gap is closed: the last scene still skips the
`transitionOut` *bundle* (correct — nothing to cut to) but DOES call
`resolveSceneEffects` on its authored `effects[]`, so they render within the
scene's own Sequence at their `frame`. Injecting an end-of-scene effect onto
"every" scene now writes *and renders* for every scene including the trailing
one.

Verify both branches with one resolve dump:

```bash
node -e "
import('./src/pipelines/pipeline2-resolve/resolve.js').then(async m => {
  const x = await m.resolveProject('studio/manifest/<projectId>/manifest.json');
  for (const s of x.scenes) {
    console.log(s.id, 'duration=' + s.durationInFrames,
      'effects:', (s.effects||[]).map(e => e.id + ' frame=' + e.frame).join(' | '));
  }
});"
```

Expect: every scene — including the trailing one — carries its injected
effects with `frame=0` (start) or `frame=durationInFrames` (end) for
scene-boundary rules; `frame=<lifted-edge>` for asset-segment rules (e.g.
`frame=130` for a KineticText that enters at global 218 in a scene whose
global start is 88).

## Fast verification without TTS

`inject-effects` calls `resolveProject`, which runs TTS when
`manifest.narration` is present. First-run TTS for even tiny clips can take
~60–150s; on cache hit it's seconds. For fast iterative verification of the
inject path itself, build a scratch project WITHOUT narration (omit the
`narration` block from `init`):

```bash
node scripts/agent-cli.mjs init '{"projectId":"scratch"}'
node scripts/agent-cli.mjs add-scene scratch '{"id":"s1","transitionOut":{"type":"default"}}'
node scripts/agent-cli.mjs add-scene scratch '{"id":"s2"}'        # no transitionOut — auto-created
node scripts/agent-cli.mjs add-asset scratch s1 '{"assetType":"TextBlock","anchor":{"position":"center"},"enterAt":0.1,"exitAt":0.7,"contentOverride":{"text":"Scene 1 title"},"styleOverride":{"width":1200,"height":120}}'
node scripts/agent-cli.mjs add-asset scratch s2 '{"assetType":"TextBlock","anchor":{"position":"center"},"enterAt":0,"exitAt":1,"contentOverride":{"text":"Scene 2 title"},"styleOverride":{"width":1200,"height":120}}'

# Asset-segment rule + scene-boundary rule, one batch:
node scripts/agent-cli.mjs inject-effects scratch \
  '[{"match":{"assetType":"TextBlock"},"anchor":"enter","effect":{"id":"tb-enter","kind":"sfx","path":"audio/sfx.mp3","volume":0.6}},
    {"match":{"scene":"all"},"anchor":"exit","effect":{"id":"end-flash","kind":"sfx","path":"audio/sfx.mp3","volume":0.4}}]'

# Validate + read on-disk scene.effects[]:
node scripts/agent-cli.mjs validate scratch
python3 -c "import json; print(json.dumps(json.load(open('studio/manifest/scratch/scenes/s1.json')).get('effects'), indent=2))"
```

On a non-narrated scratch (`defaultSceneDurationInFrames: 150`) with
two scenes, expect:

- `s1`: `tb-enter-0 frame=15` (TextBlock `enterAt: 0.1` → global 15 − scene start 0), `end-flash-0 frame=150`
- `s2`: `tb-enter-1 frame=0`  (TextBlock `enterAt: 0` → global 132 − scene start 132), `end-flash-1 frame=150`

Clean up the scratch project when done so it doesn't pollute
`studio/manifest/`.

## When to prefer `add-effect` over `inject-effects`

Use `add-effect` (see `add-effect.md`) when you know the exact scene + frame
you want and you're writing one effect at a time. Use `inject-effects` when a
single rule should fan out across every matching asset segment *or* every scene
boundary — the timeline-first frame computation is the whole point. Both
commands write the same `scene.effects[]` array; the only difference is
single-shot vs. timeline-driven bulk placement.

## In-repo references

- `docs/transition_effects.md` — design doc with the post-refactor note framing
  `scene.effects[]` as the primary surface and `frame` as the primary timing
  key.
- `add-effect.md` (this folder, new pattern: filename = command name) — the
  single-shot append counterpart; same `effect` shape.
- `timing.md` (this folder) — the legacy `timingAnchor` reference
  (`offsetPercent`/`relativeToAsset`/`relativeToCameraAction`), relevant if
  you hand-edit migrated legacy scenes that still carry `timing` instead of
  `frame`.
