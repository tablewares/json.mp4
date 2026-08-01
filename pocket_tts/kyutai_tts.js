import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile,mkdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export async function synthesizeVoice({ text, filename = "hardcoded_voice.wav", voice }) {
  const url = "http://localhost:8000/tts";
  const selectedVoice = voice?.name || "george"; // Default voice if none provided
  if (!selectedVoice) {
    throw new Error("voice.name is required");
  }

  // Create multipart/form-data payload
  const formData = new FormData();
  formData.append("text", text);
  formData.append("voice_url", selectedVoice);
  formData.append("temperature", "0.67");
  formData.append("lsd_decode_steps", "3");
  formData.append("eos_threshold", "-6");
  formData.append("frames_after_eos", "10");

  const res = await fetch(url, {
    method: "POST",
    // Note: Do NOT set Content-Type header manually here.
    // Fetch automatically manages boundaries for FormData.
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Local TTS failed (${res.status}): ${body}`);
  }

  // Define server path in public folder & relative web path
  const relativePath = `audio/${filename}`;
  const outPath = path.join("..", "public", relativePath);

  // Ensure public/audio directory exists
  await mkdir(path.dirname(outPath), { recursive: true });

  // Convert response to buffer and save the file
  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  await writeFile(outPath, buf);

  // Calculate and return duration if your helper supports .wav
  let durationSec = await getAudioDurationSec(outPath);

  // Return relative path for staticFile() to serve
  return { outPath, path: relativePath, durationSec };
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
