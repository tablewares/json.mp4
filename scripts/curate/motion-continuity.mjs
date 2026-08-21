#!/usr/bin/env node
/**
 * motion-continuity.mjs — randomized per-scene motion-continuity generator,
 * same shape as scripts/curate/scene-quota.mjs (seeded PRNG, walks
 * scene-by-scene, prints a plan not manifest JSON). Where scene-quota rolls
 * WHAT a scene needs, this rolls HOW an asset should move through the cut
 * between scenes: it fits one continuous parabola across the whole
 * timeline, samples its velocity at each scene boundary, and translates
 * that velocity into src/motion/motion.js's exact vocabulary — the
 * `up`/`down`/`left`/`right` direction aliases plus a `distancePx`
 * magnitude tier ("more" = bigger distancePx, same direction).
 *
 * Why a parabola: a single quadratic across the whole scene sequence gives
 * a physically coherent arc (ease in, apex, ease out) instead of picking a
 * random direction per scene — consecutive scenes naturally share velocity
 * sign near the cut, which is what makes an exit motion and the next
 * scene's entrance motion read as one continuous move instead of two
 * unrelated fades. Feed the output straight into `motion.in`/`motion.out`
 * on `add-asset`/`update-asset` (see scripts/curate/components/motion.md).
 *
 * CAMERA (added): the same per-scene velocity sample also drives a
 * `scene.camera` block (src/templating/camera.js contract — `actions[]` of
 * `{at, anchor, zoomPercent, easing}` + `easeZoom`). This is a SECOND
 * consumer of the identical parabola sample the asset motion already
 * reads — same axis, same direction, same intensity tier — so the camera
 * swooshes in the same direction the assets are sliding, landing centered
 * on a focus asset via `anchor.followAssetId`, instead of an unrelated
 * independent camera move.
 *
 * Sequenced to the focus asset's actual appearance, not scene start.
 * THREE actions per scene, not two: `at:0` AND `at:focusEnterAt` both hold
 * the SAME pulled-back anchor/zoom (no interpolation happens between two
 * identical keyframes) — the camera sits still through the scene's opening
 * beat exactly as long as the focus asset hasn't shown up yet. Only once
 * `focusEnterAt` arrives does the THIRD action (`at: min(focusEnterAt +
 * settleWindow, 1)`) swoosh the camera to a SUBTLE zoomed-in
 * (106-128%, intensity-scaled, never a dramatic push), `followAssetId`-
 * centered settle, `easing: easeOut` for the fast-launch/settle "swoosh"
 * read (see scripts/curate/components/parallax.md's `camera.swooshSnap`
 * pattern), `easeZoom: true` so the zoom eases continuously across that
 * final leg instead of snapping. `focusEnterAt` defaults to a sampled
 * value in [0.2, 0.45] per scene (matching this repo's own stagger
 * convention for a scene's hero visual — see scripts/curate/components/
 * motion.md's worked scenes) unless `--focus-enter-ats` supplies the
 * asset's REAL `enterAt` fraction per scene. The focus asset id is not
 * knowable to this generator (it doesn't read a manifest) — each scene
 * emits a `<FOCUS_ASSET_ID>` placeholder token; substitute the scene's
 * actual hero asset id before calling `scene <id> camera '<json>'` (see
 * scripts/SKILL.md).
 *
 * NOT EVERY SCENE gets a camera move. `--camera-chance` (default 0.65)
 * rolls per scene via the same seeded PRNG — some scenes are plain
 * motion-only cuts with the camera left static, so a whole sequence
 * doesn't feel like it's swooshing on every single beat. `scenes[i].camera`
 * is simply absent (no key) on a scene that rolled no camera work; check
 * for its presence before applying. `--camera-chance 1` forces every scene
 * to get one (the old always-on behavior).
 *
 * Implementation is split across scripts/curate/lib/ so new curve shapes,
 * axes, or a second camera-plan style can be added without re-reading this
 * whole file:
 *   lib/prng.mjs             — mulberry32 + randInt/pick/chance
 *   lib/parabola.mjs         — the single arc/dip position+velocity fit
 *   lib/motion-directive.mjs — velocity -> motion.js direction/distancePx/alias
 *   lib/camera-plan.mjs      — velocity sample -> scene.camera actions[]
 *   lib/format-plan.mjs      — JSON/Markdown rendering of the result
 * This file is just: parse args, walk scene boundaries, assemble `result`.
 *
 * Usage:
 *   node scripts/curate/motion-continuity.mjs
 *   node scripts/curate/motion-continuity.mjs --scenes 6 --axis vertical
 *   node scripts/curate/motion-continuity.mjs --seed 42 --format md
 *   node scripts/curate/motion-continuity.mjs --axis horizontal --curve dip --amplitude 220
 *   node scripts/curate/motion-continuity.mjs --no-camera             # motion only, old behavior
 *   node scripts/curate/motion-continuity.mjs --camera-chance 1       # force every scene to get a camera move
 *   node scripts/curate/motion-continuity.mjs --focus-asset-ids heroImg,tokenImg,robotImg
 *   node scripts/curate/motion-continuity.mjs --focus-enter-ats 0.3,0.35,0.25   # real per-scene enterAt fractions
 *
 * Flags:
 *   --scenes N     scene count (default: random 4-7, matches scene-quota's sweet spot)
 *   --seed N       integer seed for reproducible output (default: random)
 *   --format json|md  output shape (default: json)
 *   --axis vertical|horizontal|auto   which motion.js direction pair the parabola drives
 *                  (vertical -> up/down aliases, horizontal -> left/right aliases; default: auto)
 *   --curve arc|dip|auto   arc = hump (rises then falls, apex mid-timeline),
 *                  dip = valley (falls then rises). default: auto
 *   --amplitude N  peak displacement in px driving distancePx scaling (default: random 60-260)
 *   --fps N        composition fps, used only to report frame-ish duration hints (default 30)
 *   --camera / --no-camera   allow scene.camera swoosh+zoom generation at all (default: on;
 *                  --no-camera is a hard override — no scene gets one, camera-chance is ignored)
 *   --camera-chance N   0-1 probability EACH scene independently gets a camera move (default 0.65).
 *                  Rolled through the same seeded PRNG, so it's reproducible with --seed. 1 = every
 *                  scene (old always-on behavior); 0 = no scene (same effect as --no-camera).
 *   --focus-asset-ids a,b,c  comma list of real asset ids, one per scene, substituted into
 *                  camera.actions[-1].anchor.followAssetId in place of the placeholder token
 *   --focus-enter-ats N,N,N  comma list of real per-scene enterAt fractions [0,1] for each scene's
 *                  focus asset — when the asset actually appears. Default: a sampled placeholder in
 *                  [0.2, 0.45] per scene (same stagger range this repo's own hero-asset scenes use).
 *                  Supply the asset's REAL enterAt once known so the swoosh timing matches exactly.
 *   --zoom-min N   subtle-zoom floor, percent (default 106 — just barely a push)
 *   --zoom-max N   subtle-zoom ceiling, percent (default 128 — still reads as "subtle", not a punch-in)
 */
