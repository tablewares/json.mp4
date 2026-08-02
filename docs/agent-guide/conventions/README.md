# conventions/

The design rules the framework enforces. Read once; these explain *why*
the contracts in `../reference/` are shaped the way they are.

- `no-one-big-json.md` — small files, manifest is a router.
- `token-vs-literal.md` — token-first styling; literal overrides as escape hatch.
- `anchor-nudge.md` — never author raw x/y; corner + signed % nudge.
- `folder-not-switch.md` — assets/transitions discovered by folder scan.
- `timing-from-tts.md` — per-scene duration from narration, not a guessed number.
- `pipeline-trust.md` — each stage trusts only the previous stage's contract.

These are the invariants. If you find yourself fighting one, that's
usually a sign you're missing an existing escape hatch the framework
already supports — check the relevant reference file before inventing a
new shape.
