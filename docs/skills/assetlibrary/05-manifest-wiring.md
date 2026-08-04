# 05 — Wiring assets into a manifest

Bridge between the asset-gathering workflow (docs 01–04) and the framework's
scene-authoring contract (`docs/agent-guide/reference/manifest.md`,
`docs/agent-guide/reference/asset-spec.md`,
`docs/agent-guide/reference/audio-overlay.md`,
`docs/transition_effects.md`). Assumes every file you're referencing already
lives under `~/json.mp4/public/` — non-negotiable (see top-level
[`README.md`](README.md)).

## The contract in one paragraph

Every asset path in a manifest is a **relative path from `public/`**. Not
absolute, not URL, not `~/json.mp4/public/audio/foo.mp3` — just
`audio/foo.mp3`. Framework resolves these against `public/` root at render
time, both in Remotion studio (local dev) and headless render pipeline
(`npm run render`).

That rule is why destination matters more than source. Track at
`~/Downloads/Timeless.mp3` is invisible to the renderer; same file at
`~/json.mp4/public/audio/track-the-weeknd-timeless.mp3` is referenced as
`"path": "audio/track-the-weeknd-timeless.mp3"`.

## Audio SFX — `scene.transitionOut.effects[]`

Per `docs/transition_effects.md`, SFX are boundary effects anchored to a
scene's *resolved* ending frame:

```jsonc
{
  "id": "sfx-whoosh-1",
  "kind": "sfx",
  "offsetPercent": 0,                          // exactly scene's last frame
  "path": "audio/whoosh-cinematic-01.mp3",     // resolves to public/audio/...
  "volume": 0.85
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | Optional. Auto-generated as `sfx-N` if omitted. |
| `kind` | `"sfx"` | Required for SFX entries (`"visual"` is the other kind). |
| `offsetPercent` | number | `0` = scene's last frame. `-10` = fires 10% before end. `+10` = fires 10% *after* end (clamped to scene duration — see timing model in `docs/transition_effects.md`). |
| `durationInFrames` | int | Omit to let clip play natural length. |
| `path` | string | Required for SFX. Relative to `public/`. |
| `volume` | `0–1` | Default `1`. Duck against narration with a lower value. |

Files here must come from `public/audio/` (finalized assets) — **not**
`public/audio/split/` (raw slices from doc 03). Promote with descriptive name
first, per `03-sfx-from-single-source.md`'s final step.

## Music track — `audio.overlays[]` (scene-level bed)

Backing track spans a whole scene, not firing at one frame. From
`docs/agent-guide/reference/audio-overlay.md`:

```jsonc
{
  "audio": {
    "overlays": [
      {
        "path": "audio/track-the-weeknd-timeless.mp3",
        "startAtFrame": 0,
        "endAtFrame": null,           // null = play to end of scene
        "volume": 0.35,               // duck under narration
        "fadeInFrames": 15,
        "fadeOutFrames": 30
      }
    ]
  }
}
```

`fadeInFrames` / `fadeOutFrames` smooth abrupt cuts when track is
longer/shorter than scene — never trim the file in `ffmpeg` to fit; let the
overlay handle it.

## Still images — `scene.assets[]`

Per `docs/agent-guide/reference/asset-spec.md`, images register through the
asset registry (`assetType`) and use anchor + nudge, never raw x/y:

```jsonc
{
  "assetType": "ImageReveal",
  "src": "assets/abstract-concrete-texture.png",
  "anchor": {
    "position": "center",
    "offsetXPercent": 0,
    "offsetYPercent": 0
  },
  "enterAt": 0,
  "exitAt": null,
  "durationInFrames": 90
}
```

Source from `public/assets/` — populated by `04-images-opencli.md`. Don't
reference files from `public/audio/sources/` here (or anywhere — transient
working dir).

## The path-validation step (and why it matters)

Validate pipeline (`npm run validate` →
`src/pipelines/pipeline1-validate/validate.js`) is where a bad path fails
fast — before render. If:

```json
{ "kind": "sfx", "path": "audio/whoosh-cinematic-01.mp3", "offsetPercent": 0 }
```

…and `~/json.mp4/public/audio/whoosh-cinematic-01.mp3` does not exist,
`npm run validate` exits non-zero with a path-not-found error pointing at
scene and field. Gives you chance to:

1. Go back to docs 02/03 and create the missing file, or
2. Drop the effect from the manifest.

Don't discover a missing asset during `npm run render` — render takes minutes
per scene, validate is sub-second.

## The "have-files, write-manifest" workflow

Typical end state after docs 01–04:

```
~/json.mp4/public/
├── assets/
│   ├── abstract-concrete-texture.png         ← from doc 04
│   └── hero-portrait.png                     ← from doc 04
└── audio/
    ├── track-the-weeknd-timeless.mp3          ← from doc 02
    ├── whoosh-cinematic-01.mp3                ← from doc 03 (promoted)
    ├── whoosh-cinematic-02.mp3                ← from doc 03 (promoted)
    ├── riser-section-buildup.mp3              ← from doc 02
    ├── sources/                               ← keep for audit
    │   ├── The Weeknd, Playboi Carti - Timeless.mp3
    │   └── b9hBHt317mw - FREE Transition Sound Effects [Swoosh Pack].mp3
    └── split/                                 ← keep, raw slices
        ├── b9hBHt317mw_part01.mp3
        └── …
```

Writing the manifest, point at finalized (descriptively-named) files in
`public/audio/` and `public/assets/`, never working dirs:

```jsonc
// scene in a manifest
{
  "id": "intro",
  "durationInFrames": 240,
  "narration": { /* … */ },
  "assets": [
    {
      "assetType": "ImageReveal",
      "src": "assets/abstract-concrete-texture.png",
      "anchor": { "position": "cover" }
    }
  ],
  "audio": {
    "overlays": [
      {
        "path": "audio/track-the-weeknd-timeless.mp3",
        "volume": 0.32,
        "fadeInFrames": 15
      }
    ]
  },
  "transitionOut": {
    "type": "SlideOut",
    "durationInFrames": 15,
    "effects": [
      {
        "id": "sfx-whoosh-1",
        "kind": "sfx",
        "offsetPercent": 0,
        "path": "audio/whoosh-cinematic-01.mp3",
        "volume": 0.8
      }
    ]
  }
}
```

`sources/` and `split/` exist for re-fetch and slicing work — not referenced
from manifests.

## Cross-references

- `docs/agent-guide/reference/manifest.md` — overall manifest schema
- `docs/agent-guide/reference/asset-spec.md` — full asset contract (every
  `assetType`, required fields, anchor+nudge model)
- `docs/agent-guide/reference/audio-overlay.md` — full audio overlay contract
- `docs/transition_effects.md` — `transitionOut.effects` boundary-effect spec
  (`offsetPercent` timing model, `sfx` vs `visual` kinds)

If those ever disagree with this document, **they win** — this is a workflow
guide for getting files into `public/`, not a schema spec. Schema lives in
`docs/agent-guide/reference/` and the JSON schemas under `src/`.
