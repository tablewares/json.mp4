# How to make B-roll sequence

B-roll sequence: stock footage + hyper-specific stills timed to narration. No captions/kinetic text. Steps used for `studio/manifest/qe-explained-broll/` and `out/qe-explained-broll.mp4`.

Follow order. Commands and decisions exact.

---

## 0. Pre-flight

Read `scripts/curate/composition/rules.md` and `scripts/curate/composition/composition-design-principles.md` first. B-roll rules:

- Sequence assets. No simultaneous `enterAt`.
- `scripts/pexels/index.js` for stock video/basic objects. `agent-cli.mjs collections` for people/specific objects.
- Video-to-video/image-to-video: no animation. `styleOverride.revealDirection: \"none\"`.
- Image-to-image: fade-up OK. `motion: { in: \"fadeUp\" }`.
- Multi-thing topics: use image panel. Vary `borderRadius`, `revealDirection`, `size`, `anchor` per scene.
- Stock footage: full-bleed 1920x1080, `anchor.position: center`, zero offset.

Constraint: no hand-editing `studio/manifest/**` for schema discovery. Use `scripts/agent-cli.mjs` discovery or pipeline schema files. Editing resolved JSON via `write_file` / `patch` OK.

## 1. Story -> scenes

Break transcript into scenes. One narration entry per scene.
- Single thing: one full-bleed shot (stock video or specific still).
- Multiple things: image panel, each image timed to narration beat.

Example breakdown (Quantitative Easing):

| scene | narration beat | kind | shot |
|-------|-----------------|------|------|
| s1 | \"Quantitative Easing.\" | title card | TextBlock (no kinetic text) full-frame |
| s2 | \"When the economy stalls...\" | single thing | Fed Building still (hyper-specific) |
| s3 | \"They create new digital money...\" | multi-panel | 3 money/Treasury images stacked right |
| s4 | \"This lowers interest rates...\" | single thing | financial-trading stock video, full-bleed |
| s5 | \"The goal? To spark investment...\" | single thing | construction-cranes stock video, full-bleed |
| s6 | \"But there is a catch... inflation.\" | single thing | grocery-prices stock video, full-bleed (red-tint bg) |

## 2. Acquire hyper-specific assets

\"Hyper-specific\": asset must literally depict named thing. Fed Reserve = actual Fed building photo, not generic bank. Anthropic = Anthropic logo, not generic AI chip.

Pexels API for stock video/basic objects. Use `scripts/pexels/fetch_broll.mjs` (videos) and `scripts/pexels/fetch_image.mjs` (photos). Downloads to `public/assets/`.

```bash
# stock b-roll videos
node scripts/pexels/fetch_broll.mjs \
  \"central bank building\" \
  \"financial trading market\" \
  \"city construction cranes\" \
  \"inflation grocery prices\" \
  \"economy money graph\"

# hyper-specific stills
node scripts/pexels/fetch_image.mjs \
  \"Federal Reserve building Eccles\" \
  \"US Treasury bond certificate\" \
  \"United States Federal Reserve seal\"
```

Verify `alt` text in Pexels result. `id=6534073 alt=\"From below of Federal Reserve...\"` is correct; \"bank building\" is not.
Do NOT reuse `public/assets/` assets based on filename. Download fresh if `alt` text unverified.

## 3. Manifest + narration

Rebuild manifest with narration entries and `fullTranscript`. One `narration.entries[i].id` per scene, linked via `narrationRef`.

```jsonc
{
  \"projectId\": \"qe-explained-broll\",
  \"config\": \"config.json\",
  \"styles\": \"styles/theme.json\",
  \"scenes\": [
    { \"id\": \"s1_intro\",    \"path\": \"scenes/s1_intro.json\" },
    { \"id\": \"s2_central\",  \"path\": \"scenes/s2_central.json\" },
    // ...
  ],
  \"narration\": {
    \"entries\": [
      { \"id\": \"n1\", \"text\": \"Quantitative Easing.\" },
      { \"id\": \"n2\", \"text\": \"When the economy stalls...\" },
      // ...
    ],
    \"fullTranscript\": \"Quantitative Easing. When the economy stalls...\"
  },
  \"audioOverlay\": []
}
```

