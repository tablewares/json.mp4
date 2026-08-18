# studio/library

Project-agnostic, reusable presets — separate from any one `studio/manifest/<project>`.
Discoverable via `scripts/discovery.mjs` (read-only) and editable via
`scripts/cli.js` (`theme` / `alias` commands). `scripts/project-cli.js create`
can seed a brand-new project's theme from here with `--theme <name>`.

## themes/

One `style.schema.json`-shaped JSON file per named theme (`colors`,
`typography`, `spacing`, `easing`). `default.json` mirrors the framework's
built-in `DEFAULT_THEME` (`src/agent/defaults.js` / `scripts/lib/project.js`)
so every project always has a fallback that satisfies the `easing` block
requirement (see json-to-mp4-manifest skill pitfall #18 — a theme missing
`easing` blows up at resolve, not validate).

- `scripts/discovery.mjs themes` — list every theme preset name.
- `scripts/discovery.mjs theme <name>` — dump one preset's full JSON.
- `scripts/cli.js theme list` — same list, from the mutation-side CLI.
- `scripts/cli.js theme show <name>` — dump one preset.
- `scripts/cli.js theme create <name> ['<json>']` — save a new preset; omit
  the JSON to snapshot the ACTIVE project's current `styles/theme.json`.
- `scripts/cli.js theme use <name> [--replace]` — merge (default) or replace
  the active project's theme with a saved preset.
- `scripts/project-cli.js create <id> --theme <name>` — seed a brand-new
  project's theme from a preset instead of the hardcoded default.

## aliases/

One or more flat JSON files, each mapping `"category.name"` to
`{ description?, vars?, expansion }`. `expansion` is a STATIC object (or
array, for multi-entry aliases like `effects.*`) — JSON can't hold a
variable-taking function, so file-based aliases don't support `vars`
substitution the way the built-in code aliases in
`src/registry/aliasRegistry.js` can; they always expand to exactly the same
shape. For a variable-taking alias, register it in code instead (see
`registerAlias` in that file).

Loaded into the SAME runtime alias registry the pipeline resolves
`"$alias"` references against (`src/registry/aliasLibrary.js` calls
`registerAliases()` from `src/registry/aliasRegistry.js`), so a custom
alias saved here is immediately usable in scene JSON — `resolve.js` and
`scripts/discovery.mjs` both load this library before touching aliases.

- `scripts/discovery.mjs aliases [category]` — lists built-in AND custom
  aliases together (custom entries carry `"source": "custom"`).
- `scripts/discovery.mjs alias <name>` — describes one alias, built-in or
  custom.
- `scripts/cli.js alias list [category]` / `alias show <name>`
- `scripts/cli.js alias create <category.name> '<expansion-json>' ['<description>']`
- `scripts/cli.js alias delete <category.name>`
