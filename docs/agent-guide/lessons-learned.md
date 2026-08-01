# Lessons learned + streamlined renders

What broke, why, and the fastest path to a green render. Drawn from
bootstrapping `src/manifest/tech-reveal/` from the `boilerplate/` skeleton
and rendering it end-to-end. Read this before starting a new project — every
item below cost a real debug cycle.

Source-enforced mapping (per `CONTEXT.md`):
- TTS seam → `src/timing/ttsTiming.js` → `external/tts-provider.js`
- Resolve → `src/pipelines/pipeline2-resolve/resolve.js`
- Render → `src/pipelines/pipeline3-render/render.js` + `Composition.jsx`
- Anchor → `src/templating/anchor.js`
- Asset/transition discovery → `src/registry/assetRegistry.js`,
  `src/pipelines/pipeline3-render/Composition.jsx` (webpack require.context)

## 1. Skip narration for fast, deterministic renders

Problem: `npm run build` (validate → resolve → render) hung silently at resolve
for ~25s+ with zero log output, while the example project resolved in under 2s.

Root cause: `scene.schema.json` requires `narrationRef` on every scene, and when
the manifest has a `narration` block, `resolveScene` calls `resolveNarrationTiming`
(`src/timing/ttsTiming.js:30`). That in turn calls `generateTtsTiming` in
`external/tts-provider.js`, which synthesizes audio via a local Kyutai TTS server
+ WhisperX alignment (`external/tts-provider.js:42`). When the local TTS server
isn't running (or is slow), resolve blocks on `synthesizeVoice` with no log until
it either completes or you kill it. The "No narration" log line in
`resolve.js:57` only prints *after* the narration decision, so a hung TTS call
looks indistinguishable from a dead process.

Fix (the streamlined path): omit the entire `narration` block from the manifest.
Check `validate.js:60` — the `narrationRef` cross-check only runs
`if (manifest.narration)`, so when narration is absent the `narrationRef` field
is schema-required but its value is unconstrained. Scenes then fall back to
`config.defaultSceneDurationInFrames` (`resolve.js:117-120`), no TTS call is
made, resolve completes instantly, and timing is deterministic frame counts
instead of TTS windows.

```json
// manifest.json — no "narration" key at all
{
  "projectId": "tech-reveal",
  "config": "config.json",
  "styles": "styles/theme.json",
  "scenes": [ /* scene files still carry a dummy narrationRef */ ]
}
```

When you're ready for voiceover, add `narration` back and ensure the Kyutai
server is up. For iteration on visuals/layout/timing, leave it off.

## 2. Never rely on the `default` transition

Problem: render threw at frame 2 with `No transition presentation registered
for type "default"` and no other context — full error only visible in the render
log head, not the tail.

Root cause: when a scene omits `transitionOut`, `resolve.js` falls back to the
manifest's `defaultDurationInFrames` for the bundle but the *type* still resolves
to `"default"` (`buildTransitionBundle`, `resolve.js:198-200`). The webpack
discovery in `Composition.jsx:38-55` then fails to register it because of a
field-name mismatch:

- All transition manifests declare entry file under `"component"` (e.g.
  `src/transitions/default/manifest.json` has `"component": "DefaultTransition.jsx"`).
- `Composition.jsx:46` reads `manifest.main || defaultFileName`, where
  `defaultFileName` is the PascalCase folder name (`Default.jsx`). There is no
  `"main"` field anywhere, so discovery looks for `./default/Default.jsx` — but
  the real file is `DefaultTransition.jsx`. The `require.context.keys()` check at
  line 50 silently skips the folder, `"default"` never lands in
  `TRANSITION_PRESENTATIONS`, and render throws at `Composition.jsx:95`.

The same convention-derivation works for `shatterWipe` (folder → `ShatterWipe.jsx`)
and `slideContinuity` (`SlideContinuity.jsx`) only because those filenames happen
to match the PascalCase-folder convention. `default` is the only shipped
transition that violates it.

Workaround (what tech-reveal uses): always set an explicit `transitionOut` on
every non-final scene, and use a transition whose folder-name-derived file
exists. For a carry-less handoff use `shatterWipe`:

```json
"transitionOut": { "type": "shatterWipe", "durationInFrames": 20 }
```

Real fix (proposed, not yet applied): patch `Composition.jsx:46` to also honor
`manifest.component`:

```js
const entryFile = manifest.main || manifest.component || defaultFileName;
```

Same one-line fix applies to the asset discovery at `Composition.jsx:21` (assets
happen to work because every shipped asset's file is already `${folderName}.jsx`,
so the convention-derived name is correct by accident — but the moment an asset
is added whose component file doesn't match the folder name, it silently
disappears from the registry).

