# Physics

Physics is a bolt-on simulation powered by Matter.js. To remain compatible with Remotion's parallel/out-of-order frame rendering, the simulation is **baked** at authoring-time (Pipeline 2) into a per-frame track of positions and rotations. At render-time (Pipeline 3), the renderer simply performs a fast array lookup for the current frame.

## 1. Scene-level Physics
Configure the world simulation globally in the scene manifest.

**Field:** `physics` (Top-level scene property)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `gravity` | `vector2` | `{ x: 0, y: 1 }` | Gravity vector. `{ 0, 1 }` is standard earth gravity. |
| `gravityScale` | `number` | `0.001` | Scale for the gravity vector. |
| `iterations` | `integer` | `6` | Solver iterations for constraints/position/velocity. Higher = more stable. |
| `startFrame` | `integer` | `0` | Frame the simulation begins stepping. Before this, all bodies stay at their initial resolved positions. |

**Example:**
```json
{
  "id": "physics-demo",
  "physics": { 
    "gravity": { "x": 0, "y": 1 },
    "startFrame": 10
  },
  "assets": [...]
}
```

---

## 2. Asset-level Physics
Attach physics to an asset to make it interact with the world. Note that physics reads and writes to the asset's "box" (resolvedPosition + width/height).

**Field:** `physics` (Inside `assets[].items`)

### Body Types
- `static`: An immovable anchor (ledge, wall, floor). It does not move under gravity and receives no baked track.
- `dynamic`: A simulated body that falls, bounces, and collides. It receives a baked `resolvedPhysics.frames[]` track.

### Properties

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `bodyType` | `enum` | **Required** | `"dynamic"` or `"static"`. |
| `shape` | `enum` | `"rectangle"` | `"rectangle"` or `"circle"`. |
| `radius` | `number` | `min(w,h)/2` | Radius for circle shapes in px. |
| `restitution` | `number` | `0.6` | Bounciness (0 = no bounce, 1 = elastic). |
| `friction` | `number` | `0.1` | Surface friction. |
| `frictionAir` | `number` | `0.01` | Air resistance. `0` allows a body to fall/slide forever without damping. |
| `density` | `number` | `0.001` | Mass density. |
| `initialVelocity`| `vector2` | `{ x: 0, y: 0 }` | Start velocity in px/frame. |
| `initialAngularVelocity` | `number` | `0` | Start rotation speed in radians/frame. |
| `angle` | `number` | `0` | Starting rotation in degrees. |
| `fixedRotation` | `boolean` | `false` | If `true`, the body never rotates (infinite inertia). |
| `collidesWith` | `string[]` | `all` | List of asset IDs in the same scene this body may collide with. Omit to collide with everything. |

---

## 3. Examples

### Static Ledge
An immovable platform that other objects bounce off of.
```json
"physics": { 
    "bodyType": "static", 
    "shape": "rectangle", 
    "restitution": 0.6, 
    "friction": 0.2 
}
```

### Dynamic Bouncing Ball
A ball that falls under gravity and bounces elastically.
```json
"physics": {
    "bodyType": "dynamic",
    "shape": "circle",
    "restitution": 0.75,
    "friction": 0.05,
    "frictionAir": 0
}
```

### Fixed-Rotation Card
A body that slides and bounces but always stays upright.
```json
"physics": {
    "bodyType": "dynamic",
    "fixedRotation": true,
    "restitution": 0.3
}
```
## 8. Demo scene — drop + bounce off an anchored ledge
include this in the sceen for global gravity. 
```json
{
  "physics": { "gravity": { "x": 0, "y": 1 } 
  }
}
```

## 9. Constraints — pivots, hinges, and pendulum arms

A free body (dynamic + force/magnet) can accelerate toward things but can't be
RIGIDLY PINNED to swing around a fixed point — that needs a constraint.
`scene.physics.constraints[]` is a point-to-point joint (Matter.Constraint)
linking two physics bodies, or one body to a fixed world point. This is what
makes a balance scale, a see-saw, or a pendulum actually work: the pinned
point stays fixed while the body remains free to ROTATE about it.

