# 04 — Still image assets via the OpenCLI `yandeximages/search` adapter

Use when a scene needs a **still image** (hero photo, backplate, icon,
texture) and you want a real one from image search rather than authoring a
Remotion-native asset by hand.

Image-search path uses the OpenCLI adapter in this repo's sibling directory —
[`../images/`](../images/). This doc is a *thin wiring guide*: points at the
adapter README, then explains how downloaded image lands in `public/assets/`
so a manifest can reference it. Read `../images/README.md` first —
authoritative for the adapter itself.

## Why OpenCLI / Yandex, not direct curl

`yandeximages/search` runs inside OpenCLI browser session, which means:

- Request goes through your connected Chrome profile — Yandex sees a real
  browser, not a script. Yandex Images is far stricter than Google Images
  about bot detection; naive `curl` + `grep` returns a captcha wall.
- Adapter's `search.js` already implements the DOM extractor against Yandex's
  `a[href*="img_url="]` result markup, with a fallback inline-state scan and
  a captcha detector that error-exits cleanly instead of returning empty
  results.
- Returns structured rows (`image_url`, `thumb_url`, `width`, `height`,
  `title`, `source_url`) — no regex scraping on your side.

## One-time install

Install documented in `../images/README.md`. Short version:

```bash
mkdir -p ~/.opencli/clis/yandeximages
cp ~/json.mp4/docs/skills/assetlibrary/images/search.js \
   ~/json.mp4/docs/skills/assetlibrary/images/search.test.js \
   ~/.opencli/clis/yandeximages/
opencli list | grep -A1 yandeximages
#   yandeximages
#     search [public] — Search Yandex Images by keyword
opencli validate yandeximages/search
# opencli validate: PASS
```

OpenCLI's discovery filesystem-scans `~/.opencli/clis/**/*.js` — no manifest
edit needed. See `../images/README.md` for the "shared helper module" gotcha
(solved by the `search.js` here — helpers inlined).

## Searching

```bash
# table format — human scan
opencli yandeximages search "golden retriever puppies" --limit 20 -f table

# JSON format — pipe to jq for URLs only
opencli yandeximages search "abstract concrete texture background" --limit 10 -f json \
  | jq -r '.[].image_url'
```

| Field | Use |
|---|---|
| `image_url` | Direct image URL — what you want to download |
| `width` / `height` | Reject thumbnails / tiny icons. Hero asset wants ≥ 1920 on long edge. |
| `source_url` | Yandex search-result click-through URL — keep for licensing audit |
| `title` | Often descriptive; useful for renaming saved file |

## Downloading one result to `public/assets/`

Output rule from top-level `README.md`: still images go to
`~/json.mp4/public/assets/` (dir that `ImageReveal` and other image asset
types read from).

```bash
cd ~/json.mp4/public/assets && \
curl -fsSL -o "abstract-concrete-texture.png" \
  "$(opencli yandeximages search 'abstract concrete texture' --limit 1 -f json \
     | jq -r '.[0].image_url')"
```

Verify it's actually a usable image, not an HTML error page Yandex sometimes
substitutes:

```bash
file ~/json.mp4/public/assets/abstract-concrete-texture.png
# abstract-concrete-texture.png: PNG image data, 1920 x 1080, 8-bit/color RGBA, non-interlaced
ffprobe -v error -show_entries stream=width,height,codec_name \
  ~/json.mp4/public/assets/abstract-concrete-texture.png 2>&1 | head -6
```

`file` reports "HTML document" or "ASCII text" → URL was a redirect-to-CSS or
placeholder. Re-run search with `--limit 5`, inspect next row's `image_url`,
retry. Adapter's job ends at returning URLs — it does not download images.

## Naming convention

Same as audio in `02-yt-dlp-download.md`: lowercase, hyphenated, descriptive
of *content*, prefixed by role if known. Examples in this repo:

```
public/assets/
├── destination.png
├── network.png
├── white.avif
└── abstract-surface-textures-white-concrete-stone-wall_74190-8189.avif
```

No YouTube ID prefixes here (unlike audio `sources/`) — image assets don't have
a "source video" concept. To keep original search query for provenance, write
it as a sibling `.txt` metadata file rather than encoding into filename:

```
public/assets/abstract-concrete-texture.png
public/assets/abstract-concrete-texture.png.meta   # "query: abstract concrete texture, src: <source_url>"
```

## Pitfall: captcha wall

`opencli yandeximages search` throws *"Yandex Images returned a captcha/bot-
check page instead of results"* → adapter doing what it should — failing loud
rather than returning `[]` and looking like empty result set. Fix:

```bash
opencli browser open "https://yandex.com/images/search?text=cats"
# Solve captcha one time in connected Chrome profile window.
opencli browser close
# Retry adapter.
opencli yandeximages search "cats" --limit 5
```

Yandex cookies persist for Chrome profile, so one solve usually unblocks the
adapter for a long session. See `../images/README.md` "Verify it actually
works against the live site" for the full diagnostic flow.

## Verifying the OpenCLI adapter itself

Adapters silently degrade if Yandex changes DOM markup. Before trusting search
results for a new project, run the recon flow:

```bash
opencli browser recon analyze "https://yandex.com/images/search?text=test"
opencli browser recon verify yandeximages/search
```

`recon verify` compares live DOM against what `search.js` expects. Flags
drift → patch the extractor functions in `search.js`
(`buildSerpItemExtractorJs`, `buildInlineStateExtractorJs`) — isolated on
purpose, so patch is small. Re-run tests:

```bash
cd ~/.opencli/clis/yandeximages && npx vitest run search.test.js
```

## Output of this step

Downloaded still in `~/json.mp4/public/assets/`, ready to reference from a
manifest like:

```jsonc
// scene.assets[]
{
  "assetType": "ImageReveal",
  "src": "assets/abstract-concrete-texture.png",
  "anchor": { "position": "center" }
}
```

`path:` relative to `public/` — same contract as audio SFX. See
[`05-manifest-wiring.md`](05-manifest-wiring.md) for full wiring pattern.
