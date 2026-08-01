# Each pipeline trusts only the previous one

```
validate  ->  resolve  ->  render
```

- `validate` only trusts the files it reads (manifest + scene + style).
- `resolve` only trusts `validate`'s output contract.
- `render` only trusts `resolved.json` — it never re-opens the manifest,
  styles, or asset/transition manifests.

Why: a failure at stage N points at the file/field that's wrong, not at
some downstream consumer that happened to break. And pipeline 3 is free to
move, cache, or re-bundle the resolved graph without touching the source
files. Keep this contract — don't import manifest/styles/registries into
`render.js` or `index.jsx`.
