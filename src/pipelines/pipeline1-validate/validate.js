// src/pipelines/pipeline1-validate/validate.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { decode as decodeToon } from "@toon-format/toon"; // verify exact package/import name on npm before installing — see note below

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loads a manifest/config/scene/style file as a plain JS object, regardless
 * of whether it's authored as JSON or TOON. This is the ONLY place format
 * detection happens. Everything downstream — Ajv validation in this file,
 * resolveProject/resolveScene in pipeline2, Composition.jsx in pipeline3 —
 * only ever sees a plain object and has no idea which format the file was
 * written in.
 *
 * TOON is decoded HERE, not in pipeline2, because validateProject runs Ajv
 * against the decoded object before resolveProject does anything else —
 * decoding has to happen before schema validation, not after it.
 */
function loadStructuredFile(p) {
  const raw = fs.readFileSync(p, "utf-8");
  const ext = path.extname(p).toLowerCase();
  if (ext === ".toon") {
    try {
      // Replace non-breaking spaces (\u00A0) with normal spaces (\u0020)
      const sanitized = raw.replace(/\u00a0/g, " ");
      return decodeToon(sanitized);
    } catch (e) {
      throw new Error(`Failed to decode TOON file ${p}: ${e.message}`);
    }
  }
  return JSON.parse(raw);
}

function buildAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemaDir = path.join(__dirname, "schema");
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

  const validateScene = ajv.getSchema("scene.schema.json");
  const scenes = manifest.scenes.map(({ id, path: relPath }) => {
    const scenePath = path.join(manifestDir, relPath);
    const scene = loadStructuredFile(scenePath);
    if (!validateScene(scene)) fail(`${relPath} `, validateScene.errors);
    if (scene.id !== id) {
      throw new Error(
        `Validation failed: manifest.scenes entry id "${id}" does not match scene file id "${scene.id}" in ${relPath}`
      );
    }
    if (manifest.narration && scene.narrationRef !== undefined) {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = process.argv[2] ?? path.join(__dirname, "../../../studio/manifest/example-project/manifest.toon");
  const result = validateProject(manifestPath);
  console.log(`OK: ${result.scenes.length} scene(s) validated for project "${result.manifest.projectId}"`);
}