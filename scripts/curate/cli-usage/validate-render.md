# Validate and render

## Validate

```bash
node scripts/agent-cli.mjs validate <projectId>
```

Runs real schema + cross-reference checks (Ajv against every scene, `narrationRef` existence, anchor validity, etc.) without bundling or rendering. Returns `{ ok:true, sceneCount, projectId }` or `{ ok:false, error }`. Always run after batch of `add-*` calls and before `render` — far cheaper than a failed render.

## Render

```bash
node scripts/agent-cli.mjs render <projectId> [out/<filename>.mp4]
```

`outputMp4` optional (defaults to `out/<projectId>.mp4`). Runs full `validate → registry → resolve → render` pipeline via `scripts/render-project.mjs` subprocess; returns `{ ok, code, stdout, stderr }`. On `ok:false`, read `stderr` — it points at the specific stage (validate/registry/resolve/render) and file that failed. Fix by re-running relevant `add-*`/`set-*` command, not hand-editing written JSON.

## Authoring a new asset or transition

When no registered type fits what run needs, agent can introduce one. Two starter folders under `studio/`:

- `studio/assets/AssetBoilerplate/` — copy-and-adapt template for new visual asset. `README.md` = 5-step checklist.
- `studio/transitions/TransitionBoilerplate/` — equivalent for new transition (no README; follow `docs/agent-guide/transitions/authoring-new.md`).

Flow:

1. Copy relevant boilerplate folder into new PascalCase-named folder (`studio/assets/<NewName>/` or `studio/transitions/<NewName>/`).
2. Rename component file and export to `<NewName>`.
3. Update boilerplate `manifest.json`'s `assetType`/`transitionType`, `component`, `description`. Author `contentOverrideSchema`/`styleOverrideSchema`/`params` to match the behavior component will read.
4. Edit JSX to implement that behavior. Component receives `resolvedPosition`, `resolvedStyle`, `content`, `timing` (see boilerplate's JSDoc / `studio/assets/AssetBoilerplate/README.md`).
5. Registry auto-rescanned on every `npm run build`/`render` — new type visible to `agent-cli.mjs assets`/`transitions` immediately, no separate registration. Run `node scripts/agent-cli.mjs asset <NewName>` (or `transition <NewName>`) to confirm manifest parses, then probe `add-asset` against scratch scene to confirm `warnings: []`.

Authoring a new asset/transition component = the one case where you edit files under `studio/` by hand — manifest schemas and JSX necessarily bespoke. By design; only exception to "go through CLI". Applies to component side, never to project manifests under `studio/manifest/**/`.

Detailed contracts: `docs/agent-guide/assets/authoring-new.md` and `docs/agent-guide/transitions/authoring-new.md`. Read those first time you author one in a session.

## Pipeline pointers

When a `validate`/`render` error points at a stage contract you don't recognize, authoritative references:

- `docs/agent-guide/CONTEXT.md` — high-level mental model and router.
- `docs/agent-guide/reference/` — manifest, config, scene, styles, narration, audio-overlay contracts.
- `docs/agent-guide/conventions/` — enforced design rules validators care about (anchor+nudge, token-vs-literal, registry pattern, timing-from-tts, no-one-big-json, pipeline-trust).
- `docs/agent-guide/pipelines/` — three-stage contract in depth. Read when debugging which stage threw.
- `src/agent/ProjectBuilder.js` — class behind `agent-cli.mjs`. Fallback when a command's behavior unclear.