**Field:** `physics.constraints` (array, on the SCENE-level `physics` block,
sibling to `gravity`/`startFrame` — not on an individual asset's `physics`).

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `bodyA` | `string` | **Required** | Asset id (this scene) of the first body. Must carry its own `physics` block. |
| `pointA` | `vector2` | `{x:0,y:0}` | LOCAL offset in px from bodyA's own center (not world-space, not a percent). `{x:0,y:0}` = pin at the body's own center. |
| `bodyB` | `string` | *(omit for a fixed anchor)* | Asset id of the second body. Omitting `bodyB` anchors `bodyA` to a fixed WORLD point instead — the common "pin this beam to an immovable fulcrum" shape. |
| `pointB` | `vector2` | `{x:0,y:0}` | When `bodyB` is set: LOCAL offset from bodyB's center. When `bodyB` is omitted: an ABSOLUTE world/composition-px point. |
| `length` | `number` | `0` | Rest distance between pointA/pointB. `0` = pins the two points together (rigid hinge — free to rotate). Nonzero = a rigid rod holding that distance (pendulum arm). |
| `stiffness` | `number` | `1` | `1` = rigid pivot (correct for a hinge). `<1` = springy/stretchy tether — rarely what a pivot wants. |
| `damping` | `number` | `0` | Resists oscillation. Only meaningful when `stiffness < 1`. |

### Balance-scale recipe (beam pinned at center, two payloads pinned at each end)

```json
"physics": {
  "gravity": { "x": 0, "y": 0.6 },
  "iterations": 20,
  "constraints": [
    { "bodyA": "beam", "pointA": { "x": 0, "y": 0 }, "bodyB": "fulcrum", "pointB": { "x": 0, "y": 0 } },
    { "bodyA": "beam", "pointA": { "x": -320, "y": 0 }, "bodyB": "portfolio", "pointB": { "x": 0, "y": 0 } },
    { "bodyA": "beam", "pointA": { "x": 320, "y": 0 }, "bodyB": "paycheck", "pointB": { "x": 0, "y": 0 } }
  ]
}
```

`fulcrum` is a `static` body (never moves) at the beam's pivot point. `beam`
is a `dynamic` rectangle pinned to the fulcrum at its OWN center — free to
rotate, position fixed. `portfolio`/`paycheck` are `dynamic` circles pinned
to points on the beam's own local coordinate space (`{x:-320,y:0}` = the
beam's left end, given a 640px-wide beam) — as they fall under gravity they
drag their pinned end of the beam down with them, and the heavier one wins.
Worked, rendered case: `studio/manifest/balance-scale-demo/` — beam starts
level (`rotateDeg ≈ 0`), tilts progressively as the heavier `portfolio` body
(density 0.006 vs `paycheck`'s 0.0015) pulls its side down, settles around
`-30°`. Verify a pivot is actually rigid (not silently degrading into a free
body) by checking the pinned body's center distance from its anchor point
across all baked frames — it should stay ~0px regardless of rotation.

### Pitfalls
- **`constraints` lives on `scene.physics`, not `asset.physics`.** Each
  entry references bodies by id but the array itself is scene-level — same
  place `gravity`/`startFrame` live.
- **Both `bodyA` and (if set) `bodyB` must carry their own `physics` block
  in the SAME scene**, resolved before constraints are built. Referencing an
  asset with no physics throws `constraints references bodyA "..." which
  was not found among this scene's physics bodies`.
- **A wobbly/unstable spin instead of a clean tip usually means gravity or
  density is too aggressive for the beam's mass**, not a broken constraint —
  raise `scene.physics.iterations` (try 20) and/or `frictionAir` on the
  dynamic bodies, or lower `gravity.y`, before suspecting the pivot itself.
- **`length: 0` is a hinge (rotates freely); a nonzero `length` is a rigid
  ROD** (the two points stay exactly that far apart, like a pendulum arm) —
  don't reach for a nonzero length expecting spring behavior; use `stiffness
  < 1` for that instead.

## 4. Important Notes
- **Clipping:** Assets that fall below the composition bounds are naturally clipped by the `AbsoluteFill` overflow: "hidden" logic.
- **Timing:** `enterAt` and `exitAt` control opacity and entrance motion, but **not** the physics simulation. The physics track is indexed by absolute scene-local frames.
- **Overlap Warnings:** The framework's overlap detection currently checks static `resolvedPosition`. Dynamic bodies will likely trigger false-positive overlap warnings if their rest position overlaps their target.
