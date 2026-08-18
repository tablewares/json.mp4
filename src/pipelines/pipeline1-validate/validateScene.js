import path from "node:path";
import { loadStructuredFile } from "./parser.js";
import { resolveThemeRefsDeep } from "../../registry/resolveThemeRefs.js";

export function validateScene(ajv, sceneConfig, manifestDir, manifestNarration, fail, themeSources = {}) {
  const { id, path: relPath } = sceneConfig;
  const scenePath = path.join(manifestDir, relPath);
  
  const raw = loadStructuredFile(scenePath);
  const scene = resolveThemeRefsDeep(raw, themeSources);
  const validateSceneSchema = ajv.getSchema("scene.schema.json");

  if (!validateSceneSchema(scene)) {
    fail(`${relPath} `, validateSceneSchema.errors);
  }

  if (scene.id !== id) {
    throw new Error(
      `Validation failed: manifest.scenes entry id "${id}" does not match scene file id "${scene.id}" in ${relPath}`
    );
  }

  if (manifestNarration && scene.narrationRef !== undefined) {
    const known = new Set(manifestNarration.entries.map((e) => e.id));
    if (!known.has(scene.narrationRef)) {
      throw new Error(
        `Validation failed: scene "${id}" narrationRef "${scene.narrationRef}" has no matching narration entry`
      );
    }
  }

  return scene;
}