---
name: video-agent-cli
description: Build/render Remotion videos via scripts/agent-cli.mjs. Use for new projects, scene/asset/audio/TTS/post-effects edits, or mp4 rendering. Never hand-author studio/manifest/** or manifest.json files; use CLI instead.
---

# Video agent CLI

JSON-to-MP4 framework. Projects live in `studio/manifest/<projectId>/`.
Pipeline: `validate → resolve → render`. Assets/transitions are self-describing; CLI reads their registries.

## Core Commands
- Validate: `node scripts/agent-cli.mjs validate <projectId>`
- Render: `node scripts/agent-cli.mjs render <projectId>`

## Critical Rules
|- **No Hand-Editing:** Do not `view`/`cat`/`patch` `studio/` files to learn schemas. Use CLI.
|- **Collections:** Use `node scripts/agent-cli.mjs collections` to source images/audio.
|- **Contract First:** Always run `node scripts/agent-cli.mjs asset <Type>` to verify `contentOverride` keys. Using `url` instead of `src` (or vice versa) causes render crashes despite passing `validate`.
|- **No Invented Design:** Do not guess colors/fonts. Use provided context or ask user.

## Common Pitfalls
|- **Asset Addition:** Use `assetType` key in `add-asset`, not `type`.
|- **Transitions:** In `set-transition`, only pass `type` and `params`. Do not include `id` or `duration` at the top level of the transition object.
|- **Narration:** For narrated projects, `node scripts/agent-cli.mjs set-transcript` must be called before `render` to avoid `generateTtsTiming` failures.
|- **Anchors:** Use `node scripts/agent-cli.mjs anchors` to verify valid position enums (e.g., use `left` instead of `left-center`).
|- **Render Timeouts:** Large projects may timeout in foreground; use `terminal(background=true)` for `render`.

## Reference Docs
AI agents MUST read `scripts/curate/` for high-accuracy output.
- **Usage Guide:** `scripts/curate/cli-usage/` (Split by stage: discover, init, build, audio, post-effects, validate-render, avoid, collections).
- **Planning:** `scripts/curate/plan.md` (Mandatory pre-flight template).
- **Concepts:** `scripts/curate/asset/` (Motion, Parallax, Highlighting).
- **Mental Model:** `docs/agent-guide/CONTEXT.md`.

## CLI Capability Summary
- `asset <Type>` / `transition <Type>`: Live schema (required vs optional keys, bounds).
- `anchors`: Position enum.
- `envelope`: Field reference.
- `collections`: Asset-library workflows.
