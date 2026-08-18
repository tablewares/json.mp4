# News clip as a silent scene (no narration, exact source duration)

Cuts a real news/source clip into a scene with zero narration, sized off
the clip's own probed length — not TTS. Use this when a b-roll sequence
needs to cut AWAY from narration into a real quoted/found-footage segment
(a news broadcast, an interview clip, a screen recording) and back.

Requires the silent-block narration feature (`src/timing/silence.js`,
`external/tts-provider.js`, `manifest.schema.json` `narration.entries[]`
`kind: "silence"` variant). If that isn't present in this checkout, fall
back to `config.defaultSceneDurationInFrames` and hand-trim the clip to
match — lose the exact-length guarantee.

---

## 0. Pre-flight

Read `scripts/curate/composition/rules.md` and
`scripts/curate/solutions/composition/b-roll-sequence.md` first — this doc
only covers the ONE scene that breaks from narrated b-roll. Everything else
(transitions, sequencing, hyper-specific asset rules) still applies.

## 1. Find the segment

If the source is a downloaded video with a `.vtt`/`.srt` transcript
(yt-dlp `--write-auto-sub` output, etc.), grep the transcript for your
keyword to find timestamps instead of scrubbing the video by hand:

```bash
grep -n -i "<keyword>" path/to/source.en.vtt
```

VTT cue blocks repeat lines across `align:start position:0%` chunks (word-by-word
karaoke captions) — read a wider window around the first hit to get real
sentence boundaries:

```bash
sed -n '1,120p' path/to/source.en.vtt
```

Pick a self-contained quote/beat. Keep it under whatever ceiling the brief
gives you (e.g. "< 10 seconds") — trim the sentence, not just the clock,
so the cut doesn't stop mid-word.

## 2. Cut the clip

```bash
mkdir -p public/assets
ffmpeg -y -hide_banner -loglevel error \
  -i path/to/source.mp4 \
  -ss <start_seconds> -t <duration_seconds> \
  -vf "scale=<comp_width>:<comp_height>" \
  -c:v libx264 -preset fast -crf 20 \
  -c:a aac -b:a 128k \
  public/assets/<descriptive_name>.mp4

ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 \
  public/assets/<descriptive_name>.mp4
```

`-vf scale=<comp_width>:<comp_height>` matches the project's `config.json`
composition size (e.g. `1080:1920` for a vertical short) so the asset is
already full-bleed without runtime letterboxing. Read the REAL duration
back from `ffprobe` — don't trust the `-t` you asked for; container/codec
rounding can shift it a few ms, and that exact number feeds step 4.

## 3. Scene + asset

Create the scene with a `narrationRef` pointing at a SILENCE entry (added
in step 4, not yet in the manifest) — the id just needs to match, order
doesn't matter yet:

```bash
node scripts/cli.js scene create s2_news '{"narrationRef":"sil_news"}'

node scripts/cli.js asset create s2_news vid_news_clip '{
  "assetType":"ImageReveal",
  "anchor":{"position":"center"},
  "contentOverride":{
    "src":"assets/<descriptive_name>.mp4",
    "useAsSceneDuration":true,
    "muted":false,
    "volume":1
  },
  "styleOverride":{"width":<comp_width>,"height":<comp_height>,"borderRadius":0,"revealDirection":"none"},
  "enterAt":0,"exitAt":1,"z":1
}'

node scripts/cli.js scene s2_news transitionOut '{"type":"default","durationInFrames":18}'
```

