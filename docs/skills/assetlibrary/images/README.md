# yandeximages/search — OpenCLI adapter

## Install (local adapter, auto-detected)

```bash
mkdir -p ~/.opencli/clis/yandeximages
cp search.js search.test.js ~/.opencli/clis/yandeximages/
```

OpenCLI's discovery (`dist/src/discovery.js`) filesystem-scans
`~/.opencli/clis/**/*.js` for files that call `cli(...)` from
`@jackwener/opencli/registry` — no manifest edit needed. Also auto-creates a
`node_modules/@jackwener/opencli` symlink under `~/.opencli/` first run, so
the import resolves.

**Important:** unlike built-in adapters, `search.js` here is fully
self-contained (no `../_shared/*` import). Originally wrote it importing a
helper module the way built-in `duckduckgo`/`douban` adapters do, installed at
`~/.opencli/clis/yandeximages/search.js`, ran `opencli list` — surfaced this
real error:

```
⚠  Failed to load module /root/.opencli/clis/yandeximages/search.js:
   Cannot find module '/root/.opencli/clis/_shared/search-adapter.js'
```

That shared helper dir only exists inside the *installed npm package*
(`node_modules/@jackwener/opencli/clis/_shared/`), not under your user
`~/.opencli/clis/` tree. Local/plugin adapters can't rely on it — inlined the
handful of helpers directly into `search.js` instead. This version is what's
in this folder.

## Confirmed working (actually run, not just written)

Installed `@jackwener/opencli@1.8.6` from npm, placed this file at
`~/.opencli/clis/yandeximages/search.js`, ran the real CLI:

```
$ opencli list | grep -A1 yandeximages
  yandeximages
    search [public] — Search Yandex Images by keyword

$ opencli validate yandeximages/search
opencli validate: PASS
Checked 1 command(s)
Errors: 0  Warnings: 0

$ npx vitest run search.test.js
✓ clis/yandeximages/search.test.js (9 tests)
Tests  9 passed (9)
```

If it's missing on your machine instead:
- Run `opencli doctor` — file may have a syntax error the scanner silently skipped.
- Check `OPENCLI_VERBOSE=1 opencli list` for discovery warnings (how the
  `_shared` import bug above was actually caught).

## Verify it actually works against the live site

Couldn't test against yandex.com from my sandbox (no network egress), so DOM
extraction is written against Yandex's historically documented
`.serp-item[data-bem]` markup, with a fallback scan for inline JSON state.
Before trusting it:

```bash
opencli browser recon analyze "https://yandex.com/images/search?text=cats"
opencli browser recon verify yandeximages/search
opencli yandeximages search "cats" --limit 5 -f json
```

If `recon analyze` shows different markup, or reports a captcha/WAF vendor
(Yandex's SmartCaptcha is likely), the `func` in `search.js` needs its
selectors updated — extractor functions (`buildSerpItemExtractorJs`,
`buildInlineStateExtractorJs`) are isolated so you can patch just the DOM
query.

## Run tests

```bash
cd ~/.opencli/clis/yandeximages
npx vitest run search.test.js
```

## Usage

```bash
opencli yandeximages search "golden retriever puppies" --limit 20 -f table
opencli yandeximages search "golden retriever puppies" --page 1 -f json
opencli yandeximages search '<search-query>' --limit 10 -f json | jq -r '.[].image_url'
```
