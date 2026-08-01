# Anchor + nudge, not raw pixels

Assets are never given raw x/y. They get:

```json
{ "position": "top-left", "offsetXPercent": 6, "offsetYPercent": 10 }
```

- `position` — one of 9 anchor points (4 corners, 4 edges, center).
- `offsetXPercent` / `offsetYPercent` — signed percent of the composition
  dimensions, nudging the anchor point.

`src/templating/anchor.js` resolves this + the asset's own declared size
into final pixel coordinates at render time, pulling the box back so the
*anchor point* (not the top-left corner) lands where requested.

Why: agents reason in "corner + nudge", not pixels — easier to produce
correctly and impossible to get subtly off-screen. You never author or
see raw pixel coordinates in a scene file.
