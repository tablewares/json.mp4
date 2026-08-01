# narration (optional manifest key)

Drives per-scene timing from a TTS provider. When present, each scene's
duration becomes the spoken window for its `narrationRef`; animations and
transitions must resolve within that window.

Source: `src/timing/ttsTiming.js`
        `src/external/tts-provider.js` (the swappable provider seam)
        `src/pipelines/pipeline2-resolve/resolve.js` (consumes timingById)

## Shape (inside manifest.json)

```json
"narration": {
  "entries": [
    { "id": "n1", "text": "Why most AI videos look like slideshows." },
    { "id": "n2", "text": "Because they resolve every asset independently, with no shared registry and no continuity." }
  ],
  "fullTranscript": "Why most AI videos look like slideshows. Because they resolve every asset independently, with no shared registry and no continuity."
}
```

## Keys

| key | required | type | notes |
|---|---|---|---|
| `entries` | required | array of `{ id, text }` | Each `id` must be unique. Scenes reference these via `narrationRef`. |
| `fullTranscript` | required | string | The concatenation of every entry's `text` in order. Used by the TTS provider to align word timestamps; must contain every word. |

## What the resolver does with it

1. Calls `resolveNarrationTiming(entries, fullTranscript, fps)`, which in
   turn calls the external `generateTtsTiming` and returns
   `{ id: { startSeconds, endSeconds, startFrame, endFrame, durationInFrames } }`.
   ⛔ A non-positive duration (`end <= start`) throws
   `TTS timing for "..." has non-positive duration`.
2. For each scene, `sceneTimingBudget(narrationRef, timingById)` returns
   that scene's frame budget. ⛔ A scene whose `narrationRef` has no
   timing entry throws
   `No TTS timing resolved for narrationRef "..."`.
3. Asset `enterAt`/`exitAt` are multiplied by that budget → absolute frames.

## When narration is absent

- Scenes fall back to `config.defaultSceneDurationInFrames`.
- `narrationRef` on a scene is a no-op (validate still checks it against
  entries, but there are no entries — so it should be omitted too).

## Provider swap

`ttsTiming.js` is the **only** module that imports the TTS provider; the
rest of the framework depends on its exported function shape, not on the
provider. To swap providers, edit the import in `ttsTiming.js` (or
`external/tts-provider.js`) — pipeline 2 and the renderer are unaffected
as long as the returned shape is
`[{ id, start, end }]` (seconds) or `{ timing: [...], totalDuration, audioPath }`.
