# Validate and render

## Validate

```bash
node scripts/agent-cli.mjs validate <projectId>
```

Runs real schema + cross-reference checks (Ajv against every scene, `narrationRef` existence, anchor validity, etc.) without bundling or rendering. Returns `{ ok:true, sceneCount, projectId }` or `{ ok:false, error }`. Always run after batch of `add-*` calls and before `render` — far cheaper than a failed render.

