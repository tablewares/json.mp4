#!/usr/bin/env node
/**
 * scene-quota.mjs — randomized per-scene requirement generator for
 * short-form (vertical, ~15-60s) content planning. Walks scene-by-scene
 * and prints a REQUIREMENTS list per scene (not manifest JSON) — images
 * needed, svg needed, estimated duration, rough asset count, sourcing
 * hint (Pexels vs Yandex), composition budget from
 * scripts/curate/composition/rules.md. Feed the output to a human or an
 * authoring pass; it does not touch studio/manifest/** itself.
 *
 * Usage:
 *   node scripts/curate/scene-quota.mjs
 *   node scripts/curate/scene-quota.mjs --scenes 6 --duration 30
 *   node scripts/curate/scene-quota.mjs --seed 42 --format md
 *   node scripts/curate/scene-quota.mjs --vertical false   # 1920x1080 instead of 1080x1920
 *
 * Flags:
 *   --scenes N       scene count (default: random 4-7, short-form sweet spot)
 *   --duration N     target total duration in seconds (default: random 20-45)
 *   --seed N         integer seed for reproducible output (default: random)
 *   --format json|md output shape (default: json)
 *   --vertical bool  1080x1920 (true, default) vs 1920x1080 (false)
 *   --fps N          composition fps (default 30)
 */
import { writeFileSync } from "fs";

