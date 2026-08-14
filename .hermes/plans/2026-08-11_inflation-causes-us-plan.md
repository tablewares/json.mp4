# Inflation & its causes (US) — render plan

> Instance of `scripts/curate/plan.md`. B-roll-led: most scenes are an image
> + motion+broll feel with short KineticText callouts riding narration; one
> data scene (`BarChartRace`) breaks the rhythm. Six scenes, ~50–60s total.

## 1. Project identity

- **projectId**: `inflation-causes-us`
- **One-line intent**: Explain what inflation is, how it's measured (CPI), and the three main US causes — demand-pull, cost-push, built-in wage spiral.
- **Total expected duration**: ~55s (rough — narration-driven final)
- **Target aspect / resolution**: 1920×1080 (16:9)
- **Narration?**: yes
- **B-roll emphasis** — most scenes carry one `ImageReveal` hero image with `motion` + camera parallax; KineticText callouts ride narration to avoid slideshows.

## 2. Design surface

External context: choose a serious documentary palette (Vox/Johnny Harris-adjacent), warm accent on a near-black canvas. Easing presets = framework defaults.

- **Palette**:
  - `shade1` (canvas dark): `#0B0E14`
  - `shade2` (panel dark): `#161B26`
  - `main1` (primary text): `#F5F7FA`
  - `main2` (secondary text): `#8B93A7`
  - `accentBg` (accent — warm, "rising prices" red): `#FF6B4A`
  - `accentCool` (data positive — green for "real value"): `#3DD68C`
- **Typography**:
  - `title`: Inter, sans-serif / 72 / 700 / 1.1 / main1
  - `body`: Inter, sans-serif / 36 / 400 / 1.4 / main2
  - `kicker`: Inter, sans-serif / 28 / 600 / 1.2 / accentBg
- **Easing presets**: framework defaults (`gentleSpring`{damping:16,mass:0.7,stiffness:110}, `snappy`{damping:26,mass:0.4,stiffness:220})
- **Composition rules**: rule-of-thirds power-points for hero subjects; centered for the single stat-card scene. Consult `docs/composition/composition-design-principles.md` §1 for offset-percents.

## 3. Audio sources — resolve via collections first

### 3a. Background music
| id | mood | source | collection | dest path | volume | loop | fades |
|----|------|--------|------------|-----------|--------|------|-------|
| bgm-1 | low-tension ambient bed | "dark ambient instrumental" YouTube search → yt-dlp | `youtubeSearch` → `ytDlpDownload` | `audio/bgm_inflation.mp3` | 0.18 | true | 2s in / 2.5s out |

### 3b. SFX / one-shots
| id | beat | source | collection | dest path | volume |
|----|------|--------|------------|-----------|--------|
| whoosh | every scene-cut | `sfxSplit` from a pack (search "transition whoosh pack") | `youtubeSearch` → `ytDlpDownload` → `sfxSplit` | `audio/sfx_whoosh.mp3` | 0.5 |
| tick | chart-bar rise (scene 5) | same pack, "tick" clip | `sfxSplit` | `audio/sfx_tick.mp3` | 0.4 |

### 3c. Manifest wiring — run after files land:
```bash
node scripts/agent-cli.mjs collection manifestWiring
```

## 4. Image sources — resolve via collections first

All via `imageSearch` (Yandex) + `curl -fsSL <url> | file -` connection test before wiring.

| asset id | subject | source (search term) | dest path under `public/assets/` |
|----------|---------|----------------------|----------------------------------|
| `infl-cpi-print` | CPI report / inflation headline print | "CPI inflation report newspaper headline" | `assets/cpi_headline.jpg` |
| `infl-demand` | crowded store / shopper surge (demand-pull) | "crowded grocery store shoppers" | `assets/demand_pull.jpg` |
| `infl-oil` | oil refinery / gas pump 1970s (cost-push) | "1970s oil crisis gas pump" | `assets/cost_push_oil.jpg` |
| `infl-wage` | labor union picket / wages sign (built-in spiral) | "union wage strike picket sign" | `assets/wage_spiral.jpg` |
| `infl-fed` | Federal Reserve building / Powell | "Federal Reserve building" | `assets/fed_building.jpg` |

