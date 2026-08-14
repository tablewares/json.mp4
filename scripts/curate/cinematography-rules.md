# Cinematography & Composition Rules

These rules ensure high-quality, professional output and avoid common render warnings.

## Camera Work
- **No Lateral Movement:** Never move the camera side-to-side.
- **Targeted Zooms:** When zooming in, always zoom into a visual asset. Never zoom into plain text.

## Scene Composition
- **Asset Selection:** Prioritize high-resolution, subject-appropriate assets.
- **Overlay Management:**
    - **No Concurrent Sequencing:** If intentionally overlaying assets, never sequence two assets to appear/exist in the same timing window.
    - **Warning Check:** Always check for `overlap-warning` output after rendering.

## Technical Defaults
- **Canvas:** Use 1080x1920 for vertical/mobile formats.
- **TTS:** Use `ttsProvider: http` for high-quality narration.