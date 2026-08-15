# How to make a B-roll sequence

A B-roll sequence is a video composed entirely of b-roll shots (stock
footage + hyper-specific still images), timed to a narration track, with
no on-screen captions / kinetic text. This is the sequence of steps that
produced `studio/manifest/qe-explained-broll/` and `out/qe-explained-broll.mp4`.

Follow in order. Each step names the exact commands and the key decisions.

---

## 0. Pre-flight

Read `scripts/curate/composition/rules.md` and
`scripts/curate/composition/composition-design-principles.md` before
placing a single asset. The rules that matter most for b-roll:

- Time assets one after another — never enterAt on all assets at the same time.
- `scripts/pexels/index.js` (or its programmatic form) is for stock b-roll
  videos AND basic objects only. Use `agent-cli.mjs collections` for
  images of people and more specific objects.
- Video-to-video or image-to-video cuts: no animation. Set
  `styleOverride.revealDirection: "none"` on the video asset.
- Image-to-image cuts: fade-up is allowed — `motion: { in: "fadeUp" }`.
- If the topic involves multiple things, identify them and build a panel
  with multiple images. Never use the same default image panel style
  across multiple scenes (vary borderRadius / revealDirection / size /
  anchor so each panel layout reads differently).
- If using stock footage, fill the scene with the video (full-bleed
  1920x1080, `anchor.position: center`, zero offset).

Authoring constraint: never hand-edit `studio/manifest/**` scene files to
discover schemas — go through `scripts/agent-cli.mjs` discovery commands
or the pipeline schema files. Editing the resolved JSON the agent writes
through `write_file` / `patch` is fine (those ARE the authored files).

## 1. Story → scenes

Break the narration transcript into scenes. One narration entry per
scene. Decide per scene:

- Single thing → one full-bleed shot (stock footage fills the scene, or
  one hyper-specific still image).
- Multiple things → a panel of multiple images, each timed to its own
  narration beat.

For "Quantitative Easing" the breakdown was:

| scene | narration beat                                          | kind           | shot                                                      |
|-------|---------------------------------------------------------|----------------|-----------------------------------------------------------|
| s1    | "Quantitative Easing."                                  | title card     | TextBlock (no kinetic text) full-frame                    |
| s2    | "When the economy stalls, central banks step in."       | single thing   | Federal Reserve Building still (hyper-specific)           |
| s3    | "They create new digital money to buy government bonds, flooding the financial system with liquidity." | multi-thing panel | 3 specific money/Treasury images stacked on right |
| s4    | "This lowers interest rates and encourages banks to lend." | single thing   | financial-trading stock video, full-bleed                |
| s5    | "The goal? To spark investment and jumpstart growth."  | single thing   | construction-cranes stock video, full-bleed               |
| s6    | "But there is a catch. Too much money chasing too few goods can lead to one thing: inflation." | single thing | grocery-prices stock video, full-bleed (red-tint bg) |

## 2. Acquire hyper-specific assets

"Hyper-specific" means the asset must literally depict the thing the
narration names. Federal Reserve → an actual Federal Reserve building
photo (with USA flags), not a generic bank vault. Anthropic → the
Anthropic logo, not a generic AI chip.

For stock b-roll video AND basic objects, use the Pexels API. The repo
ships an interactive CLI (`scripts/pexels/index.js`) but for an agent
batch-download, call the API programmatically. The script
`scripts/pexels/fetch_broll.mjs` (videos) and `scripts/pexels/fetch_image.mjs`
(photos) are working examples — both search Pexels and download to
`public/assets/`.

```bash
# stock b-roll videos
node scripts/pexels/fetch_broll.mjs \
  "central bank building" \
  "financial trading market" \
  "city construction cranes" \
  "inflation grocery prices" \
  "economy money graph"

# hyper-specific stills
node scripts/pexels/fetch_image.mjs \
  "Federal Reserve building Eccles" \
  "US Treasury bond certificate" \
  "United States Federal Reserve seal"
```

