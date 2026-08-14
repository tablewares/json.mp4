# Pre-flight Plan: Python History

## 1. Project Identity
- **projectId**: python-history-short
- **Intent**: A fast-paced, Vox-style short on the origins and impact of Python.
- **Duration (sec)**: ~25
- **Aspect Ratio**: 1080x1920 (9:16)
- **Narration?**: yes

## 2. Design Surface (Vox Style)
- **Palette**: 
  - `shade1`: #0a0a0a (Deep Black)
  - `shade2`: #1a1a1a (Dark Grey)
  - `main1`: #ffffff (Pure White)
  - `main2`: #cccccc (Light Grey)
  - `accentBg`: #ffde57 (Python Yellow)
- **Typography**: 
  - `title`: Inter / 80 / 700 / 1.1 / main1
  - `body`: Inter / 40 / 400 / 1.4 / main2
  - `kicker`: Inter / 30 / 600 / 1.2 / accentBg
- **Easing**: snappy
- **Composition**: Power-point anchors, center symmetry.

## 3. Audio
- **BGM**: ID: `bgm_fast` | Mood: Tech/Fast | Source: YouTube (Fast corporate tech) | Path: `public/audio/bgm_fast.mp3` | Vol: 0.2 | Loop: true
- **SFX**: `sfx_pop` (for text appearances) | `sfx_whoosh` (for transitions).

## 4. Images
- **Asset 1**: `img_guido` | Guido van Rossum | Yandex | `public/assets/guido.jpg`
- **Asset 2**: `img_logo` | Python Logo | Yandex | `public/assets/logo.png`
- **Asset 3**: `img_code` | Python Code Snippet | Yandex | `public/assets/code.png`
- **Asset 4**: `img_ai` | AI/ML usage visual | Yandex | `public/assets/ai.png`

## 5. Narration
- **Transcript**: "Meet Guido van Rossum. In 1989, he created Python to be simple, readable, and powerful. Today, it's the backbone of data science and AI. From automation to Neural Networks, Python runs the modern world."
- **Entries**:
  - `n1`: "Meet Guido van Rossum."
  - `n2`: "In 1989, he created Python to be simple, readable, and powerful."
  - `n3`: "Today, it's the backbone of data science and AI."
  - `n4`: "From automation to Neural Networks, Python runs the modern world."
- **TTS**: Provider: `http`, ttsHumanize: `on`.

## 6. Scene Breakdown
| # | sceneId | narrationRef | Intent | Carried Assets | transitionOut | BG |
|---|---|---|---|---|---|---|
| 1 | s1_intro | n1 | Intro Guido | - | slideContinuity(img_logo) | shade1 |
| 2 | s2_origin | n2 | The 1989 start | img_logo | pivotZoom(img_code) | shade2 |
| 3 | s3_impact | n3 | Data Science/AI | img_code | default | shade1 |
| 4 | s4_outro | n4 | Modern World | img_ai | null | shade2 |

## 7. Per-Scene Assets
- **S1**: `img_guido` (Center, 0.1-0.9, content: src) | `img_logo` (Bottom, 0.5-1.0, content: src)
- **S2**: `img_logo` (Top, 0.1-0.5, content: src) | `img_code` (Center, 0.3-0.9, content: src)
- **S3**: `img_code` (Left, 0.1-0.6, content: src) | `img_ai` (Right, 0.4-1.0, content: src)
- **S4**: `img_ai` (Center, 0.2-0.8, content: src)

## 8. Transitions
- s1 $\rightarrow$ s2: `slideContinuity` (carry: img_logo)
- s2 $\rightarrow$ s3: `pivotZoom` (carry: img_code)
- s3 $\rightarrow$ s4: `default`

## 9. Custom Tokens
- None.

## 10. Post-Cinematography
- [x] vignette: 0.5 | [x] grain: 0.2

## 11. Pitfalls
- Ensure `img_logo` and `img_code` are in both scenes for carry.
- Use `src` for ImageReveal/Backdrop.
