# audioOverlay (optional manifest key)

Places audio files on the timeline. Remotion composites the mix during
render — no separate mux step.

Source: `src/audio/overlay.jsx` (the Remotion `<Audio>` sequencer)
        `src/pipelines/pipeline2-resolve/resolve.js` (passes through to resolved graph)

## Shape (inside manifest.json)

```json
"audioOverlay": [
  { "id": "voiceover", "start": 0, "end": 8.5, "path": "audio/voiceover.mp3" }
]
```

## Keys (per entry)

| key | required | type | notes |
|---|---|---|---|
| `id` | required | string | Stable identifier. |
| `start` | required | number | Start time in **seconds**. |
| `end` | required | number | End time in seconds. ⛔ `end > start` is implied; nonsensical values will misplace the clip. |
| `path` | required | path | Relative to the manifest dir. Must exist at render time (Remotion resolves it during bundle). |

## Notes

- `audioOverlay` is independent of `narration`: narration drives scene
  *timing* (via TTS), audioOverlay drops literal audio files onto the
  timeline. A common setup: narration generates the voiceover file,
  then an audioOverlay entry plays it back at the TTS-aligned start.
- If narration is present, the resolver exposes a `__totalDuration` on
  the timing map (when the provider returns one) so the manifest's
  `audioOverlay` end can be reconciled against the real audio length.
- Multiple entries are allowed; they layer (not replace).