import { createRng } from "./lib/prng.mjs";
import { fitParabola } from "./lib/parabola.mjs";
import { velocityToDirective, inAlias, outAlias } from "./lib/motion-directive.mjs";
import { cameraForScene } from "./lib/camera-plan.mjs";
import { formatJson, formatMarkdown } from "./lib/format-plan.mjs";

function parseArgs(argv) {
  const out = {
    scenes: null,
    seed: null,
    format: "json",
    axis: "auto",
    curve: "auto",
    amplitude: null,
    fps: 30,
    camera: true,
    cameraChance: 0.65,
    focusAssetIds: null,
    focusEnterAts: null,
    zoomMin: 106,
    zoomMax: 128,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenes") out.scenes = parseInt(argv[++i], 10);
    else if (a === "--seed") out.seed = parseInt(argv[++i], 10);
    else if (a === "--format") out.format = argv[++i];
    else if (a === "--axis") out.axis = argv[++i];
    else if (a === "--curve") out.curve = argv[++i];
    else if (a === "--amplitude") out.amplitude = parseFloat(argv[++i]);
    else if (a === "--fps") out.fps = parseInt(argv[++i], 10);
    else if (a === "--camera") out.camera = true;
    else if (a === "--no-camera") out.camera = false;
    else if (a === "--camera-chance") out.cameraChance = parseFloat(argv[++i]);
    else if (a === "--focus-asset-ids") out.focusAssetIds = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--focus-enter-ats") out.focusEnterAts = argv[++i].split(",").map((s) => parseFloat(s.trim()));
    else if (a === "--zoom-min") out.zoomMin = parseFloat(argv[++i]);
    else if (a === "--zoom-max") out.zoomMax = parseFloat(argv[++i]);
  }
  return out;
}

