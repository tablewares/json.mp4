# 02 — Downloading with yt-dlp into `public/`

Use when you have a YouTube URL (or `ytsearch*` query to download directly) and
need the file under `~/json.mp4/public/` so a manifest can reference it.

Contract from top-level `README.md`: **destination always under
`~/json.mp4/public/`.** Audio goes to `public/audio/sources/` so doc 03 slicing
finds it; final, renamed SFX/track files get promoted to `public/audio/`.

## Pre-flight: where things go

```bash
mkdir -p ~/json.mp4/public/audio/sources
mkdir -p ~/json.mp4/public/audio/split
mkdir -p ~/json.mp4/public/assets          # doc 04 images
```

`sources/`: raw download. `split/`: work dir for doc 03 (per-hit slices).
`assets/`: image assets (see `04-images-opencli.md`).

## Audio download — MP3 best quality, with metadata

```bash
cd ~/json.mp4/public/audio/sources && \
yt-dlp -x --audio-format mp3 --audio-quality 0 \
  --embed-thumbnail --embed-metadata --add-metadata \
  -o "%(artist)s - %(title)s.%(ext)s" \
  "https://www.youtube.com/watch?v=5EpyN_6dqyk"
```

| Flag | Why |
|---|---|
| `-x` | Extract audio (don't keep video) |
| `--audio-format mp3` | Transcode to MP3 — universally readable by Remotion/ffmpeg |
| `--audio-quality 0` | Best VBR MP3 (0=best … 10=worst). Source usually opus ~160k; can't upscale, only preserve |
| `--embed-thumbnail` | Cover art inside MP3 — visible in editors |
| `--embed-metadata --add-metadata` | Embed title/artist/date as ID3 tags |
| `-o "%(artist)s - %(title)s.%(ext)s"` | Filename from metadata. `artist` = *channel name* for music; often empty for SFX packs → `NA - ` prefix. See "Filename fixups" |

## Batch download (multiple URLs)

```bash
cd ~/json.mp4/public/audio/sources && \
yt-dlp -x --audio-format mp3 --audio-quality 0 --embed-metadata \
  --no-warnings --no-playlist \
  -o "%(id)s - %(title).70s.%(ext)s" \
  "https://www.youtube.com/watch?v=b9hBHt317mw" \
  "https://www.youtube.com/watch?v=qP_iJ-yLi7c" \
  "https://www.youtube.com/watch?v=pqEn9icjK0I" \
  "https://www.youtube.com/watch?v=pyzUhkKf2Qo" \
  "https://www.youtube.com/watch?v=xVlgn7vGJ0I" \
  "https://www.youtube.com/watch?v=1g_5oijkxPM" \
  "https://www.youtube.com/watch?v=Am4wYTiHHx8" \
  --progress 2>&1 | grep -E "^\[download\] 100|^\[ExtractAudio\]|has already|ERROR"
```

- `--no-playlist` critical — without it, a URL that's part of a playlist pulls
  the whole playlist (could be hundreds of videos).
- `--no-warnings` + `grep` keeps output to per-file events (download complete /
  extracted / already / error) instead of progress bar spam. 7-file batch: ~15
  lines vs ~1.5k.
- Template `%(id)s - %(title).70s.%(ext)s` keeps video ID at front of filename —
  doc 03 slicing script keys off ID (stable; metadata `artist` may be empty).

## Downloading video (MP4) instead of audio

For `ImageReveal` asset type, B-roll overlays, or SFX pack video with visual
timing cues:

```bash
cd ~/json.mp4/public/assets && \
yt-dlp -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" \
  --merge-output-format mp4 \
  -o "%(id)s - %(title).70s.%(ext)s" \
  "https://www.youtube.com/watch?v=<ID>"
```

- `-f "bestvideo[height<=1080]+bestaudio/best[height<=1080]"` caps at 1080p
  (enough for overlays; higher just bloats `public/assets/`).
- `--merge-output-format mp4` combines separate video/audio streams yt-dlp
  downloads into one MP4 via ffmpeg.
- Goes to `public/assets/` (visual dir), not `public/audio/` — file is video.

## Filename fixups (very common)

`%(artist)s` falls back to "NA" (literal) when upload has no artist metadata →
filenames like `"NA - The Weeknd - Timeless.mp3"`. Strip after download:

```bash
cd ~/json.mp4/public/audio/sources && \
mv "NA - The Weeknd, Playboi Carti - Timeless.mp3" \
   "The Weeknd, Playboi Carti - Timeless.mp3"
```

Many to fix — prefix is consistent `NA - `:

```bash
cd ~/json.mp4/public/audio/sources && \
for f in NA\ -\ *.mp3; do mv "$f" "${f#NA - }"; done
```

## Verifying the download

Two fast checks:

```bash
# 1. Duration matches source?
ffprobe -v error -show_entries format=duration -of csv=p=0 \
  "~/json.mp4/public/audio/sources/The Weeknd, Playboi Carti - Timeless.mp3"
# → 256.058063  (matches ~4:16 video)

# 2. Metadata + thumbnail embedded?
ffprobe -v error -show_entries format_tags=artist,title,album,date:format=duration \
  "<file>" 2>&1 | head -10
# thumbnail:
ffprobe -v error -show_streams "<file>" 2>&1 | grep -E "codec_name=png|width=|height=" | head -3
```

yt-dlp-reported vs ffprobe duration mismatch = truncation symptom — usually
YouTube concurrent-download limit or network drop. Re-run with `--retries 5`
and `--fragment-retries 5`.

## Promoting a final asset into `public/audio/`

Clean file ready for manifest reference (vs. `sources/` download to slice
further): copy up one dir with a *descriptive* name — not the YouTube ID:

```bash
cp ~/json.mp4/public/audio/sources/"The Weeknd, Playboi Carti - Timeless.mp3" \
   ~/json.mp4/public/audio/"track-the-weeknd-timeless.mp3"
```

Lower-case, hyphenated, prefixed by what the asset *is* (`track-`, `whoosh-`,
`riser-`, `boom-`) — not what video it came from. Manifest `path:` reads this
name; humans reading manifest understand at a glance. yt-dlp source files stay
in `sources/` for re-fetch and licensing audit.

## Pitfalls

- **`yt-dlp` stale-version warning.** Debian/Ubuntu apt package lags months.
  YouTube tweaks player markup often; old yt-dlp silently degrades to
  format-251-only. Fix: `pip install --upgrade -U yt-dlp` (ensure newer binary
  on `$PATH` ahead of `/usr/bin/yt-dlp`).
- **No JS runtime.** yt-dlp warns "No supported JavaScript runtime could be
  found. Only deno is enabled by default." Download still works via
  `android vr player` API fallback, but some formats disappear (notably 1080p+
  on music videos). Install `deno` if needed — see
  https://github.com/yt-dlp/yt-dlp/wiki/EJS.
- **`--embed-thumbnail` on a file already containing a thumbnail** fails
  silently. Not fatal — second download of same ID won't re-embed.