`narrationRef` MUST match an entry ID for resolver timing.

## 4. TTS server + narration alignment

Timing from WhisperX aligned TTS. Provider: `external/tts-provider.js` -> `pocket_tts/kyutai_tts.js` on `127.0.0.1:8000`.

```bash
# check server
ss -tlnp | grep :8000
```

Cache key is sha256 of full transcript. One word edit re-synthesizes all. Get transcript right, resolve once to warm cache.
Fallback: if server down, drop `narration` block. Use `config.defaultSceneDurationInFrames` (~5s). Lose `relativeToWord` timing but renderable.

## 5. Standalone `relativeToWord` timing

Key pattern for caption-free b-roll. `enterAt` anchors asset enter frame to spoken word/phrase in scene narration. No `KineticText` needed.

Single word:
```jsonc
\"enterAt\": { \"relativeToWord\": \"central\", \"offsetFrames\": -2 }
```

Phrase (fires at first word):
```jsonc
\"enterAt\": { \"relativeToWord\": [\"too\", \"much\", \"money\"], \"offsetFrames\": -2 }
```

`offsetFrames: -2` fires 2 frames before word start. Prevents audio lag. `-2` works for full-bleed video.

Gotchas:
- No `relativeToAsset + relativeToWord`. Requires `KineticText` captions. Wrong for b-roll.
- `relativeToWord` matches EXACT WhisperX token, including punctuation. `bonds,` not `bonds`.
- Array form is PHRASE, not fallback. All elements must exist. Missing element throws.

Read timing source:
Cache at `public/audio/tts_<sha>.json`. Use script to print word timings:
```bash
node -e '
  import fs from \"fs\";
  const t = JSON.parse(fs.readFileSync(\"public/audio/tts_<sha>.json\",\"utf8\"));
  for (const seg of t.segments) for (const w of seg.words)
    console.log(w.start.toFixed(3) + \"s \" + w.word);
'
```

## 6. Per-scene asset placement

### Full-bleed stock video
```jsonc
{
  \"id\": \"vid_growth\",
  \"assetType\": \"ImageReveal\",
  \"anchor\": { \"position\": \"center\" },
  \"contentOverride\": { \"src\": \"assets/broll_city_construction_cranes_5917216.mp4\" },
  \"styleOverride\": {
    \"width\": 1920, \"height\": 1080,
    \"borderRadius\": 0,
    \"revealDirection\": \"none\"      // direct cut
  },
  \"enterAt\": { \"relativeToWord\": \"investment\", \"offsetFrames\": -2 },
  \"exitAt\": 1,
  \"z\": 1
}
```
`revealDirection: \"none\"` = no animation, direct cut.

### Hyper-specific still image
```jsonc
{
  \"id\": \"img_frb\",
  \"assetType\": \"ImageReveal\",
  \"anchor\": { \"position\": \"center\" },
  \"contentOverride\": {
    \"src\": \"assets/img_Federal_Reserve_building_Eccles_6534073.jpg\",
    \"alt\": \"Federal Reserve building exterior against USA flags\"
  },
  \"styleOverride\": {
    \"width\": 1600, \"height\": 900,
    \"borderRadius\": 16,
    \"revealDirection\": \"top-to-bottom\"
  },
  \"enterAt\": { \"relativeToWord\": \"central\", \"offsetFrames\": -2 },
  \"exitAt\": 1,
  \"z\": 5,
  \"motion\": { \"in\": \"fadeUp\" }      // fade-up OK for image-to-image
}
```

### Multi-thing panel
Multiple `ImageReveal` assets in shared band, timed sequentially.
- Vary style per scene: `borderRadius`, `revealDirection`, size.
- Gap boxes to avoid overlap. Use Python rect model in `software-development/json-to-mp4-overlap-warnings` to verify.
- Sequence `enterAt` anchors to match narration.

## 7. Title card without KineticText

Use centered `TextBlock`, `motion: { in: \"fadeUp\" }`. No `narrationRef` anchor. `enterAt: 0`.

