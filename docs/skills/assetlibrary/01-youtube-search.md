# 01 — Searching YouTube for tracks and SFX

Use when you **don't yet have a URL** — need to find candidates for a track,
transition SFX, ambient bed, or any audio source before downloading. Output:
shortlist of video IDs + durations to feed into
[`02-yt-dlp-download.md`](02-yt-dlp-download.md).

`yt-dlp` ships a YouTube search prefix returning real entries without an API key:

```
ytsearchN:<query>      → top N matches
ytsearchall:<query>    → all results (paginated, slow)
```

Key flag: `--flat-playlist --dump-json`. Emits one compact JSON line *per
result* without resolving full metadata (one network round-trip + one big JSON
blob per result otherwise — wasteful for a shortlist).

## Recommended one-liner (trimmed)

```bash
yt-dlp --flat-playlist --dump-json "ytsearch5:free transition sound effect whoosh" 2>/dev/null \
|| python3 -c "
import json, sys
for i, l in enumerate(sys.stdin, 1):
    d = json.loads(l)
    print(f'{i}. url=https://www.youtube.com/watch?v={d.get(\"id\")} '
          f'dur={d.get(\"duration\")} title={d.get(\"title\")[:70]}')
"
```

Output (real example):

```
1. url=https://www.youtube.com/watch?v=b9hBHt317mw dur=28.0 title=FREE Transition Sound Effects [Swoosh Pack] (Sam Kolder | Taylor Cut F
2. url=https://www.youtube.com/watch?v=qP_iJ-yLi7c dur=11.0 title=5 Free Cinematic Whoosh Sound Effect | Whoosh Sound Effects | FREE Tra
3. url=https://www.youtube.com/watch?v=pqEn9icjK0I dur=6.0  title=Whoosh Sounds effects No copyright
4. url=https://www.youtube.com/watch?v=pyzUhkKf2Qo dur=8.0  title=Magic WHOOSH / Transition Sound FX (NO Copyright)
5. url=https://www.youtube.com/watch?v=xVlgn7vGJ0I dur=32.0 title=FREE Transition Sounds Effects! | Swoosh, Swish, Whoosh
```

Each line ~110 chars. Raw `--dump-json` line is **8–15 KB** per result
(description, thumbnails, formats, subtitles…). Shortlist of 5 saves ~50–75
KB context — matters on token-billed agent.

## What `--flat-playlist` actually gives

Without it, `yt-dlp` resolves each result (downloads watch page, talks to
player API, extracts formats). With it, only the **playlist-level entries**
YouTube's search page already contains — `id`, `title`, `duration`, `channel`,
`view_count` (sometimes). Everything to pick a candidate, nothing you don't.

Field cheat-sheet (flat, search results):

| Field | Usually present? | Use |
|---|---|---|
| `id` | yes | video ID — paste into `watch?v=` URL |
| `title` | yes | fit check (e.g. "no copyright" in title) |
| `duration` | yes, seconds | reject too-long clips; SFX ≤ 30s are pack candidates |
| `url` | yes (sometimes `webpage_url`) | alternate URL form |
| `uploader` / `channel` | yes | official artist channel vs. random reupload |
| `view_count` | sometimes | legitimacy signal for music videos |
| `description`, `formats`, `thumbnails` | **no** (only without `--flat-playlist`) | fetch only when actually needed |

## Query patterns

**Music tracks**: artist + track + "official" biases toward artist-uploaded
versions (ones whose licenses the framework can plausibly honor for a demo).

```
ytsearch3:"The Weeknd" "Timeless" official
```

**SFX packs**: "free" or "no copyright" + noun for the sound's physical
character, not just "sound effect" — "whoosh", "riser", "sub drop", "boom",
"swoosh", "cinematic hit". One-word queries return lo-fi 10-hour "rain
sounds" spam.

```
ytsearch5:free cinematic riser hit sound effect no copyright
ytsearch5:free whoosh transition sound effect
ytsearch3:free cinematic sub drop boom no copyright
```

## Picking from the shortlist

Three things to eyeball before committing to a download in step 02:

1. **Duration vs. intent.** 6s clip = one SFX, use as-is. 28s clip = likely a
   *pack* of several SFX stitched — fine, but go to
   [`03-sfx-from-single-source.md`](03-sfx-from-single-source.md) to slice.
   4-minute "whoosh" = "10 hours of whoosh" lofi — skip.
2. **"No copyright" / "free" / "royalty-free" in title.** Framework produces
   demo videos; pick uploads marked reusable. Not legal clearance — best
   heuristic at search stage. License audit out of scope.
3. **Uploader.** Music: prefer artist's official channel. SFX: channels
   specializing in editing assets (e.g. Sam Kolder-style swoosh packs) upload
   well-separated, silence-bounded clips — makes doc 03 slicing actually work.

## When to skip search

Already have a URL (someone pasted one, or saved from earlier session)? Skip
this doc, go straight to [`02-yt-dlp-download.md`](02-yt-dlp-download.md).
Search is only for discovery.

## Output of this step

List of video IDs and durations — nothing else. Next: download the winner(s)
in `02-yt-dlp-download.md`.
