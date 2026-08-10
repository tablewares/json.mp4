# Init a project

```bash
node scripts/agent-cli.mjs init '{ "projectId": "<projectId>" }'
```

Only `projectId` required. Working defaults: `fps`, `width`, `height`, `defaultSceneDurationInFrames`, `ttsProvider`, full color/typography/spacing/easing theme. Override piecemeal — e.g. `"colors":{ "accentBg":"#FF6600" }` replaces only that token; everything else stays. Overrides come from run's external design context, not this skill.

Narration optional — omit for no voiceover. When present, scenes timed by narration window (TTS = source of truth for timing). See `docs/agent-guide/conventions/timing-from-tts.md`. Short version: each scene's `narrationRef` must match an `entries[].id`; `fullTranscript` must contain every word the TTS will synthesize, in order.

Add/replace narration after init:

```bash
# add a single narration entry
node scripts/agent-cli.mjs add-narration <projectId> '{ "id":"n2", "text":"..." }'

# replace full transcript string (TTS aligns against this)
node scripts/agent-cli.mjs set-transcript <projectId> '{ "text":"every word, in order..." }'

# manifest-level audio overlay (non-TTS bed/SFX track)
node scripts/agent-cli.mjs add-audio <projectId> '{ "id":"bed", "start":0, "end":12, "path":"audio/bed.mp3" }'
```

Pass `"overwrite": true` in init spec to replace an existing project.
