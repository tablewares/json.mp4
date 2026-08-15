# Schema indexer

Reads pipeline1 JSON Schema files, resolves `$ref`, flattens `oneOf`/`anyOf`/`allOf`, and surfaces constraints (min/max/pattern/default/enum). Used by agents to discover file contracts without manual schema inspection.

Separate from `envelope` command: `envelope` maps fields to files; `schema indexer` defines field content contracts. Uses same schemas as `validate.js`.

Source: `src/agent/schemaIndex.js`, `src/pipelines/pipeline1-validate/schema/`, `scripts/agent-cli.mjs`.

## CLI discovery

```bash
node scripts/agent-cli.mjs schemas               # list schema files + required keys + def count
node scripts/agent-cli.mjs schema <filename>     # flatten one schema file's full contract
node scripts/agent-cli.mjs definition <name>     # find a definition by name across all schemas
```

- `schemas`: Returns `{ file, label, required, definitionCount }`.
- `schema <filename>`: Returns `{ file, label, root, definitions }`. `root.properties` lists top-level keys; `definitions` maps named sub-shapes.
- `definition <name>`: Returns `{ name, file, ref, shape }` for a specific definition.

## The 6 schema files

| file | label | required | def count |
|---|---|---|---|
| `manifest.schema.json` | manifest.json (router) | `projectId`, `config`, `styles`, `scenes` | 0 |
| `scene.schema.json` | scenes/<id>.json (scene content) | `id`, `assets` | 5 |
| `shared.schema.json` | shared definitions | — | 3 |
| `style.schema.json` | styles/theme.json (registry) | `colors`, `typography`, `spacing` | 0 |
| `camera.schema.json` | scene.camera (spec) | — | 3 |
| `transition.schema.json` | scene.transitionOut (spec) | — | 1 |

## Standalone ESM API (`src/agent/schemaIndex.js`)

Synchronous, mtime-cached exports:
- `listSchemas()`: `() -> [{ file, label, required, definitionCount }]`
- `describeSchema(filename)`: `(filename) -> { file, label, root, definitions }`
- `findDefinition(defName)`: `(defName) -> { name, file, ref, shape }`
- `describeSchemaPath(filename, dotPath)`: `(filename, dotPath) -> flattened shape`
- `describeAllSchemas()`: `() -> { schemaCount, schemas: {...}, schemaDir }`
- `clearCache()`: `() -> force reload from disk`

## Flattening Rules

| feature | flattened output |
|---|---|
| `$ref` | inline expansion; `sourceRef` added |
| `oneOf` / `anyOf` | `{ oneOf/anyOf: [<flattened>], description? }` |
| `allOf` | shallow-merged into one object |
| `properties` | `{ properties: { key: { ... }, required?: true }, required: [...], additionalProperties: bool }` |
| `items` | `{ items: <flattened>, minItems?, ... }` |
| `additionalProperties` | `{ mapValues: <flattened> }` (for `style.colors` etc.) |
| `enum`/`min`/`max`/`pattern`/`default` | preserved on node |

## Examples

- **Asset effect keys:** `node scripts/agent-cli.mjs definition assetEffect`
- **`enterAt` type check:** `node scripts/agent-cli.mjs schema scene.schema.json` (check `root.properties.assets.items.properties.enterAt`)
- **Timing anchor shape:** `node scripts/agent-cli.mjs definition timingAnchor`
- **Manifest contract:** `node scripts/agent-cli.mjs schema manifest.schema.json`

## Tests
`node scripts/test-schema-index.mjs` (50 passed). Covers all exports, cross-file refs, unions, map types, and cache.