Three things this asset does differently from a normal b-roll shot:
- `contentOverride.useAsSceneDuration: true` — the scene's `durationInFrames`
  is overridden with THIS video's own ffprobe'd length (see
  `studio/assets/ImageReveal/manifest.json`'s `contentOverrideSchema`) instead
  of TTS narration timing. At most one asset per scene may set this.
- `contentOverride.muted: false, volume: 1` — `ImageReveal.jsx` defaults
  video assets to `muted: true` (the b-roll convention: silent footage under
  narration). This scene has NO narration, so the clip's own audio is the
  only thing carrying it — unmute it or the scene is dead silent.
  `contentOverrideSchema` has no `additionalProperties: false`, so `muted`/
  `volume` pass validate even though they're not in the schema's declared
  properties.
- `"src": "assets/<name>.mp4"` — relative to `public/`, no `public/` prefix
  (pitfall #9 in the manifest skill: `staticFile()` rejects absolute paths).

## 4. Wire the silence entry into narration

Add a silence entry to `manifest.json`'s `narration.entries[]`, positioned
by array order relative to the surrounding narrated entries — NOT by an
absolute timeline offset. Its `durationSeconds` is the exact ffprobe value
from step 2:

```jsonc
"narration": {
  "entries": [
    { "id": "n1", "text": "..." },
    { "id": "sil_news", "kind": "silence", "durationSeconds": 9.41 },
    { "id": "n3", "text": "..." }
  ],
  "fullTranscript": "... n1 text ... n3 text ..."  // silence contributes nothing to the transcript
}
```

`sil_news`'s id must match the `narrationRef` the scene was created with in
step 3. No TTS synthesis runs for it — the provider generates a matching
digital-silence clip and splices it into the single narration audio track
at the right position, so composition-wide timing (every OTHER scene's
`narrationRef` lookup) stays correct across the cut.

## 5. Resolve + render

```bash
node src/pipelines/pipeline2-resolve/resolve.js studio/manifest/<project>/manifest.json studio/resolved-<project>.json
node scripts/render-project.mjs studio/manifest/<project>/manifest.json out/<project>.mp4
```

Resolve is slow the first time a silence-bearing narration block runs
(WhisperX loads its model fresh per synthesis pass) — run it in the
background with a generous timeout rather than foregrounding it. Confirm
the scene's resolved `durationInFrames` matches the clip:

```bash
node -e "
const r = JSON.parse(require('fs').readFileSync('studio/resolved-<project>.json','utf8'));
for (const s of r.scenes) console.log(s.id, s.durationInFrames);
"
```

The news scene's frame count should be `round(clipDurationSeconds * fps) +
transitionOut.durationInFrames` (the transition pad only applies if it's
not the last scene).

## 6. Verify audio actually plays

```bash
ffmpeg -y -hide_banner -nostats -ss <news_scene_start_sec> -t <clip_dur> \
  -i out/<project>.mp4 -map a -c copy /tmp/w.mp4
ffmpeg -hide_banner -nostats -i /tmp/w.mp4 -af volumedetect -f null - 2>&1 \
  | grep -E "mean_volume|max_volume"
```

`-91 dB` mean/max = silent (the `muted: true` default slipped through, or
the clip has no audio track). Anything louder = the clip's dialogue is
actually carrying the scene.

## Pitfalls

1. **Forgetting `muted: false`.** `ImageReveal` defaults video to muted —
   correct for b-roll under narration, wrong here. Silent render at -91dB
   is the signature symptom; check this FIRST.
2. **`durationSeconds` drift from the actual clip.** Use the `ffprobe`
   number from step 2, not the `-t` you passed to ffmpeg. A few tens of ms
   off doesn't break anything (`useAsSceneDuration` re-probes at resolve
   time and the scene frame count is authoritative), but the silence
   entry's duration only matters for the COMPOSITION-WIDE audio track
   staying in sync — get it close or `sceneEndTimes` for the entries after
   it drift.
3. **VTT keyword grep hits mid-word karaoke fragments.** Auto-caption VTTs
   repeat each line 2-3 times with growing `<c>word</c>` spans as the
   caption builds. `grep -n` will return several line numbers per real
   utterance — read the surrounding block, don't trust the first match's
   line alone to be the full sentence.
4. **`useAsSceneDuration` needs `contentOverride.src` present.** Throws
   `has contentOverride.useAsSceneDuration: true but no contentOverride.src
   to probe` otherwise (`resolveScene.js`) — not usually an issue since the
   asset needs `src` anyway, but a copy-paste from a non-video asset spec
   can lose it.
5. **Silence positioning is array-order, not `enterAt`/timestamp.** The
   silence entry has no concept of "at 5.48s" — it just occupies the gap
   between whichever entries sit before/after it in `narration.entries[]`.
   Reordering entries changes what it's silent BETWEEN, not when in
   absolute time (that falls out of the entries before it).

## Worked case

`studio/manifest/yen-collapse/` — 3-scene b-roll: yen-banknotes b-roll
(narrated) → news broadcast clip on US currency intervention (silent
block, 9.41s, own audio unmuted) → trading-screen b-roll (narrated).
Source: `tmp/news.webm` + `tmp/news.en.vtt`, cut via `grep -n -i "yen"
tmp/news.en.vtt` to find the intervention quote, ffmpeg-cut to 9.41s,
scaled to 1080x1920. Total render: 21.55s, 1080x1920@30fps, mean volume
-26.2dB (not silent).
