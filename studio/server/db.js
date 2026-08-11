import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const CATEGORY_KEYS = [
  'kineticText',
  'colorAndContrast',
  'camera',
  'pacingAndTiming',
  'transitions',
  'audioSync',
  'overallCraft'
];

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      manifest_path TEXT,
      video_path TEXT,
      manifest_snapshot TEXT,
      verdict TEXT CHECK(verdict IN ('good','bad','mixed')) NOT NULL,
      overall_score INTEGER NOT NULL,
      category_scores TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      reviewer TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_verdict ON reviews(verdict);
    CREATE INDEX IF NOT EXISTS idx_reviews_score ON reviews(overall_score);
  `);

  return db;
}

export function insertReview(db, review) {
  const stmt = db.prepare(`
    INSERT INTO reviews
      (project_id, manifest_path, video_path, manifest_snapshot,
       verdict, overall_score, category_scores, tags, notes, reviewer)
    VALUES (@project_id, @manifest_path, @video_path, @manifest_snapshot,
            @verdict, @overall_score, @category_scores, @tags, @notes, @reviewer)
  `);
  const info = stmt.run({
    project_id: review.projectId,
    manifest_path: review.manifestPath || null,
    video_path: review.videoPath || null,
    manifest_snapshot: review.manifestSnapshot || null,
    verdict: review.verdict,
    overall_score: review.overallScore,
    category_scores: JSON.stringify(review.categoryScores || {}),
    tags: JSON.stringify(review.tags || []),
    notes: review.notes || '',
    reviewer: review.reviewer || ''
  });
  return info.lastInsertRowid;
}

export function listReviews(db, { projectId } = {}) {
  const rows = projectId
    ? db.prepare('SELECT * FROM reviews WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
    : db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all();
  return rows.map(hydrate);
}

export function getReview(db, id) {
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  return row ? hydrate(row) : null;
}

export function deleteReview(db, id) {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
}

function hydrate(row) {
  return {
    ...row,
    category_scores: JSON.parse(row.category_scores || '{}'),
    tags: JSON.parse(row.tags || '[]')
  };
}

export { CATEGORY_KEYS };
