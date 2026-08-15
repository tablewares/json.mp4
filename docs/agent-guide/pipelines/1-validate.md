# Pipeline 1 — validate

Manifest + every referenced scene + style registry are loaded and schema-
checked. On success returns `{ manifest, manifestDir, config, styles, scenes }`
(unchanged raw data, ready for pipeline 2) — validate never transforms
data, it only checks.

Source: `src/pipelines/pipeline1-validate/validate.js` (`validateProject`)

## What it does, in order

1. Load + Ajv-validate `manifest.json` against `manifest.schema.json`.
2. Load + Ajv-validate `manifest.styles` against `style.schema.json`.
3. Load `manifest.config` (no Ajv schema currently — the schema/ dir exists
   but is empty at time of writing; Ajv schemas are loaded from there if
   present. Treat config as structurally trusted, validated by usage in
   pipeline 2.)
4. For each `manifest.scenes[]` entry:
   - Load + Ajv-validate the scene file against `scene.schema.json`.
   - ⛔ Check `scenes[].id === scene file's id field`.
   - ⛔ If narration present, check the scene's `narrationRef` exists in
     `narration.entries[].id`.

The `scene.schema.json` now accepts `effects[]` on each asset (the
`assetEffect` definition) and `enterAt`/`exitAt` as either a legacy float or
a timing-anchor object (`shared.schema.json#/definitions/timingAnchor`).
Ajv validates these structurally; `ProjectBuilder.addAsset`/`updateAsset`
also calls `checkAssetEffects` (`src/agent/validators.js`) which round-trips
through `resolveAssetEffects` to catch semantic errors (unknown effect type)
at build time, surfaced as warnings.

## Errors and their causes

| thrown text (paraphrased) | cause | fix |
|---|---|---|
| `Validation failed in <context>: - <path> <message>` | Ajv schema violation; context = file path prefix | open the file at `instancePath`, fix the named field |
| `manifest.scenes entry id "X" does not match scene file id "Y" in <relPath>` | the `id` in the manifest's scenes[] entry ≠ the `id` field in the scene file | make them identical |
| `scene "X" narrationRef "Y" has no matching narration entry` | scene references a narration id that doesn't exist in `narration.entries` | add the narration entry or fix the ref |
| thrown while reading a path | `config`/`styles`/scene file path couldn't be opened | check the path is relative to the manifest dir and exists |

> Note on the empty `schema/` dir: `buildAjv` reads whatever `.json` files
> are there. If empty, `ajv.getSchema("manifest.schema.json")` returns
> `undefined` and validate currently no-ops the schema step (real schema
> files need to be added there — tracked separately). Cross-reference
> checks (id match, narrationRef) always run regardless.

## CLI

```bash
node src/pipelines/pipeline1-validate/validate.js path/to/manifest.json
```

Default manifest (no arg) = `studio/manifest/example-project/manifest.toon`.
Success prints `OK: N scene(s) validated for project "..."`.