Every row must pass the Yandex connection-test rule (`avoid.md`) before going
into a scene's `contentOverride.src`.

## 5. Narration

- **fullTranscript** (in order): "Inflation is when your money buys less, because prices across the economy are rising. The US tracks this with the Consumer Price Index — a basket of goods the average household actually buys. When demand outpaces supply, buyers bid prices up. That's demand-pull inflation. When a key input gets scarce — oil, labor, chips — producers pass the cost along. That's cost-push. And once everyone expects prices to rise, workers demand higher wages, which raises prices again. That's the built-in spiral. The Federal Reserve fights all three by raising interest rates, cooling demand, and breaking the cycle."
- **entries**:

| entry id | text |
|----------|------|
| n1 | Inflation is when your money buys less, because prices across the economy are rising. |
| n2 | The US tracks this with the Consumer Price Index — a basket of goods the average household actually buys. |
| n3 | When demand outpaces supply, buyers bid prices up. That's demand-pull inflation. |
| n4 | When a key input gets scarce — oil, labor, chips — producers pass the cost along. That's cost-push. |
| n5 | And once everyone expects prices to rise, workers demand higher wages, which raises prices again. That's the built-in spiral. |
| n6 | The Federal Reserve fights all three by raising interest rates, cooling demand, and breaking the cycle. |

- **TTS provider**: `http`
- **ttsHumanize**: default (on) — narration is the timing source of truth, so humanize before WhisperX alignment

## 6. Scene breakdown

