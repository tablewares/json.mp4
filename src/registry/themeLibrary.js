// src/registry/themeLibrary.js
//
// Discovery-only helper over studio/library/themes/*.json — named,
// reusable style-registry presets (style.schema.json shape: colors,
// typography, spacing, easing) that live OUTSIDE any one project, so an
// agent (or `scripts/project-cli.js create --theme <name>`) can pick one
// instead of hand-writing a theme from scratch or copying an existing
// project's styles/theme.json.
//
// Deliberately has no write path here — writes go through
// scripts/lib/ops.js `theme create`/`theme use` (CommonJS CLI side), which
// already owns Workspace/atomic-write machinery for studio/manifest. This
// module is read-only, mirroring how aliasRegistry.js's `listAliases` /
// `describeAlias` are read-only relative to aliasLibrary.js's loader.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_THEME_LIBRARY_DIR = path.resolve(__dirname, "../../studio/library/themes");

function themeFile(dir, name) {
  return path.join(dir, `${name}.json`);
}

/** Lists every theme preset name + a one-line summary (color/typography token counts). */
export function listThemes(opts = {}) {
  const dir = opts.dir ?? DEFAULT_THEME_LIBRARY_DIR;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const name = f.slice(0, -".json".length);
      let theme;
      try {
        theme = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      } catch (e) {
        return { name, error: `could not parse ${f}: ${e.message}` };
      }
      return {
        name,
        colorTokens: Object.keys(theme.colors ?? {}).length,
        typographyTokens: Object.keys(theme.typography ?? {}).length,
        easingTokens: Object.keys(theme.easing ?? {}).length,
      };
    });
}

/** Full JSON for one named theme preset. */
export function describeTheme(name, opts = {}) {
  const dir = opts.dir ?? DEFAULT_THEME_LIBRARY_DIR;
  const p = themeFile(dir, name);
  if (!fs.existsSync(p)) {
    const available = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length))
      : [];
    throw new Error(`Unknown theme "${name}". Available: ${available.join(", ") || "(none)"}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
