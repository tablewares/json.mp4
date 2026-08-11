Here's the edge logic, implemented across the three files it touches. All changes are additive — omitting `anchorEdge`/`fromEdge`/`toEdge` reproduces the exact old center-to-center behavior.

## `src/templating/anchor.js`

`resolveAnchorPoint`'s `followAssetId` branch, changed to accept an optional edge on the target's own box:

```js
  if (typeof anchor?.followAssetId === "string") {
    const target = ctx?.resolvedAssetsById?.[anchor.followAssetId];
    if (!target) {
      throw new Error(
        `Anchor follows asset "${anchor.followAssetId}" but no such asset was resolved ` +
          `in scene "${ctx?.sceneId ?? "?"}". Known: ${
            Object.keys(ctx?.resolvedAssetsById ?? {}).join(", ") || "(none)"
          }. A followed asset must appear earlier in scene.assets than the referencing asset.`,
      );
    }
    const pos = target.resolvedPosition ?? { left: 0, top: 0 };
    const w = target.resolvedStyle?.width ?? 0;
    const h = target.resolvedStyle?.height ?? 0;

    // anchorEdge picks a point on the TARGET's own box (top-left/bottom/etc,
    // the same ANCHOR_ALIGN vocabulary the composition-frame branch below
    // uses) instead of always the target's center. Default "center" means
    // every { followAssetId } anchor authored before this field existed
    // resolves to the identical point it always has.
    const edgeAlign = ANCHOR_ALIGN[anchor.anchorEdge ?? "center"];
    if (!edgeAlign) {
      throw new Error(
        `Unknown anchorEdge "${anchor.anchorEdge}" on a followAssetId anchor. Valid: ${Object.keys(ANCHOR_ALIGN).join(", ")}`,
      );
    }

    return {
      x: pos.left + edgeAlign.x * w + (offsetXPercent / 100) * composition.width,
      y: pos.top + edgeAlign.y * h + (offsetYPercent / 100) * composition.height,
    };
  }
```

And the doc comment above `resolveAnchorPoint`, shape B line, updated to mention it:

```js
 *  B. { followAssetId, anchorEdge?, offsetXPercent, offsetYPercent (... edge) }  — the
 *     camera-anchor "track an asset's center" shape: resolve to the followed
 *     asset's resolved box (center by default, or the point named by
 *     anchorEdge — same ANCHOR_ALIGN vocabulary as `position` below), then
 *     nudge by composition-space % offsets.
```

No other code in `anchor.js` needs to change — `resolveAnchorPoint` still takes a plain object, so this is a pure read of one more optional key.

## `src/pipelines/pipeline2-resolve/resolveRefs.js`

`resolveOneRef`'s connector branch, changed to read `fromEdge`/`toEdge`/offset percents off `content` and pass them through:

```js
  // Connector between two targets — resolve each endpoint through the
  // same `resolveAnchorPoint` resolver as standalone endpoints, then
  // write pixels into content.points. Identical intent to how
  // `carryFrom`/`carryTo` are handed to `TransitionBoilerplate`, just
  // within one scene.
  const fromId = content.fromAssetId;
  const toId = content.toAssetId;
  if (typeof fromId === "string" && typeof toId === "string") {
    requireTarget(byId, fromId, sceneId);
    requireTarget(byId, toId, sceneId);

    // fromEdge/toEdge (optional): which point on the TARGET's own box to
    // anchor to — the same ANCHOR_ALIGN vocabulary a normal asset `anchor`
    // uses (top-left, bottom, center, ...). Omitted = "center", identical
    // to the connector's behavior before this field existed.
    // fromOffsetXPercent/YPercent and toOffsetXPercent/YPercent nudge from
    // the resolved edge point in composition-space %, the same convention
    // every other anchor offset in the framework already uses.
    const fromPt = resolveEndpoint(
      {
        followAssetId: fromId,
        anchorEdge: content.fromEdge,
        offsetXPercent: content.fromOffsetXPercent,
        offsetYPercent: content.fromOffsetYPercent,
      },
      composition,
      { byId, sceneId },
    );
    const toPt = resolveEndpoint(
      {
        followAssetId: toId,
        anchorEdge: content.toEdge,
        offsetXPercent: content.toOffsetXPercent,
        offsetYPercent: content.toOffsetYPercent,
      },
      composition,
      { byId, sceneId },
    );
    asset.content = {
      ...content,
      from: fromPt,
      to: toPt,
      points: [fromPt, toPt],
    };
    return asset;
  }
```

