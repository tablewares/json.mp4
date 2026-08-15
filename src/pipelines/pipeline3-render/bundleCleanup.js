import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Cleans up `remotion-webpack-bundle-*` directories left behind in the OS
 * tmpdir by @remotion/bundler's bundle() calls. Two failure modes this
 * guards against:
 *
 *   1. The current render's own bundle dir (handled by render.js's
 *      try/finally around bundle()+renderMedia() — that's the common case).
 *   2. Orphans from a PRIOR run that never reached its finally block at all
 *      — SIGKILL, OOM-kill, a crashed CI runner, `kill -9`, a machine
 *      reboot mid-render. Those leave a bundle dir with no process left to
 *      clean it up. This sweep is what catches those.
 *
 * Age-gated (default 1 hour) rather than "every remotion-webpack-bundle-*
 * dir found" so a sweep run concurrently with ANOTHER in-flight render on
 * the same machine can never delete a bundle a sibling process is actively
 * serving from.
 */

const BUNDLE_DIR_PATTERN = /^remotion-webpack-bundle-/;
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * @param {{ maxAgeMs?: number, tmpDir?: string, dryRun?: boolean }} opts
 * @returns {{ removed: string[], skipped: string[], errors: {dir:string, message:string}[] }}
 */
export function sweepStaleBundles(opts = {}) {
  const { maxAgeMs = DEFAULT_MAX_AGE_MS, tmpDir = os.tmpdir(), dryRun = false } = opts;

  const result = { removed: [], skipped: [], errors: [] };

  let entries;
  try {
    entries = fs.readdirSync(tmpDir);
  } catch (e) {
    result.errors.push({ dir: tmpDir, message: `Could not read tmpdir: ${e.message}` });
    return result;
  }

  const now = Date.now();
  for (const name of entries) {
    if (!BUNDLE_DIR_PATTERN.test(name)) continue;
    const full = path.join(tmpDir, name);

    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // vanished between readdir and stat (another sweep/process) — fine, skip
    }
    if (!stat.isDirectory()) continue;

    const ageMs = now - stat.mtimeMs;
    if (ageMs < maxAgeMs) {
      result.skipped.push(full); // too young — could still be an active render
      continue;
    }

    if (dryRun) {
      result.removed.push(full); // report what WOULD be removed
      continue;
    }

    try {
      fs.rmSync(full, { recursive: true, force: true });
      result.removed.push(full);
    } catch (e) {
      result.errors.push({ dir: full, message: e.message });
    }
  }

  if (result.removed.length > 0) {
    console.log(
      `[bundleCleanup] removed ${result.removed.length} stale bundle dir(s) from ${tmpDir}` +
        (dryRun ? " (dry run)" : ""),
    );
  }
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.warn(`[bundleCleanup] failed to remove ${e.dir}: ${e.message}`));
  }

  return result;
}

// CLI usage: node src/pipelines/pipeline3-render/bundleCleanup.js [--dry-run] [--max-age-minutes=N]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const maxAgeArg = args.find((a) => a.startsWith("--max-age-minutes="));
  const maxAgeMs = maxAgeArg ? Number(maxAgeArg.split("=")[1]) * 60 * 1000 : DEFAULT_MAX_AGE_MS;

  const result = sweepStaleBundles({ maxAgeMs, dryRun });
  console.log(JSON.stringify(result, null, 2));
}