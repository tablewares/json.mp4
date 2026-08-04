# 03 — Deriving multiple SFX from a single video

Use when one YouTube video is a *pack* of several SFX stitched back-to-back
(e.g. "5 Free Cinematic Whoosh Pack", "FREE Transition Sound Effects"). Want
each effect as its own file to drop individually into a scene's
`transitionOut.effects`.

Technique: silence-based splitting. ffmpeg's `silencedetect` filter emits
timestamps where audio drops below a noise threshold; cut at midpoint of each
silence gap and each clip is one isolated effect, no re-encode (`-c copy` on
MP3 is fast, lossless at frame boundaries).

Destination (per top-level `README.md`): `~/json.mp4/public/audio/split/`.
Source downloads live in `~/json.mp4/public/audio/sources/`
(see [`02-yt-dlp-download.md`](02-yt-dlp-download.md)).

## Step 1 — Probe for silence

Run on a source file already downloaded:

```bash
cd ~/json.mp4/public/audio/sources && \
SRC="b9hBHt317mw - FREE Transition Sound Effects [Swoosh Pack].mp3" && \
ffmpeg -nostdin -hide_banner -i "$SRC" \
  -af silencedetect=n=-30dB:d=0.18 -f null - 2>&1 \
| grep "silence_" | sed 's/.*silence_/silence_/'
```

Output (real example):

```
silence_start: 0
silence_duration: 0.897125        ← leading silence (skip)
silence_start: 1.83325
silence_duration: 0.651875
silence_start: 3.397833
silence_duration: 0.605187
silence_start: 5.478271
silence_duration: 1.140667
silence_start: 7.364438
silence_duration: 0.83
silence_start: 10.261792
silence_duration: 1.190729
silence_start: 13.738854
silence_duration: 1.063187
silence_start: 15.891896
silence_duration: 1.603771
silence_start: 17.926042
silence_duration: 0.868375
silence_start: 19.103208
silence_duration: 1.182438
silence_start: 20.451917
silence_duration: 7.446875       ← final tail silence (skip)
```

| Flag/Arg | Why |
|---|---|
| `silencedetect=n=-30dB` | Noise floor. -30 dB good default for SFX packs (louder than ambient music). `-40dB` if pack has quiet tail reverb you still want separated; `-25dB` if narrator/upload has background hum you want treated as silence. |
| `silencedetect:d=0.18` | Min silence *duration* to count. 180 ms filters micro-gaps inside one effect (zero-crossing between two syllables of "whooo-osh"). Shorter than 0.18 s not a real pause between effects. |
| `-f null -` | No output file — silence detection reads whole stream, produces no media, just stderr log lines. |
| `-nostdin` | Don't read keyboard — required in script/agent pipeline (ffmpeg hangs on stdin without it). |

## Step 2 — Read total duration

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC"
# → 27.899...
```

## Step 3 — Cut clips at silence midpoints

Midpoint of each silence gap = natural cut point. Build list once (start,
midpoints, end-of-file), then `-c copy` each segment. No re-encode, instant,
lossless at MP3 frame boundaries.

Python helper keeps bookkeeping honest (don't hand-write — off-by-one errors
mean clips with chopped tails or padded silence):

```python
import os, subprocess
from pathlib import Path

SRC = Path.home() / "json.mp4/public/audio/sources/<source>.mp3"
OUT = Path.home() / "json.mp4/public/audio/split"
OUT.mkdir(parents=True, exist_ok=True)
PREFIX = "<ID>"                          # e.g. "b9hBHt317mw" — filename prefix

# Midpoints of each silence gap, from step 1's output.
# Skip first (leading silence) and last (tail silence).
silence_midpoints = [
    (1.833 + 0.652/2),   # 2.159 — end of effect 1 / start of effect 2
    (3.398 + 0.605/2),
    (5.478 + 1.141/2),
    (7.364 + 0.830/2),
    (10.262 + 1.191/2),
    (13.739 + 1.063/2),
    (15.892 + 1.604/2),
    (17.926 + 0.868/2),
    (19.103 + 1.182/2),
]