// ---------------------------------------------------------------------
// seeded PRNG (mulberry32) — deterministic when --seed is passed, so a
// generated quota is reproducible/shareable without re-rolling.
// ---------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv) {
  const out = { scenes: null, duration: null, seed: null, format: "json", vertical: true, fps: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenes") out.scenes = parseInt(argv[++i], 10);
    else if (a === "--duration") out.duration = parseFloat(argv[++i]);
    else if (a === "--seed") out.seed = parseInt(argv[++i], 10);
    else if (a === "--format") out.format = argv[++i];
    else if (a === "--vertical") out.vertical = argv[++i] !== "false";
    else if (a === "--fps") out.fps = parseInt(argv[++i], 10);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const seed = args.seed ?? Math.floor(Math.random() * 1e9);
const rnd = mulberry32(seed);

function randInt(min, max) {
  // inclusive both ends
  return Math.floor(rnd() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}
function chance(p) {
  return rnd() < p;
}

// ---------------------------------------------------------------------
// short-form scene arc — a real short lives or dies on the first 1-3s
// (hook) and needs a clean landing (cta/outro). Roles carry duration
// WEIGHTS, not fixed seconds — total gets normalized to --duration.
// ---------------------------------------------------------------------
const ARC_TEMPLATES = {
  // scenes: 4 -> hook, context, payoff, cta
  4: ["hook", "context", "payoff", "cta"],
  // scenes: 5 -> hook, context, build, payoff, cta
  5: ["hook", "context", "build", "payoff", "cta"],
  // scenes: 6 -> hook, context, build, build, payoff, cta
  6: ["hook", "context", "build", "build", "payoff", "cta"],
  // scenes: 7 -> hook, context, build, build, build, payoff, cta
  7: ["hook", "context", "build", "build", "build", "payoff", "cta"],
};

const ROLE_WEIGHTS = {
  hook: 0.7, // short and sharp — grab attention fast
  context: 1.0,
  build: 1.1,
  payoff: 1.3, // the beat that lands the point gets more air
  cta: 0.8,
};

// Composition budget table — mirrors scripts/curate/composition/rules.md
// rule 1 (size scales inversely with asset count). Used to pick a
// plausible assetCount + per-asset size hint for the scene's role.
const ASSET_COUNT_BUDGET = {
  1: { perAssetWidthPx: "1600-1920 (full-bleed OK)", placement: "anchor.position: center, zero offset" },
  2: { perAssetWidthPx: "700-900", placement: "split left/right or top/bottom, symmetric offsets" },
  3: { perAssetWidthPx: "450-600", placement: "one row or L-shape band, equal gaps" },
  4: { perAssetWidthPx: "380-480", placement: "2x2 grid or vertical stack, tightest margins" },
};

// Per-role bias on how many on-screen assets a beat WANTS (rule 2: center
// is priority, hook/payoff/cta stay single-focus; context/build carry the
// "multi-thing panel" beats).
const ROLE_ASSET_COUNT_WEIGHTS = {
  hook: [1, 1, 1, 2], // almost always one big focal asset (or none — text-only title)
  context: [1, 2, 2, 3],
  build: [1, 2, 3, 3, 4],
  payoff: [1, 1, 2],
  cta: [1, 1],
};

// Requirement pools — what KIND of visual the scene should include, on
// top of the raw count. `svg` = icon/logo overlay via SvgImage
// (scripts/svg/fetch_icon.mjs, offline simple-icons); `image` = stock or
// hyper-specific still (Pexels vs Yandex, see scripts/SKILL.md); `video`
// = full-bleed b-roll clip; `text` = TextBlock/KineticText.
function rollRequirements(role, assetCount) {
  const req = { images: 0, svg: 0, video: 0, text: 0, notes: [] };

  if (role === "hook") {
    // Hook: either a bold title card (text-only) or one striking visual.
    if (assetCount === 1 && chance(0.4)) {
      req.text = 1;
      req.notes.push("title card — TextBlock, no kinetic text, motion: fadeUp");
    } else {
      req.images = 1;
      req.text = chance(0.5) ? 1 : 0;
      req.notes.push("single striking full-bleed image/video, hyper-specific if a named subject is on screen");
    }
    if (chance(0.15)) req.video = 1, req.images = Math.max(0, req.images - (req.video ? 1 : 0));
  } else if (role === "cta") {
    req.text = 1;
    req.notes.push("clear CTA text — centered, large, short-lived on screen");
    if (chance(0.5)) {
      req.svg = 1;
      req.notes.push("brand/logo svg via scripts/svg/fetch_icon.mjs (offline simple-icons)");
    }
  } else {
    // context / build / payoff
    const wantsVideo = chance(role === "payoff" ? 0.35 : 0.25);
    const wantsSvg = chance(assetCount >= 2 ? 0.35 : 0.15);
    let remaining = assetCount;
    if (wantsVideo && remaining > 0) {
      req.video = 1;
      remaining -= 1;
      req.notes.push("full-bleed b-roll cut, revealDirection: none");
    }
    if (wantsSvg && remaining > 0) {
      req.svg = 1;
      remaining -= 1;
      req.notes.push("icon/logo accent via SvgImage (offline simple-icons, no network)");
    }
    req.images = Math.max(0, remaining);
    if (req.images > 0) {
      req.notes.push(
        req.images === 1
          ? "one focal still, hyper-specific if named subject (Yandex) else stock (Pexels)"
          : `${req.images} supporting stills in a shared band/grid, not scattered to all 4 corners`
      );
    }
    // captioning text overlay is common on build/payoff beats even with a visual
    if (chance(0.4)) {
      req.text = 1;
      req.notes.push("caption/kicker text layered over the visual, relativeToWord timed");
    }
  }

  return req;
}

function totalAssetCount(req) {
  return req.images + req.svg + req.video + req.text;
}

function buildScenes(opts) {
  const sceneCount = opts.scenes ?? randInt(4, 7);
  const arc = ARC_TEMPLATES[sceneCount] ?? ARC_TEMPLATES[4].concat(Array(Math.max(0, sceneCount - 4)).fill("build"));
  const roles = arc.slice(0, sceneCount);

  const totalDuration = opts.duration ?? randInt(20, 45);
  const weightSum = roles.reduce((s, r) => s + ROLE_WEIGHTS[r], 0);

  const scenes = roles.map((role, i) => {
    const rawSeconds = (ROLE_WEIGHTS[role] / weightSum) * totalDuration;
    // add mild per-scene jitter so it doesn't look mechanically even,
    // then re-clamp to a sane per-scene floor for short-form pacing
    const jitter = 1 + (rnd() - 0.5) * 0.3; // +/-15%
    let seconds = Math.max(1.2, rawSeconds * jitter);
    seconds = Math.round(seconds * 10) / 10;

    const assetCount = pick(ROLE_ASSET_COUNT_WEIGHTS[role]);
    const budget = ASSET_COUNT_BUDGET[Math.min(4, Math.max(1, assetCount))];
    const requirements = rollRequirements(role, assetCount);

    return {
      sceneIndex: i + 1,
      sceneId: `s${i + 1}_${role}`,
      role,
      estimatedDurationSeconds: seconds,
      estimatedDurationFrames: Math.round(seconds * opts.fps),
      roughAssetCount: totalAssetCount(requirements),
      compositionBudget: {
        assetCountTarget: assetCount,
        perAssetWidthPx: budget.perAssetWidthPx,
        placement: budget.placement,
      },
      requirements: {
        images: requirements.images,
        svg: requirements.svg,
        video: requirements.video,
        text: requirements.text,
      },
      notes: requirements.notes,
    };
  });

  // rescale so estimated durations actually sum to the target (jitter can
  // drift the total a few % off) — proportional adjustment, keep 1 decimal
  const sumSeconds = scenes.reduce((s, sc) => s + sc.estimatedDurationSeconds, 0);
  const scale = totalDuration / sumSeconds;
  let runningFrames = 0;
  for (const sc of scenes) {
    sc.estimatedDurationSeconds = Math.round(sc.estimatedDurationSeconds * scale * 10) / 10;
    sc.estimatedDurationFrames = Math.round(sc.estimatedDurationSeconds * opts.fps);
    runningFrames += sc.estimatedDurationFrames;
  }

  return { scenes, sceneCount, totalDuration, totalFrames: runningFrames };
}

const composition = {
  width: args.vertical ? 1080 : 1920,
  height: args.vertical ? 1920 : 1080,
  fps: args.fps,
  orientation: args.vertical ? "vertical (short-form)" : "horizontal",
};

const built = buildScenes(args);

const result = {
  generator: "scripts/curate/scene-quota.mjs",
  seed,
  composition,
  totalDurationSeconds: built.totalDuration,
  totalDurationFrames: built.totalFrames,
  sceneCount: built.sceneCount,
  scenes: built.scenes,
  sourcingRule:
    "images: Pexels (scripts/pexels/fetch_image.mjs) for stock/generic; Yandex (opencli yandeximages / discovery.mjs collection imageSearch) for hyper-specific named subjects (real people, logos, landmarks). svg: scripts/svg/fetch_icon.mjs, offline simple-icons.",
  compositionRulesRef: "scripts/curate/composition/rules.md — read before authoring; asset count/size budget above is derived from its rule 1 table.",
};

if (args.format === "md") {
  const lines = [];
  lines.push(`# Scene quota — seed ${seed}`);
  lines.push("");
  lines.push(`Composition: ${composition.width}x${composition.height}@${composition.fps}fps (${composition.orientation})`);
  lines.push(`Target: ${built.totalDuration}s total, ${built.sceneCount} scenes (${built.totalFrames} frames)`);
  lines.push("");
  lines.push("| # | id | role | duration | assets | images | svg | video | text | notes |");
  lines.push("|---|----|----|----------|--------|--------|-----|-------|------|-------|");
  for (const sc of built.scenes) {
    lines.push(
      `| ${sc.sceneIndex} | ${sc.sceneId} | ${sc.role} | ${sc.estimatedDurationSeconds}s (${sc.estimatedDurationFrames}fr) | ${sc.roughAssetCount} | ${sc.requirements.images} | ${sc.requirements.svg} | ${sc.requirements.video} | ${sc.requirements.text} | ${sc.notes.join("; ") || "-"} |`
    );
  }
  lines.push("");
  lines.push("Sourcing: " + result.sourcingRule);
  lines.push("Composition rules: " + result.compositionRulesRef);
  console.log(lines.join("\n"));
} else {
  console.log(JSON.stringify(result, null, 2));
}