```jsonc
{
  \"id\": \"title_qe\",
  \"assetType\": \"TextBlock\",
  \"anchor\": { \"position\": \"center\" },
  \"contentOverride\": { \"text\": \"Quantitative Easing\" },
  \"styleOverride\": {
    \"typography\": \"heading1\",
    \"width\": 1400, \"height\": 180,
    \"align\": \"center\",
    \"backgroundColorToken\": \"transparent\"
  },
  \"enterAt\": 0, \"exitAt\": 1, \"z\": 10,
  \"motion\": { \"in\": \"fadeUp\" }
}
```

## 8. Transitions

Use deliberate cuts, not soft fades.
- `WhipPan` (14fr): title to first b-roll shot.
- `default` (18fr): general use, image-to-image panels.
- `slideContinuity` (24fr): only for asset continuity across scenes. Rare for b-roll.
- Avoid `shatterWipe` unless editorial smash intended.
- No `transitionOut` on last scene.

## 9. Validate -> resolve -> render

```bash
cd /home/tablewares/json.mp4

# 1. validate
node src/pipelines/pipeline1-validate/validate.js studio/manifest/qe-explained-broll/manifest.json
# 2. resolve
node src/pipelines/pipeline2-resolve/resolve.js studio/manifest/qe-explained-broll/manifest.json
# 3. render
node src/pipelines/pipeline3-render/render.js out/qe-explained-broll.mp4
```

Or use orchestrator:
```bash
node scripts/render-project.mjs studio/manifest/qe-explained-broll/manifest.json out/qe-explained-broll.mp4
```

`npm run build` uses default manifest. Pass manifest path for specific project.

Verification:
```bash
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 out/qe-explained-broll.mp4
```
Expect: `h264`, `1920x1080`, `30fps`, duration matching narration.

Disk-headroom:
Remotion writes frames to `/tmp`. If `/tmp` fills (ENOSPC), clear it:
```bash
rm -rf /tmp/remotion-* /tmp/.org.chromium.* /tmp/.com.google.* /tmp/tmp*
```

## 10. Pitfalls

1. `relativeToWord` array = PHRASE, not fallback. Match exact WhisperX token.
2. `relativeToAsset + relativeToWord` requires `KineticText`. Wrong for b-roll.
3. Punctuation matters in `relativeToWord`. Copy from error message list.
4. `revealDirection` enum: `[left-to-right, top-to-bottom, center-out, none]`. No `right-to-left`.
5. TextBlock `contentOverride` only accepts `text`. Style keys go in `styleOverride`.
6. `motion` schema: `additionalProperties: false`. Use `{ \"in\": \"fadeUp\" }`.
7. `offsetPercent` is scene-end-relative. Prefer `relativeToWord`.
8. `transitionOut.carryAssetId` must exist in both scenes. Use `WhipPan` or `default` for b-roll.
9. `sceneDurationInFrames` = narration + transition pad. `relativeToWord` sidesteps this.
10. Verify Pexels `alt` text. Read alt, not just filename.

## Reference: qe-explained-broll scene map

| scene | narrationRef | shot kind | asset ids | enterAt anchor | revealDir | motion | transitionOut |
|-------|--------------|-----------|-----------|----------------|-----------|--------|---------------|
| s1_intro | n1 | title TextBlock | title_qe | `enterAt: 0` | n/a | fadeUp | WhipPan(14) |
| s2_central | n2 | still image | img_frb | \"central\" / -2 | top-to-bottom | fadeUp | default(18) |
| s3_process | n3 | 3-image panel | img_money / img_bonds / img_liquidity | \"money\" / \"bonds,\" / \"flooding\" / -2 | var | fadeUp x3 | default(18) |
| s4_liquidity | n4 | full-bleed video | vid_lend | \"lowers\" / -2 | none | n/a | default(18) |
| s5_goal | n5 | full-bleed video | vid_growth | \"investment\" / -2 | none | n/a | default(18) |
| s6_risk | n6 | full-bleed video | vid_inflation | \"catch.\" / -2 | none | n/a | (none) |

Total: 6 scenes, 10 assets, 0 KineticText, 4 `relativeToWord` anchors. Render ~25MB, 18.624s, 1920x1080@30fps.
