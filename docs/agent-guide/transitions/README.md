# transitions/

Same split as `../assets/`:

1. **Using a shipped transition** in a scene — see `using-transitions.md`.
2. **Authoring a new transition** — see `authoring-new.md`.

Transitions sit at scene boundaries. pipeline2 collects the outgoing +
incoming scene context and hands it to a transition component, which
decides how to hand off (default fade+slide) or carry a specific asset
across the cut (`slideContinuity`).

The authored-JSON contract (the `transitionOut` block on a scene) lives
in `../reference/scene.md`. This folder covers the component side.