## 3. Full-bleed centered image is a manifest-only change

To make `ImageReveal` fill the entire panel centered — no JSX edit, no new asset
flag — set `anchor` to `center` with zero offsets and `styleOverride.width`/`height`
to the composition size, and drop `borderRadius` to 0:

```json
{
  "assetType": "ImageReveal",
  "anchor": { "position": "center", "offsetXPercent": 0, "offsetYPercent": 0 },
  "contentOverride": { "src": "...", "alt": "..." },
  "styleOverride": { "borderRadius": 0, "revealDirection": "center-out", "width": 1920, "height": 1080 },
  "enterAt": 0, "exitAt": 1
}
```

Verified against `resolved.json`: `resolveAnchor` returns `left:0, top:0` with
`transformOrigin: 50% 50%`, and `ImageReveal.jsx` already pulls box size from
`resolvedStyle.width/height` with `objectFit: cover` on the inner `<img>`, so the
image crops to fill the full frame.

Caveat: hardcoding `width/height` per scene couples the manifest to the
composition size in `config.json` — change `config.width` later and the box no
longer matches. A `fill: "composition"` opt-in in `ImageReveal.jsx` (pulling
`width/height` from `useVideoConfig`, which is already imported) would make this
composition-relative and portable, at the cost of a schema + JSX change. Worth
doing if full-bleed heroes become a common pattern.

## 4. Resolved graph is a singleton — protect it

`render.js:24` hardcodes `resolved.json` at the repo root, and `resolve.js`'s
default output writes there too. If you resolve a second project without an
explicit output path, you silently overwrite the first project's graph and the
next render target gets the wrong content with no error.

Workaround used for this task: back up the existing graph before resolving a
different project, pass an explicit third arg if you want it elsewhere, and
restore after:

```bash
cp resolved.json resolved.backup.json
node src/pipelines/pipeline2-resolve/resolve.js src/manifest/new-project/manifest.json resolved.json
# render (reads root resolved.json)
node src/pipelines/pipeline3-render/render.js out/new-project.mp4
mv resolved.backup.json resolved.json   # restore previous
```

Real fix (proposed): let `render.js` read the resolved graph path from an env
var or argv (`resolved.json` path should be a render input, not a global).

## 5. Output capture and debugging commands that hang

Two mechanical traps that cost real time during this task:

- The terminal tool's default timeout is 60s even when you pass a longer timeout
  to the underlying `node` process — pass the *tool* timeout, not just a shell
  `timeout` wrapper, or the wrapper is killed first. For renders that bundle
  Remotion, set the tool timeout to 540s (build is foreground-blocked up to 600s).
- When a node process hangs before flushing stdout (the TTS case above), piping
  to `tail` gives an empty buffer and you see nothing. Redirect to a file first
  (`>/tmp/render.log 2>&1`), then read it back — the file captures even on kill.

## Streamlined path (the 5-minute recipe)

The fastest zero-dependency path from empty manifest to rendered mp4, assuming
the Kyutai TTS server is not running and you don't need voiceover:

1. Copy `src/manifest/boilerplate/` to `src/manifest/<project-id>/`.
2. Fill `manifest.json` — `projectId`, `config`, `styles`, `scenes[]`. **Omit
   the `narration` block entirely.** Leave `audioOverlay` out too.
3. Fill `config.json` — `fps`, `width`, `height`, `defaultSceneDurationInFrames`
   (this is now your real per-scene duration, not a fallback).
4. Fill `styles/theme.json` — every color/typography/easing token your scenes
   reference must exist here; missing tokens throw at resolve, not validate.
5. Author each scene file. Every scene needs a `narrationRef` string (schema
   requirement, value ignored when narration is absent). Give every non-final
   scene an explicit `transitionOut` of type `shatterWipe` (or another
   convention-conforming transition) — **never rely on the implicit `default`**.
6. Run:
   ```bash
   node src/pipelines/pipeline1-validate/validate.js src/manifest/<id>/manifest.json
   node src/pipelines/pipeline2-resolve/resolve.js src/manifest/<id>/manifest.json resolved.json
   node src/pipelines/pipeline3-render/render.js out/<id>.mp4
   ```
   expect `OK: N scene(s) validated`, `Resolved scene graph written to
   resolved.json`, `Done.` — no other output means success.

Reference example that follows this path: `src/manifest/tech-reveal/`. Two
scenes, full-bleed `ImageReveal` (scene 2) + `KineticText` headline (scene 1) +
`TextBlock` caption, `shatterWipe` handoff, no narration, renders in ~15s after
the first Remotion bundle. Output: `out/tech-reveal.mp4` (160 frames, 5.33s at
30fps, ~450KB).
