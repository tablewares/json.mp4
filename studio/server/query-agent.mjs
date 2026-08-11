#!/usr/bin/env node
// query-agent.mjs — read-only CLI for AI agents to consult accumulated human
// review verdicts before/while authoring manifests.
//
// Usage:
//   query-agent.mjs good [--limit N] [--min-score N] [--category KEY]
//   query-agent.mjs bad  [--limit N] [--max-score N] [--category KEY]
//   query-agent.mjs patterns
//   query-agent.mjs project <projectId>
//   query-agent.mjs search <keyword>
//
// Global flags:
//   --db <path>     path to reviews.db (default: $REVIEW_DB_PATH or ./review-tool-data/reviews.db)
//   --json          emit raw JSON instead of the human/agent-readable text report
//
// Exit codes: 0 = ok, 1 = usage error, 2 = db not found.

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

function parseArgs(argv) {
  const positional = [];
  const flags = { limit: 20, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') flags.db = argv[++i];
    else if (a === '--json') flags.json = true;
    else if (a === '--limit') flags.limit = Number(argv[++i]);
    else if (a === '--min-score') flags.minScore = Number(argv[++i]);
    else if (a === '--max-score') flags.maxScore = Number(argv[++i]);
    else if (a === '--category') flags.category = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

function openDb(flags) {
  const dbPath = flags.db || process.env.REVIEW_DB_PATH ||
    path.join(process.cwd(), 'review-tool-data', 'reviews.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`No review database found at ${dbPath}`);
    console.error('Pass --db <path> or set REVIEW_DB_PATH.');
    process.exit(2);
  }
  return new Database(dbPath, { readonly: true });
}

function hydrate(row) {
  return {
    ...row,
    category_scores: JSON.parse(row.category_scores || '{}'),
    tags: JSON.parse(row.tags || '[]')
  };
}

function printReport(title, reviews, { showManifest = false } = {}) {
  console.log(`# ${title} (${reviews.length})\n`);
  if (!reviews.length) {
    console.log('(none found)');
    return;
  }
  for (const r of reviews) {
    console.log(`## ${r.project_id}  [${r.verdict}, overall ${r.overall_score}/10]  (review #${r.id}, ${r.created_at})`);
    const catStr = Object.entries(r.category_scores).map(([k, v]) => `${k}=${v}`).join(', ');
    if (catStr) console.log(`categories: ${catStr}`);
    if (r.tags.length) console.log(`tags: ${r.tags.join(', ')}`);
    if (r.notes) console.log(`notes: ${r.notes}`);
    if (showManifest && r.manifest_snapshot) {
      console.log('manifest snapshot:');
      console.log(r.manifest_snapshot);
    }
    console.log('');
  }
}

function cmdGoodBad(db, flags, verdictWord) {
  const clauses = ['verdict = ?'];
  const params = [verdictWord];
  if (flags.minScore != null) { clauses.push('overall_score >= ?'); params.push(flags.minScore); }
  if (flags.maxScore != null) { clauses.push('overall_score <= ?'); params.push(flags.maxScore); }
  const sql = `SELECT * FROM reviews WHERE ${clauses.join(' AND ')} ORDER BY overall_score DESC, created_at DESC LIMIT ?`;
  params.push(flags.limit);
  let rows = db.prepare(sql).all(...params).map(hydrate);
  if (flags.category) {
    rows = rows.filter(r => flags.category in r.category_scores);
  }
  return rows;
}

function cmdPatterns(db) {
  const rows = db.prepare('SELECT * FROM reviews').all().map(hydrate);
  const byVerdict = { good: [], bad: [], mixed: [] };
  for (const r of rows) byVerdict[r.verdict]?.push(r);

  const tagFreq = (list) => {
    const freq = new Map();
    for (const r of list) for (const t of r.tags) freq.set(t, (freq.get(t) || 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1]);
  };

  const categoryAverages = (list) => {
    const sums = {}, counts = {};
    for (const r of list) {
      for (const [k, v] of Object.entries(r.category_scores)) {
        sums[k] = (sums[k] || 0) + v;
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    return Object.fromEntries(Object.keys(sums).map(k => [k, +(sums[k] / counts[k]).toFixed(2)]));
  };

  return {
    totalReviews: rows.length,
    counts: { good: byVerdict.good.length, bad: byVerdict.bad.length, mixed: byVerdict.mixed.length },
    topTagsInGood: tagFreq(byVerdict.good).slice(0, 15),
    topTagsInBad: tagFreq(byVerdict.bad).slice(0, 15),
    categoryAveragesGood: categoryAverages(byVerdict.good),
    categoryAveragesBad: categoryAverages(byVerdict.bad)
  };
}

function printPatterns(p) {
  console.log(`# Review patterns (${p.totalReviews} total reviews)\n`);
  console.log(`good=${p.counts.good}  bad=${p.counts.bad}  mixed=${p.counts.mixed}\n`);
  console.log('## Category averages — good reviews');
  for (const [k, v] of Object.entries(p.categoryAveragesGood)) console.log(`  ${k}: ${v}`);
  console.log('\n## Category averages — bad reviews');
  for (const [k, v] of Object.entries(p.categoryAveragesBad)) console.log(`  ${k}: ${v}`);
  console.log('\n## Most common tags in GOOD reviews (what to aim for)');
  for (const [tag, n] of p.topTagsInGood) console.log(`  ${tag}  (${n})`);
  console.log('\n## Most common tags in BAD reviews (what to avoid)');
  for (const [tag, n] of p.topTagsInBad) console.log(`  ${tag}  (${n})`);
}

function cmdProject(db, projectId) {
  return db.prepare('SELECT * FROM reviews WHERE project_id = ? ORDER BY created_at DESC').all(projectId).map(hydrate);
}

function cmdSearch(db, keyword, limit) {
  const like = `%${keyword}%`;
  return db.prepare(
    `SELECT * FROM reviews WHERE notes LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT ?`
  ).all(like, like, limit).map(hydrate);
}

function usageExit() {
  console.error(`Usage:
  query-agent.mjs good [--limit N] [--min-score N] [--category KEY]
  query-agent.mjs bad  [--limit N] [--max-score N] [--category KEY]
  query-agent.mjs patterns
  query-agent.mjs project <projectId>
  query-agent.mjs search <keyword>

Global: --db <path>  --json`);
  process.exit(1);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [cmd, arg] = positional;
if (!cmd) usageExit();

const db = openDb(flags);

switch (cmd) {
  case 'good': {
    const rows = cmdGoodBad(db, flags, 'good');
    flags.json ? console.log(JSON.stringify(rows, null, 2)) : printReport('Good renders', rows);
    break;
  }
  case 'bad': {
    const rows = cmdGoodBad(db, flags, 'bad');
    flags.json ? console.log(JSON.stringify(rows, null, 2)) : printReport('Bad renders', rows);
    break;
  }
  case 'patterns': {
    const p = cmdPatterns(db);
    flags.json ? console.log(JSON.stringify(p, null, 2)) : printPatterns(p);
    break;
  }
  case 'project': {
    if (!arg) usageExit();
    const rows = cmdProject(db, arg);
    flags.json ? console.log(JSON.stringify(rows, null, 2)) : printReport(`Reviews for "${arg}"`, rows, { showManifest: true });
    break;
  }
  case 'search': {
    if (!arg) usageExit();
    const rows = cmdSearch(db, arg, flags.limit);
    flags.json ? console.log(JSON.stringify(rows, null, 2)) : printReport(`Search: "${arg}"`, rows);
    break;
  }
  default:
    usageExit();
}
