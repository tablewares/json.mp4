# Post-cinematography effects & diagnostics

## `config.postEffects`

Applied as **second pass over finished mp4**, after Remotion's own render — not inside composition. Keeps render pipeline untouched; only `pipeline3-render/render.js` knows this step exists, only when `config.postEffects` set.

```json
{
  "postEffects": {
    "vignette": { "strength": 0.4 },
    "grain": { "strength": 15 },
    "colorGrade": { "contrast": 1.08, "brightness": 0, "saturation": 1.1, "gamma": 1 },
    "letterbox": { "aspectRatio": 2.35 }
  }
}
```

- Every key (`vignette`, `grain`, `colorGrade`, `letterbox`) independently optional; omit `postEffects` entirely for no post-pass.
- Strict no-op when absent — raw ffmpeg shell-out, requires `ffmpeg` on PATH. When `postEffects` set but `ffmpeg` missing, `render.js` throws clear error naming the missing binary, not raw ENOENT.
- **No CLI command yet** — `postEffects` is raw `config.json` field; edit `studio/manifest/<projectId>/config.json` directly (same sanctioned-exception caveat as `music`/`ttsHumanize`). `init` does not accept `postEffects`.

## Overlap / composition diagnostics

`overlap_warn.js` runs automatically inside `resolve.js` for every scene during `render` — never call it directly. **Warns, never blocks**: spatial+temporal overlap between assets, off-screen clipping, tiny assets, very short on-screen durations, low visual activity vs narration window (when narrated). Treat output as pre-render sanity check, not validation failure — if `render` succeeds despite warnings, expected. Read them; don't chase into false failures; don't edit `overlap_warn.js` to silence.

## Batching many steps at once

If more than two or three `agent-cli.mjs` calls in a row, use `scripts/agent-batch.mjs`:

```bash
node scripts/agent-batch.mjs '<steps-array>'
```

Each step = `["command", arg1, arg2, ...]`. JSON payload argument is real JSON, not pre-escaped string — wrapper stringifies for you. Default: stops at first failing step (later steps return `{ skipped:true }`). Pass `{ "steps":[...], "continueOnError":true }` when later steps don't depend on earlier ones (e.g. several independent `add-scene` calls).

Response = `{ ok:<all steps ok>, results:[...] }`. Check each result's own `ok` (and, for `add-asset`/`update-asset` steps, its nested `result.warnings`), not only top-level.

Minimal shape — replace `<…>` from run's design context:

```bash
node scripts/agent-batch.mjs '[
  ["init",       {"projectId":"<projectId>", "narration":{"entries":[{"id":"n1","text":"..."}],"fullTranscript":"..."}}],
  ["add-scene",  "<projectId>", {"id":"<sceneId>", "narrationRef":"n1", "background":"<token>", "transitionOut":{"type":"<type>"}}],
  ["add-asset",  "<projectId>", "<sceneId>", {"assetType":"<Type>", "anchor":{"position":"<anchor>"}, "contentOverride":{}}],
  ["validate",   "<projectId>"],
  ["add-music",  "<projectId>", {"id":"m1","src":"/audio/track.mp3","volume":0.8}]
]'
```

Need state mid-build (e.g. before a transition that needs `carryAssetId`)? Use `show <projectId>` — returns fully assembled tree in one call.
