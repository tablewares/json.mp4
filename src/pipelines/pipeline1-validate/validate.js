import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { loadStructuredFile } from "./parser.js";
import { validateScene } from "./validateScene.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemaDir = path.join(__dirname, "schema");

  // Dynamically load all fragmented schemas. Files are added under their own
  // $id (e.g. "scene.schema.json", "shared.schema.json"), so the same AJV
  // instance can be used to resolve cross-file $refs at introspection time
  // (see src/agent/schemaIntrospect.js) as well as to validate manifests.
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

  // "$theme.*" / "$physics.*" / "$config.*" — the read-only environment
  // scenes can point into. `theme` is always available. `physics` is
  // additive: only present when manifest.physicsPresets is declared, a
  // reusable library of named physics specs an agent can point a whole
  // `physics` field at instead of re-guessing restitution/friction/force
  // numbers per asset. Strict no-op for every project that doesn't declare it.
  const themeSources = { theme: styles, config };
  if (manifest.physicsPresets) {
    themeSources.physics = loadStructuredFile(path.join(manifestDir, manifest.physicsPresets));
  }

  // Utilize isolated scene validation
  const scenes = manifest.scenes.map((sceneConfig) => 
    validateScene(ajv, sceneConfig, manifestDir, manifest.narration, fail, themeSources)
  );

  return { manifest, manifestDir, config, styles, scenes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = process.argv[2] ?? path.join(__dirname, "../../../studio/manifest/example-project/manifest.toon");
  const result = validateProject(manifestPath);
  console.log(`OK: ${result.scenes.length} scene(s) validated for project "${result.manifest.projectId}"`);
}