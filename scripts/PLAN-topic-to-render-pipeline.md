# Topic → Render Pipeline Implementation Plan

> **For Hermes:** Use the `video-agent-cli` skill (`scripts/SKILL.md`) for Stage 3
> (the actual build). Stages 1–2 are new entry-point scripts that hand off to it.

**Goal:** Let a run start from nothing but a topic ("markets this week", "explain
OAuth") and end with a rendered mp4, by adding two thin entry-point scripts in
`scripts/` that chain the agent through topic → research → asset selection →
build → render, always landing on the existing `agent-cli.mjs` for the actual
file writes.

**Architecture:** Three stages, one per script, no cross-stage state beyond a
JSON research brief that flows forward through stdout:

```
topic (argv)
   │
   ▼
scripts/agent-research.mjs   ── stage 1 ── topic → research brief JSON
   │   (web_search / web_extract, deep research on the topic;
   │    produces { topic, scenes: [{id, narration, sources[], facts[]}] })
   ▼
scripts/agent-plan.mjs       ── stage 2 ── research brief → manifest plan JSON
   │   (introspects the asset/transition registry via agent-cli.mjs;
   │    selects existing assets/transitions OR copies a boilerplate into
   │    studio/assets/<NewName>/ or studio/transitions/<NewName>/ and
   │    extends the registry; produces a build sequence consumable by
   │    agent-batch.mjs)
   ▼
scripts/agent-cli.mjs init / add-scene / add-asset / set-transition /
   validate / render   ── stage 3 ── manifest plan → out/<projectId>.mp4
       (unchanged — this is the video-agent-cli skill's existing core
       workflow. agent-batch.mjs runs the whole sequence in one process.)
```

Each stage is its own process and prints one JSON document to stdout, exits 0
on success / 1 with `{ ok: false, error }` on failure — matching the existing
`agent-cli.mjs` contract so an agent can chain them mechanically without
parsing prose.

**Tech stack:**
- Node ESM (`"type": "module"` already in package.json).
- `web_search` / `web_extract` tools — invoked as Hermes tools by the agent
  that runs `agent-research.mjs`, NOT imported into the script itself. The
  script's job is to *structure* the research, not perform it; the agent
  driving the run is what issues the actual web calls and feeds results in.
  (Two designs considered; see "Open questions" — this is the recommended
  one, keeps the scripts pure and testable.)
- `scripts/agent-cli.mjs` for registry introspection (`assets`, `asset
  <Type>`, `transitions`, `transition <Type>`, `anchors`, `envelope`).
- `scripts/agent-batch.mjs` for executing the final build sequence.
- `fs.cpSync` (Node 16.7+) for boilerplate-folder copy.

---

## Stage 1 — `scripts/agent-research.mjs` (topic → research brief)

**Objective:** Take a free-text topic and emit a structured JSON research brief
that Stage 2 can plan a video around. The script itself does NOT call the web
— it accepts the topic and an optional `--research <path>` JSON file the
agent pre-populated from its Hermes `web_search`/`web_extract` calls, normalizes
the shape, splits the synthesized content into N narration scenes, and writes
entries + a fullTranscript that the framework's TTS provider
(`external/tts-provider.js` → kyutai + WhisperX) will time against.

**Inputs (argv):**
- `topic` (positional, required) — free text, becomes `projectId` after
  slugification (trim, lowercase, replace non-`[a-z0-9]+` with `-`, clamp
  length to 32, strip leading/trailing `-`). Reject empty / only-`-`
  results with a clear error.
- `--research <path>` (optional) — JSON file the agent produced from its
  web research. Expected shape (lenient — missing fields default to empty):
  ```json
  {
    "topic": "markets this week",
    "summary": "One paragraph synthesis.",
    "scenes": [
      {
        "id": "scene-001",
        "headline": "Markets moved fast this week.",
        "narration": "Markets moved fast this week, led by tech and energy.",
        "facts": ["S&P 500 +1.2%", "NVDA +3.2%"],
        "sources": [{"url": "https://...", "title": "..."}]
      }
    ]
  }
  ```
- `--scenes <n>` (optional, default `3`, max `6`) — desired scene count.
  If the research file provided fewer/more, the script either pads with
  generic "[fill in scene N]" placeholders or truncates, and logs a warning
  to stderr.

**Behavior:**
1. Parse argv. Slugify topic → `projectId`. Validate uniqueness against
   `node scripts/agent-cli.mjs projects` (call via `spawnSync`, parse stdout
   JSON); if `projectId` already exists, suffix `-2`, `-3`, etc.
2. If `--research` was given, read + JSON.parse it (lenient; missing fields
   default to empty). If not, synthesize a minimal brief from `topic` alone:
   one summary line and `--scenes` placeholder scenes with narration
   `[Research topic: <topic> — scene N]`. Log to stderr that this is a
   stub and the agent should re-run with `--research`.
3. Combine each scene's `headline` + `narration` + facts (each fact as a
   short clause) into one canonical narration string per scene if the
   research file did not already provide a `narration` string. (Avoid
   canny heuristics — keep the combination rule explicit and predictable.)
