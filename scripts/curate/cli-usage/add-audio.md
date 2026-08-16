# Audio: overlays, music, TTS humanization

Three independent audio concerns. Layer onto same audio timeline `pipeline2-resolve` builds. Each is a strict no-op for a project that doesn't author it — omit and output unchanged.

## 1. Manifest-level audio overlays (`add-audio`)

Hand-authored non-TTS beds/SFX. Only meaningful for *non-narrated* projects: once real TTS narration audio exists, `resolve.js` overrides `audioOverlay` and these entries are ignored. Covered in `init.md`.

## 2. Background music

Separate concept from narration/audioOverlay: different defaults (looping, low volume, fades) and independent of TTS timing. `music` is manifest-level array field (`manifest.schema.json`):

```json
"music": [
  {
    "id": "bgm-1",
    "path": "audio/theme.mp3",
    "volume": 0.25,
    "start": 0,
    "loop": true,
    "fadeInSeconds": 1.5,
    "fadeOutSeconds": 2
  }
]
```

- `id` + `path` required; rest has working default (`volume` 0.25, `start` 0, `loop` true, fades 0). Bare `{ "id":..., "path":... }` valid.
- `end` optional — omit to run track for full composition duration (auto-computed from total scene time).
- Layered onto same audio timeline as narration/audioOverlay; not replaced/overridden by TTS the way `audioOverlay` is.

## 3. TTS humanization

TTS output humanized (pitch jitter, pacing variance, micro-pauses, breathiness) **before** WhisperX alignment runs, so word-level timestamps measured against actual shipped audio — not a "clean" pass that drifts out of sync once humanization applied. Provider-level pass, not post-processing. **On by default.**

Control via `config.ttsHumanize` in project's `config.json`:

```json
{ "ttsHumanize": false }
```

or partially override built-in defaults (`pitchJitterSemitones` 0.4, `pacingJitterPercent` 6, `microPauseMs` [60,180], `breathiness` 0.15):

```json
{ "ttsHumanize": { "breathiness": 0.3, "pacingJitterPercent": 8 } }
```

