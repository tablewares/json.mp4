# Pre-flight Plan: Quantitative Easing B-Roll

## 1. Project Identity
- **projectId**: qe-explained-broll
- **Intent**: A high-energy, vox-style educational sequence explaining the mechanics and risks of Quantitative Easing.
- **Duration (sec)**: ~36
- **Aspect Ratio**: 1920x1080
- **Narration?**: yes

## 2. Design Surface
- **Palette**: Dark financial theme. Deep navy (#0a192f), Gold accent (#ffd700), White text (#ffffff), Red for risk (#ff4d4d).
- **Typography**: Bold sans-serif for KineticText, clean mono for TickerTape.
- **Easing**: snappy (for financial beats).
- **Composition**: Center-weighted for KineticText, Rule of Thirds for ImageReveals.

## 3. Audio
- **BGM**: ID: bgm_finance_pulse | Mood: Tense, rhythmic, pulsing | Source: Stock | Vol: 0.6 | Loop: yes
- **SFX**: 
    - sfx_cash_register | Beat: Scene 3 (Money injection) | Vol: 0.8
    - sfx_whoosh | Beat: Transitions | Vol: 0.5
    - sfx_alarm_subtle | Beat: Scene 6 (Inflation) | Vol: 0.7

## 4. Images/Footage (Pexels/Collections)
- **Assets**:
    - img_central_bank | Central Bank Building | Pexels | b-roll
    - img_money_press | High-speed money printing | Pexels | b-roll
    - img_gov_bonds | Government bond certificates | Collections | specific
    - img_city_growth | Modern city construction/cranes | Pexels | b-roll
    - img_inflation | Close-up of price tags increasing | Pexels | b-roll
    - img_market_chaos | Stressed traders on floor | Pexels | b-roll

## 5. Narration
- **Transcript**: "Quantitative Easing. When the economy stalls, central banks step in. They create new digital money to buy government bonds, flooding the financial system with liquidity. This lowers interest rates and encourages banks to lend. The goal? To spark investment and jumpstart growth. But there's a catch. Too much money chasing too few goods can lead to one thing: inflation."
- **Entries**:
    - n1: "Quantitative Easing."
    - n2: "When the economy stalls, central banks step in."
    - n3: "They create new digital money to buy government bonds, flooding the financial system with liquidity."
    - n4: "This lowers interest rates and encourages banks to lend."
    - n5: "The goal? To spark investment and jumpstart growth."
    - n6: "But there's a catch. Too much money chasing too few goods can lead to one thing: inflation."

## 6. Scene Breakdown
| # | sceneId | narrationRef | Intent | Carried Assets | transitionOut | BG |
|---|---|---|---|---|---|---|
| 1 | s1_intro | n1 | Bold title intro | - | pivotZoom | navy_dark |
| 2 | s2_central | n2 | Establish the actor (Central Bank) | - | WhipPan | navy_dark |
| 3 | s3_process | n3 | Explain the mechanism (Buying bonds) | - | default | navy_dark |
| 4 | s4_liquidity | n4 | Show the result (Money supply) | - | slideContinuity | navy_dark |
| 5 | s5_goal | n5 | Show the intended outcome (Growth) | - | default | navy_dark |
| 6 | s6_risk | n6 | The downside (Inflation) | - | default | red_dark |

## 7. Per-Scene Assets
**Timing Rule: Assets sequence one after another.**

**Scene 1 (s1_intro)**
- Asset: `KineticText` | ID: txt_qe | Anchor: center | enterAt: 0 | content: "QUANTITATIVE EASING" | motion: `$alias: motion.fadeIn` | z: 10
- Camera: dollyIn | start: center | end: center | zoomStart: 100 | zoomEnd: 110

**Scene 2 (s2_central)**
- Asset: `BackdropImage` | ID: img_bank | Anchor: center | enterAt: 0 | content: { src: "img_central_bank" } | z: 1
- Asset: `KineticText` | ID: txt_step_in | Anchor: center | enterAt: { $alias: "timing.withPreviousExit", assetId: "img_bank", offsetFrames: 5 } | content: "CENTRAL BANKS STEP IN" | motion: `$alias: motion.fadeIn` | z: 10

**Scene 3 (s3_process)**
- Asset: `ImageReveal` | ID: img_press | Anchor: left | enterAt: 0 | content: { src: "img_money_press" } | z: 5
- Asset: `ImageReveal` | ID: img_bonds | Anchor: right | enterAt: { $alias: "timing.withPreviousExit", assetId: "img_press", offsetFrames: 10 } | content: { src: "img_gov_bonds" } | z: 5
- Asset: `KineticText` | ID: txt_liquidity | Anchor: center | enterAt: { $alias: "timing.withPreviousExit", assetId: "img_bonds", offsetFrames: 10 } | content: "FLOODING WITH LIQUIDITY" | motion: `$alias: motion.fadeIn` | z: 10

**Scene 4 (s4_liquidity)**
- Asset: `TickerTape` | ID: tape_finance | Anchor: bottom | enterAt: 0 | content: { tickers: [...] } | z: 5
- Asset: `BarChartRace` | ID: chart_supply | Anchor: center | enterAt: { $alias: "timing.withPreviousExit", assetId: "tape_finance", offsetFrames: 10 } | content: { data: "Money Supply" } | z: 10

**Scene 5 (s5_goal)**
- Asset: `BackdropImage` | ID: img_growth | Anchor: center | enterAt: 0 | content: { src: "img_city_growth" } | z: 1
- Asset: `KineticText` | ID: txt_growth | Anchor: center | enterAt: { $alias: "timing.withPreviousExit", assetId: "img_growth", offsetFrames: 15 } | content: "SPARKING GROWTH" | motion: `$alias: motion.fadeIn` | z: 10

**Scene 6 (s6_risk)**
- Asset: `ImageReveal` | ID: img_inflation | Anchor: center | enterAt: 0 | content: { src: "img_inflation" } | z: 5
- Asset: `KineticText` | ID: txt_risk | Anchor: center | enterAt: { $alias: "timing.withPreviousExit", assetId: "img_inflation", offsetFrames: 15 } | content: "THE RISK: INFLATION" | motion: `$alias: motion.fadeIn` | style: { color: "#ff4d4d" } | z: 10

## 8. Transitions
| Out-Scene | Type | Duration | Params |
|---|---|---|---|
| s1_intro | pivotZoom | 20 | { carryAssetId: "txt_qe" } |
| s2_central | WhipPan | 14 | {} |
| s3_process | default | 18 | {} |
| s4_liquidity | slideContinuity | 24 | { carryAssetId: "chart_supply" } |
| s5_goal | default | 18 | {} |
| s6_risk | default | 18 | {} |

## 11. Pitfalls
- **Timing**: Ensure the `withPreviousExit` chain is strictly followed so assets don't overlap and clutter the screen.
- **Assets**: Use Pexels for the "Money Press" and "City Growth" to get high-quality b-roll; use a specific collection for "Gov Bonds" to ensure accuracy.
- **Contrast**: Use the dark navy BG to make the gold and white text pop.
