# Minimal preflight checklist

Run this list before invoking `validate`. Every item here corresponds to a
real error `validateProject` (or `resolveProject`) will throw — caught early
here is cheaper than reading the throw text.

## Project shape

- [ ] Project directory contains `manifest.json`, `config.json`,
      `styles/theme.json`, and a `scenes/` folder. No other shape is
      accepted.
- [ ] `manifest.json` `projectId` is a stable string. It's surfaced in
      error messages and the resolved graph; don't reuse ids across
      projects.
- [ ] `manifest.config` and `manifest.styles` are paths relative to the
      manifest dir, and actually resolve to existing files.

## Config

- [ ] `config.json` has `fps`, `width`, `height`, `defaultSceneDurationInFrames`.
      All four are numbers. `defaultSceneDurationInFrames` is the fallback
      duration used only when the scene has no `narrationRef` (or narration
      is absent entirely).

## Styles (registry)

- [ ] Every color value referenced anywhere (scene `background`, asset
      `backgroundColorToken`, typography `colorToken`) exists as a key in
      `styles.colors`. Unknown token → resolve-time throw.
- [ ] Every `typography` entry's `colorToken` (if present) points at an
      existing `colors` key.
- [ ] Every `easing` token referenced by an asset exists in `styles.easing`.

## Narration (optional, but if present)

- [ ] `narration.entries` is an array of `{ id, text }`. Every `id` is
      unique.
- [ ] `narration.fullTranscript` is the concatenation of the entries' text
      in order (whitespace-separated is fine) — the TTS provider aligns
      against this string, so it must contain every word.
- [ ] Every scene's `narrationRef`, if set, matches one of the entry ids.
      A scene with no `narrationRef` falls back to
      `config.defaultSceneDurationInFrames`.

## Audio overlay (optional)

- [ ] Each `audioOverlay` entry has `id`, `start`, `end` (seconds), `path`.
- [ ] `path` is relative to the manifest dir. `start`/`end` are numbers,
      `end > start`.

## Scenes + assets

- [ ] Each scene file's `id` matches the `id` declared in the
      `manifest.scenes[]` entry that points at it.
- [ ] Every `assetType` exists under `src/assets/<AssetName>/`. Unknown
      asset type → resolve-time throw listing the available ones.
- [ ] Every asset has an `anchor` with a valid `position`. The full set is
      in `../reference/scene.md` (and `src/templating/anchor.js`):
      `center | top | bottom | left | right | top-left | top-right |
      bottom-left | bottom-right`.
- [ ] `enterAt` and `exitAt` are floats in `[0, 1]` — fractions of the
      scene's duration, not frames. Defaults: `enterAt=0`, `exitAt=1`.

## Transitions (optional)

- [ ] `scene.transitionOut.type` exists under `src/transitions/<Name>/`.
      Omitting `transitionOut` selects `default`.
- [ ] If the transition `manifest.consumes.carriedAssets` is true and you
      pass `params.carryAssetId`, that asset id must appear in BOTH this
      scene AND the next scene. Resolve-time checks this and names the
      missing side.

## Run

```bash
node src/pipelines/pipeline1-validate/validate.js my-project/manifest.json
```

Output `OK: N scene(s) validated for project "..."` means pass. Any other
output is a thrown error with a file path prefix — that prefix is the file
to fix.
