# reference/

Field-by-field contracts for every file an agent authors. Each file here
describes one authored file: required keys, optional keys, what each key is
typed as, and which source actually enforces the rule. Load only the file
that matches the file you're editing.

- `manifest.md`  — the router. Points at everything else.
- `config.md`    — render settings (fps, resolution, fallback duration).
- `scene.md`     — one file per scene: assets, anchor, transition, narrationRef.
- `styles.md`    — the style registry: color/typography/spacing/easing tokens.
- `asset-spec.md`— the shape of one entry inside a scene's `assets[]`
                    (anchor, contentOverride, styleOverride, enterAt/exitAt).
                    Distinct from `../assets/` which covers authoring a new
                    asset *component*, not using one.
- `narration.md` — optional. Drives per-scene timing via TTS.
- `audio-overlay.md` — optional. Places audio files on the timeline.

## Conventions used in every reference file

- **Required** vs **Optional** labels match exactly what the pipeline
  enforces, not what the example happens to include.
- ⛔ marks a key that will throw at validate or resolve time if violated, and
  names the throwing function.
- The `Source:` line at the bottom of each file points at the file that
  enforces the contract. Cross-check it when behavior diverges from this
  doc — the source wins, fix the doc.