Verify the downloaded file's `alt` text in the Pexels result BEFORE you
trust it — `id=6534073 alt="From below of Federal Reserve building
exterior against USA flags..."` is actually the Federal Reserve; a
generic "bank building" search result is not.

Do NOT use assets already in `public/assets/` just because the filename
sounds relevant. If you can't verify what a prior asset depicts, download
a fresh one whose alt text you can read.

## 3. Manifest + narration

Rebuild the manifest with narration entries and a `fullTranscript`. One
`narration.entries[i].id` per scene, referenced from each scene's
`narrationRef`.

```jsonc
{
  "projectId": "qe-explained-broll",
  "config": "config.json",
  "styles": "styles/theme.json",
  "scenes": [
    { "id": "s1_intro",    "path": "scenes/s1_intro.json" },
    { "id": "s2_central",  "path": "scenes/s2_central.json" },
    // ...
  ],
  "narration": {
    "entries": [
      { "id": "n1", "text": "Quantitative Easing." },
      { "id": "n2", "text": "When the economy stalls, central banks step in." },
      // ...
    ],
    "fullTranscript": "Quantitative Easing. When the economy stalls, ..."
  },
  "audioOverlay": []
}
```

Each scene's `narrationRef: "n<N>"` MUST point at one of those entries —
the resolver keys word timing off that ref.

## 4. TTS server + narration alignment

Narration timing comes from real TTS audio aligned by WhisperX. The
provider is `external/tts-provider.js` → `pocket_tts/kyutai_tts.js`, which
talks to a local Kyutai/pocket-tts server on `127.0.0.1:8000`.

```bash
# confirm the server is up before you spend 5 minutes on a cold synth
ss -tlnp | grep :8000   # expect pocket-tts, pid ...
```

Resolve caches per-transcript: the first run synthesizes + aligns
(minutes), subsequent runs hit the cache (sub-second). The cache key is
the sha256 of the full transcript, so a single-word edit to an entry
re-synthesizes everything. Don't churn the transcript — get it right,
then resolve once to warm the cache.

If the server is down and you don't need word-accurate timing, drop the
`narration` block from the manifest and fall back to
`config.defaultSceneDurationInFrames` (~5s per scene). You lose
`relativeToWord` timing but still get a renderable b-roll sequence.

## 5. Standalone `relativeToWord` timing (the key pattern)

This is the working pattern for a caption-free b-roll sequence.

`enterAt` accepts a timing-anchor object that anchors an asset's enter
frame to a specific spoken word (or phrase) in the scene's own narration
— WITHOUT requiring any other asset to display that text. No
`KineticText` needed.

Single word:
```jsonc
"enterAt": { "relativeToWord": "central", "offsetFrames": -2 }
```

