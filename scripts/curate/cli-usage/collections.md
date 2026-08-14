# Asset Collections Workflow

Use collections to source and validate external media (audio/images) before referencing them in scenes.

## 1. Discovery
- **List all workflows**: `node scripts/agent-cli.mjs collections`
- **Get specific command**: `node scripts/agent-cli.mjs collection <Type>`
  - Returns the exact CLI command to run, required prerequisites, and output fields.

## 2. Common Workflows

### Audio Pipeline (YouTube)
1. **Search**: Run `youtubeSearch` command.
   - `yt-dlp --flat-playlist --dump-json 'ytsearchN:<query>'`
   - Identify target `url` and `id`.
2. **Download**: Run `ytDlpDownload` command.
   - Download to `public/audio/sources/`.
3. **Optional Slicing**: Use `sfxSplit` if the source is a pack.
   - Splits by silence into `public/audio/split/`.

### Image Pipeline (Yandex)
1. **Search**: Run `imageSearch` command.
   - `opencli yandeximages search '<query>' --limit 10 -f json`
   - Identify `image_url`.
2. **Verify (Connection Test)**: **CRITICAL**.
   - Yandex URLs often 404 or return captchas.
   - `curl -fsSL <image_url> | file -`
   - Confirm output is a real image (PNG/JPEG/AVIF) with dimensions.
3. **Download**: `curl -o public/assets/<id>.<ext> <image_url>`.

## 3. Finalization: Manifest Wiring
Once all files are on disk in `public/audio/` or `public/assets/`, run:
```bash
node scripts/agent-cli.mjs collection manifestWiring
```
This validates the path contract. Skipping this is the primary cause of render crashes (`TypeError: Cannot read properties of undefined` on media `src`).

## Summary Table
| Type | Source | Tool | Destination |
|---|---|---|---|
| BGM/SFX | YouTube | `yt-dlp` | `public/audio/` |
| Images | Yandex | `opencli` + `curl` | `public/assets/` |
| Wiring | Local | `agent-cli` | Manifests |
