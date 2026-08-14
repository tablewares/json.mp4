# Pre-flight Plan

Fill this template *before* running any mutating `agent-cli.mjs` commands. Design gaps are expensive; solve them here first.

## Discovery (Read-Only)
```bash
node scripts/agent-cli.mjs assets        # List asset types
node scripts/agent-cli.mjs asset <Type> # Schema for one type
node scripts/agent-cli.mjs transitions   # List transition types
node scripts/agent-cli.mjs transition <Type> # Schema for one transition
node scripts/agent-cli.mjs collections   # Library workflows
node scripts/agent-cli.mjs anchors      # Position values
node scripts/agent-cli.mjs envelope      # Field reference
```

---

## 1. Project Identity
- **projectId**: ____________________
- **Intent**: ____________________
- **Duration (sec)**: ____
- **Aspect Ratio**: 1920x1080 (Default)
- **Narration?** yes/no (If no, use `config.defaultSceneDurationInFrames`)

## 2. Design Surface (External Context Only)
- **Palette**: shade1(dark), shade2(panel), main1(text), main2(sec-text), accentBg.
- **Typography**: title, body, kicker (fontFamily/size/weight/lineHeight/color).
- **Easing**: gentleSpring, snappy (damping/mass/stiffness).
- **Composition**: Rule of thirds? (See `docs/composition/composition-design-principles.md`).

## 3. Audio (Resolve via Collections first)
- **BGM**: ID | Mood | Source | Collection | Path | Vol | Loop | Fade
- **SFX**: ID | Beat | Source | Collection | Path | Vol
- **Wiring**: Run `node scripts/agent-cli.mjs collection manifestWiring` after files land.

## 4. Images (Resolve via Collections first)
- **Assets**: ID | Subject | Source | Collection | Path
- **Yandex Rule**: `curl -fsSL` URLs to confirm real images; don't trust JSON.

## 5. Narration
- **Transcript**: [Full text]
- **Entries**: [ID | Text]
- **Settings**: Provider (http), ttsHumanize (on/off).

## 6. Scene Breakdown
| # | sceneId | narrationRef/Duration | Intent | Carried Assets | transitionOut (type+id) | BG |
|---|---|---|---|---|---|---|

## 7. Per-Scene Assets
**Verify `content.required` via `asset <Type>` first.**
| Asset ID | Type | Anchor (pos+%) | enterAt/exitAt | contentOverride | styleOverride | motion | z |
|---|---|---|---|---|---|---|---|

- **Camera**: Start/End anchors, easeZoom, zoomPercent (100=unity).
- **Effects**: ID | Kind | Timing Anchor | Payload.

## 8. Transitions
| Out-Scene | Type | Duration | Params (carryAssetId etc.) |
|---|---|---|---|

## 9. Custom Tokens
- **Colors/Typography/Easing/Textures**: List any non-default tokens for `init`.

## 10. Post-Cinematography (Manual edit `config.json`)
- [ ] vignette | [ ] grain | [ ] colorGrade | [ ] letterbox

## 11. Pitfalls
- **Contract:** Use `asset <Type>` to check `src` vs `url`.
- **Carry:** `carryAssetId` must exist in both scenes.
- **Zoom:** `zoomPercent` is 100-based, not 0-1.
- **Timing:** `exitAt < 1` may cut audio mid-word.
- **Editing:** Use CLI commands, not hand-editing `studio/manifest/**`.

---

## Build Sequence
1. **Collections**: Download all media $\rightarrow$ `manifestWiring`.
2. **Init**: `node scripts/agent-cli.mjs init '{...}'` (projectId, narration, tokens).
3. **Scenes**: `add-scene` $\rightarrow$ `add-asset` (per scene).
4. **Camera**: `set-camera` / `add-camera-action`.
5. **Audio**: `add-music` / `add-effect` / `inject-effects`.
6. **Post**: Manual `config.json` edit.
7. **Validate**: `node scripts/agent-cli.mjs validate <projectId>`.
8. **Render**: `node scripts/agent-cli.mjs render <projectId>`.
9. **Verify**: `ffprobe out/<projectId>.mp4`.
