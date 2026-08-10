import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Import the direct API directly instead of spawning CLI processes
import { runAgentCommand } from "./agent-cli.mjs";

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
  throw new Error(`invalid step structure: ${JSON.stringify(step)}`);
}

async function executeStep({ command, args }) {
  try {
    // Call JS logic directly; preserving full object structures and native errors
    const data = await runAgentCommand(command, args);
    return { command, args, ok: true, result: data };
  } catch (err) {
    return { command, args, ok: false, error: err.message ?? String(err) };
  }
}

// Entry Point Parsing
const raw = process.argv[2];
if (!raw) fail(new Error("Usage: node scripts/agent-batch.mjs '<json>'"));

let input;
try {
  input = JSON.parse(raw === "-" ? readStdinSync() : raw);
} catch (e) {
  fail(new Error(`invalid batch JSON: ${e.message}`));
}

const steps = Array.isArray(input) ? input : input?.steps;
const continueOnError = Boolean(input?.continueOnError);

if (!Array.isArray(steps)) {
  fail(new Error("batch input must be an array or contain a 'steps' array"));
}

const results = [];
let stopped = false;

for (const rawStep of steps) {
  if (stopped) {
    results.push({ ...normalizeStep(rawStep), skipped: true });
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

  const outcome = await executeStep(step);
  results.push(outcome);
  if (!outcome.ok && !continueOnError) stopped = true;
}

// Print results reliably formatted for LLM consumption
const allOk = results.every((r) => r.ok !== false);
console.log(`ok: ${allOk}`);
for (const res of results) {
  if (res.skipped) {
    console.log(`skipped: ${res.command}`);
  } else if (!res.ok) {
    console.log(`command: ${res.command}`);
    console.log(`error: ${res.error}`);
  } else {
    console.log(`command: ${res.command}`);
    if (res.result !== undefined) {
      // Serialize objects explicitly to prevent "[object Object]" print issues
      console.log(typeof res.result === "string" ? res.result : JSON.stringify(res.result));
    }
  }
}

process.exit(allOk ? 0 : 1);