function buildPlan(args, seed) {
  const { rnd, randInt, pick, chance } = createRng(seed);

  const axis = args.axis === "auto" ? pick(["vertical", "horizontal"]) : args.axis;
  if (!["vertical", "horizontal"].includes(axis)) {
    throw new Error(`--axis must be vertical|horizontal|auto, got "${args.axis}"`);
  }
  const curveShape = args.curve === "auto" ? pick(["arc", "dip"]) : args.curve;
  if (!["arc", "dip"].includes(curveShape)) {
    throw new Error(`--curve must be arc|dip|auto, got "${args.curve}"`);
  }
  const amplitude = args.amplitude ?? randInt(60, 260);
  const vertexT = 0.25 + rnd() * 0.5; // apex/trough sits somewhere in the middle third-ish of the timeline

  const { position, velocity } = fitParabola({ curveShape, amplitude, vertexT });

  // Walk scene boundaries, sample entry/exit velocity per scene, and
  // verify continuity: scene i's exit direction should match scene i+1's
  // entry direction (both moving the same way through the cut).
  const sceneCount = args.scenes ?? randInt(4, 7);

  // peak |velocity| over the sampled boundary set, used to normalize
  // distancePx scaling consistently across the whole plan.
  const boundaryTs = Array.from({ length: sceneCount + 1 }, (_, i) => i / sceneCount);
  const boundaryVelocities = boundaryTs.map(velocity);
  const vMax = Math.max(...boundaryVelocities.map(Math.abs), 1e-6);

  const scenes = [];
  for (let i = 0; i < sceneCount; i++) {
    const tEnter = boundaryTs[i];
    const tExit = boundaryTs[i + 1];
    const vEnter = velocity(tEnter);
    const vExit = velocity(tExit);
    const entry = velocityToDirective(vEnter, vMax, axis);
    const exit = velocityToDirective(vExit, vMax, axis);

    scenes.push({
      sceneIndex: i + 1,
      sceneId: `s${i + 1}`,
      t: { enter: Math.round(tEnter * 1000) / 1000, exit: Math.round(tExit * 1000) / 1000 },
      position: {
        enter: Math.round(position(tEnter) * 10) / 10,
        exit: Math.round(position(tExit) * 10) / 10,
      },
      motion: {
        in: { alias: inAlias(entry.direction), distancePx: entry.distancePx },
        out: { alias: outAlias(exit.direction), distancePx: exit.distancePx },
      },
      intensity: { in: entry.intensity, out: exit.intensity },
      // Not every scene gets a camera move — rolled independently per scene
      // through the same seeded PRNG (reproducible with --seed). A scene
      // that doesn't roll simply has no `camera` key at all; a plain
      // motion-only cut, camera left static for that beat.
      ...(args.camera && chance(args.cameraChance) ? { camera: cameraForScene(entry, i, args, rnd) } : {}),
    });
  }

  // continuity check: exit direction of scene i vs entry direction of
  // scene i+1 (same underlying direction word means the cut reads as one
  // continuous move, not two independently-chosen motions).
  const continuityLinks = [];
  for (let i = 0; i < scenes.length - 1; i++) {
    const outDir = scenes[i].motion.out.alias.replace("fadeOut", "").toLowerCase();
    const inDir = scenes[i + 1].motion.in.alias.replace("fade", "").toLowerCase();
    continuityLinks.push({
      fromScene: scenes[i].sceneId,
      toScene: scenes[i + 1].sceneId,
      continuous: outDir === inDir,
      outDirection: outDir,
      inDirection: inDir,
    });
  }

  return {
    generator: "scripts/curate/motion-continuity.mjs",
    seed,
    axis,
    curveShape,
    amplitudePx: amplitude,
    vertexT: Math.round(vertexT * 1000) / 1000,
    sceneCount,
    cameraEnabled: args.camera,
    cameraChance: args.camera ? args.cameraChance : 0,
    scenesWithCamera: scenes.filter((sc) => sc.camera).length,
    scenes,
    continuityLinks,
    usageNote:
      'Apply per-scene motion via add-asset/update-asset on the SAME carried assetId across the cut (see scripts/curate/to_be_indexed/recipes/continuity-carry.md): `motion: { in: <scenes[i].motion.in>, out: <scenes[i].motion.out> }`. "more" intensity just raises distancePx on the same direction alias — it is not a fifth motion.js direction.' +
      (args.camera
        ? ' Apply camera via `node scripts/cli.js scene <sceneId> camera \'<scenes[i].camera>\'` ONLY on scenes where `scenes[i].camera` is present — not every scene rolls one (see cameraChance). Replace the "<FOCUS_ASSET_ID>" placeholder (or pass --focus-asset-ids at generation time) with the scene\'s real hero asset id first; the final action\'s `anchor.followAssetId` must resolve to an asset authored earlier in that scene\'s assets[] or resolve throws. The camera holds pulled-back and static until `camera.focusEnterAt` (the focus asset\'s own entrance fraction — pass --focus-enter-ats with the asset\'s real enterAt for exact sync), THEN swooshes to a zoomed-in, followAssetId-centered settle — same direction/intensity sample the asset motion already used, so the camera push agrees with the asset slide instead of fighting it, and never swooshes toward something that hasn\'t appeared yet.'
        : ""),
    motionRef: "src/motion/motion.js (resolveMotion / computeMotionTransform) — direction vocabulary and distancePx default are read straight from that module's DIRECTION_OFFSETS / DEFAULT_DISTANCE_PX.",
    cameraRef: args.camera
      ? "src/templating/camera.js (resolveCamera / resolveCameraTransform) — actions[]/easeZoom/easing vocabulary and followAssetId anchor resolution read straight from that module's contract; scripts/curate/components/parallax.md documents the swoosh/zoom authoring surface this reuses."
      : undefined,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const seed = args.seed ?? Math.floor(Math.random() * 1e9);
  const result = buildPlan(args, seed);
  console.log(args.format === "md" ? formatMarkdown(result) : formatJson(result));
}

main();