4. Assemble `fullTranscript` by concatenating every scene's final narration
   with a single space between entries — this is what `tts-provider.js`
   synthesizes and what `resolve.js` uses to derive per-entry start/end.
5. Emit the research brief to stdout:
   ```json
   {
     "ok": true,
     "projectId": "markets-this-week",
     "topic": "markets this week",
     "narration": {
       "entries": [{"id":"scene-001","text":"..."}, ...],
       "fullTranscript": "..."
     },
     "scenes": [
       {
         "id": "scene-001",
         "headline": "...",
         "narration": "...",
         "facts": ["..."],
         "sources": [{"url":"...","title":"..."}]
       }
     ]
   }
   ```
6. Exit 0 on success, 1 with `{ ok: false, error }` on any failure.

**Files:**
- Create: `scripts/agent-research.mjs`
- No edits to existing files.

**Step 1: Write the argv parser and slugifier**
~40 lines. Slugify with regex `/[^a-z0-9]+/g`, clamp length, dedup against
`agent-cli.mjs projects` via `spawnSync`.

**Step 2: Write the research-file loader (lenient)**
~30 lines. `JSON.parse` with try/catch, default missing `scenes` to `[]`,
missing `summary` to `""`, etc. Throw clear errors on malformed JSON.

**Step 3: Write the scene-splitter / placeholder generator**
~40 lines. If `research.scenes.length < n`, pad with templated placeholders.
If `> n`, truncate and log a warning. Merge `headline`+`narration`+`facts`
into one narration string only when `narration` is absent.

**Step 4: Assemble `entries` + `fullTranscript` and emit stdout**
~20 lines. Map scenes to `{id, text}` entries, join with `" "` for
`fullTranscript`. Wrap in the success shape, `JSON.stringify(..., null, 2)`.

**Step 5: Smoke test**
```bash
node scripts/agent-research.mjs "markets this week" --scenes 3
# Expected: JSON brief with projectId "markets-this-week", 3 scenes,
# single glued transcript. Exit 0.
node scripts/agent-research.mjs "markets this week" --research /tmp/brief.json
# Expected: brief mirrors the research file's scenes, fullTranscript
# concatenates each narration entry.
```

---

## Stage 2 — `scripts/agent-plan.mjs` (research brief → manifest plan)

**Objective:** Take Stage 1's JSON brief and produce a build sequence that
`agent-batch.mjs` can execute in Stage 3. The script introspects the live
asset + transition registries by calling `agent-cli.mjs assets` /
`asset <Type>` / `transitions` / `transition <Type>`, matches each scene's
narration + facts to existing asset/transition types, and **optionally** copies
`studio/assets/AssetBoilerplate/` or `studio/transitions/TransitionBoilerplate/`
into a new folder when the agent decides the topic needs something the
registry doesn't already have.