Phrase (all words matched, fires at the first word's start):
```jsonc
"enterAt": { "relativeToWord": ["too", "much", "money"], "offsetFrames": -2 }
```

`offsetFrames: -2` means "fire 2 frames before the word's real start
frame" — gives the footage / image a beat of presence so the viewer
registers it just as the word lands, instead of lagging 1–2 frames late
behind the audio. Tune per taste; `-2` works for full-bleed video
shots.

### Whispers of the gotcha that bit me first

You CAN also write `enterAt` with `relativeToAsset + relativeToWord`,
but that form requires the referenced asset to be a `KineticText` whose
`contentOverride.text` EXACTLY matches its scene's narration text
(word-for-word, including word count). That path is wrong for b-roll: it
puts a visible kinetic-text caption on screen, which is the opposite of
b-roll. Use the standalone form above.

The OTHER gotcha: `relativeToWord` matches the EXACT token WhisperX
produced, punctuation included. WhisperX stores `bonds,` not `bonds`,
`catch.` not `catch`. The error message lists every available word:

```
Error: Timing anchor references relativeToWord "bonds" but it wasn't found
in scene "s3_process"'s narration.
Available: They, create, new, digital, money, to, buy, government, bonds,, ...
```

If you wrote `"bonds"` you'll see `bonds,` in that list — fix the spelling
in your manifest to match exactly. Don't use the array form
`["bonds,", "bonds"]` as a "find either" fallback — the array form is a
PHRASE: every element must exist, and the anchor fires at the first
word's start frame. A missing array element throws.

### Reading the per-word timing source

After your first successful resolve, the cache json lives at
`public/audio/tts_<sha>.json` (the sha = the resolved.json
`audioOverlay[0].path`'s filename). It has `segments[i].words[j]` with
`word`, `start`, `end` (seconds, global audio timeline). To print it:

```bash
node -e '
  import fs from "fs";
  const t = JSON.parse(fs.readFileSync("public/audio/tts_<sha>.json","utf8"));
  for (const seg of t.segments) for (const w of seg.words)
    console.log(w.start.toFixed(3) + "s " + w.word);
'
```

Use that list to choose your `relativeToWord` tokens and to verify the
exact punctuation WhisperX attached.

## 6. Per-scene asset placement

### Full-bleed stock video (single-thing scenes with stock footage)

```jsonc
{
  "id": "vid_growth",
  "assetType": "ImageReveal",
  "anchor": { "position": "center" },
  "contentOverride": { "src": "assets/broll_city_construction_cranes_5917216.mp4" },
  "styleOverride": {
    "width": 1920, "height": 1080,
    "borderRadius": 0,
    "revealDirection": "none"      // <-- the no-animation direct cut
  },
  "enterAt": { "relativeToWord": "investment", "offsetFrames": -2 },
  "exitAt": 1,
  "z": 1
}
```

`ImageReveal.jsx` recognizes `revealDirection: "none"` (line 8 +
isNoAnimation check at line 41-45): no clip-path wipe, no spring scale,
clip-path "none", and it returns `null` (hidden) before `enterAtFrame` —
then snaps to visible. That's the direct cut the b-roll rules ask for.

### Hyper-specific still image (single-thing scenes with an image)

```jsonc
{
  "id": "img_frb",
  "assetType": "ImageReveal",
  "anchor": { "position": "center" },
  "contentOverride": {
    "src": "assets/img_Federal_Reserve_building_Eccles_6534073.jpg",
    "alt": "Federal Reserve building exterior against USA flags"
  },
  "styleOverride": {
    "width": 1600, "height": 900,
    "borderRadius": 16,
    "revealDirection": "top-to-bottom"
  },
  "enterAt": { "relativeToWord": "central", "offsetFrames": -2 },
  "exitAt": 1,
  "z": 5,
  "motion": { "in": "fadeUp" }      // image-to-image: fade-up is allowed
}
```

### Multi-thing panel (varied styles across scenes)

A panel is multiple `ImageReveal` assets sharing a vertical or horizontal
band, each timed to its own narration beat. Critical rules:

- Vary the panel style scene-to-scene. Don't reuse the same
  `borderRadius` + `revealDirection` + size combo across multiple panel
  scenes. S3 used 3 stacked 540×280 boxes with three distinct
  reveals (top-to-bottom / center-out / left-to-right) and three
  distinct `borderRadius` (24 / 8 / 0).
- Stack boxes with a real gap so they don't overlap. For three 540×280
  boxes on `position: right`, tuned `offsetYPercent` to -28.15 / 0 /
  +28.15 gives tops at y=96 / 400 / 704 — 24px gaps between each
  280-tall box, all inside the 1080 frame.
- The `overlap_warn.js` plugin warns when bounding rects intersect while
  assets co-exist in time. Layout your panel BEFORE authoring — verify
  with the Python rect model in
  `software-development/json-to-mp4-overlap-warnings`:

  ```python
  ANCHOR = {"center":(0.5,0.5),"left":(0,0.5),"right":(1,0.5), ...}
  def resolve(anchor, size, C=(1920,1080)):
      ax,ay = ANCHOR[anchor["position"]]
      X = ax*C[0] + anchor.get("offsetXPercent",0)/100*C[0]
      Y = ay*C[1] + anchor.get("offsetYPercent",0)/100*C[1]
      return (X - ax*size[0], Y - ay*size[1], size[0], size[1])
  ```

- Time panel images one after another — each `enterAt` keyed to a later
  narration word, so they reveal sequentially as the narration names
  each thing.

## 7. Title card without KineticText

The opening title scene can't be "b-roll" — there's nothing to roll yet.
Use a centered `TextBlock` with `motion: { in: "fadeUp" }`. One asset,
one scene, no narrationRef-timed anchor (just `enterAt: 0`).

```jsonc
{
  "id": "title_qe",
  "assetType": "TextBlock",
  "anchor": { "position": "center" },
  "contentOverride": { "text": "Quantitative Easing" },
  "styleOverride": {
    "typography": "heading1",
    "width": 1400, "height": 180,
    "align": "center",
    "backgroundColorToken": "transparent"
  },
  "enterAt": 0, "exitAt": 1, "z": 10,
  "motion": { "in": "fadeUp" }
}
```

## 8. Transitions

B-roll bounces hard between very different shots — pick transitions that
read as deliberate cuts, not soft fades.

- `WhipPan` (14fr) — opening title into the first b-roll shot ("camera
  arrives"). Good for the s1 → s2 handoff.
- `default` (18fr) — the catch-all fade+slide; fine for
  similar-weight handoffs (image-to-image within a panel scene boundary).
- `slideContinuity` (24fr) ONLY when a single named asset carries visual
  continuity between scenes — rarely correct for pure b-roll.
- Avoid `shatterWipe` for b-roll unless you want a hard editorial smash.

Last scene has no `transitionOut` at all — the video ends.

## 9. Validate → resolve → render

```bash
cd /home/tablewares/json.mp4

# 1. validate (Ajv schemas) — seconds
node src/pipelines/pipeline1-validate/validate.js \
  studio/manifest/qe-explained-broll/manifest.json

# 2. resolve (anchor→pixels, tokens→values, TTS→frames) — cold: minutes, cache: sub-second
node src/pipelines/pipeline2-resolve/resolve.js \
  studio/manifest/qe-explained-broll/manifest.json

# 3. render (Remotion bundles + chromium) — minutes
node src/pipelines/pipeline3-render/render.js out/qe-explained-broll.mp4
```

Orchestrator wrapper (all four stages, fresh-graph guaranteed):
```bash
node scripts/render-project.mjs \
  studio/manifest/qe-explained-broll/manifest.json \
  out/qe-explained-broll.mp4
```

`npm run build` = `node scripts/render-project.mjs` with the default
manifest arg (`studio/manifest/example-project/manifest.toon`). For a
non-default project, pass the manifest path explicitly as the first
positional — that's what the line above does.

### Verification

```bash
ffprobe -v error \
  -show_entries format=duration,size \
  -show_entries stream=codec_name,width,height,r_frame_rate \
  -of default=noprint_wrappers=1 \
  out/qe-explained-broll.mp4
```

Expect `codec_name=h264`, `width=1920`, `height=1080`,
`r_frame_rate=30/1`, duration roughly equal to total narration seconds
(plus final-tail). For `qe-explained-broll` that's 18.624s for an
18.56s narration.

### Disk-headroom trap

Remotion's headless-Chromium compositor writes intermediate frames to
`/tmp` (tmpfs on this box is 3.9G). After several renders in one
session `/tmp` can hit 79%+ used and the next render fails with
`ENOSPC: no space left on device, write` mid-render — even though
the project disk has 800G+ free. Clear before retrying:

```bash
rm -rf /tmp/remotion-* /tmp/.org.chromium.* /tmp/.com.google.* /tmp/tmp*
df -h /tmp
```

## 10. Pitfalls hit during this build (for the next agent)

1. **`relativeToWord` array form is a PHRASE, not a fallback list.** Every
   element must exist in the scene's narration words; the anchor fires at
   the FIRST word's start frame. Don't use it as `["bonds,", "bonds"]`
   to hedge punctuation — pick the exact WhisperX token.
2. **`relativeToAsset + relativeToWord` requires `KineticText`.** Don't
   use it for b-roll (no kinetic text allowed). The standalone
   `relativeToWord` (no `relativeToAsset`) reads scene-level narration
   word timing directly and is the right pattern.
3. **Punctuation in `relativeToWord` matching.** WhisperX keeps commas
   and periods attached: `bonds,`, `catch.`, `growth.`. The error
   message lists all available words — read it, copy the exact token.
4. **`revealDirection` enum is `[left-to-right, top-to-bottom,
   center-out, none]`.** No `right-to-left`. `none` is the no-animation
   direct cut the b-roll rules want for video-to-video / image-to-video
   handoffs.
5. **TextBlock `contentOverride` only accepts `text`.** `typography` /
   `align` / `backgroundColorToken` are `styleOverride` fields, not
   content. Validate throws "must NOT have additional properties" if
   you put style keys in `contentOverride`.
6. **`motion` schema is `additionalProperties: false`.** Hand-author
   `{ "in": "fadeUp" }` directly — don't put `{ "$alias": "motion.fadeIn",
   "direction": "up" }` in `motion` because the schema rejects extra
   props (aliases expand only in pipeline2, AFTER validate runs).
7. **`offsetPercent` is scene-end-relative, not raw-frame-relative.**
   `offsetPercent: 0` is the scene's LAST frame, `-100` is scene START.
   Don't use it as a raw frame offset. Prefer standalone `relativeToWord`
   for narration-timed reveals.
8. **`transitionOut.carryAssetId` must exist in BOTH adjacent scenes.**
   `pivotZoom` with `carryAssetId: "title_qe"` from s1 into s2 fails
   because `title_qe` doesn't exist in s2. Use `WhipPan` or `default` for
   b-roll handoffs.
9. **`sceneDurationInFrames = narration duration + transitionOut pad.**
   When computing `offsetPercent` by hand remember the on-screen duration
   you author against is the FULL duration including the transition pad,
   not just the narration window. (Another reason to prefer
   `relativeToWord` — it sidesteps this calculation entirely.)
10. **Verify the chosen image's Pexels `alt` text.** `img_Federal_Reserve_building_Eccles_6534073.jpg`
    downloaded with alt `"From below of Federal Reserve building exterior
    against USA flags and staircase..."` — that's literally a Federal
    Reserve building. A search hit titled just "bank building" is not.
    The "hyper-specific" rule demands you read the alt, not just the
    filename.

## Reference: the qe-explained-broll scene map

| scene      | narrationRef | shot kind        | asset ids                              | enterAt anchor (relativeToWord)         | revealDir        | motion     | transitionOut |
|------------|--------------|------------------|----------------------------------------|-----------------------------------------|------------------|------------|---------------|
| s1_intro   | n1           | title TextBlock  | title_qe                               | `enterAt: 0`                            | n/a (text)       | fadeUp     | WhipPan(14)   |
| s2_central | n2           | still image      | img_frb                                | "central" / -2                          | top-to-bottom    | fadeUp     | default(18)   |
| s3_process | n3           | 3-image panel    | img_money / img_bonds / img_liquidity  | "money" / "bonds," / "flooding" (each -2)| top-to-bottom / center-out / left-to-right | fadeUp ×3 | default(18) |
| s4_liquidity | n4         | full-bleed video | vid_lend                               | "lowers" / -2                           | none (direct cut)| n/a        | default(18)   |
| s5_goal    | n5           | full-bleed video | vid_growth                             | "investment" / -2                       | none             | n/a        | default(18)   |
| s6_risk    | n6           | full-bleed video | vid_inflation                          | "catch." / -2                           | none             | n/a        | (none, last)  |

Total: 6 scenes, 10 assets, 0 KineticText, 4 standalone
`relativeToWord` anchors. Render ~25MB, 18.624s, 1920x1080@30fps.
