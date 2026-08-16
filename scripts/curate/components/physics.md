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

## 4. Important Notes
- **Clipping:** Assets that fall below the composition bounds are naturally clipped by the `AbsoluteFill` overflow: "hidden" logic.
- **Timing:** `enterAt` and `exitAt` control opacity and entrance motion, but **not** the physics simulation. The physics track is indexed by absolute scene-local frames.
- **Overlap Warnings:** The framework's overlap detection currently checks static `resolvedPosition`. Dynamic bodies will likely trigger false-positive overlap warnings if their rest position overlaps their target.
