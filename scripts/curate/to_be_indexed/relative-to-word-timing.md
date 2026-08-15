# Feature: Word-Level Timing Anchors (`relativeToWord`)

This update enables timing anchors to be locked to specific spoken words within a `KineticText` asset, rather than just the overall entrance or exit of the asset. This allows for precise synchronization between visual effects (like highlights or flashes) and the actual audio timestamps produced by TTS/WhisperX.

## Changes

### 1. Timing Logic (`src/timing/effectTiming.js`)
- Updated `resolveAssetRelative` to support `relativeToWord`.
- If `relativeToWord` is provided:
    - It validates that the target asset has resolved word-level timing (currently only `KineticText` assets that match the scene's narration).
    - It supports both **index-based** (integer) and **text-based** (string) word lookups.
    - It uses `startFrame` or `endFrame` of the specific word based on the `edge` property (defaulting to `startFrame`).
- Retains original behavior for standard asset-relative anchors.

### 2. Schema Validation (`src/pipelines/pipeline1-validate/schema/shared.schema.json`)
- Added `relativeToWord` to the `timingAnchor` definition.
- Defined as a `oneOf` (integer or string) to allow flexible word targeting.
- Added documentation in the schema to guide agent authoring.

### 3. Agent Introspection (`src/agent/introspect.js`)
- Updated `describeSceneEnvelope` for the `enterAt` field.
- Added explicit documentation explaining how to use `{ relativeToAsset, relativeToWord, edge, offsetFrames }` so the AI agent can leverage this feature when authoring manifests.

## Usage Example

To make an effect fire exactly when the word "recession" is spoken in an asset named "caption-1":

```json
{
  "id": "highlight-word",
  "assetType": "TextHighlight",
  "enterAt": { 
    "relativeToAsset": "caption-1", 
    "relativeToWord": "recession" 
  },
  "exitAt": { 
    "relativeToAsset": "caption-1", 
    "relativeToWord": "recession", 
    "edge": "exit", 
    "offsetFrames": 4 
  }
}
```
