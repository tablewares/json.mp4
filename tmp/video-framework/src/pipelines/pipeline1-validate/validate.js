import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function buildAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemaDir = path.join(__dirname, "schema");
  for (const file of fs.readdirSync(schemaDir)) {
    ajv.addSchema(loadJson(path.join(schemaDir, file)));
  }
  return ajv;
}

function fail(context, errors) {
  const message = errors
    .map((e) => `  - ${context}${e.instancePath || "(root)"} ${e.message}`)
    .join("\n");
  throw new Error(`Validation failed in ${context}:\n${message}`);
}

/**
 * Validates a project's manifest + every scene file it points at + its style
 * registry. Throws with a precise, file-scoped error on the first failure.
 * On success, returns { manifest, manifestDir, scenes, styles } — raw
 * (unresolved) data, ready for pipeline2.
 */
export function validateProject(manifestPath) {
  const ajv = buildAjv();
  const manifestDir = path.dirname(manifestPath);

  const manifest = loadJson(manifestPath);
  const validateManifest = ajv.getSchema("manifest.schema.json");
  if (!validateManifest(manifest)) fail(`${manifestPath} `, validateManifest.errors);

  const styles = loadJson(path.join(manifestDir, manifest.styles));
  const validateStyles = ajv.getSchema("style.schema.json");
  if (!validateStyles(styles)) fail(`${manifest.styles} `, validateStyles.errors);

  const config = loadJson(path.join(manifestDir, manifest.config));

  const validateScene = ajv.getSchema("scene.schema.json");
  const scenes = manifest.scenes.map(({ id, path: relPath }) => {
    const scenePath = path.join(manifestDir, relPath);
    const scene = loadJson(scenePath);
    if (!validateScene(scene)) fail(`${relPath} `, validateScene.errors);
    if (scene.id !== id) {
      throw new Error(
        `Validation failed: manifest.scenes entry id "${id}" does not match scene file id "${scene.id}" in ${relPath}`
      );
    }
    if (manifest.narration) {
      const known = new Set(manifest.narration.entries.map((e) => e.id));
      if (!known.has(scene.narrationRef)) {
        throw new Error(
          `Validation failed: scene "${id}" narrationRef "${scene.narrationRef}" has no matching narration entry`
        );
      }
    }
    return scene;
  });

  return { manifest, manifestDir, config, styles, scenes };
}

// CLI usage: node validate.js path/to/manifest.json
if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = process.argv[2] ?? path.join(__dirname, "../../manifest/example-project/manifest.json");
  const result = validateProject(manifestPath);
  console.log(`OK: ${result.scenes.length} scene(s) validated for project "${result.manifest.projectId}"`);
}
