// src/agent/validators.js
//
// Compile-on-first-use AJv validators shared across ProjectBuilder
// camera/motion write-time checks. These never block normal render: each
// cached validator is lazy-loaded on first call so a CLI run that
// doesn't touch camera or motion never pays the compile cost.
//
// Each check returns [] when the spec is clean, or human-readable error
// strings when not — matching the `checkAgainstSchema` contract the
// asset contentOverride path uses.
//
// Split out of ProjectBuilder.js: validators heap-allocate the Ajv
// per-dispose and load four sibling schema files from disk. Keeping
// them in their own module means importers that never write camera /
// motion (the introspection CLI, tests for `addScene`) never pull Ajv
// or ajv-formats into their hot module graph.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

import { resolveMotion } from "../motion/motion.js";
import { resolveAssetEffects } from "../effects/assetEffects.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(
  __dirname,
  "../pipelines/pipeline1-validate/schema",
);

export function checkAgainstSchema(schema, value) {
  if (!schema) return [];
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateFn = ajv.compile(schema);
  if (validateFn(value)) return [];
  return validateFn.errors.map((e) => `${e.instancePath || "(root)"} ${e.message}`);
}

function loadSchemaAjv() {
  const sceneSchema = JSON.parse(
    fs.readFileSync(path.join(SCHEMA_DIR, "scene.schema.json"), "utf-8"),
  );
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  // scene.schema.json $refs three sibling schema files
  // (transition.schema.json, shared.schema.json, camera.schema.json);
  // all must be registered with this Ajv instance before any sub-schema
  // is resolved, otherwise getSchema throws "can't resolve reference".
  for (const sib of [
    "transition.schema.json",
    "shared.schema.json",
    "camera.schema.json",
  ]) {
    const sibPath = path.join(SCHEMA_DIR, sib);
    if (!ajv.getSchema(sib)) {
      ajv.addSchema(
        JSON.parse(fs.readFileSync(sibPath, "utf-8")),
        sib,
      );
    }
  }
  if (!ajv.getSchema("scene.schema.json")) {
    ajv.addSchema(sceneSchema, "scene.schema.json");
  }
  return ajv;
}

/**
 * Caches a compiled `scene.schema.json#/definitions/cameraSpec` validator
 * (Ajv) so setCamera / updateCamera / addCameraAction can sanity-check a
 * cameraSpec at write time, standing parallel to addAsset's content-schema
 * check. Returns an empty array when the spec is clean, or human-readable
 * error strings when not — same return shape as `checkAgainstSchema`.
 *
 * Lazy-loaded on first call so a CLI run that doesn't touch camera never
 * pays the compile cost.
 */
let _cachedCameraValidator = null;
export function checkCameraSpec(cameraSpec) {
  if (cameraSpec == null) return [];
  if (_cachedCameraValidator === null) {
    const ajv = loadSchemaAjv();
    // getSchema resolves the #/definitions/cameraSpec sub-schema. The
    // cameraSpec definition lives in camera.schema.json (scene.schema.json
    // only $refs it); resolving against the owning $id returns the compiled
    // validator function, which is exactly what validate.js uses at run
    // time, so a cameraSpec that passes here will also pass validate.
    _cachedCameraValidator = ajv.getSchema("camera.schema.json#/definitions/cameraSpec");
  }
  if (_cachedCameraValidator(cameraSpec)) return [];
  return (_cachedCameraValidator.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`);
}

/**
 * Caches a compiled `scene.schema.json#/definitions/motionSpec` validator,
 * standing parallel to checkCameraSpec. Returns [] when clean, or
 * human-readable error strings when not.
 */
let _cachedMotionValidator = null;
export function checkMotionSpec(motionSpec) {
  if (motionSpec == null) return [];
  if (_cachedMotionValidator === null) {
    const ajv = loadSchemaAjv();
    _cachedMotionValidator = ajv.getSchema("scene.schema.json#/definitions/motionSpec");
  }
  if (_cachedMotionValidator(motionSpec)) return [];
  return (_cachedMotionValidator.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`);
}

export function checkMotionAliases(motionSpec) {
  if (motionSpec == null) return [];
  try {
    resolveMotion(motionSpec);
    return [];
  } catch (e) {
    return [e.message];
  }
}

/**
 * Caches a compiled `shared.schema.json#/definitions/timingAnchor` validator
 * for the NEW enterAt/exitAt object form. A bare number (the legacy
 * fraction form) is always valid and short-circuits without touching Ajv.
 * Returns [] when clean, or human-readable error strings when not — same
 * contract as checkCameraSpec/checkMotionSpec.
 */
let _cachedTimingAnchorValidator = null;
export function checkAssetEffects(effectsSpec) {
  if (effectsSpec == null) return [];
  try {
    resolveAssetEffects(effectsSpec);
    return [];
  } catch (e) {
    return [e.message];
  }
}

export function checkTimingAnchor(value) {
  if (value == null || typeof value !== "object") return []; // legacy number form, or omitted
  if (_cachedTimingAnchorValidator === null) {
    const ajv = loadSchemaAjv();
    // shared.schema.json isn't registered under its own $id by
    // loadSchemaAjv's sibling loop when only scene.schema.json is the
    // entry point being resolved — it IS one of the three siblings
    // scene.schema.json $refs, so it's already added; getSchema just
    // needs the fragment path.
    _cachedTimingAnchorValidator = ajv.getSchema("shared.schema.json#/definitions/timingAnchor");
  }
  if (_cachedTimingAnchorValidator(value)) return [];
  return (_cachedTimingAnchorValidator.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`);
}
