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


Need state mid-build (e.g. before a transition that needs `carryAssetId`)? Use `show <projectId>` — returns fully assembled tree in one call.
