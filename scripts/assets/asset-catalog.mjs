#!/usr/bin/env node
/**
 * asset-catalog.mjs — turns a raw file in public/{assets,svg} into a
 * searchable "card": a .meta.json sidecar (provenance, tags, dimensions)
 * plus a Markdown card ready for local-rag's `ingest_data`. This is the
 * "pattern for inserting assets" the embeddings search engine needs —
 * public/ files are binary blobs (jpg/mp4/svg) with no text for a
 * text-embedding index to latch onto, so every asset gets a small
 * text-shaped proxy document instead of trying to embed pixels.
 *
 * This script does NOT call the RAG MCP server itself (it's a plain node
 * script, no MCP client) — it prepares everything an agent session needs
 * to call ingest_data per asset: the card body plus a stable
 * "asset://public/..." source id. Run it, then feed each entry's
 * `ingestData` object straight into the ingest_data tool call.
 *
 * Card contents (why these fields, not others): filename tokens (already
 * carry the acquisition query — see fetch_image.mjs's
 * `img_<query>_<id>.jpg` naming and fetch_icon.mjs's `<slug>.svg`),
 * dimensions/duration (ffprobe), and whatever provenance the sidecar
 * already has (source API, original query, alt text, license) — the
 * exact fields relevance-check.mjs's candidate scoring consumed, kept
 * around so a future search hit is self-explanatory without re-deriving
 * it from the filename.
 *
 * Usage:
 *   node scripts/assets/asset-catalog.mjs                       # scan + print cards, no writes
 *   node scripts/assets/asset-catalog.mjs --write-sidecar        # also write/update .meta.json next to each asset
 *   node scripts/assets/asset-catalog.mjs --dir public/assets    # restrict to one dir (repeatable)
 *   node scripts/assets/asset-catalog.mjs --only img_office_team_meeting_laptop_3865639.jpg
 *   node scripts/assets/asset-catalog.mjs --set-meta public/svg/notion.svg '{"source":"simple-icons","sourceQuery":"notion","tags":["notion","logo","brand"]}'
 *
 * Flags:
 *   --dir <path>       directory to scan (repeatable; default: public/assets, public/svg)
 *   --write-sidecar    write/update <file>.meta.json next to each asset (default: dry-run, print only)
 *   --only <filename>  restrict to one file (basename match)
 *   --set-meta <file> '<json>'   shallow-merge json into that file's .meta.json before cataloging
 *                                (this is how a fetch step records provenance/tags/relevance BEFORE cataloging;
 *                                see scripts/curate/components/asset-search-pattern.md)
 *   --format json|md   output shape for the printed cards (default: json)
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

function parseArgs(argv) {
  const out = { dirs: [], writeSidecar: false, only: null, setMetaFile: null, setMetaJson: null, format: "json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dirs.push(argv[++i]);
    else if (a === "--write-sidecar") out.writeSidecar = true;
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--set-meta") {
      out.setMetaFile = argv[++i];
      out.setMetaJson = argv[++i];
    } else if (a === "--format") out.format = argv[++i];
  }
  if (out.dirs.length === 0) out.dirs = ["public/assets", "public/svg"];
  return out;
}

const args = parseArgs(process.argv.slice(2));

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm"]);
const SVG_EXT = new Set([".svg"]);
const SKIP_EXT = new Set([".json"]); // sidecars themselves

function metaPath(filePath) {
  return `${filePath}.meta.json`;
}

function readMeta(filePath) {
  const p = metaPath(filePath);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function writeMeta(filePath, meta) {
  fs.writeFileSync(metaPath(filePath), JSON.stringify(meta, null, 2) + "\n");
}

// --set-meta shallow-merge, applied before the scan below reads it back
if (args.setMetaFile) {
  if (!fs.existsSync(args.setMetaFile)) {
    console.error(`--set-meta target not found: ${args.setMetaFile}`);
    process.exit(1);
  }
  const current = readMeta(args.setMetaFile);
  const patch = JSON.parse(args.setMetaJson);
  writeMeta(args.setMetaFile, { ...current, ...patch });
  console.error(`[asset-catalog] merged meta into ${metaPath(args.setMetaFile)}`);
}

function ffprobeDims(filePath) {
  const r = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-show_entries", "format=duration",
    "-of", "json", filePath,
  ], { encoding: "utf8" });
  if (r.status !== 0) return {};
  try {
    const parsed = JSON.parse(r.stdout);
    const stream = parsed.streams?.[0] ?? {};
    return {
      width: stream.width ?? null,
      height: stream.height ?? null,
      durationSeconds: parsed.format?.duration ? Math.round(parseFloat(parsed.format.duration) * 100) / 100 : null,
    };
  } catch {
    return {};
  }
}

function svgDims(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const m = src.match(/viewBox="[^"]*?\s(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
  return m ? { width: parseFloat(m[1]), height: parseFloat(m[2]) } : {};
}

// filename -> a first-pass token/tag guess when no sidecar exists yet.
// Mirrors the naming conventions the fetch scripts already use:
//   img_<query tokens>_<pexels id>.jpg   (fetch_image.mjs)
//   broll_<query tokens>_<pexels id>.mp4 (fetch_broll.mjs)
//   <slug>.svg                            (fetch_icon.mjs)
function guessTagsFromFilename(base) {
  const stem = base.replace(/\.[^.]+$/, "");
  const stripped = stem.replace(/^(img|broll|news)_/, "").replace(/_\d+$/, "");
  return stripped.split("_").filter(Boolean);
}

function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => path.join(dir, f))
    .filter((p) => fs.statSync(p).isFile())
    .filter((p) => !p.endsWith(".meta.json"))
    .filter((p) => !SKIP_EXT.has(path.extname(p)));
}

let files = args.dirs.flatMap(collect);
if (args.only) files = files.filter((f) => path.basename(f) === args.only);

const cards = [];
for (const filePath of files) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  const assetType = IMAGE_EXT.has(ext) ? "image" : VIDEO_EXT.has(ext) ? "video" : SVG_EXT.has(ext) ? "svg" : "other";
  if (assetType === "other") continue;

  const existingMeta = readMeta(filePath);
  const dims = assetType === "svg" ? svgDims(filePath) : ffprobeDims(filePath);
  const tags = existingMeta.tags ?? guessTagsFromFilename(base);

  const meta = {
    file: filePath,
    assetType,
    source: existingMeta.source ?? "unknown",
    sourceQuery: existingMeta.sourceQuery ?? null,
    sourceId: existingMeta.sourceId ?? null,
    altText: existingMeta.altText ?? null,
    photographer: existingMeta.photographer ?? null,
    license: existingMeta.license ?? null,
    relevanceScore: existingMeta.relevanceScore ?? null,
    tags,
    width: dims.width ?? existingMeta.width ?? null,
    height: dims.height ?? existingMeta.height ?? null,
    durationSeconds: dims.durationSeconds ?? existingMeta.durationSeconds ?? null,
    catalogedAt: new Date().toISOString(),
  };

  if (args.writeSidecar) writeMeta(filePath, meta);

  // one markdown "card" per asset — filename, tags, dims, provenance up
  // front (keyword-searchable), one plain-English sentence describing
  // how/why it was sourced (semantic-searchable). Kept short: the whole
  // point is a proxy document, not a full description.
  const cardLines = [
    `# Asset: ${base}`,
    "",
    `Type: ${meta.assetType}. Path: ${meta.file}.`,
    meta.width && meta.height ? `Dimensions: ${meta.width}x${meta.height}${meta.durationSeconds ? `, ${meta.durationSeconds}s` : ""}.` : "",
    `Tags: ${meta.tags.join(", ") || "none"}.`,
    meta.altText ? `Description: ${meta.altText}` : "",
    meta.source !== "unknown" ? `Source: ${meta.source}${meta.sourceQuery ? ` (query: "${meta.sourceQuery}")` : ""}${meta.sourceId ? `, id ${meta.sourceId}` : ""}.` : "",
    meta.photographer ? `Credit: ${meta.photographer}.` : "",
    meta.relevanceScore != null ? `Relevance-check score at acquisition: ${meta.relevanceScore}.` : "",
  ].filter(Boolean);

  cards.push({
    file: meta.file,
    meta,
    cardMarkdown: cardLines.join("\n"),
    ingestData: {
      content: cardLines.join("\n"),
      metadata: { source: `asset://${meta.file}`, format: "markdown" },
    },
  });
}

const output = {
  generator: "scripts/assets/asset-catalog.mjs",
  scannedDirs: args.dirs,
  fileCount: cards.length,
  sidecarWritten: args.writeSidecar,
  cards,
  ingestNote:
    "Not run by this script (no MCP client here). For each card, call ingest_data(card.ingestData) from an agent session to make the asset text-searchable; source is \"asset://<relative path>\" so query_documents results map straight back to the real file.",
};

if (args.format === "md") {
  const lines = [`# Asset catalog — ${cards.length} file(s)`, ""];
  for (const c of cards) {
    lines.push(c.cardMarkdown, "", "---", "");
  }
  console.log(lines.join("\n"));
} else {
  console.log(JSON.stringify(output, null, 2));
}
