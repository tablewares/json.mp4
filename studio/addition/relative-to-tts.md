Good point — tying to a spoken phrase shouldn't require some other asset to already exist and happen to display matching text. Here's a standalone `relativeToWord` that reads straight from the scene's own narration word timing (the same `timing.words` `KineticText` already gets, just exposed one level up), plus support for a *set* of words so an asset can span a phrase, not just one word.

## `src/pipelines/pipeline2-resolve/resolveScene.js`

Two changes: pass the scene's word timing into the anchor ctx, and expose it on the returned scene object so `resolveTransitions.js` can reach it too.

```js
    const timingAnchorCtx = {
      sceneDurationInFrames: timing.durationInFrames,
      resolvedAssetsById,
      camera,
      words: timing.words, // scene-level narration word timing, for standalone relativeToWord anchors
      sceneId: scene.id,
    };
```

```js
  return {
    id: scene.id,
    durationInFrames: sceneDurationInFrames,
    effects: [],
    camera,
    // Scene-level narration word timing, exposed so transitionOut.effects
    // (resolved later, outside this function) can also anchor to a spoken
    // word/phrase without needing a KineticText asset to already display
    // matching text. null when the scene has no narration.
    narrationWords: timing.words ?? null,
    ttsWindow: hasNarration
      ? {
          narrationRef: scene.narrationRef,
          startSeconds: timing.startSeconds,
          endSeconds: timing.endSeconds,
          startFrame: timing.startFrame,
          endFrame: timing.endFrame,
        }
      : null,
    background: scene.background ? resolveBackground(styles, scene.background) : undefined,
    assets: resolvedAssets,
    transitionIn: null,
    transitionOut: null,
  };
```

## `src/pipelines/pipeline2-resolve/resolveTransitions.js`

Thread the same scene-level words into the transition-effects timing ctx:

```js
  const resolvedAssetsById = indexAssetsById(outgoingScene.assets ?? []);
  const timingCtx = {
    sceneDurationInFrames: outgoingScene.durationInFrames,
    resolvedAssetsById,
    camera: outgoingScene.camera,
    words: outgoingScene.narrationWords,
    sceneId: outgoingScene.id,
  };
```

## `src/timing/effectTiming.js`

New resolver for the standalone case, plus dispatch for it in `resolveTimingAnchor`. `resolveAssetRelative`'s existing `relativeToWord` handling (asset-scoped) is untouched — that still wins when `relativeToAsset` is also present.

