import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

function resolveProvider(provider, voice) {
  const raw = provider ?? voice?.provider ?? voice?.ttsProvider ?? process.env.TTS_PROVIDER;
  if (typeof raw !== "string") return "python";

  const normalized = raw.trim().toLowerCase();
  if (["http", "fetch", "local-server", "local", "server", "kyutai-http"].includes(normalized)) {
    return "http";
  }
  if (["python", "py", "script", "venv", "local-python", "default"].includes(normalized)) {
    return "python";
  }

  return normalized;
}

export async function synthesizeVoice({ text, filename = "hardcoded_voice.wav", voice, provider }) {
  const selectedProvider = resolveProvider(provider, voice);
  const selectedVoice = voice?.name || "george";
  if (!selectedVoice) {
    throw new Error("voice.name is required");
  }

  if (selectedProvider === "http") {
    const url = "http://localhost:8000/tts";
    const formData = new FormData();
    formData.append("text", text);
    formData.append("voice_url", selectedVoice);
    formData.append("temperature", "0.8");
    formData.append("lsd_decode_steps", "5");
    formData.append("eos_threshold", "0");

    const res = await fetch(url, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Local TTS failed (${res.status}): ${body}`);
    }

    const relativePath = `audio/${filename}`;
    const outPath = path.join(process.cwd(), "public", relativePath);
    await mkdir(path.dirname(outPath), { recursive: true });

    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    await writeFile(outPath, buf);

    const durationSec = await getAudioDurationSec(outPath);
    return { durationSec };
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const venv = path.join(currentDir, ".chattervenv");
  const isWindows = process.platform === "win32";

  const venvPython = isWindows
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const pythonBin = existsSync(venvPython) ? venvPython : "python";

  const relativePath = `audio/${filename}`;
  const outPath = path.join(process.cwd(), "public", relativePath);
  await mkdir(path.dirname(outPath), { recursive: true });

  const scriptPath = path.join(currentDir, "synthesis.py");
  const voicePath = voice?.path || voice?.name || "";

  await execFileAsync(pythonBin, [
    scriptPath,
    "--text", text,
    "--output", outPath,
    "--voice", voicePath,
  ]);

  const durationSec = await getAudioDurationSec(outPath);
  return { durationSec };
}

export async function getAudioDurationSec(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return parseFloat(stdout.trim());
}