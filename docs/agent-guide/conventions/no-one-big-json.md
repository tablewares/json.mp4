# No one big JSON

A single `manifest.json` containing everything is a bad interface for an
agent: it's easy to produce a document that's structurally valid but
semantically wrong (wrong token, wrong asset id, off-screen offset), and
hard to diff/patch incrementally.

Instead, the manifest is a router — it only points at other files:

```
manifest.json          <- paths only
  ├─ config.json
  ├─ styles/theme.json
  └─ scenes/<id>.json
```

An agent edits one scene file or the style registry without touching
anything else. Errors thrown by validate/resolve are file-scoped to the
file that's wrong, not a line somewhere in a 2KB blob.
