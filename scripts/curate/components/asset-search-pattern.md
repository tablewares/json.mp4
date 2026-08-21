# Pattern: acquiring an asset for the embeddings-searchable public/ library

`public/` is now indexed by `mcp-local-rag` (see `mcp-local-rag` skill) so
an agent can `query_documents` for "a rocket launch shot" or "bitcoin logo"
instead of re-running `fetch_image.mjs`/`fetch_icon.mjs` blind every time.
The index is a text-embedding store — it cannot see pixels — so every
binary asset in `public/` needs a small text-shaped proxy document (a
"card") to actually be findable. This doc is the four-step pattern for
adding ONE new asset the searchable way; do all four steps, in order,
every time — a downloaded file with no card is invisible to search.

## The four steps

1. **Search** — `scripts/pexels/fetch_image.mjs`/`fetch_broll.mjs`
   (stock), `scripts/svg/fetch_icon.mjs --list` (offline brand icons), or
   `opencli yandeximages search` (hyper-specific named subjects) — per
   `scripts/SKILL.md`'s sourcing rule. Get raw candidates with metadata
   (id, title/alt, width, height) BEFORE downloading/writing anything.

2. **Quality/relevance gate** — `scripts/assets/relevance-check.mjs`.
   Feed it the same candidate list the search step returned, not the
   downloaded files:
   ```bash
   node scripts/assets/relevance-check.mjs \
     --query "office team meeting laptop" --type image \
     --candidates '[{"id":"3865639","title":"...","width":7680,"height":5120}, ...]'
   ```
   Three gates, all must pass: relevance (token-overlap vs the search
   query), resolution (per-type minimum — vectors/svg always pass),
   duplicate (token-overlap vs existing `public/assets`/`public/svg`
   filenames). Only download/save candidates the check `accept`s. Don't
   hand-wave past a reject — widen the query or pick a different
   candidate instead of inserting a rejected one.

3. **Acquire** — run the actual fetch script (or `opencli yandeximages`
   download step) for the accepted candidate(s) only. This is the step
   that writes bytes into `public/assets/` or `public/svg/`.

4. **Catalog + ingest** — `scripts/assets/asset-catalog.mjs` turns the new
   file into a searchable card:
   ```bash
   # record provenance/tags/relevance BEFORE cataloging (optional but recommended)
   node scripts/assets/asset-catalog.mjs --set-meta public/assets/img_office_team_meeting_laptop_3865639.jpg \
     '{"source":"pexels","sourceQuery":"office team meeting laptop","sourceId":"3865639","altText":"...","photographer":"Andrea Piacquadio","relevanceScore":62,"tags":["office","team","meeting","laptop","coworkers"]}'

   # write the sidecar + print the ingest-ready card
   node scripts/assets/asset-catalog.mjs --only img_office_team_meeting_laptop_3865639.jpg --write-sidecar
   ```
   Then, from the agent session (this script has no MCP client), call
   `ingest_data` with the printed `card.ingestData` object for each new
   asset. `source` is `asset://<relative path>` — a `query_documents` hit
   maps straight back to the real file path, no separate lookup table.

## Why a card, not raw file indexing

`mcp-local-rag` ingests text/PDF/DOCX/MD content — it has no image/video
embedder. A `.jpg`/`.mp4`/`.svg` dropped into `public/` is otherwise
invisible to `query_documents`. The card is a proxy document carrying
everything a search should be able to match against: filename tokens
(fetch scripts already encode the acquisition query into the filename —
`img_<query>_<id>.jpg`, `<slug>.svg` — so even an un-catalogued asset has
SOME signal), tags, alt text, and provenance. Cataloging just makes that
signal a first-class searchable chunk instead of something only visible
via `ls`/grep on a filename.

## Sidecar shape (`<file>.meta.json`)

```json
{
  "file": "public/assets/img_office_team_meeting_laptop_3865639.jpg",
  "assetType": "image",
  "source": "pexels",
  "sourceQuery": "office team meeting laptop",
  "sourceId": "3865639",
  "altText": "Positive focused multiracial coworkers gathering ...",
  "photographer": "Andrea Piacquadio",
  "license": null,
  "relevanceScore": 62,
  "tags": ["office", "team", "meeting", "laptop", "coworkers"],
  "width": 7680,
  "height": 5120,
  "durationSeconds": null,
  "catalogedAt": "2026-08-20T00:00:00.000Z"
}
```

`asset-catalog.mjs` reads this sidecar back on every future run (e.g. a
resync after the file changed), so `--set-meta` provenance survives
across re-cataloging — it's a shallow-merge, not a fresh guess.

## Search-then-use loop

Before running steps 1-4 for a NEW asset, always `query_documents` first
— the asset you want may already be in `public/` under a different query
term:
```
query_documents({ query: "rocket launch night" })
```
If a hit's card's `file` path exists and its `relevanceScore` /
resolution look right for the new use, reuse it directly (point
`contentOverride.src` at it) instead of re-acquiring a near-duplicate —
`relevance-check.mjs`'s duplicate gate exists precisely to keep this from
silently drifting into two near-identical files anyway, but checking
first is cheaper than letting the gate catch it later.
