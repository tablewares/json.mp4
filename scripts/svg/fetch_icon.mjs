#!/usr/bin/env node
/**
 * fetch_icon.mjs — pulls brand/UI icons from the local `simple-icons`
 * library (installed as a normal npm dependency, ~3450 SVG marks, fully
 * offline — no network/API key needed) and writes them into public/svg/
 * as standalone <svg> files ready to be pointed at by SvgImage's
 * `content.src` (path relative to public/).
 *
 * Mirrors the scripts/pexels/fetch_image.mjs CLI shape: pass one or more
 * queries, get a ranked list of candidates printed, top match(es) saved.
 *
 * Usage:
 *   node scripts/svg/fetch_icon.mjs "github" "bitcoin" "youtube"
 *   node scripts/svg/fetch_icon.mjs --list "git"        # just list, no write
 *   node scripts/svg/fetch_icon.mjs --exact vercel       # slug/title exact match only
 *
 * Output: public/svg/<slug>.svg — a self-contained square SVG
 * (viewBox 0 0 24 24) with the icon's official path filled with its
 * official brand hex. Filename = simple-icons slug (stable, lowercase,
 * URL-safe) so content.src stays predictable, e.g. "svg/github.svg".
 */
import fs from "fs";
import path from "path";
import * as icons from "simple-icons";

const outDir = path.join(process.cwd(), "public", "svg");
fs.mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const exact = args.includes("--exact");
const queries = args.filter((a) => !a.startsWith("--"));

if (queries.length === 0) {
  console.error(
    'Usage: node scripts/svg/fetch_icon.mjs [--list] [--exact] "query1" "query2" ...'
  );
  process.exit(1);
}

// Build a flat searchable index once: { key, title, slug, svg, hex }
const all = Object.keys(icons)
  .filter((k) => k.startsWith("si"))
  .map((k) => icons[k]);

function score(query, icon) {
  const q = query.toLowerCase();
  const title = icon.title.toLowerCase();
  const slug = icon.slug.toLowerCase();
  if (title === q || slug === q) return 100;
  if (title.startsWith(q) || slug.startsWith(q)) return 80;
  if (title.includes(q) || slug.includes(q)) return 50;
  return 0;
}

function search(query, limit = 8) {
  return all
    .map((icon) => ({ icon, s: score(query, icon) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.icon);
}

function wrapSvg(icon) {
  // simple-icons ships bare <path> data; wrap into a standalone square SVG
  // (viewBox 0 0 24 24, same coordinate space every icon is authored in)
  // filled with the icon's official brand hex, matching the convention
  // already used by public/svg/image.svg (flat fills, no external refs).
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">\n<path d="${icon.path}" fill="#${icon.hex}"/>\n</svg>\n`;
}

for (const query of queries) {
  const results = search(query, exact ? 1 : 8);
  console.log(`\n=== "${query}" — ${results.length} match(es) ===`);
  results.forEach((icon, i) => {
    console.log(`  [${i}] ${icon.title} (slug=${icon.slug}, hex=#${icon.hex})`);
  });
  if (results.length === 0) {
    console.log("  None found.");
    continue;
  }
  if (listOnly) continue;

  const top = exact ? results.filter((i) => i.slug === query.toLowerCase() || i.title.toLowerCase() === query.toLowerCase()) : results.slice(0, 1);
  if (top.length === 0) {
    console.log(`  No exact match for "${query}", skipping write (use without --exact to fuzzy-pick).`);
    continue;
  }
  for (const icon of top) {
    const fname = `${icon.slug}.svg`;
    const outPath = path.join(outDir, fname);
    fs.writeFileSync(outPath, wrapSvg(icon));
    console.log(`  Saved: public/svg/${fname}`);
  }
}

console.log(`\nDone. Library size: ${all.length} icons available (search anytime, fully offline).`);
