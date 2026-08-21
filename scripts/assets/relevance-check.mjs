#!/usr/bin/env node
/**
 * relevance-check.mjs — quality/relevance gate for candidate assets BEFORE
 * they get written into public/. Runs on the metadata returned by a
 * *search* step (Pexels JSON, simple-icons matches, Yandex images JSON) —
 * never on pixels — so it costs one process spawn, not a vision-model
 * call, and can run on every candidate a fetch script considers.
 *
 * Three independent gates, all must pass for `accept: true`:
 *   1. relevance  — token-overlap (Jaccard) between the intended query/tags
 *      and the candidate's own title/alt text. Catches "search matched but
 *      isn't actually about the thing" (stock photo APIs frequently return
 *      loosely-related filler past the first couple results).
 *   2. resolution — per-assetType minimum dimensions. A technically
 *      on-topic image that's too small to read at 1080x1920 is still a
 *      quality reject.
 *   3. duplicate  — token-overlap against EXISTING public/assets or
 *      public/svg filenames (or an explicit --existing list). Prevents
 *      re-downloading a near-identical asset under a new id.
 *
 * This is a pure scorer — it does not download or write anything. Wire it
 * between a search step and a fetch/write step (see
 * scripts/assets/asset-catalog.mjs and scripts/curate/components/*.md for
 * the intended pipeline).
 *
 * Usage:
 *   node scripts/assets/relevance-check.mjs \
 *     --query "office team meeting laptop" \
 *     --type image \
 *     --candidates '[{"id":"123","title":"...","width":6000,"height":4000}]'
 *
 *   # or pipe candidates as JSON on stdin instead of --candidates
 *   cat candidates.json | node scripts/assets/relevance-check.mjs --query "..." --type svg
 *
 * Flags:
 *   --query "<text>"        required. Intended search intent / tag string.
 *   --type image|video|svg  required. Selects the resolution-gate minimums.
 *   --candidates '<json>'   JSON array of { id, title|alt|slug, width?, height?, duration? }.
 *   --existing '<json>'     optional JSON array of existing filenames to dedupe against.
 *                           default: scans public/assets + public/svg on disk.
 *   --min-score N           relevance-score accept threshold, 0-100 (default 35).
 *   --format json|md        output shape (default: json).
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const out = { query: null, type: null, candidates: null, existing: null, minScore: 35, format: "json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query") out.query = argv[++i];
    else if (a === "--type") out.type = argv[++i];
    else if (a === "--candidates") out.candidates = argv[++i];
    else if (a === "--existing") out.existing = argv[++i];
    else if (a === "--min-score") out.minScore = parseFloat(argv[++i]);
    else if (a === "--format") out.format = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.query) { console.error("--query is required"); process.exit(1); }
if (!args.type || !["image", "video", "svg"].includes(args.type)) {
  console.error("--type must be image|video|svg");
  process.exit(1);
}

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

let candidatesRaw = args.candidates;
if (!candidatesRaw) candidatesRaw = readStdinSync();
if (!candidatesRaw || !candidatesRaw.trim()) {
  console.error("No candidates provided (--candidates '<json>' or stdin).");
  process.exit(1);
}
const candidates = JSON.parse(candidatesRaw);

// ---------------------------------------------------------------------
// gate 1: relevance — Jaccard token overlap between query and candidate
// text (title/alt/slug, whichever is present), with a light stopword
// filter so "a"/"the"/"with" don't inflate the denominator.
// ---------------------------------------------------------------------
const STOPWORDS = new Set(["a", "an", "the", "and", "or", "with", "of", "in", "on", "at", "for", "to", "is", "are"]);
function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}
function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = new Set([...a, ...b]).size;
  return inter / union;
}
function candidateText(c) {
  return c.title || c.alt || c.slug || c.name || "";
}

const queryTokens = tokenize(args.query);

// ---------------------------------------------------------------------
// gate 2: resolution minimums by assetType — matches the composition
// budget in scripts/curate/composition/rules.md (assets get rendered up
// to full-bleed 1080-1920 wide on a vertical composition; anything much
// smaller than that upscales visibly).
// ---------------------------------------------------------------------
const MIN_DIMENSIONS = {
  image: { width: 800, height: 800 },
  video: { width: 640, height: 640 },
  svg: { width: 0, height: 0 }, // vector, resolution-independent
};

// ---------------------------------------------------------------------
// gate 3: duplicate — existing on-disk filenames (or an explicit list),
// token-overlap against the candidate's own text/id.
// ---------------------------------------------------------------------
function scanExistingFilenames() {
  const dirs = ["public/assets", "public/svg"];
  const names = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) names.push(f);
  }
  return names;
}
const existingNames = args.existing ? JSON.parse(args.existing) : scanExistingFilenames();
const DUPLICATE_JACCARD_THRESHOLD = 0.75;

function checkDuplicate(c) {
  const cTokens = tokenize(candidateText(c) + " " + (c.id ?? c.slug ?? ""));
  let best = { name: null, score: 0 };
  for (const name of existingNames) {
    const nameTokens = tokenize(path.parse(name).name.replace(/^(img|broll|svg)_/, "").replace(/_\d+$/, ""));
    const score = jaccard(cTokens, nameTokens);
    if (score > best.score) best = { name, score };
  }
  return { isDuplicate: best.score >= DUPLICATE_JACCARD_THRESHOLD, closest: best.name, closestScore: Math.round(best.score * 1000) / 1000 };
}

// ---------------------------------------------------------------------
// score + verdict per candidate
// ---------------------------------------------------------------------
const minDims = MIN_DIMENSIONS[args.type];
const results = candidates.map((c) => {
  const text = candidateText(c);
  const cTokens = tokenize(text);
  const relevanceScore = Math.round(jaccard(queryTokens, cTokens) * 100);

  const width = c.width ?? null;
  const height = c.height ?? null;
  const resolutionOk =
    args.type === "svg" ? true : width != null && height != null && width >= minDims.width && height >= minDims.height;

  const dup = checkDuplicate(c);

  const accept = relevanceScore >= args.minScore && resolutionOk && !dup.isDuplicate;
  const reasons = [];
  if (relevanceScore < args.minScore) reasons.push(`relevance ${relevanceScore} < min ${args.minScore}`);
  if (!resolutionOk) reasons.push(`resolution ${width ?? "?"}x${height ?? "?"} below min ${minDims.width}x${minDims.height}`);
  if (dup.isDuplicate) reasons.push(`near-duplicate of "${dup.closest}" (overlap ${dup.closestScore})`);

  return {
    id: c.id ?? c.slug ?? null,
    text,
    relevanceScore,
    resolution: { width, height, ok: resolutionOk },
    duplicate: dup,
    accept,
    reasons,
  };
});

const accepted = results.filter((r) => r.accept);
const rejected = results.filter((r) => !r.accept);

const output = {
  generator: "scripts/assets/relevance-check.mjs",
  query: args.query,
  assetType: args.type,
  minScore: args.minScore,
  candidateCount: candidates.length,
  acceptedCount: accepted.length,
  rejectedCount: rejected.length,
  results,
  nextStep:
    accepted.length > 0
      ? "For each accepted candidate: download/save into public/assets|svg, write the .meta.json sidecar (scripts/assets/asset-catalog.mjs --write-sidecar), then ingest its catalog card with ingest_data so it's searchable."
      : "No candidate cleared the gate — widen --query, raise result count, or lower --min-score deliberately (don't just insert a rejected candidate).",
};

if (args.format === "md") {
  const lines = [];
  lines.push(`# Relevance check — "${args.query}" (${args.type})`);
  lines.push("");
  lines.push(`${accepted.length}/${candidates.length} candidates accepted (min score ${args.minScore}).`);
  lines.push("");
  lines.push("| id | text | relevance | resolution | duplicate | verdict |");
  lines.push("|----|------|-----------|------------|-----------|---------|");
  for (const r of results) {
    lines.push(
      `| ${r.id} | ${r.text.slice(0, 40)} | ${r.relevanceScore} | ${r.resolution.width ?? "-"}x${r.resolution.height ?? "-"} ${r.resolution.ok ? "ok" : "FAIL"} | ${r.duplicate.isDuplicate ? `DUP(${r.duplicate.closest})` : "ok"} | ${r.accept ? "ACCEPT" : "reject: " + r.reasons.join("; ")} |`
    );
  }
  console.log(lines.join("\n"));
} else {
  console.log(JSON.stringify(output, null, 2));
}
