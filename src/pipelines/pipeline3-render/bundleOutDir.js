import fs from "node:fs";
import path from "node:path";

/**
 * Resolves the single, stable output directory used for every
 * `@remotion/bundler` `bundle()` call in this repo.
 *
 * Why this exists:
 *   By default `bundle({ entryPoint })` creates a fresh
 *   `remotion-webpack-bundle-XXXXXX` directory in os.tmpdir() on EVERY call
 *   (mkdtemp, @remotion/bundler/dist/bundle.js ~line 76) and never removes
 *   the previous one. Repeated renders therefore leave an unbounded trail of
 *   large bundle dirs across /tmp. Remotion's own docs flag this as an
 *   anti-pattern ("Calling bundle() for every video that you render is an
 *   anti-pattern").
 *
 * What this does:
 *   Pass the returned path as `bundle({ outDir })`. @remotion/bundler's
 *   `prepareOutDir()` then does `mkdir(outDir, { recursive: true })` and
 *   returns the SAME directory on every run, instead of mkdtemp-ing a new
 *   one. Webpack rebuilds into the stable dir, overwriting stale files
 *   in place. Exactly one bundle dir is ever created and reused forever.
 *
 *   The dir is rooted under `out/` (gitignored) rather than os.tmpdir() so it
 *   lives with the project, survives machine reboots, and is trivially
 *   inspectable/cleanable by hand (`rm -rf out/.remotion-bundle`).
 *
 *   Reuse is safe: renderMedia/selectComposition only read from the bundle
 *   during their own call; they don't hold long-lived handles to it, and
 *   restarting the process releases everything.
 *
 * @param {string} repoRoot  Absolute path to the repo root (caller resolves it
 *                           via `fileURLToPath(import.meta.url)` etc.).
 * @returns {string} absolute path to the stable bundle outDir.
 */
export function getBundleOutDir(repoRoot) {
  const outDir = path.join(repoRoot, "out", ".remotion-bundle");
  // Ensure it exists so a bare `bundle({ outDir })` call never hits a
  // missing-dir edge case, even though prepareOutDir mkdir's recursively too.
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}
