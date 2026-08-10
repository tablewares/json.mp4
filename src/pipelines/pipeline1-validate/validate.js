import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { loadStructuredFile } from "./parser.js";
import { validateScene } from "./validateScene.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemaDir = path.join(__dirname, "schema");
  
  // Dynamically load all fragmented schemas
  for (const file of fs.readdirSync(schemaDir)) {
    ajv.addSchema(loadStructuredFile(path.join(schemaDir, file)));
  }
  
  return ajv;
}

function fail(context, errors) {
  const message = errors
    .map((e) => `  - ${context}${e.instancePath || "(root)"} ${e.message}`)
    .join("\n");
  throw new Error(`Validation failed in ${context}:\n${message}`);
}

export function validateProject(manifestPath) {
  const ajv = buildAjv();
  const manifestDir = path.dirname(manifestPath);

  const manifest = loadStructuredFile(manifestPath);
  const validateManifest = ajv.getSchema("manifest.schema.json");
  if (!validateManifest(manifest)) fail(`${manifestPath} `, validateManifest.errors);

  const styles = loadStructuredFile(path.join(manifestDir, manifest.styles));
  const validateStyles = ajv.getSchema("style.schema.json");
  if (!validateStyles(styles)) fail(`${manifest.styles} `, validateStyles.errors);

  const config = loadStructuredFile(path.join(manifestDir, manifest.config));

  // Utilize isolated scene validation
  const scenes = manifest.scenes.map((sceneConfig) => 
    validateScene(ajv, sceneConfig, manifestDir, manifest.narration, fail)
  );

  return { manifest, manifestDir, config, styles, scenes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = process.argv[2] ?? path.join(__dirname, "../../../studio/manifest/example-project/manifest.toon");
  const result = validateProject(manifestPath);
  console.log(`OK: ${result.scenes.length} scene(s) validated for project "${result.manifest.projectId}"`);
}