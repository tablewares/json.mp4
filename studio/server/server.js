import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, insertReview, listReviews, getReview, deleteReview } from './db.js';
import { scanProjects, readManifestSnapshot } from './scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { port: 4870 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifests') args.manifestDir = argv[++i];
    else if (a === '--videos') args.videoDir = argv[++i];
    else if (a === '--db') args.dbPath = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
  }
  args.manifestDir ??= process.env.REVIEW_MANIFEST_DIR;
  args.videoDir ??= process.env.REVIEW_VIDEO_DIR;
  args.dbPath ??= process.env.REVIEW_DB_PATH || path.join(process.cwd(), 'review-tool-data', 'reviews.db');
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.manifestDir || !args.videoDir) {
  console.error(
    'Usage: node server.js --manifests <dir> --videos <dir> [--db <path>] [--port <n>]\n' +
    '  (or set REVIEW_MANIFEST_DIR / REVIEW_VIDEO_DIR / REVIEW_DB_PATH env vars)'
  );
  process.exit(1);
}

const db = openDb(args.dbPath);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- projects -------------------------------------------------------------

app.get('/api/projects', (req, res) => {
  const scanned = scanProjects(args.manifestDir, args.videoDir);
  const reviews = listReviews(db);
  const reviewCountByProject = new Map();
  const lastVerdictByProject = new Map();
  for (const r of reviews) {
    reviewCountByProject.set(r.project_id, (reviewCountByProject.get(r.project_id) || 0) + 1);
    if (!lastVerdictByProject.has(r.project_id)) lastVerdictByProject.set(r.project_id, r.verdict);
  }

  const out = scanned.map(p => ({
    id: p.id,
    hasManifest: Boolean(p.manifestPath),
    hasVideo: Boolean(p.videoPath),
    reviewCount: reviewCountByProject.get(p.id) || 0,
    lastVerdict: lastVerdictByProject.get(p.id) || null
  }));

  res.json({ projects: out, manifestDir: args.manifestDir, videoDir: args.videoDir });
});

app.get('/api/projects/:id/manifest', (req, res) => {
  const scanned = scanProjects(args.manifestDir, args.videoDir);
  const project = scanned.find(p => p.id === req.params.id);
  if (!project || !project.manifestPath) return res.status(404).json({ error: 'manifest not found' });
  const content = readManifestSnapshot(project.manifestPath);
  res.json({ id: project.id, manifestPath: project.manifestPath, content });
});

// ---- video streaming (supports range requests for scrubbing) --------------

app.get('/videos/:id.mp4', (req, res) => {
  const filePath = path.join(args.videoDir, `${req.params.id}.mp4`);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': 'video/mp4'
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
});

// ---- reviews ----------------------------------------------------------

app.get('/api/reviews', (req, res) => {
  res.json({ reviews: listReviews(db, { projectId: req.query.projectId }) });
});

app.get('/api/reviews/:id', (req, res) => {
  const review = getReview(db, Number(req.params.id));
  if (!review) return res.status(404).json({ error: 'not found' });
  res.json({ review });
});

app.post('/api/reviews', (req, res) => {
  const body = req.body || {};
  if (!body.projectId || !body.verdict || typeof body.overallScore !== 'number') {
    return res.status(400).json({ error: 'projectId, verdict, and overallScore are required' });
  }

  const scanned = scanProjects(args.manifestDir, args.videoDir);
  const project = scanned.find(p => p.id === body.projectId);
  const manifestSnapshot = project ? readManifestSnapshot(project.manifestPath) : null;

  const id = insertReview(db, {
    projectId: body.projectId,
    manifestPath: project?.manifestPath || null,
    videoPath: project?.videoPath || null,
    manifestSnapshot,
    verdict: body.verdict,
    overallScore: body.overallScore,
    categoryScores: body.categoryScores || {},
    tags: body.tags || [],
    notes: body.notes || '',
    reviewer: body.reviewer || ''
  });

  res.status(201).json({ id });
});

app.delete('/api/reviews/:id', (req, res) => {
  deleteReview(db, Number(req.params.id));
  res.status(204).end();
});

app.listen(args.port, () => {
  console.log(`Review tool running at http://localhost:${args.port}`);
  console.log(`  manifests: ${args.manifestDir}`);
  console.log(`  videos:    ${args.videoDir}`);
  console.log(`  db:        ${args.dbPath}`);
});