| # | sceneId | narrationRef | intent | carried asset(s) | transitionOut | background |
|---|---------|--------------|--------|-------------------|---------------|------------|
| 1 | intro       | n1 | title + CPI headline b-roll | (intro establishes, not carried) | `{type:"slideContinuity", params:{carryAssetId:"hero-cpi"}}` → scene 2 carries the CPI image | shade1 (flat) |
| 2 | what-cpi    | n2 | CPI basket concept | `hero-cpi` (same asset appears here as the carried element from scene 1's transitionOut — must keep same id) | `{type:"slideContinuity", params:{carryAssetId:"hero-cpi"}}` → scene 3 carries forward | `{color:"shade1", texture:"paper", blendMode:"multiply", opacity:0.3}` |
| 3 | demand-pull | n3 | crowded-store b-roll | `hero-cpi` → scene 3 will *not* contain `hero-cpi`; instead the carry needs a new directed-flow. Simpler: switch to `pivotZoom` with `carryAssetId:"hero-store"` and scene 4 will also have `hero-store`? — NO. Each B-roll scene uses `default` transition. See note below. | shade1 |
| 4 | cost-push   | n4 | oil-crisis b-roll | (default transition — B-roll montage beat) | `{type:"default"}` | shade1 |
| 5 | wage-spiral | n5 | labor-strike b-roll + BarChartRace stat inset | (default transition) | `{type:"default"}` | shade2 (panel lift for stat scene) |
| 6 | fed         | n6 | Federal Reserve b-roll + closing title | (none — last scene) | `null` | shade1 |

**Carry rule clarification** (from `style-transition.md`): `slideContinuity`
only reads as continuous if the `carryAssetId` exists in *both* the outgoing
and incoming scene with the *same id*. B-roll montages don't share a hero
element scene-to-scene, so scenes 3–6 use the `default` transition (fade +
slight slide). Only scenes 1→2 carry (the CPI print is the visual spine of
that pair).

## 7. Per-scene asset list

### Scene 1: intro (~8s — n1 window)

Title is centered; CPI image reveals on the right power-point as the kicker
lands. Camera drifts in subtly (slow push).

| asset id | assetType | anchor | enterAt/exitAt | contentOverride | styleOverride | motion | z |
|----------|-----------|--------|----------------|-----------------|----------------|--------|---|
| `title-text` | TextBlock | center, offsetXPercent:-16, offsetYPercent:-16 | 0 / 1 | `{text:"What is inflation?"}` | `{typography:"title"}` | `{in:"fadeUp", rotate:{toDeg:0, durationInFrames:24}}` (static, no rotate) — use `{in:"fadeUp"}` only | 1 |
| `kicker-1` | TextBlock | top-left, offsetXPercent:8, offsetYPercent:10 | 0.05 / 0.95 | `{text:"U.S. ECONOMY · 2024"}` | `{typography:"kicker"}` | `{in:"fade"}` | 2 |
| `hero-cpi` | ImageReveal | center, offsetXPercent:16, offsetYPercent:16 | 0.1 / 1 | `{src:"assets/cpi_headline.jpg", alt:"CPI inflation report headline"}` | `{borderRadius:16, revealDirection:"left-to-right", width:640, height:640}` | `{in:{alias:"fadeUp", distancePx:80, durationInFrames:18}, rotate:{toDeg:6, startAt:"afterIn", durationInFrames:30, easing:"easeOut"}}` | 1 |

Camera (camera.md, start/end form):
- `start`: `{position:"center", offsetXPercent:0, offsetYPercent:0}`
- `end`: `{position:"center", offsetXPercent:-3, offsetYPercent:-2}`
- `zoomStartPercent`: 110, `zoomEndPercent`: 130
- `easeZoom`: true
- `durationInFrames`: omitted (full scene)

### Scene 2: what-cpi (~7s — n2 window)

The carried `hero-cpi` re-appears (same id, different position/size — the
resolver morphs `carryFrom`→`carryTo`). Caption block to the left.

| asset id | assetType | anchor | enterAt/exitAt | contentOverride | styleOverride | motion | z |
|----------|-----------|--------|----------------|-----------------|----------------|--------|---|
| `hero-cpi` | ImageReveal | center, offsetXPercent:-16, offsetYPercent:0 | 0 / 1 | `{src:"assets/cpi_headline.jpg", alt:"CPI inflation report headline"}` | `{borderRadius:24, revealDirection:"left-to-right", width:520, height:520}` | `{in:"fade"}` (carry handles the morph) | 1 |
| `caption-2` | KineticText | top-left, offsetXPercent:8, offsetYPercent:30 | 0 / 0.95 | `{text:"a basket of goods the average household buys", useNarrationTiming:true}` — **important**: `content.text` word-for-word with n2's tail to sync pops to narration | `{typography:"body", align:"left", width:760, height:200}` | `{in:"fadeUp"}` | 2 |

No camera (static — let the carry morph breathe).

### Scene 3: demand-pull (~9s — n3 window)

Hero image of crowded store on left power-point; angled tilt settles; camera
parallax push-in continues.

| asset id | assetType | anchor | enterAt/exitAt | contentOverride | styleOverride | motion | z |
|----------|-----------|--------|----------------|-----------------|----------------|--------|---|
| `hero-store` | ImageReveal | center, offsetXPercent:-16, offsetYPercent:-8 | 0 / 1 | `{src:"assets/demand_pull.jpg", alt:"crowded grocery store shoppers"}` | `{borderRadius:16, revealDirection:"bottom-to-top", width:760, height:560}` | `{in:{alias:"fadeRight", distancePx:120, durationInFrames:22}, rotate:{toDeg:-4, startAt:"afterIn", durationInFrames:28, easing:"easeInOut"}}` | 1 |
| `callout-3` | KineticText | bottom-right, offsetXPercent:-8, offsetYPercent:-12 | 0.15 / 0.9 | `{text:"demand outpaces supply", useNarrationTiming:true}` | `{typography:"kicker", align:"right", width:600, height:120}` | `{in:"fade"}` | 2 |

Camera (start/end form):
- `start`: `{position:"center", offsetXPercent:2, offsetYPercent:0}`
- `end`: `{position:"center", offsetXPercent:-2, offsetYPercent:0}`
- `zoomStartPercent`: 115, `zoomEndPercent`: 140
- `easeZoom`: true

Boundary effect on exit (whoosh on cut to scene 4):
| effect id | kind | timing | payload |
|-----------|------|--------|---------|
| whoosh-3 | sfx | `{offsetPercent:0}` (scene's visible end frame) | `{path:"audio/sfx_whoosh.mp3", volume:0.5}` |

### Scene 4: cost-push (~10s — n4 window)

Oil-crisis image on right power-point; full B-roll feel with parallax.

| asset id | assetType | anchor | enterAt/exitAt | contentOverride | styleOverride | motion | z |
|----------|-----------|--------|----------------|-----------------|----------------|--------|---|
| `hero-oil` | ImageReveal | center, offsetXPercent:16, offsetYPercent:8 | 0 / 1 | `{src:"assets/cost_push_oil.jpg", alt:"1970s oil crisis gas pump"}` | `{borderRadius:16, revealDirection:"left-to-right", width:720, height:520}` | `{in:{alias:"fadeLeft", distancePx:120, durationInFrames:22}, rotate:{toDeg:5, startAt:"afterIn", durationInFrames:32, easing:"easeOut"}}` | 1 |
| `callout-4` | KineticText | top-left, offsetXPercent:8, offsetYPercent:12 | 0.15 / 0.92 | `{text:"a key input gets scarce — oil, labor, chips", useNarrationTiming:true}` | `{typography:"body", align:"left", width:680, height:140}` | `{in:"fadeUp"}` | 2 |

Camera (start/end form):
- `start`: `{position:"center", offsetXPercent:-2, offsetYPercent:0}`
- `end`: `{position:"center", offsetXPercent:3, offsetYPercent:2}`
- `zoomStartPercent`: 120, `zoomEndPercent`: 135
- `easeZoom`: true

Boundary effect on exit (whoosh):
| effect id | kind | timing | payload |
|-----------|------|--------|---------|
| whoosh-4 | sfx | `{offsetPercent:0}` | `{path:"audio/sfx_whoosh.mp3", volume:0.5}` |

### Scene 5: wage-spiral (~12s — n5 window)

Split focus: wage-strike b-roll fills the frame; `BarChartRace` inset chart
shows "wage growth vs price growth" bars racing to dramatize the spiral.

| asset id | assetType | anchor | enterAt/exitAt | contentOverride | styleOverride | motion | z |
|----------|-----------|--------|----------------|-----------------|----------------|--------|---|
| `hero-wages` | ImageReveal | center, offsetXPercent:-12, offsetYPercent:-8 | 0 / 1 | `{src:"assets/wage_spiral.jpg", alt:"union wage strike picket sign"}` | `{borderRadius:20, revealDirection:"bottom-to-top", width:1100, height:780}` | `{in:"fade"}` (let the chart ride next to it) | 1 (background plane) |
| `chart-spiral` | BarChartRace | bottom-right, offsetXPercent:-6, offsetYPercent:-8 | 0.2 / 0.95 | (run `node scripts/agent-cli.mjs asset BarChartRace` for exact required keys — likely `{title, bars:[{label, value, colorToken}]}`) | (per manifest, likely `{width:560, height:380, depth:1.2}`) | `{in:"fadeUp"}` | 2 (foreground plane) |
| `callout-5` | KineticText | top-left, offsetXPercent:8, offsetYPercent:10 | 0.05 / 0.9 | `{text:"everyone expects prices to rise. wages chase prices. repeat.", useNarrationTiming:true}` | `{typography:"kicker", align:"left", width:680, height:120}` | `{in:"fadeUp"}` | 3 |

Boundary effects (whoosh on cut + tick as the chart rises):
| effect id | kind | timing | payload |
|-----------|------|--------|---------|
| whoosh-5 | sfx | `{offsetPercent:0}` | `{path:"audio/sfx_whoosh.mp3", volume:0.5}` |
| tick-5 | sfx | `{relativeToAsset:"chart-spiral", edge:"enter", offsetFrames:6}` (tick 6 frames after the chart starts rising) | `{path:"audio/sfx_tick.mp3", volume:0.4}` |

Background: `shade2` (panel lift — signals a stat-heavy scene).

### Scene 6: fed (~7s — n6 window)

Federal Reserve b-roll on right power-point + closing title centered.
Narration exits before the scene ends so the last beat dwells on the image.

| asset id | assetType | anchor | enterAt/exitAt | contentOverride | styleOverride | motion | z |
|----------|-----------|--------|----------------|-----------------|----------------|--------|---|
| `hero-fed` | ImageReveal | center, offsetXPercent:16, offsetYPercent:0 | 0 / 1 | `{src:"assets/fed_building.jpg", alt:"Federal Reserve building"}` | `{borderRadius:24, revealDirection:"left-to-right", width:600, height:780}` | `{in:{alias:"fadeRight", distancePx:100, durationInFrames:20}, rotate:{toDeg:-3, startAt:"afterIn", durationInFrames:28, easing:"easeOut"}}` | 1 |
| `closing` | TextBlock | center, offsetXPercent:-16, offsetYPercent:-16 | 0.1 / 1 | `{text:"Break the cycle."}` | `{typography:"title"}` | `{in:"fadeUp"}` (static) | 2 |

Camera (slow zoom-out as the Fed's role expands):
- `start`: `{position:"center", offsetXPercent:0, offsetYPercent:0}`
- `end`: `{position:"center", offsetXPercent:2, offsetYPercent:0}`
- `zoomStartPercent`: 125, `zoomEndPercent`: 110
- `easeZoom`: true

No boundary effects (last scene — no outgoing transition).

## 8. Transitions (summary)

| outgoing sceneId | transitionOut.type | durationInFrames | params |
|------------------|--------------------|------------------|--------|
| intro       | slideContinuity | 24 | `{carryAssetId:"hero-cpi"}` — carries CPI print into scene 2 |
| what-cpi    | default         | 18 | `{}` |
| demand-pull | default         | 18 | `{}` |
| cost-push   | default         | 18 | `{}` |
| wage-spiral | default         | 18 | `{}` |
| fed         | null            | —  | last scene, no transitionOut |

## 9. Tokens beyond defaults

- **colors** (additional):
  - `accentCool`: `#3DD68C` (green for real-value chart bar)
- **typography** (additional): none — three roles in §2 cover it
- **easing** (additional): none — framework defaults
- **textures** (additional):
  - `paper`: `assets/paper_texture.jpg` (used in scene 2's background overlay; pick from `imageSearch` along with the hero images or skip the overlay if sourcing is heavy — strict no-op if absent)

## 10. Post-cinematography

- [x] vignette: `{strength: 0.35}` — frame-edge dim for documentary weight
- [x] grain: `{strength: 12}` — subtle texture, B-roll feel
- [x] colorGrade: `{contrast:1.08, brightness:0, saturation:1.05, gamma:1}`
- [ ] letterbox: (off)

## 11. Pitfalls to remember while building

- **Trust the contract, not the name.** `asset ImageReveal` confirms `src`
  not `url` before any row's `contentOverride` is authored. Same for
  `BarChartRace` — its required keys differ from what we'd guess.
- **`hero-cpi` must exist in scenes 1 AND 2 with the same id** for the
  `slideContinuity` carry. Resolver throws if missing in either.
- **`zoomPercent` ≥ 1, percent not fraction.** 110 = 1.1×, 200 = 2×. 1.1
  will fail validation.
- **Narration word-for-word match for `KineticText` `useNarrationTiming:true`**
  — `content.text` must match the `n#` window's narration text verbatim or
  word-pop timing falls back to even stagger.
- **`exitAt < 1` cuts narration audio.** All narration-riders in this plan
  use `exitAt: 1` (default) — none leave early.
- **No `update-scene` command.** Scene-level fields (`background`,
  `transitionOut`) are set at `add-scene` time; assets then added on top.
- **Yandex connection-test before every image wire.** `curl -fsSL <url> |
  file -` each `imageSearch` result before referencing from a scene.
- **`overlap_warn.js` warns, never blocks.** Some scenes intentionally
  overlap image + callout (foreground plane differentiation via `z`); treat
  warnings as sanity. Don't edit the checker.

---

## Build (execute once every section above is filled in)

### Step 0 — Resolve collections (sections 3 + 4)

```bash
# discovery
node scripts/agent-cli.mjs collection youtubeSearch
node scripts/agent-cli.mjs collection ytDlpDownload
node scripts/agent-cli.mjs collection sfxSplit
node scripts/agent-cli.mjs collection imageSearch
node scripts/agent-cli.mjs collection manifestWiring

# background music — search, pick, download
# (run `collection youtubeSearch` for the exact command shape)
# SFX — search a transition/whoosh pack, download, silence-split into clips
# Images — Yandex search each of the 5 subjects in section 4
#   for each: curl -fsSL <url> | file -  (connection test, see avoid.md)
# finally:
node scripts/agent-cli.mjs collection manifestWiring
```

### Step 1 — Init the project (section 1 + 2 + 5 + 9)

```bash
node scripts/agent-cli.mjs init '{
  "projectId": "inflation-causes-us",
  "narration": {
    "entries": [
      { "id": "n1", "text": "Inflation is when your money buys less, because prices across the economy are rising." },
      { "id": "n2", "text": "The US tracks this with the Consumer Price Index — a basket of goods the average household actually buys." },
      { "id": "n3", "text": "When demand outpaces supply, buyers bid prices up. That'"'"'s demand-pull inflation." },
      { "id": "n4", "text": "When a key input gets scarce — oil, labor, chips — producers pass the cost along. That'"'"'s cost-push." },
      { "id": "n5", "text": "And once everyone expects prices to rise, workers demand higher wages, which raises prices again. That'"'"'s the built-in spiral." },
      { "id": "n6", "text": "The Federal Reserve fights all three by raising interest rates, cooling demand, and breaking the cycle." }
    ],
    "fullTranscript": "Inflation is when your money buys less, because prices across the economy are rising. The US tracks this with the Consumer Price Index — a basket of goods the average household actually buys. When demand outpaces supply, buyers bid prices up. That'"'"'s demand-pull inflation. When a key input gets scarce — oil, labor, chips — producers pass the cost along. That'"'"'s cost-push. And once everyone expects prices to rise, workers demand higher wages, which raises prices again. That'"'"'s the built-in spiral. The Federal Reserve fights all three by raising interest rates, cooling demand, and breaking the cycle."
  },
  "colors":     { "shade1":"#0B0E14", "shade2":"#161B26", "main1":"#F5F7FA", "main2":"#8B93A7", "accentBg":"#FF6B4A", "accentCool":"#3DD68C" },
  "typography": {
    "title":  { "fontFamily":"Inter, sans-serif", "fontSize":72, "fontWeight":700, "lineHeight":1.1, "colorToken":"main1" },
    "body":   { "fontFamily":"Inter, sans-serif", "fontSize":36, "fontWeight":400, "lineHeight":1.4, "colorToken":"main2" },
    "kicker": { "fontFamily":"Inter, sans-serif", "fontSize":28, "fontWeight":600, "lineHeight":1.2, "colorToken":"accentBg" }
  },
  "textures":   { "paper": "assets/paper_texture.jpg" }
}'
```

### Step 2 — Build scenes + assets

For brevity here's the first two scenes — scenes 3–6 are mechanical repeats
of the pattern in section 7. Best executed via `agent-batch.mjs` (see
`post-effects.md` §"Batching"):

```bash
node scripts/agent-batch.mjs '[
  ["add-scene", "inflation-causes-us", {
    "id":"intro", "narrationRef":"n1", "background":"shade1",
    "transitionOut":{"type":"slideContinuity","durationInFrames":24,"params":{"carryAssetId":"hero-cpi"}}
  }],
  ["add-asset", "inflation-causes-us", "intro", {
    "assetType":"TextBlock",
    "anchor":{"position":"center","offsetXPercent":-16,"offsetYPercent":-16},
    "contentOverride":{"text":"What is inflation?"},
    "styleOverride":{"typography":"title"},
    "motion":{"in":"fadeUp"},
    "z":1
  }],
  ["add-asset", "inflation-causes-us", "intro", {
    "assetType":"TextBlock",
    "anchor":{"position":"top-left","offsetXPercent":8,"offsetYPercent":10},
    "contentOverride":{"text":"U.S. ECONOMY · 2024"},
    "styleOverride":{"typography":"kicker"},
    "motion":{"in":"fade"},
    "enterAt":0.05,
    "z":2
  }],
  ["add-asset", "inflation-causes-us", "intro", {
    "assetType":"ImageReveal",
    "anchor":{"position":"center","offsetXPercent":16,"offsetYPercent":16},
    "contentOverride":{"src":"assets/cpi_headline.jpg","alt":"CPI inflation report headline"},
    "styleOverride":{"borderRadius":16,"revealDirection":"left-to-right","width":640,"height":640},
    "motion":{"in":{"alias":"fadeUp","distancePx":80,"durationInFrames":18},"rotate":{"toDeg":6,"startAt":"afterIn","durationInFrames":30,"easing":"easeOut"}},
    "z":1
  }],
  ["set-camera", "inflation-causes-us", "intro", {
    "start":{"position":"center","offsetXPercent":0,"offsetYPercent":0},
    "end":{"position":"center","offsetXPercent":-3,"offsetYPercent":-2},
    "zoomStartPercent":110, "zoomEndPercent":130, "easeZoom":true
  }]
  /* … continue for scenes 2–6 using their section 7 tables … */
]'
```

### Step 3 — Wire audio

```bash
# background music
node scripts/agent-cli.mjs add-music inflation-causes-us '{
  "id":"bgm-1", "src":"/audio/bgm_inflation.mp3",
  "volume":0.18, "loop":true, "fadeInSeconds":2, "fadeOutSeconds":2.5
}'

# whoosh on every scene cut (global) — inject-effects shorthand
node scripts/agent-cli.mjs inject-effects inflation-causes-us '[
  { "match":{"scene":"all"}, "anchor":"exit",
    "effect":{"kind":"sfx","id":"whoosh","path":"audio/sfx_whoosh.mp3","volume":0.5} }
]'

# chart tick on scene 5 (scene-specific — add-effect)
node scripts/agent-cli.mjs add-effect inflation-causes-us wage-spiral '{
  "id":"tick-5", "kind":"sfx",
  "path":"audio/sfx_tick.mp3", "volume":0.4,
  "timing":{"relativeToAsset":"chart-spiral","edge":"enter","offsetFrames":6}
}'
```

### Step 4 — Post-effects (section 10)

Edit `studio/manifest/inflation-causes-us/config.json` directly (sanctioned
exception). Append:

```json
{ "postEffects": { "vignette":{"strength":0.35}, "grain":{"strength":12}, "colorGrade":{"contrast":1.08,"brightness":0,"saturation":1.05,"gamma":1} } }
```

Keep `"postEffects"` absent if skipping. `ffmpeg` must be on PATH.

### Step 5 — Validate

```bash
node scripts/agent-cli.mjs validate inflation-causes-us
```
Expect `{ ok:true, sceneCount:6, projectId:"inflation-causes-us" }`. Fix any
`error` (names the file/stage) with the matching `add-*`/`set-*` command.

### Step 6 — Render

```bash
node scripts/agent-cli.mjs render inflation-causes-us
# -> out/inflation-causes-us.mp4
```

### Step 7 — Verify output

```bash
ffprobe out/inflation-causes-us.mp4
```
Confirm real h264 stream + duration ~55s matches section 1.