**The agent's role here is the editorial judgment.** The script provides
three things the agent needs to make that judgment call mechanically:

1. The registry's full content+style schema for every existing type
   (`agent-cli.mjs assets` → `asset <Type>` for each).
2. A `--new-asset <Name> --description "<...>"` flag that copies the
   AssetBoilerplate folder, renames the component, and writes a starter
   manifest with the agent-supplied description + a placeholder schema —
   the agent then edits the JSX content + schema to match the topic.
3. A `--new-transition <Name> --description "<...>"` flag that does the
   same for TransitionBoilerplate.

After all `--new-*` copies are made (if any), the agent assembles an
`agent-batch.mjs`-shaped JSON array — `[["init", {...}], ["add-scene", ...],
["add-asset", ...], ["set-transition", ...], ..., ["validate", projectId]]` —
and the script emits it to stdout as `{ ok: true, projectId, steps }`.

**Inputs (argv):**
- `brief` (positional, required) — path to Stage 1's output JSON, OR `-` to
  read the brief from stdin (so the agent can pipe stages together:
  `agent-research.mjs ... | agent-plan.mjs -`).
- `--new-asset <PascalCaseName>` (repeatable) — copy AssetBoilerplate into
  `studio/assets/<Name>/`, rename the component export, leave the JSX
  body + manifest schema for the agent to edit. The flag may be given as
  `--new-asset Name="description text"` to pre-fill the manifest's
  `description` field.
- `--new-transition <PascalCaseName>` (repeatable) — same for
  TransitionBoilerplate.
- `--anchor-strategy <center|top-left|bottom|...>` (optional) — default
  anchor position to use when the planner doesn't specify one per-asset
  (default `center`). Per-scene overrides are emitted in the steps array.

**Behavior:**
1. Read the brief (from `path` or stdin). Validate it has the Stage 1 shape.
2. Discover the registry: `node scripts/agent-cli.mjs assets` and
   `node scripts/agent-cli.mjs transitions`, parsing each command's JSON
   stdout into arrays of `{ assetType, description, defaultSize }` /
   `{ transitionType, description, defaultDurationInFrames }`. For each
   candidate type the agent shows interest in (by matching keywords in
   the scene narration/facts — see "Editorial heuristics" below), descend
   with `agent-cli.mjs asset <Type>` / `transition <Type>` to get the
   full content+style schema. The script exposes these schemas as
   structured JSON to the agent; it does NOT pick assets itself.
3. For each `--new-asset <Name>`:
   - Verify `<Name>` is a PascalCase identifier (`/^[A-Z][A-Za-z0-9]+$/`)
     and doesn't already exist in `studio/assets/`.
   - `fs.cpSync("studio/assets/AssetBoilerplate",
       "studio/assets/<Name>", { recursive: true })`.
   - Rename `AssetBoilerplate.jsx` → `<Name>.jsx` and replace the export
     name + the manifest's `assetType` / `component` fields.
   - If `Name="description"` was passed, write it into the manifest's
     `description`; otherwise leave the boilerplate description.
   - Log the new folder + the README's 5-step adaptation guide (from
     `studio/assets/AssetBoilerplate/README.md`) to stderr so the agent
     sees exactly what to edit next.
4. Do the same for each `--new-transition <Name>` (TransitionBoilerplate has
   no README; the script writes the same 5-step adaptation guide inline,
   adapted: rename folder/component, update manifest `transitionType` +
   `component`, rename the exported factory, replace the sample param
   shape, set `defaultDurationInFrames`).
