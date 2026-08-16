# `cli-usage/` — convention

One doc per agent-cli command, **named after the command** (`<command>.md`),
plus a small set of pre-existing topic docs for cross-command concepts that
don't map 1:1 to a single command.

## Naming convention (`filename = agent cli command name`)

A new file is added whenever a CLI command on
`scripts/agent-cli.mjs` earns its own doc. The filename is the **exact command
name, kebab-cased, with `.md`** appended:

| command (as printed by `node scripts/agent-cli.mjs --help`) | file |
|---|---|
| `add-effect` | `add-effect.md` |
| `inject-effects` | `inject-effects.md` |
| `add-scene`            | (covered today by `build.md`; promote when it earns its own page) |
| `add-asset`            | (covered today by `build.md`) |
| `set-transition` | (covered today by `transitions.md`) |

Commands that share a workflow (e.g. `add-scene`/`add-asset`/`update-asset`/
`remove-asset` all build out a scene's body) can continue to live on a shared
topic doc like `build.md` until they earn a dedicated page — **the convention
grows files, it doesn't relocate existing ones**. When a command does earn its
own page (as `add-effect` and `inject-effects` did during the effects refactor),
create `<command>.md` here and cross-link it from the topic doc that used to
host its coverage (see `build.md`'s `## Injecting effects at scene boundaries`
section pointing at `inject-effects.md`).

### When to spawn a `<command>.md`

Spawn a dedicated `<command>.md` (rather than keeping a command inside a topic
doc) when any of these hold:

- The command has its own **match-mode / payload model** worth documenting
  end-to-end (e.g. `inject-effects`' two `match` modes + frame computation):
  spawn immediately so a reader can land on it from the command name alone.
- The command writes to a **schema** that's itself worth referring to (e.g.
  `add-effect` ↔ `effects.schema.json`): spawn so the doc owns the mapping.
- The command's worked example is non-trivial enough that it would crowd the
  topic doc (e.g. a multi-step scratch-project verify walkthrough).

Don't spawn a `<command>.md` when a one-liner + a thin JSON example fits neatly
inside an existing topic doc (most `add-`/`update-`/`remove-` commands fall in
this category today).

### What each `<command>.md` doc must contain

To keep the per-command pages scannable, follow this structure:

1. **`# <command>`** — H1 = the command name (matches the file basename).
2. **One-sentence purpose**, including which on-disk file(s) / array the
   command writes to (e.g. `scene.effects[]`).
3. **`## Syntax`** — the exact `node scripts/agent-cli.mjs <command> ...`
   invocation, including the JSON arg (note the `"-"` reads-from-stdin trick).
4. **`## <match modes / sub-shapes>`** — one subsection per distinct payload
   mode the command accepts (e.g. `inject-effects` has two `match` modes;
   `add-effect` has sfx vs. visual).
5. **`## <Verify>`** — the read-only commands that confirm the write landed
   (`validate`, `timeline`, or a one-shot `node -e` resolve dump).
6. **A worked example whose output you have actually run** — paste the
   exact stdout / on-disk JSON the command produced on a real scratch project
   in this session. Never a plausible-but-unrun example.
7. **`## In-repo references`** — sibling cli-usage docs + in-repo design docs
   the command's behavior depends on.

### What the topic docs (pre-existing pattern) continue to host

Cross-command conceptual docs that don't map 1:1 to a single command stay as
topic filenames (NOT `<command>.md`):

- `build.md` — orchestrating scene+asset construction (`add-scene`,
  `add-asset`, `update-asset`, `remove-asset`) plus pointers to the dedicated
  per-command docs (`add-effect.md`, `inject-effects.md`).
- `transitions.md` — `set-transition`/`update-transition`/`remove-transition`
  + the detached `scene.effects[]` schema overview.
- `timing.md` — the `timingAnchor` reference shared by asset-timing + the
  effects legacy-bridge `timing` shape.
- `camera.md`, `audio.md`, `backgrounds.md`, `styles.md`, `init.md`,
  `collections.md`, `discover.md`, `registry.md`, `post-effects.md`,
  `render.md`, `schema.md`, `validate-render.md`, `avoid.md` — these remain as
  topic docs.

The split is: **command → `<command>.md`; concept-or-workflow → topic doc**.

## Conventions inherited from the rest of `curate/`

These apply to every doc in this folder regardless of which pattern it uses:

1. **Run `node scripts/agent-cli.mjs --help` before authoring** to confirm a
   command exists — the CLI help output is the source of truth for command
   surface (catches fabricated commands like `update-scene`; see the
   `curate-doc-authoring` reference in the `json-to-mp4-manifest` Hermes
   skill).
2. **Verify every path you write** against current source (the
   `doc-hygiene.md` pitfall — `src/{assets,transitions}` long since moved to
   `studio/`; `src/pipelines/` framework source still lives under `src/`).
   Don't copy a path from a sibling doc.
3. **Re-run the worked example** on a fresh scratch project before pasting its
   output. Verify commands (`validate` + `resolve`) get into the doc only if
   they were observed to pass on the project the doc describes.
