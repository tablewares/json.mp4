#!/usr/bin/env node
/**
 * visual_review.mjs — standalone post-render visual QA for json.mp4 output.
 *
 * Lives OUTSIDE the render pipeline (scripts/qa/, not scripts/curate or
 * src/pipelines) on purpose: it never touches manifests, never re-renders,
 * only inspects an already-produced .mp4. Safe to run/iterate on without
 * any risk to the compositing engine.
 *
 * What it actually automates (no LLM/vision model required):
 *   1. blackdetect / freezedetect over the whole file — catches dead-black
 *      or stuck-frame segments, a real render bug signature.
 *   2. Per-scene frame sampling (start/mid/end of each scene, from the
 *      resolved manifest's scene durations) OR even time-spaced sampling
 *      if no resolved manifest is passed.
 *   3. Per-sample brightness/uniformity stats (PIL/numpy) — flags
 *      near-solid-color frames, a proxy for "empty composition" or a
 *      missing/broken asset.
 *   4. Cross-scene similarity check — perceptual diff between the last
 *      sampled frame of scene N and first sampled frame of scene N+1, to
 *      confirm a transition actually changed the picture (catches an
 *      authored transitionOut that didn't visibly do anything).
 *   5. A single contact-sheet PNG tiling every sampled frame with a
 *      timestamp/scene label burned in — one image, not N — sized for a
 *      single vision-model pass instead of one call per frame.
 *
 * What it deliberately does NOT do: judge aesthetics, composition quality,
 * overlap, or color harmony. Those need an actual vision-capable reviewer
 * looking at the contact sheet this script produces. The JSON/markdown
 * report ends with the exact next step for that hand-off.
 *
 * Usage:
 *   node scripts/qa/visual_review.mjs <video.mp4> [resolved.json] [--outdir <dir>] [--samples-per-scene N]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function die(msg) {
  console.error(`[visual_review] ERROR: ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, ...opts });
  return r;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--outdir') flags.outdir = argv[++i];
    else if (a === '--samples-per-scene') flags.samplesPerScene = parseInt(argv[++i], 10);
    else positional.push(a);
  }
  return { positional, flags };
}

function ffprobeDuration(video) {
  const r = run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', video,
  ]);
  if (r.status !== 0) die(`ffprobe failed: ${r.stderr}`);
  return parseFloat(r.stdout.trim());
}

function ffprobeSize(video) {
  const r = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate',
    '-of', 'default=noprint_wrappers=1', video,
  ]);
  const out = {};
  for (const line of r.stdout.split('\n')) {
    const [k, v] = line.split('=');
    if (k) out[k.trim()] = v ? v.trim() : v;
  }
  return out;
}

// --- 1. blackdetect / freezedetect -----------------------------------
function detectBlackFrames(video) {
  const r = run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', video,
    '-vf', 'blackdetect=d=0.15:pic_th=0.98:pix_th=0.10',
    '-an', '-f', 'null', '-',
  ]);
  const events = [];
  const re = /black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g;
  let m;
  while ((m = re.exec(r.stderr)) !== null) {
    events.push({ start: parseFloat(m[1]), end: parseFloat(m[2]), duration: parseFloat(m[3]) });
  }
  return events;
}

function detectFreezeFrames(video) {
  const r = run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', video,
    '-vf', 'freezedetect=n=-30dB:d=0.5',
    '-an', '-f', 'null', '-',
  ]);
  const events = [];
  const starts = [...r.stderr.matchAll(/freeze_start: ([\d.]+)/g)].map(m => parseFloat(m[1]));
  const ends = [...r.stderr.matchAll(/freeze_end: ([\d.]+)/g)].map(m => parseFloat(m[1]));
  const durs = [...r.stderr.matchAll(/freeze_duration: ([\d.]+)/g)].map(m => parseFloat(m[1]));
  for (let i = 0; i < starts.length; i++) {
    events.push({ start: starts[i], end: ends[i] ?? null, duration: durs[i] ?? null });
  }
  return events;
}

// --- 2. sample timestamp plan ------------------------------------------
function buildSamplePlan(resolvedManifestPath, totalDuration, samplesPerScene) {
  if (!resolvedManifestPath) {
    // even spacing fallback: one sample every ~1.5s, capped at 40 samples
    const step = Math.max(0.5, totalDuration / 40);
    const plan = [];
    for (let t = 0.15; t < totalDuration - 0.1; t += step) {
      plan.push({ t: +t.toFixed(2), sceneId: null, label: `t=${t.toFixed(1)}s` });
    }
    return plan;
  }
  const resolved = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf8'));
  const fps = resolved.config?.fps ?? 30;
  let cursor = 0;
  const plan = [];
  for (const scene of resolved.scenes ?? []) {
    const durFrames = scene.durationInFrames ?? Math.round((resolved.config?.defaultSceneDurationInFrames ?? 150));
    const durSec = durFrames / fps;
    const fracs = samplesPerScene === 1 ? [0.5]
      : samplesPerScene === 2 ? [0.1, 0.9]
      : [0.08, 0.5, 0.92]; // default 3: near-start, middle, near-end
    for (const f of fracs) {
      const t = cursor + f * durSec;
      plan.push({ t: +t.toFixed(2), sceneId: scene.id, label: `${scene.id}@${f.toFixed(2)}` });
    }
    cursor += durSec;
  }
  return plan;
}

// --- 3. extract frames ---------------------------------------------------
function extractFrame(video, t, outPath) {
  const r = run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(t), '-i', video,
    '-frames:v', '1', '-q:v', '2', outPath,
  ]);
  return r.status === 0 && fs.existsSync(outPath);
}

// --- 4. per-frame stats via a tiny inline python helper -------------------
function frameStats(framePaths) {
  const script = `
import sys, json
from PIL import Image
import numpy as np

out = []
for p in sys.argv[1:]:
    im = Image.open(p).convert('RGB')
    arr = np.asarray(im).astype(np.float32)
    gray = arr.mean(axis=2)
    mean_b = float(gray.mean())
    std_b = float(gray.std())
    # dominant-color coverage: bucket pixels to 16-level per channel, find
    # the most common bucket's share of the frame
    q = (arr // 16).astype(np.int32)
    flat = q[:, :, 0] * 256 + q[:, :, 1] * 16 + q[:, :, 2]
    vals, counts = np.unique(flat, return_counts=True)
    dominant_share = float(counts.max()) / flat.size
    out.append({
        'path': p,
        'meanBrightness': round(mean_b, 2),
        'stdBrightness': round(std_b, 2),
        'dominantColorShare': round(dominant_share, 4),
        'width': im.width,
        'height': im.height,
    })
print(json.dumps(out))
`;
  const r = run('python3', ['-c', script, ...framePaths]);
  if (r.status !== 0) die(`python frame-stats failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// --- 5. simple perceptual diff between two frames (mean abs pixel delta) --
function frameDiff(pathA, pathB) {
  const script = `
import sys, json
from PIL import Image
import numpy as np
a = np.asarray(Image.open(sys.argv[1]).convert('L').resize((64,36))).astype(np.float32)
b = np.asarray(Image.open(sys.argv[2]).convert('L').resize((64,36))).astype(np.float32)
diff = float(np.abs(a - b).mean()) / 255.0
print(json.dumps({'diff': round(diff, 4)}))
`;
  const r = run('python3', ['-c', script, pathA, pathB]);
  if (r.status !== 0) die(`python frame-diff failed: ${r.stderr}`);
  return JSON.parse(r.stdout).diff;
}

// --- 6. contact sheet -------------------------------------------------
function buildContactSheet(framePaths, labels, outPath, cols = 5) {
  const rows = Math.ceil(framePaths.length / cols);
  const tileW = 384;
  const tileH = 216;
  const tmpDir = path.dirname(outPath);
  const labeledPaths = [];
  for (let i = 0; i < framePaths.length; i++) {
    const labeled = path.join(tmpDir, `_labeled_${i}.png`);
    const label = labels[i].replace(/[:'"\\]/g, '').slice(0, 40);
    const r = run('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', framePaths[i],
      '-vf', `scale=${tileW}:${tileH},drawtext=text='${label}':x=6:y=6:fontsize=14:fontcolor=yellow:box=1:boxcolor=black@0.55:boxborderw=4`,
      labeled,
    ]);
    if (r.status !== 0) die(`labeling frame failed: ${r.stderr}`);
    labeledPaths.push(labeled);
  }
  const inputs = labeledPaths.flatMap(p => ['-i', p]);
  const n = labeledPaths.length;
  const filter = `tile=${cols}x${rows}`;
  // pad to a full grid by re-using the last frame if not divisible (tile
  // filter requires exactly cols*rows inputs)
  const needed = cols * rows;
  const finalInputs = [...inputs];
  while (finalInputs.length / 2 < needed) {
    finalInputs.push('-i', labeledPaths[labeledPaths.length - 1]);
  }
  // ffmpeg's `tile` filter packs consecutive FRAMES of a single video
  // stream into a grid — it does not merge N separate input streams on its
  // own. Concat the per-image inputs into one stream first, then tile.
  const concatFilter = Array.from({ length: needed }, (_, i) => `[${i}:v]`).join('')
    + `concat=n=${needed}:v=1:a=0,${filter}`;
  const r2 = run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...finalInputs,
    '-filter_complex', concatFilter,
    outPath,
  ]);
  for (const p of labeledPaths) fs.rmSync(p, { force: true });
  if (r2.status !== 0) die(`contact sheet build failed: ${r2.stderr}`);
  return outPath;
}

// --- main -----------------------------------------------------------------
function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const video = positional[0];
  const resolvedManifestPath = positional[1] || null;
  if (!video || !fs.existsSync(video)) die(`video not found: ${video}`);
  if (resolvedManifestPath && !fs.existsSync(resolvedManifestPath)) {
    die(`resolved manifest not found: ${resolvedManifestPath}`);
  }

  const baseName = path.basename(video, path.extname(video));
  const outdir = flags.outdir || path.join('tmp', 'qa', baseName);
  const framesDir = path.join(outdir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  console.error(`[visual_review] probing ${video} ...`);
  const duration = ffprobeDuration(video);
  const streamInfo = ffprobeSize(video);

  console.error('[visual_review] scanning for black frames ...');
  const blackEvents = detectBlackFrames(video);

  console.error('[visual_review] scanning for freeze/stuck frames ...');
  const freezeEvents = detectFreezeFrames(video);

  console.error('[visual_review] building sample plan ...');
  const samplesPerScene = flags.samplesPerScene || 3;
  const plan = buildSamplePlan(resolvedManifestPath, duration, samplesPerScene);

  console.error(`[visual_review] extracting ${plan.length} frames ...`);
  const framePaths = [];
  const labels = [];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const fname = `f${String(i).padStart(3, '0')}_${(p.sceneId || 't').replace(/[^a-zA-Z0-9_-]/g, '')}_${p.t}s.png`;
    const outPath = path.join(framesDir, fname);
    const ok = extractFrame(video, p.t, outPath);
    if (ok) {
      framePaths.push(outPath);
      labels.push(p.label + ` (${p.t}s)`);
    } else {
      console.error(`[visual_review] WARN: failed to extract frame at t=${p.t}`);
    }
  }

  console.error('[visual_review] computing per-frame brightness/uniformity stats ...');
  const stats = frameStats(framePaths);
  const UNIFORM_STD_THRESHOLD = 8;   // near-flat frame: likely blank/dead composition
  const DOMINANT_SHARE_THRESHOLD = 0.85; // one color covers >85% of frame
  const flaggedUniform = stats
    .map((s, i) => ({ ...s, label: labels[i] }))
    .filter(s => s.stdBrightness < UNIFORM_STD_THRESHOLD || s.dominantColorShare > DOMINANT_SHARE_THRESHOLD);

  console.error('[visual_review] checking scene-to-scene visual change at transitions ...');
  const transitionChecks = [];
  const bySceneOrder = [];
  for (let i = 0; i < plan.length; i++) {
    if (plan[i].sceneId && (bySceneOrder.length === 0 || bySceneOrder[bySceneOrder.length - 1].sceneId !== plan[i].sceneId)) {
      bySceneOrder.push({ sceneId: plan[i].sceneId, firstIdx: i, lastIdx: i });
    } else if (plan[i].sceneId) {
      bySceneOrder[bySceneOrder.length - 1].lastIdx = i;
    }
  }
  for (let i = 0; i < bySceneOrder.length - 1; i++) {
    const endOfA = bySceneOrder[i].lastIdx;
    const startOfB = bySceneOrder[i + 1].firstIdx;
    if (framePaths[endOfA] && framePaths[startOfB]) {
      const diff = frameDiff(framePaths[endOfA], framePaths[startOfB]);
      transitionChecks.push({
        from: bySceneOrder[i].sceneId,
        to: bySceneOrder[i + 1].sceneId,
        pixelDiff: diff,
        suspiciouslyStatic: diff < 0.03,
      });
    }
  }

  console.error('[visual_review] building contact sheet ...');
  const contactSheetPath = path.join(outdir, 'contact_sheet.png');
  buildContactSheet(framePaths, labels, contactSheetPath);

  const report = {
    video,
    outdir,
    stream: streamInfo,
    durationSeconds: duration,
    blackFrameEvents: blackEvents,
    freezeFrameEvents: freezeEvents,
    sampleCount: framePaths.length,
    flaggedUniformFrames: flaggedUniform,
    transitionChecks,
    contactSheet: contactSheetPath,
    frames: framePaths.map((p, i) => ({ path: p, label: labels[i], ...stats[i] })),
  };

  const reportPath = path.join(outdir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const md = renderMarkdown(report);
  const mdPath = path.join(outdir, 'report.md');
  fs.writeFileSync(mdPath, md);

  console.log(md);
  console.error(`\n[visual_review] JSON report: ${reportPath}`);
  console.error(`[visual_review] Markdown report: ${mdPath}`);
  console.error(`[visual_review] Contact sheet: ${contactSheetPath}`);
}

function renderMarkdown(r) {
  const lines = [];
  lines.push(`# Visual QA report — ${path.basename(r.video)}`);
  lines.push('');
  lines.push(`Duration: ${r.durationSeconds.toFixed(2)}s. Stream: ${r.stream.width}x${r.stream.height} @ ${r.stream.r_frame_rate}fps. Samples: ${r.sampleCount}.`);
  lines.push('');
  lines.push('## Automated checks (no vision model)');
  lines.push('');
  lines.push(`- Black-frame events: ${r.blackFrameEvents.length}` + (r.blackFrameEvents.length ? '' : ' — none.'));
  for (const e of r.blackFrameEvents) lines.push(`  - ${e.start}s -> ${e.end}s (${e.duration}s)`);
  lines.push(`- Freeze/stuck-frame events: ${r.freezeFrameEvents.length}` + (r.freezeFrameEvents.length ? '' : ' — none.'));
  for (const e of r.freezeFrameEvents) lines.push(`  - starts ${e.start}s${e.duration ? `, ${e.duration}s long` : ''}`);
  lines.push(`- Near-uniform / possibly-blank frames: ${r.flaggedUniformFrames.length}` + (r.flaggedUniformFrames.length ? '' : ' — none.'));
  for (const f of r.flaggedUniformFrames) {
    lines.push(`  - ${f.label}: stdBrightness=${f.stdBrightness}, dominantColorShare=${f.dominantColorShare} -> ${f.path}`);
  }
  lines.push(`- Scene-transition visual-change check:`);
  if (!r.transitionChecks.length) lines.push('  - only one scene / no transitions sampled.');
  for (const t of r.transitionChecks) {
    const flag = t.suspiciouslyStatic ? ' ⚠ SUSPICIOUSLY STATIC — transition may not be visibly doing anything' : ' ok';
    lines.push(`  - ${t.from} -> ${t.to}: pixelDiff=${t.pixelDiff}${flag}`);
  }
  lines.push('');
  lines.push('## Next step: actual visual review');
  lines.push('');
  lines.push(`This script cannot judge composition, overlap, color harmony, or "does this look good" —`);
  lines.push(`those need a vision-capable pass. One image covers every sampled frame:`);
  lines.push('');
  lines.push('```');
  lines.push(`vision_analyze("${r.contactSheet}")`);
  lines.push('# or, if unavailable this session, open it directly:');
  lines.push(`# ${r.contactSheet}`);
  lines.push('```');
  lines.push('');
  lines.push('Ask it to check, per labeled tile: overlapping/colliding elements, dead/empty');
  lines.push('space, text legibility against background, color clash, and whether each');
  lines.push('scene reads as visually distinct from its neighbors.');
  return lines.join('\n');
}

main();
