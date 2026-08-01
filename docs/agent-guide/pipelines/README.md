# pipelines/

The three-stage contract: validate → resolve → render. Each stage only
trusts the contract of the one before it. When something fails, the
throwing function names the file and field — read the README for the stage
that failed to map the error text to the file/field you need to fix.

- `1-validate.md` — schema + cross-reference checks. Read when validate throws.
- `2-resolve.md` — token/anchor/timing/transition resolution. Read when resolve throws.
- `3-render.md`   — Remotion bundle + render. Read when render throws or output is wrong.

Each file lists the precise errors thrown and the file/field that causes each.
