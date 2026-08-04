# Asset Library — gathering sources for the json-to-mp4 framework

Asset-gathering workflow: find, download, slice, wire-in external media so a
manifest author can reference it without leaving the `public/`-relative path
contract.

Split across several small docs. Each covers **one** acquisition method —
load only what you need. All share one rule and one output directory.

## The one rule

> **All files go into `~/json.mp4/public/`.**

- Audio SFX/music → `~/json.mp4/public/audio/`
- Downloaded MP4/MP3 sources for slicing → `~/json.mp4/public/audio/sources/` (transient — delete after slicing OK)
- Sliced SFX (hits cut from a pack) → `~/json.mp4/public/audio/split/`
- Still images from OpenCLI adapter → `~/json.mp4/public/assets/`

Manifest contract (see `docs/agent-guide/reference/manifest.md`,
`docs/transition_effects.md`) references every asset as a path **relative to
`public/`**. Anything outside `public/` is invisible to the renderer.
Destination matters more than source.

Example transition SFX in a scene:

```jsonc
// scene.transitionOut.effects[]
{
  "kind": "sfx",
  "offsetPercent": 0,
  "path": "audio/split/b9hBHt317mw_part05.mp3",   // resolves to public/audio/split/...
  "volume": 0.85
}
```

…works only if file lives at `~/json.mp4/public/audio/split/b9hBHt317mw_part05.mp3`.

## When to use which doc

| You are... | Read |
|---|---|
| Finding track/SFX by keyword on YouTube, need URL or shortlist | [`01-youtube-search.md`](01-youtube-search.md) |
| Have video URL or `ytsearch*` query, need MP3/MP4 downloaded into `public/` | [`02-yt-dlp-download.md`](02-yt-dlp-download.md) |
| Have one SFX-pack video (several SFX back-to-back), want each as standalone file | [`03-sfx-from-single-source.md`](03-sfx-from-single-source.md) |
| Need still image for a scene (Yandex image search via OpenCLI adapter — sibling `images/`) | [`04-images-opencli.md`](04-images-opencli.md) |
| Asset already in `public/`, need to put it in a scene manifest | [`05-manifest-wiring.md`](05-manifest-wiring.md) |

Each doc self-contained. Cross-refs point outward only when next step depends on them.

## Directory layout (after gathering)

```
~/json.mp4/public/
├── assets/                       # still images (doc 04)
│   ├── destination.png
│   └── …
└── audio/
    ├── sources/                  # unedited downloads (doc 02)
    │   ├── The Weeknd - Timeless.mp3
    │   └── b9hBHt317mw - Swoosh pack.mp3
    ├── split/                    # per-hit slices (doc 03)
    │   ├── b9hBHt317mw_part01.mp3
    │   └── …
    └── <named finalized SFX>.mp3 # curated, renamed, ready-to-reference
```

`sources/` and `split/` are working dirs — cache originals and per-hit slices.
Files referenced from manifests are the finalized hits in `public/audio/`
(often copied from `split/` with a descriptive name like `whoosh-cinematic-01.mp3`).

## Prerequisites

| Tool | What for | Install check |
|---|---|---|
| `yt-dlp` | Download + `ytsearch*` query (docs 01, 02, 03) | `yt-dlp --version` |
| `ffmpeg` / `ffprobe` | Probe duration, silence-split, fades (docs 02, 03) | `ffmpeg -version` |
| `python3` | Parse `--dump-json` output compactly (all docs) | `python3 --version` |
| `opencli` | Drive browser adapter for image search (doc 04) | `opencli --version` |

Debian/WSL `yt-dlp` apt package goes stale fast. On extraction failure (esp.
after YouTube markup change), upgrade: `pip install --upgrade -U yt-dlp`.

## Output discipline

Report of each gathering step, at minimum:

- **Path chosen** — absolute `~/json.mp4/public/...` path file landed at.
- **Source** — URL or query it came from (re-fetch / licensing audit).
- **Format / duration / size** — so author decides: reference as-is or trim further.

Asset-focused. Track or SFX is finished when it has a descriptive filename in
`public/` and you can write the `path:` entry pointing at it — not when
"download command exited 0."
