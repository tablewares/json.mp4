import fs from 'node:fs';
import path from 'node:path';

/**
 * Scans a manifest directory and a video directory, pairing them up by name.
 *
 * Supports two manifest layouts:
 *   flat:   <manifestDir>/<id>.json
 *   nested: <manifestDir>/<id>/manifest.json   (projectId read from file if present)
 *
 * Videos are matched as <videoDir>/<id>.mp4 (case-insensitive extension).
 */
export function scanProjects(manifestDir, videoDir) {
  const projects = new Map();

  if (fs.existsSync(manifestDir)) {
    for (const entry of fs.readdirSync(manifestDir, { withFileTypes: true })) {
      const full = path.join(manifestDir, entry.name);

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        const id = path.basename(entry.name, path.extname(entry.name));
        addProject(projects, id, full);
      } else if (entry.isDirectory()) {
        const nested = path.join(full, 'manifest.json');
        if (fs.existsSync(nested)) {
          let id = entry.name;
          try {
            const parsed = JSON.parse(fs.readFileSync(nested, 'utf-8'));
            if (parsed.projectId) id = parsed.projectId;
          } catch {
            // ignore parse errors here; still register by directory name
          }
          addProject(projects, id, nested);
        }
      }
    }
  }

  if (fs.existsSync(videoDir)) {
    for (const entry of fs.readdirSync(videoDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.mp4')) continue;
      const id = path.basename(entry.name, path.extname(entry.name));
      const full = path.join(videoDir, entry.name);
      if (!projects.has(id)) projects.set(id, { id, manifestPath: null });
      projects.get(id).videoPath = full;
    }
  }

  return [...projects.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function addProject(projects, id, manifestPath) {
  if (!projects.has(id)) projects.set(id, { id, videoPath: null });
  projects.get(id).manifestPath = manifestPath;
}

export function readManifestSnapshot(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return null;
  try {
    return fs.readFileSync(manifestPath, 'utf-8');
  } catch {
    return null;
  }
}