5. For each scene in the brief, emit one `["add-scene", projectId, {...}]`
   step (id, narrationRef = scene.id, background `"shade1"`,
   transitionOut `{"type":"default"}` — the patched ProjectBuilder now
   backfills `durationInFrames` from the registry, so we don't need to
   hand-specify it; see Stage 3 pitfall #1).
6. For each scene, emit one or more `["add-asset", projectId, sceneId,
   {...}]` steps. The script does NOT pick the assetType — that is the
   agent's editorial call, made with the registry data the script exposed
   in step 2. The script's job is to make sure the chosen assetType is
   valid (in the registry, or just created via `--new-asset`) and that
   the step's `contentOverride`/`styleOverride`/`anchor` shape matches
   the registry's published schema. Mismatched keys are dropped with a
   warning to stderr (the schema check inside `addAsset` will report
   the rest as `warnings`, which Stage 3 reads).
7. Emit `["validate", projectId]` as the final step.
8. Output: `{ ok: true, projectId, newAssets: [...], newTransitions: [...],
   steps: [...] }`. Exit 0 / 1 with `{ ok: false, error }`.

**Editorial heuristics (guidance, not hard rules):** The script exposes
registry data; the agent matches scene content to asset types. Suggested
mapping table to encode in `scripts/SKILL.md` (see Stage 4 below):

| Content of scene                           | Likely asset type(s)                  |
| ------------------------------------------ | ------------------------------------ |
| One punchy number / KPI / metric           | `NumberStat`                         |
| Scrolling list of prices / tickers         | `TickerTape`                         |
| Comparison of competing values              | `BarChartRace`                       |
| Bullet list / steps / checklist            | `ListReveal`                         |
| Code / command / config                    | `CodeBlock`                          |
| Image / photo / poster reveal              | `ImageReveal`                        |
| Word-by-word emphasis synced to narration  | `KineticText` (set `text` = narration) |
| Plain headline / paragraph                  | `TextBlock`                          |
| None of the above fits                     | Copy `AssetBoilerplate`, adapt       |

Transition choice: `default` for plain cuts, `slideContinuity` /
`pivotZoom` when an asset is shared across two adjacent scenes (use
`carryAssetId` — first time the asset's id repeats across scenes),
`shatterWipe` for high-energy topic shifts, `TransitionBoilerplate` copy
when something bespoke is needed.

**Files:**
- Create: `scripts/agent-plan.mjs`
- No edits to existing files (the script only writes into
  `studio/assets/` / `studio/transitions/` when `--new-*` flags are used,
  which is by design — those are the documented "make a new asset" paths).

**Step 1: Write the brief loader (path or stdin)**
~25 lines. Same `readStdinSync` pattern as `agent-cli.mjs:71-77`.

**Step 2: Write the registry introspection helper**
~40 lines. Spawn `agent-cli.mjs assets` / `transitions`, parse stdout,
return `{ assets: [...], transitions: [...] }`. Cache; only descend into
per-type `asset <Type>` / `transition <Type>` when the agent's keyword
match flags a candidate (the script returns the full per-type schema to
the agent for the editorial call).

**Step 3: Write the `--new-asset` copy + rename**
~50 lines. `fs.cpSync` recursive, `fs.renameSync` for the JSX file,
`fs.readFileSync` + `String.prototype.replace` for the export name +
manifest fields. Validate PascalCase + uniqueness.

**Step 4: Write the `--new-transition` copy + rename**
~40 lines. Same pattern; TransitionBoilerplate has a factory export
(`TransitionBoilerplate` function name) so the rename targets two
identifiers.

**Step 5: Wire the per-scene step emission**
~60 lines. One `add-scene` per scene, then `add-asset`/`set-transition`
steps per the agent's supplied manifest plan (see "Open questions" for
how the agent conveys its plan to the script — recommendation: a JSON
file `--plan <path>` produced by the agent after reading the script's
registry dump, so the script's role stays "validation + assembly", not
"editorial selection").

**Step 6: Validate the steps array against the live registry**
~30 lines. For every `["add-asset", , , {assetType, ...}]` step, confirm
the assetType exists in the registry (or was just created via `--new-asset`).
Same for transition types. Drop unknown content/style keys with a warning.

**Step 7: Emit `{ ok, projectId, newAssets, newTransitions, steps }`**
stdout JSON, exit 0 / 1.

**Step 8: Smoke test**
```bash
# No new assets — picks TextBlock + NumberStat for a 2-scene research brief
echo '{"projectId":"t","topic":"t","narration":{"entries":[{"id":"scene-001","text":"hi"}],"fullTranscript":"hi"},"scenes":[{"id":"scene-001","narration":"hi","facts":["82% of cats"]}]}' \
  | node scripts/agent-plan.mjs - --plan /tmp/plan.json

# New asset — copy AssetBoilerplate into studio/assets/QuoteCallout/
node scripts/agent-plan.mjs /tmp/brief.json --new-asset QuoteCallout="A big pull-quote with attribution." --plan /tmp/plan.json
# Expected: studio/assets/QuoteCallout/ exists with QuoteCallout.jsx + manifest.json
#           (assetType = "QuoteCallout", description set), and the steps array
#           references assetType "QuoteCallout". Exit 0.
```

---

## Stage 3 — `scripts/agent-cli.mjs` (unchanged) + `scripts/agent-batch.mjs`

**Objective:** Take Stage 2's `steps` array and produce an mp4. No new
scripts here — this is the existing `video-agent-cli` skill workflow,
unchanged.

**Behavior:**
```bash
node scripts/agent-batch.mjs '<JSON array of steps>'
node scripts/agent-cli.mjs render <projectId> out/<projectId>.mp4
```
(`agent-batch.mjs` already runs the steps in order and stops at the first
failing one. `render` is separate so the agent can run `validate` once
more or inspect `list-assets` between batch and render.)

**Pitfalls to bake into `scripts/SKILL.md` (Stage 4):**

1. **`{"type":"default"}` now backfills `durationInFrames: 18`** — the
   ProjectBuilder patch from this session means the agent no longer needs to
   hand-specify it. The skill's existing recipes that write
   `{"type":"default"}` are now correct as-is (they were silently wrong
   before; the patch is what made them right).
2. **`exitAt: 1` (not `0.95`) for closing assets** — a closer TextBlock with
   `exitAt < 1` will visually disappear before the scene's TTS audio
   finishes, leaving the last word or two playing against an empty board.
   For the final scene's closer / any asset meant to ride the full
   narration, use `exitAt: 1` (default). Reserve `exitAt < 1` for assets
   you explicitly want to leave early.
3. **TTS fencepost** — `ttsTiming.js` now derives `durationInFrames` as
   `round(end*fps) - round(start*fps)` so middle scenes no longer drift by
   ±1 frame vs. the actual audio. No skill change needed; just don't revert
   that line.

**Files:**
- No edits to `scripts/agent-cli.mjs` or `scripts/agent-batch.mjs`.

**Validation:**
- Stage 3 itself is verified end-to-end by the run we already did this
  session (the demo project built + rendered + fixed the cut-off bug).

---

## Stage 4 — Update `scripts/SKILL.md` (the agent's runbook)

**Objective:** Make `scripts/SKILL.md` aware of Stages 1–2 so a future agent
loading the skill knows the topic-to-render flow exists.

**Files:**
- Modify: `scripts/SKILL.md` — add a new top section "## Topic → render
  pipeline" *before* the existing "## The workflow" section, plus the
  editorial heuristics table + the three pitfalls from Stage 3.

**Edits:**

1. **Insert new section before "## The workflow"** titled
   `## Topic → render pipeline (when you only have a topic)`:
   - One paragraph: when the user gives you only a topic (no scenes, no
     narration), start at Stage 1. When they give scenes/assets, skip to
     Stage 3 (the existing "## The workflow").
   - Three subsections describing each stage's script + a one-line example
     invocation.
   - The "agent's editorial call" paragraph for Stage 2, emphasizing that
     the agent CAN copy a boilerplate into `studio/assets/<NewName>/` or
     `studio/transitions/<NewName>/` when no existing asset/transition fits,
     and that the boilerplate README (`studio/assets/AssetBoilerplate/
     README.md`) is the adaptation checklist.

2. **Insert the editorial heuristics table** (from Stage 2 above) into the
   new "Topic → render" section, not into the existing "Discover" section
   (which is about introspecting what already exists, not what to pick).

3. **Add the three pitfalls from Stage 3** to the existing "## Things to
   avoid" section, replacing or extending the current bullet list. The
   existing list already says "Don't assume TOON" and "Don't skip validate
   before render" — append the new three without rewording the old ones.

4. **Cross-link**: under existing "## 1. Discover", add one line:
   "When the agent copies a new asset via `agent-plan.mjs --new-asset`,
   re-run `node scripts/agent-cli.mjs asset <NewName>` after the
   adaptation edits to confirm the manifest schema is valid (warnings:
   \[\] across a synthetic add-asset)."

**Step 1: Read the current `scripts/SKILL.md` to get exact anchor strings
for patches.**

**Step 2: Insert the "Topic → render pipeline" section**

**Step 3: Insert the editorial heuristics table inside it**

**Step 4: Extend "## Things to avoid" with the three pitfalls**

**Step 5: Add the cross-link line under "## 1. Discover"**

**Validation:**
- `node scripts/agent-cli.mjs help` (or no args) still prints the help block.
- Re-read the patched `scripts/SKILL.md` end-to-end and check the new
  section flows into the existing "## The workflow" section without
  duplicate or contradictory guidance.

---

## Files likely to change

| File                                    | Action  | Stage |
| --------------------------------------- | ------- | ----- |
| `scripts/agent-research.mjs`            | create  | 1     |
| `scripts/agent-plan.mjs`                | create  | 2     |
| `scripts/SKILL.md`                       | modify  | 4     |
| `package.json`                          | modify  | 4 (optional) — add `agent:research` and `agent:plan` script entries mirroring the existing `agent:project` shorthand. |

No edits required to `scripts/agent-cli.mjs`, `scripts/agent-batch.mjs`,
`src/agent/ProjectBuilder.js`, `src/timing/ttsTiming.js`,
`src/pipelines/pipeline2-resolve/resolve.js`, or any `studio/` file.

---

## Tests / validation

No `tests/` directory exists in this repo (the project's verification is
`npm run build`, which exercises the pipeline end-to-end against
`studio/manifest/example-project/`). Validation plan for each task:

- **Stage 1 script:** `node scripts/agent-research.mjs "test topic" --scenes 3`
  → JSON with `projectId`, 3 scenes, glued transcript. Exit 0.
- **Stage 1 with --research:** pre-write a minimal brief to `/tmp/brief.json`,
  run with `--research`, confirm the brief was used verbatim.
- **Stage 2 script (no new assets):** pipe a Stage 1 brief into Stage 2 with
  a `--plan` file → confirm the steps array references only existing
  assetTypes and exits 0.
- **Stage 2 script (with --new-asset):** run with `--new-asset
  QuoteCallout="pull quote"` → confirm `studio/assets/QuoteCallout/` exists,
  `QuoteCallout.jsx` exports `QuoteCallout`, manifest says
  `assetType: "QuoteCallout"`, and `node scripts/agent-cli.mjs asset
  QuoteCallout` succeeds (proving the registry generator picked it up).
- **Stage 2 script (with --new-transition):** same for transitions.
- **End-to-end:** run Stage 1 → Stage 2 → `agent-batch.mjs` → `render` for
  a real 2-scene topic. Confirm `out/<projectId>.mp4` exists, the closer
  asset's `exitAt` is 1 (no audio cut-off), and the final scene's audio
  ends before the video frame count (the bug fix from this session holds).
- **`npm run build`:** unchanged — still renders `example-project` end-to-end.

---

## Risks, tradeoffs, open questions

**1. Where does the actual web research happen — script or agent?**
Recommended: agent does it with Hermes `web_search`/`web_extract` tools and
feeds results into Stage 1 via `--research <path>`. Alternative: import a
search client into `agent-research.mjs` directly. The recommended design keeps
the script pure (no network deps, no API keys, testable in isolation, runs
the same in CI as on the desktop) and matches the existing pattern where
`agent-cli.mjs` is also network-free. Cost: the agent has to do one extra
step (writing its research to a file before invoking Stage 1).

**2. Does Stage 2 select assets, or does the agent?**
The script can't read the user's mind; "what asset goes best with this
narration" is editorial judgment. Recommended split: Stage 2 *dumps*
registry schemas to stdout as structured JSON and *validates+assembles* a plan
the agent supplies via `--plan <path>` (the agent's plan file is just the
per-scene asset/transition picks). Alternative: encode keyword→assetType
heuristics directly in the script so a single command produces a full plan
with no agent in the loop. The first is more flexible (agent can override
heuristics); the second is faster for fully autonomous runs. The plan above
defaults to the first but the heuristics table in Stage 4 supports either.

**3. Boilerplate adaptation is the agent's job, not the script's.**
Stage 2 copies + renames the folder and writes the manifest description, but
the actual JSX content (the rendering behavior of the new asset) is left for
the agent to author by editing `studio/assets/<NewName>/<NewName>.jsx`. The
README's 5-step adaptation guide is the agent's checklist. The script does
not attempt to synthesize JSX — that is exactly the kind of code synthesis
that needs the full agent context (registry conventions, narration timing,
scene palette) and would only produce broken output if hardcoded.

**4. Two scripts vs one.**
Considered a single `scripts/agent-topic-render.mjs topic` that does
everything. Rejected because the stages have different inputs, different
costs (research is slow + networky; planning is fast + local; rendering is
slow + browser-headlessy), and the agent often wants to inspect
intermediate state between them (e.g. tweak narration wording after Stage
1 before locking in asset picks in Stage 2, or reject a `--new-asset` copy
before sending the batch). Three discrete JSON-exchanging processes also
fail loudly at the right stage instead of somewhere deep inside one
monolith.

**5. Should `agent-plan.mjs`'s `--new-asset` skip the registry re-scan?**
Registry is loaded fresh from `studio/{assets,graphics,transitions}` on
every `loadAssetRegistry()` call (see `src/registry/assetRegistry.js:82-88`),
so a newly-copied boilerplate folder is visible immediately to validate
the chosen assetType. No cache invalidation needed. Confirm in the
end-to-end test for Stage 2.

**6. Naming the new asset's component file.**
`studio/assets/AssetBoilerplate/AssetBoilerplate.jsx` exports
`AssetBoilerplate`. After copy + rename to `studio/assets/QuoteCallout/
QuoteCallout.jsx`, both the file and the default export should be renamed
to `QuoteCallout`. The registry's `generateRegistryManifest.js` reads the
`component` field from the manifest, not the export name, so a missed
rename wouldn't break the registry — but it would confuse the agent later.
The script does the rename; the agent is told (via the README log) to
verify.

**7. Do we recover if the agent's manifest schema change breaks an
existing `addAsset` warnings check?**
Yes — `agent-cli.mjs addAsset` returns `{ asset, warnings }` per the
existing contract; if the new asset's `contentOverrideSchema` is malformed
or too strict, the agent will get `warnings` back on the first probe
`add-asset`. The pitfall list in `scripts/SKILL.md` (Stage 4 edit) already
instructs the agent to run a synthetic `asset <NewName>` + `add-asset`
after authoring a new asset, so the recovery path is documented.

---

## Execution handoff

**Plan complete. Ready to execute — I'll implement the four stages in order
(Stage 1 → Stage 2 → Stage 4 → end-to-end validation), one stage at a time,
running each stage's smoke test before moving on. Want me to proceed?**