```js
/**
 * Resolves { relativeToWord } WITHOUT relativeToAsset: anchors directly to
 * the SCENE's own narration word timing (ctx.words — the same array
 * KineticText's per-word reveal already reads, just not gated behind any
 * asset's content matching the narration). Use this when something should
 * simply appear at a spoken word/phrase, independent of whether any asset
 * happens to display that text.
 *
 * `relativeToWord` accepts:
 *   - a word index (number) or exact word text (string) — a single word
 *   - an array of indices/words — a SET/phrase. `edge: "enter"` (default)
 *     anchors to the FIRST word's start frame; `edge: "exit"` anchors to
 *     the LAST word's end frame. So the anchor spans the whole phrase:
 *     an asset can enter when the phrase starts and exit when it ends.
 */
function resolveWordRelative(anchor, ctx) {
  const words = ctx.words;
  if (!Array.isArray(words) || words.length === 0) {
    throw new Error(
      `Timing anchor references relativeToWord ${JSON.stringify(anchor.relativeToWord)} but scene ` +
        `"${ctx.sceneId ?? "?"}" has no resolved narration word timing. This requires the scene to have ` +
        `a narrationRef with word-level (WhisperX/TTS) alignment.`,
    );
  }

  const specs = Array.isArray(anchor.relativeToWord) ? anchor.relativeToWord : [anchor.relativeToWord];
  const matched = specs.map((s) => {
    const w = typeof s === "number" ? words[s] : words.find((word) => word.word === s);
    if (!w) {
      const available = typeof s === "number" ? `0-${words.length - 1}` : words.map((word) => word.word).join(", ");
      throw new Error(
        `Timing anchor references relativeToWord ${JSON.stringify(s)} but it wasn't found in scene ` +
          `"${ctx.sceneId ?? "?"}"'s narration. Available: ${available}.`,
      );
    }
    return w;
  });

  const first = matched[0];
  const last = matched[matched.length - 1];
  const base = anchor.edge === "exit" ? last.endFrame : first.startFrame;
  const offset = anchor.offsetFrames ?? 0;
  return clamp(Math.round(base + offset), 0, ctx.sceneDurationInFrames);
}
```

```js
export function resolveTimingAnchor(anchor, ctx) {
  if (typeof anchor === "number") {
    return resolveEffectFrame(anchor, ctx.sceneDurationInFrames);
  }
  if (!anchor || typeof anchor !== "object") {
    return resolveEffectFrame(0, ctx.sceneDurationInFrames);
  }

  if (anchor.relativeToAsset !== undefined) {
    return resolveAssetRelative(anchor, ctx);
  }
  if (anchor.relativeToCameraAction !== undefined) {
    return resolveCameraRelative(anchor, ctx);
  }
  // Standalone relativeToWord — no relativeToAsset — anchors to the scene's
  // own narration word timing directly. When relativeToAsset IS present,
  // resolveAssetRelative handles relativeToWord against that asset's own
  // resolved word array instead (see its branch above).
  if (anchor.relativeToWord !== undefined) {
    return resolveWordRelative(anchor, ctx);
  }
  return resolveEffectFrame(anchor.offsetPercent ?? 0, ctx.sceneDurationInFrames);
}
```

## `src/pipelines/pipeline1-validate/schema/shared.schema.json`

Widen `relativeToWord` to allow a bare word/index/array, without requiring `relativeToAsset`:

```json
    "timingAnchor": {
      "type": "object",
      "description": "A timing anchor for an effect/camera event. Exactly one of: offsetPercent, relativeToAsset, relativeToCameraAction, relativeToWord (relativeToWord may also be combined with relativeToAsset to read that asset's own word timing instead of the scene's narration).",
      "additionalProperties": false,
      "properties": {
        "offsetPercent": { "type": "number" },
        "relativeToAsset": { "type": "string" },
        "relativeToWord": {
          "oneOf": [
            { "type": "integer", "minimum": 0 },
            { "type": "string" },
            {
              "type": "array",
              "minItems": 1,
              "items": { "oneOf": [{ "type": "integer", "minimum": 0 }, { "type": "string" }] }
            }
          ],
          "description": "A word index, exact word text, or array of words/indices (a phrase/set) to anchor to. Without relativeToAsset, resolves against the SCENE's own narration word timing (requires scene.narrationRef with word-level alignment) — use this to place something at a spoken word/phrase with no asset needing to display that text. With relativeToAsset, resolves against that asset's own resolved timing.words instead. For an array, edge 'enter' (default) anchors to the FIRST word's start frame and edge 'exit' anchors to the LAST word's end frame."
        },
        "relativeToCameraAction": { "oneOf": [{ "type": "number" }, { "type": "string" }] },
        "edge": { "type": "string", "enum": ["enter", "exit"], "default": "enter" },
        "offsetFrames": { "type": "number", "default": 0 }
      }
    }
```

No change needed to `checkTimingAnchor` in `validators.js` — it already compiles and runs against this same schema fragment.

## `src/agent/introspect.js`

```js
      enterAt: "fraction 0-1 of the scene's duration (default 0), OR a timing anchor object: { relativeToAsset, edge?: 'enter'|'exit', offsetFrames? } to fire relative to an EARLIER asset's edge, { relativeToWord, edge?, offsetFrames? } to fire at a specific spoken word or phrase in the SCENE's own narration (relativeToWord: a word index, exact word text, or array of words/indices for a phrase — no asset needs to display that text), { relativeToAsset, relativeToWord, edge?, offsetFrames? } to read word timing from a specific asset's own resolved words instead, { relativeToCameraAction, offsetFrames? } to fire relative to a camera action, or { offsetPercent } for scene-end-relative percent — same shape as transitionEffect timing anchors",
```

## Result: appears purely at spoken words, no asset dependency

```json
{
  "id": "shock-flash",
  "assetType": "TextHighlight",
  "anchor": { "position": "center" },
  "enterAt": { "relativeToWord": ["stock", "market", "crashed"] },
  "exitAt": { "relativeToWord": ["stock", "market", "crashed"], "edge": "exit", "offsetFrames": 6 }
}
```

`shock-flash` enters the frame "stock" starts and exits 6 frames after "crashed" ends — driven entirely by the scene's real narration alignment, with no `relativeToAsset` and no requirement that any other asset's `contentOverride.text` happen to match that phrase.