Looked at both files — here's my plan: add a `variant` style (`"wavy"` | `"elbow"`), auto-oriented arrowheads for both variants, and a new pure-math `elbowPath.js` module (mirroring `wavyPath.js`'s shape-in/string-out contract) for the 90°-turn connector with edge-out stubs. Everything is additive — old manifests with no `variant`/`arrow*` keys render byte-identical to today.

Key design decisions, so you can sanity-check them against the rest of the pipeline:

- **Arrow direction, wavy variant**: computed by sampling the already-mounted invisible measurement `<path>` with `getPointAtLength` near each end and taking the tangent — this reuses the exact fallback-measurement pattern the file already has for `totalLen`, so it's not a new architectural pattern, just the same DOM-fallback precedent applied to angle instead of length.
- **Arrow direction, elbow variant**: trivial — orthogonal segments only have 4 possible headings, so it's `directionAngle(oppositeDirection(toDir))` with no measurement needed.
- **Stub direction (`fromDir`/`toDir`)**: I did *not* touch `resolveRefs.js` (not uploaded, didn't want to guess-overwrite it). Instead `elbowPath.js` auto-infers direction from the relative position of the two resolved points when not told otherwise — so this works with zero pipeline changes. If you want the stub to honor an author's explicit `fromEdge`/`toEdge` (e.g. force "leaves from the bottom" even when the target happens to be up-and-left), that requires threading `fromEdge`/`toEdge` into `content._path.fromDir`/`toDir` in `resolveRefs.js` — I left a `content._path.fromDir` read as an optional override so this slots in later without touching `WavyLine.jsx` again. Flagging this the same way you flag "known gaps" in your notes, since it's a real one.Now the manifest with the new schema fields:Let me verify the manifest is still valid JSON, then hand the files over.Two new authoring recipes, no schema-breaking changes:

**Arrows on the existing wavy curve** — just add to `styleOverride`:
```json
{ "arrowEnd": true }
```
The angle is sampled off the actual rendered tangent near each endpoint (reusing the same invisible measurement `<path>` the file already mounts for length), so it always matches the real curve — no angle authoring, no per-frame math added to the render component.

**Square-edge / flowchart connector**:
```json
{ "variant": "elbow", "arrowEnd": true, "stubLength": 40, "cornerRadius": 0 }
```
This gives you a straight run out of the source, a 90° turn, then a straight run into the target — direction inferred from where the two points actually sit relative to each other. `routeStyle: "horizontal-first" | "vertical-first"` overrides that inference if you want the stub to always leave sideways or always leave vertically regardless of layout. `cornerRadius` fillets the turns instead of hard corners if you want a softer look while keeping the orthogonal shape.

One real gap worth flagging (matches your "known gap" documentation style): direction is inferred from resolved pixel positions, not from the authored `fromEdge`/`toEdge`. For the common cases ("attach below," "attach to the right") they agree, but if you ever want a stub to leave a specific edge *against* the geometric grain, `resolveRefs.js` needs to write `content._path.fromDir`/`toDir` from `fromEdge`/`toEdge` — `WavyLine.jsx` already checks for that and will prefer it the moment it's there, no further component changes needed.