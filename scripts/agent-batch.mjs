#!/usr/bin/env node
// scripts/agent-batch.mjs
//
// Batch wrapper around scripts/agent-cli.mjs: runs a LIST of CLI commands
// in one call instead of one `node scripts/agent-cli.mjs ...` process per
// step. Each step spawns the exact same agent-cli.mjs as a subprocess — so
// it behaves identically to running that command by hand — and every
// result collects into one JSON array. Use this whenever you're about to
// issue more than two or three agent-cli.mjs commands in a row (e.g.
// building out a whole scene's worth of assets); use plain agent-cli.mjs
// directly for a single command.
//
// Usage:
//   node scripts/agent-batch.mjs '<json>'
//   echo '<json>' | node scripts/agent-batch.mjs -
//
// <json> is either a bare array of steps, or { steps: [...], continueOnError?: boolean }.
// Each step is either:
//   ["command", arg1, arg2, ...]                     (positional array — the common case)
//   { "command": "...", "args": [arg1, arg2, ...] }  (object form, equivalent)
//
// Any array/object element within a step's args is automatically
// JSON.stringify'd before being passed to agent-cli.mjs as a CLI argument —
// write plain JSON in your batch, never a pre-escaped string.
//
// By default the batch STOPS at the first failing step; every step after it
// is included in the output with { skipped: true } rather than being run.
// Pass { "continueOnError": true } alongside "steps" to run every step
// regardless of earlier failures (useful when later steps don't depend on
// earlier ones, e.g. adding several independent scenes).
//
// Prints a compact text summary instead of pretty JSON, keeping the output
// smaller and easier for an LLM agent to consume without the surrounding
// JSON punctuation overhead.
//
// Example — scaffold a whole scene in one call:
//   node scripts/agent-batch.mjs '[
//     ["init", {"projectId":"demo"}],
//     ["add-scene", "demo", {"id":"scene-001","transitionOut":{"type":"default"}}],
//     ["add-asset", "demo", "scene-001", {"assetType":"TextBlock","anchor":{"position":"center"},"contentOverride":{"text":"Hi."}}],
//     ["add-asset", "demo", "scene-001", {"assetType":"ImageReveal","anchor":{"position":"right"},"contentOverride":{"src":"assets/hero.png"}}],
//     ["validate", "demo"]
//   ]'

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const CLI_SCRIPT = path.join(__dirname, "agent-cli.mjs");

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function fail(err) {
  console.log(`error: ${err.message ?? String(err)}`);
  process.exit(1);
}

function normalizeStep(step) {
  if (Array.isArray(step)) {
    const [command, ...args] = step;
    return { command, args };
  }
  if (step && typeof step === "object" && step.command) {
    return { command: step.command, args: step.args ?? [] };
  }
  throw new Error(`invalid batch step (expected ["command", ...args] or {command,args}): ${JSON.stringify(step)}`);
}

// Strings pass through untouched (so e.g. a projectId or sceneId stays a
// plain positional arg); anything else — the JSON payload arguments — gets
// serialized the way agent-cli.mjs expects on the command line.
function stringifyArg(arg) {
  return typeof arg === "string" ? arg : JSON.stringify(arg);
}

function parseAgentOutput(stdout) {
  if (!stdout) return null;

  const text = stdout.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    if (text.startsWith("error:")) {
      return { error: text.slice("error:".length).trim() };
    }
    return text;
  }
}

function runStep({ command, args }) {
  const cliArgs = [CLI_SCRIPT, command, ...args.map(stringifyArg)];
  const proc = spawnSync("node", cliArgs, { cwd: repoRoot, encoding: "utf-8" });
  const stdout = (proc.stdout ?? "").trim();

  const parsed = parseAgentOutput(stdout);

  if (proc.status === 0) {
    return { command, args, ok: true, result: parsed };
  }
  const error =
    (parsed && typeof parsed === "object" && parsed.error) ||
    (proc.stderr || "").trim() ||
    stdout ||
    `agent-cli.mjs exited with code ${proc.status}`;
  return { command, args, ok: false, error };
}

// -- entry point --------------------------------------------------------------

const raw = process.argv[2];
if (raw === undefined) {
  fail(new Error("usage: node scripts/agent-batch.mjs '<json array of steps>' (or '-' to read JSON from stdin)"));
}

let input;
try {
  input = JSON.parse(raw === "-" ? readStdinSync() : raw);
} catch (e) {
  fail(new Error(`invalid batch JSON: ${e.message}`));
}

let steps;
let continueOnError = false;
if (Array.isArray(input)) {
  steps = input;
} else if (input && typeof input === "object" && Array.isArray(input.steps)) {
  steps = input.steps;
  continueOnError = Boolean(input.continueOnError);
} else {
  fail(new Error('batch input must be an array of steps, or { "steps": [...], "continueOnError"?: boolean }'));
}

const results = [];
let stopped = false;

for (const rawStep of steps) {
  if (stopped) {
    let step;
    try {
      step = normalizeStep(rawStep);
    } catch {
      step = { command: undefined, args: [] };
    }
    results.push({ ...step, skipped: true });
    continue;
  }

  let step;
  try {
    step = normalizeStep(rawStep);
  } catch (e) {
    results.push({ ok: false, error: e.message, step: rawStep });
    if (!continueOnError) stopped = true;
    continue;
  }

  const outcome = runStep(step);
  results.push(outcome);
  if (outcome.ok === false && !continueOnError) stopped = true;
}

const allOk = results.every((r) => r.ok !== false);
console.log(`ok: ${allOk}`);
for (const result of results) {
  if (result.skipped) {
    console.log(`skipped: ${result.command ?? "unknown"}`);
    continue;
  }
  if (result.ok === false) {
    console.log(`command: ${result.command ?? "unknown"}`);
    console.log(`error: ${result.error}`);
    continue;
  }
  console.log(`command: ${result.command ?? "unknown"}`);
  if (result.result !== null && result.result !== undefined) {
    console.log(String(result.result));
  }
}
process.exit(allOk ? 0 : 1);