`resolveEndpoint` itself needs no change — it already forwards the whole spec object straight into `resolveAnchorPoint`, so `anchorEdge` rides along for free. That also means the **standalone `content.points` path** (non-connector) gets edge support automatically: an author can write `{"followAssetId":"hero-image","anchorEdge":"top"}` as a raw points[] item today with zero further code changes.

## `studio/assets/WavyLine/manifest.json`

New/changed keys in `contentOverrideSchema`:

```json
  "contentOverrideSchema": {
    "type": "object",
    "properties": {
      "fromAssetId": {
        "type": "string",
        "description": "Connector shorthand: id of an asset resolved earlier in this scene. Pass 2 books `{ followAssetId: <fromAssetId>, anchorEdge: fromEdge }` for endpoint[0] and resolves it through the same anchor templating resolver the rest of the framework uses (src/templating/anchor.js). See `points` below for the full endpoint vocabulary. Overrides explicit `points[0]`."
      },
      "fromEdge": {
        "type": "string",
        "enum": ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
        "description": "Which point on the fromAssetId target's OWN box the line originates from. Default 'center'. Use e.g. 'bottom' to leave from the bottom edge of a text block instead of cutting through its middle."
      },
      "fromOffsetXPercent": { "type": "number", "default": 0, "description": "Composition-space % nudge applied after resolving fromEdge." },
      "fromOffsetYPercent": { "type": "number", "default": 0, "description": "Composition-space % nudge applied after resolving fromEdge." },
      "toAssetId": {
        "type": "string",
        "description": "Connector shorthand: id of an asset resolved earlier in this scene. Pass 2 books `{ followAssetId: <toAssetId>, anchorEdge: toEdge }` for endpoint[1] and resolves it through the anchor templating resolver (src/templating/anchor.js). Overrides explicit `points[1]`."
      },
      "toEdge": {
        "type": "string",
        "enum": ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
        "description": "Which point on the toAssetId target's OWN box the line arrives at. Default 'center'."
      },
      "toOffsetXPercent": { "type": "number", "default": 0, "description": "Composition-space % nudge applied after resolving toEdge." },
      "toOffsetYPercent": { "type": "number", "default": 0, "description": "Composition-space % nudge applied after resolving toEdge." },
      "points": {
        "type": "array",
        "description": "Two endpoints. Each item is authored in the anchor templating vocabulary (the SAME shape `cameraAnchor` accepts in camera.schema.json), NOT exact composition-space pixels:\n  - { position: 'top-left'|'center'|... , offsetXPercent?, offsetYPercent? } — named composition-frame corner + composition-space % nudge.\n  - { followAssetId, anchorEdge?, offsetXPercent?, offsetYPercent? } — follow another asset's resolved box; anchorEdge picks WHICH point on that box (default 'center'), then nudge by composition-space %.\n  - { x, y } — raw composition-space pixels (backward-compatible passthrough; not the preferred form).\nignored for an item when the matching fromAssetId/toAssetId is set. Resolved to pixels by pass 2 before the renderer mounts.",
        "items": {
          "type": "object",
          "properties": {
            "position": { "type": "string", "enum": ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"] },
            "followAssetId": { "type": "string" },
            "anchorEdge": {
              "type": "string",
              "enum": ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
              "description": "Only used with followAssetId. Which point on the followed asset's box to resolve to. Default 'center'."
            },
            "offsetXPercent": { "type": "number", "default": 0 },
            "offsetYPercent": { "type": "number", "default": 0 },
            "x": { "type": "number" },
            "y": { "type": "number" }
          }
        }
      }
    }
  },
```

## Result for your original use case

A line from a KineticText caption to an ImageReveal that doesn't stab through either box:

```json
{
  "assetType": "WavyLine",
  "anchor": { "position": "center" },
  "contentOverride": {
    "fromAssetId": "caption-1",
    "fromEdge": "bottom",
    "toAssetId": "hero-image",
    "toEdge": "top-left",
    "toOffsetXPercent": 2
  },
  "z": 5
}
```

No pixels guessed anywhere. `z: 5` above is still manual — the "default z to above both connected targets" and "warn on cross-depth-plane connectors" pieces from before are separate, smaller follow-ups in `ProjectBuilder.addAsset` and `overlap_warn.js` respectively if you want those next.