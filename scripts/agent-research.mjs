#!/usr/bin/env node
// scripts/agent-research.mjs
//
// Stage 1 of the topic-to-render pipeline. Takes a free-text topic and emits
// a structured JSON research brief that Stage 2 (agent-plan.mjs) can plan a
// video around. The script itself does NOT call the web — it accepts the
// topic and an optional --research <path> JSON file the agent pre-populated
// from its Hermes web_search/web_extract calls, normalizes the shape, splits
// the synthesized content into N narration scenes, and writes entries + a
// fullTranscript that the framework's TTS provider will time against.
//
// Usage:
//   node scripts/agent-research.mjs <topic> [--research <path>] [--scenes <n>]
//
// Emits a JSON document to stdout:
//   { ok, projectId, topic, narration:{entries,fullTranscript}, scenes:[...] }
// Exits 0 on success, 1 with { ok:false, error } on failure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const CLI_SCRIPT = path.join(__dirname, "agent-cli.mjs");

// -- helpers ------------------------------------------------------------------

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

function emit(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: message }, null, 2) + "\n");
  process.exit(1);
}

function listExistingProjects() {
  try {
    const proc = spawnSync("node", [CLI_SCRIPT, "projects"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    if (proc.status !== 0) return [];
    const text = (proc.stdout ?? "").trim();
    // The CLI renders one "projectId" per line prefixed with "- ". Parse the
    // raw lines defensively — any non-empty token after a dash is a project id.
    const ids = [];
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*-\s*(\S+)/);
      if (m) ids.push(m[1]);
    }
    return ids;
  } catch {
    return [];
  }
}

function dedupeProjectId(base, existing) {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function loadResearchFile(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, "utf-8");
  } catch (e) {
    throw new Error(`could not read --research file "${p}": ${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`--research file "${p}" is not valid JSON: ${e.message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`--research file "${p}" must be a JSON object`);
  }
  // Lenient defaults for missing fields.
  return {
    topic: typeof parsed.topic === "string" ? parsed.topic : "",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
  };
}

// Combine a scene's headline + narration + facts into one canonical narration
// string only when the scene's `narration` is absent. Predictable, canned.
function canonNarration(scene) {
  if (typeof scene.narration === "string" && scene.narration.trim().length > 0) {
    return scene.narration.trim();
  }
  const parts = [];
  if (typeof scene.headline === "string" && scene.headline.trim()) {
    parts.push(scene.headline.trim().replace(/\.$/, ""));
  }
  const facts = Array.isArray(scene.facts) ? scene.facts.filter((f) => typeof f === "string" && f.trim()) : [];
  for (const f of facts) parts.push(f.trim().replace(/\.$/, ""));
  return parts.join(". ") + (parts.length ? "." : "");
}

// -- entry point --------------------------------------------------------------

const argv = process.argv.slice(2);
let topic = null;
let researchPath = null;
let sceneCount = 3;

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--research") {
    researchPath = argv[++i];
  } else if (a === "--scenes") {
    sceneCount = parseInt(argv[++i], 10);
  } else if (!topic && !a.startsWith("--")) {
    topic = a;
  }
}

if (!topic || !topic.trim()) {
  fail("missing required positional argument: topic (free text)");
}
const maxScenes = 6;
if (!Number.isFinite(sceneCount) || sceneCount < 1) {
  fail(`--scenes must be a positive integer (got ${sceneCount})`);
}
if (sceneCount > maxScenes) {
  process.stderr.write(`warning: --scenes ${sceneCount} exceeds max ${maxScenes}; clamping.\n`);
  sceneCount = maxScenes;
}

const projectIdBase = slugify(topic);
if (!projectIdBase) {
  fail(`topic slugified to empty (got "${topic}") — supply a non-empty topic`);
}
const projectId = dedupeProjectId(projectIdBase, listExistingProjects());

// Assemble the scene list from the research file (or synthesize placeholders).
let research = { topic, summary: "", scenes: [] };
if (researchPath) {
  research = loadResearchFile(researchPath);
  if (!research.topic) research.topic = topic;
}

let scenes;
if (research.scenes.length === 0) {
  process.stderr.write(`warning: no scenes in --research file or no --research given; synthesizing ${sceneCount} placeholders.\n`);
  scenes = [];
  for (let i = 0; i < sceneCount; i += 1) {
    const id = `scene-${String(i + 1).padStart(3, "0")}`;
    scenes.push({
      id,
      headline: "",
      narration: `[Research topic: ${topic} — scene ${i + 1}]`,
      facts: [],
      sources: [],
    });
  }
} else if (research.scenes.length < sceneCount) {
  process.stderr.write(`warning: --scenes ${sceneCount} but research file has ${research.scenes.length}; padding with placeholders.\n`);
  scenes = research.scenes.slice();
  for (let i = scenes.length; i < sceneCount; i += 1) {
    const id = `scene-${String(i + 1).padStart(3, "0")}`;
    scenes.push({
      id,
      headline: "",
      narration: `[Research topic: ${topic} — scene ${i + 1}]`,
      facts: [],
      sources: [],
    });
  }
} else if (research.scenes.length > sceneCount) {
  process.stderr.write(`warning: --scenes ${sceneCount} but research file has ${research.scenes.length}; truncating.\n`);
  scenes = research.scenes.slice(0, sceneCount);
} else {
  scenes = research.scenes.slice();
}

// Normalize the scenes: ensure id, narration, facts, sources, headline.
const normalized = scenes.map((s, idx) => {
  const id = (typeof s.id === "string" && s.id.trim()) ? s.id : `scene-${String(idx + 1).padStart(3, "0")}`;
  const headline = typeof s.headline === "string" ? s.headline : "";
  const narration = canonNarration(s);
  const facts = Array.isArray(s.facts) ? s.facts.filter((f) => typeof f === "string") : [];
  const sources = Array.isArray(s.sources) ? s.sources.filter((o) => o && typeof o === "object") : [];
  return { id, headline, narration, facts, sources };
});

// Assemble narration.entries + fullTranscript for the TTS layer.
const entries = normalized.map((s) => ({ id: s.id, text: s.narration }));
const fullTranscript = entries.map((e) => e.text).join(" ");

emit({
  ok: true,
  projectId,
  topic: research.topic || topic,
  narration: { entries, fullTranscript },
  scenes: normalized,
});
process.exit(0);
