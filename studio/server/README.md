# Render Review Tool

Reviews rendered videos against their source manifests, scores them, and
lets an AI agent query the accumulated verdicts to learn what "good" and
"bad" look like in this pipeline.

## Layout

```
review-tool/
  server.js        Express server: scans manifest+video dirs, serves UI, persists reviews
  db.js             SQLite schema + query helpers (better-sqlite3)
  scanner.js        Pairs manifests to same-name .mp4 files
  public/index.html Review UI (vanilla JS/CSS, no build step)
  bin/query-agent.mjs   Read-only CLI for AI agents to query verdicts/patterns
```

## 1. Install

```
npm install
```

## 2. Run the review server

```
node server.js --manifests /path/to/studio/manifest --videos /path/to/renders/out --db ./review-tool-data/reviews.db --port 4870
```

Manifest directory supports two layouts, matched automatically:
- flat: `<dir>/<projectId>.json`
- nested: `<dir>/<projectId>/manifest.json` (id read from `projectId` field if present — matches this pipeline's `studio/manifest/<projectId>/manifest.json` layout)

Videos are matched as `<videoDir>/<projectId>.mp4`.

Env var equivalents: `REVIEW_MANIFEST_DIR`, `REVIEW_VIDEO_DIR`, `REVIEW_DB_PATH`.

Open `http://localhost:4870`. Pick a project in the sidebar, watch the
render, read the manifest side-by-side, score it (verdict + overall +
per-category bars for kinetic text / color & contrast / camera / pacing /
transitions / audio sync / overall craft), add tags (`good:x`, `bad:y`
convention) and freeform notes, save.

Every review snapshots the manifest JSON at review time, so later schema
edits to the source file don't retroactively change what a past review
was actually judging.

## 3. Query from an AI agent

`bin/query-agent.mjs` is a separate, read-only binary — it never touches
the manifest/video directories, only the reviews DB — so an agent can run
it mid-authoring without needing the review server up.

```
bin/query-agent.mjs good --db ./review-tool-data/reviews.db
bin/query-agent.mjs bad  --db ./review-tool-data/reviews.db --category camera
bin/query-agent.mjs patterns --db ./review-tool-data/reviews.db
bin/query-agent.mjs project btc-code --db ./review-tool-data/reviews.db
bin/query-agent.mjs search "shake" --db ./review-tool-data/reviews.db
```

Add `--json` to any command for machine-readable output instead of the
text report. `patterns` is the highest-value call for an agent starting a
new scene: it returns tag frequency split by verdict (what to aim for /
avoid) and average category scores for good vs. bad renders.

`REVIEW_DB_PATH` env var works here too, so an agent doesn't need `--db`
if it's already set in the environment.

## Notes

- The DB is SQLite (`better-sqlite3`), a single file — safe to commit
  reviewer notes to source control or ship alongside the manifest repo if
  desired, or gitignore it if reviews are considered ephemeral.
- Nothing here writes to manifest or video files — it's read-only against
  both scanned directories; only `reviews.db` is written.
- Category keys are fixed (`kineticText`, `colorAndContrast`, `camera`,
  `pacingAndTiming`, `transitions`, `audioSync`, `overallCraft`) — edit the
  `CATEGORIES` array in `public/index.html` and `CATEGORY_KEYS` in `db.js`
  if the taxonomy needs to change.