def total_dur(p):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)], capture_output=True, text=True)
    return float(r.stdout.strip())

cuts = [0.0] + silence_midpoints + [total_dur(SRC)]

for i in range(len(cuts) - 1):
    ss, to = cuts[i], cuts[i+1]
    if to - ss < 0.35:              # drop sub-0.35s noise blips
        continue
    out = OUT / f"{PREFIX}_part{i+1:02d}.mp3"
    subprocess.run([
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{ss:.3f}", "-to", f"{to:.3f}", "-i", str(SRC),
        "-c", "copy", str(out)
    ], check=True)
    print(f"{out.name:32s} start={ss:6.2f}s dur={total_dur(out):5.2f}s "
          f"size={out.stat().st_size//1024:4d}KB")
```

Each run microseconds (`-c copy` doesn't decode/re-encode). 10-clip file
finishes ~2 seconds.

## Step 4 — Optional: micro-fades to eliminate seam clicks

Stream-copy cuts land on MP3 frame boundaries, not zero-crossings.
Non-zero-crossing cut sometimes gives a single-sample click on first/last
frame — inaudible in mix but checkable with `ffprobe`. For absolute
edit-timeline cleanliness, re-encode with very short (5 ms) linear fades:

```bash
cd ~/json.mp4/public/audio/split && \
for f in <PREFIX>_part*.mp3; do
  ffmpeg -nostdin -hide_banner -loglevel error -y \
    -i "$f" \
    -af "afade=in:st=0:d=0.005,afade=out:st=$((ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | cut -d. -f1)-1):d=0.005" \
    -c:a libmp3lame -q:a 0 \
    "${f%.mp3}_faded.mp3"
done
```

Re-encodes (slower, lossy-once), but only files you'll actually drop in a
timeline. Do this *after* auditing raw split and deciding which cuts to keep —
don't fade throwaway clips.

## Common pitfalls

- **No silences found** → pack has continuous music or SFX overlap. Try
  `n=-25dB:d=0.08` first (lower threshold, shorter min). Still nothing: source
  isn't silence-splittable — abandon, search for separate per-SFX upload, or
  slice by fixed time intervals (manual waveform inspection in Audacity).
- **Clips with truncated tails** → midpoint cut slightly *before* actual end
  of an effect (effects often end on quiet but non-silent decay). Bump
  midpoint forward 50–80 ms: `(start + (dur - 0.05)/2)`.
- **Clips with leading silence** → cut landed too close to silence start.
  Midpoint above is already the smart choice. Still 100+ ms leading silence on
  every clip: `d` too long (catching silence on *inside* of an effect's
  leading decay). Shorten `d` to `0.10`.
- **`-c copy` on MP3 always rounds cuts to nearest frame** (~26 ms at 44.1
  kHz). Granularity floor — sub-26 ms precision impossible without
  re-encoding (what the fade step does).

## Output of this step

Directory of single-hit files at `~/json.mp4/public/audio/split/`:

```
split/
├── b9hBHt317mw_part01.mp3   2s
├── b9hBHt317mw_part02.mp3   1s
├── b9hBHt317mw_part03.mp3   2s
└── …
```

Each filename keeps source video ID as prefix — how later you (or a licensing
audit) trace every clip back to its origin video.

## Promoting to finalized assets

Pick cleanly-separated hits, copy to `public/audio/` with descriptive names —
*not* the `partNN` numbering — so manifest reads naturally:

```bash
cp ~/json.mp4/public/audio/split/b9hBHt317mw_part05.mp3 \
   ~/json.mp4/public/audio/whoosh-cinematic-01.mp3
cp ~/json.mp4/public/audio/split/b9hBHt317mw_part07.mp3 \
   ~/json.mp4/public/audio/whoosh-cinematic-02.mp3
```

Now `05-manifest-wiring.md` can write
`"path": "audio/whoosh-cinematic-01.mp3"` in a scene, and a human reading the
manifest knows exactly what sound fires on that transition.
