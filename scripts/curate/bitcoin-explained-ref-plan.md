# Pre-flight Plan: bitcoin-explained-ref

## 1. Project Identity
- **projectId**: bitcoin-explained-ref
- **Intent**: High-quality reference video explaining Bitcoin's core mechanisms.
- **Duration (sec)**: ~45
- **Aspect Ratio**: 1080x1920
- **Narration?**: yes

## 2. Design Surface
- **Palette**: Gold (#FFD700), Deep Charcoal (#121212), White (#FFFFFF), Accent Blue (#00BFFF).
- **Typography**: Title: Montserrat Bold, Body: Open Sans Regular.
- **Easing**: gentleSpring.
- **Composition**: Center-focused for assets, Rule of Thirds for labels.

## 3. Audio
- **BGM**: Tech-ambient, driving but clean. ID: btc-ambient | Source: Collection | Vol: 0.3 | Loop: true.
- **SFX**:
    - `digital-click`: When blocks appear.
    - `whoosh`: On camera zooms.
    - `ping`: On final logo resolve.

## 4. Images (To be fetched via collections)
- **Assets**:
    - `btc-coin`: High-res Bitcoin symbol (Gold).
    - `global-nodes`: Map of world with connected dots.
    - `block-element`: 3D Isometric block graphic.
    - `mining-rig`: Macro shot of ASIC miners/chips.
    - `ledger-bg`: Abstract binary/data background.

## 5. Narration
- **Provider**: http
- **Transcript**:
    - [n1] Bitcoin is more than just a currency; it's a revolution in how we think about money.
    - [n2] Unlike traditional banks, Bitcoin is decentralized. It runs on a global network of computers called nodes.
    - [n3] Every transaction is recorded on a public ledger known as the blockchain—a chain of blocks that cannot be altered.
    - [n4] New bitcoins are created through mining, where powerful computers solve complex puzzles to secure the network.
    - [n5] A transparent, secure, and borderless system. That is the essence of Bitcoin.

## 6. Scene Breakdown
| # | sceneId | narrationRef | Intent | Assets | transitionOut | BG |
|---|---|---|---|---|---|---|
| 1 | s1-intro | n1 | Hook: Digital Gold | btc-coin | pivotZoom | ledger-bg |
| 2 | s2-nodes | n2 | Decentralization | global-nodes | default | ledger-bg |
| 3 | s3-chain | n3 | Blockchain Ledger | block-1, block-2, line-1 | default | ledger-bg |
| 4 | s4-mining | n4 | Proof of Work | mining-rig | default | ledger-bg |
| 5 | s5-outro | n5 | Summary | btc-coin | default | ledger-bg |

## 7. Per-Scene Assets
**S1: intro**
- Asset `btc-coin`: ImageReveal | center | 0 -> 1 | z: 10
- Camera: start {center}, end {center}, zoomStart 100, zoomEnd 150. (Zoom into asset).

**S2: nodes**
- Asset `global-nodes`: ImageReveal | center | 0 -> 1 | z: 10
- Camera: start {center}, end {followAssetId: global-nodes}, zoomStart 100, zoomEnd 180. (Zoom into network hub).

**S3: chain**
- Asset `block-1`: ImageReveal | left-center | 0 -> 0.5 | z: 10
- Asset `block-2`: ImageReveal | right-center | 0.3 -> 1 | z: 10
- Asset `line-1`: DrawLine | block-1 -> block-2 | 0.3 -> 0.7 | z: 5
- Camera: start {center}, end {followAssetId: block-2}, zoomStart 100, zoomEnd 140.

**S4: mining**
- Asset `mining-rig`: ImageReveal | center | 0 -> 1 | z: 10
- Camera: start {center}, end {followAssetId: mining-rig}, zoomStart 100, zoomEnd 200. (Zoom into chip).

**S5: outro**
- Asset `btc-coin`: ImageReveal | center | 0 -> 1 | z: 10
- Camera: start {center}, end {center}, zoomStart 150, zoomEnd 100. (Zoom out to reveal full coin).

## 8. Transitions
- S1 -> S2: `pivotZoom` (carryAssetId: btc-coin)

## 9. Custom Tokens
- PrimaryGold: #FFD700
- DarkBg: #121212

## 10. Post-Cinematography
- [x] vignette
- [x] grain
- [ ] colorGrade
- [ ] letterbox
