# manifest.json

The router. Contains no scene or style content — only paths and the
narration/audio overlay timelines. Every path is relative to the manifest
file's own directory.

Source: `src/pipelines/pipeline1-validate/validate.js` (loads + cross-checks)
       `src/pipelines/pipeline2-resolve/resolve.js` (consumes)

## Shape

```json
{
  "projectId": "string",
  "config": "config.json",
  "styles": "styles/theme.json",
  "narration": { ... },        // optional — see narration.md
  "audioOverlay": [ ... ],     // optional — see audio-overlay.md
  "scenes": [
    { "id": "scene-001", "path": "scenes/scene-001.json" }
  ]
}
```

## Keys

| key | required | type | notes |
|---|---|---|---|
| `projectId` | required | string | Surfaces in errors + the resolved graph. Stable per project. |
| `config` | required | path | Relative to manifest dir. ⛔ `validateProject` throws if the file is missing. |
| `styles` | required | path | Relative to manifest dir. ⛔ throws if missing. Must point at a style registry — see `styles.md`. |
| `scenes` | required | array | Each entry `{ id, path }`. Must have ≥1 scene. |
| `narration` | optional | object | If present, drives per-scene timing. See `narration.md`. |
| `audioOverlay` | optional | array | If present, places audio files on the timeline. See `audio-overlay.md`. |

## Cross-reference rules (enforced at validate)

- ⛔ `manifest.scenes[].id` MUST equal the `id` field inside the scene file
  it points at. Mismatch →
  `Validation failed: manifest.scenes entry id "..." does not match scene file id "..." in <relPath>`.
- ⛔ If `narration` is present, every scene's `narrationRef` MUST match one
  of `narration.entries[].id`. Mismatch →
  `scene "..." narrationRef "..." has no matching narration entry`.
- ⛔ A missing `config` or `styles` file → thrown with the path that
  couldn't be read.

## What NOT to put here

- Scene content (assets, anchors, overrides). Belongs in `scenes/<id>.json`.
- Style values (colors, fonts). Belong in `styles/theme.json`.
- The full narration text as a duplicate of `fullTranscript` —
  `entries[].text` is the source of truth; `fullTranscript` is the TTS
  alignment target.
