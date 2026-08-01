# Timing from TTS, not guesses

`src/timing/ttsTiming.js` is the single seam. Input: `[{ id, text }]` +
the `fullTranscript`. Output: `[{ id, start, end }]` in seconds, converted
to frames using `config.fps`.

Every scene's animations and transitions are budgeted to resolve *within*
that scene's narration window — nothing free-runs past its audio. Asset
`enterAt`/`exitAt` are fractions of the scene's TTS-derived duration, not
guessed frame counts.

Without narration, scenes fall back to
`config.defaultSceneDurationInFrames` — a fixed fallback, not a substitute
for narration on narrative videos.

The provider is swappable: only `ttsTiming.js` imports it. Swap the
provider there; pipeline 2 and the renderer never know.
