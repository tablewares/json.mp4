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
  formData.append("temperature", "0.8");
  formData.append("lsd_decode_steps", "5");
  formData.append("eos_threshold", "0");

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
  const outPath = path.join(process.cwd(), "public", relativePath);

  // Ensure public/audio directory exists
  await mkdir(path.dirname(outPath), { recursive: true });

  // Convert response to buffer and save the file
  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  await writeFile(outPath, buf);

  // Calculate and return duration if your helper supports .wav
  let durationSec = await getAudioDurationSec(outPath);

  // Return relative path for staticFile() to serve
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

// export async function synthesizeVoice({ text, filename = "hardcoded_voice.wav", voice }) {
//   const selectedVoice = voice?.name || "YOUR_FILE.wav"; // Default voice or reference audio path
//   if (!selectedVoice) {
//     throw new Error("voice.name is required");
//   }

//   // Define server path in public folder
//   const relativePath = `audio/${filename}`;
//   const outPath = path.join(process.cwd(), "public", relativePath);

//   // Ensure target directory exists
//   await mkdir(path.dirname(outPath), { recursive: true });

//   // Python inline script matching ChatterboxTTS generation example
//   const pythonScript = `
// import torchaudio as ta
// import torch
// from pathlib import Path
// from chatterbox.tts import ChatterboxTTS

// if torch.cuda.is_available():
//     device = "cuda"
// elif torch.backends.mps.is_available():
//     device = "mps"
// else:
//     device = "cpu"

// model = ChatterboxTTS.from_pretrained(device=device)

// text = """${text.replace(/"/g, '\\"')}"""
// audio_prompt = "${selectedVoice}"

// if Path(audio_prompt).exists():
//     wav = model.generate(
//         text,
//         audio_prompt_path=audio_prompt,
//         temperature=0.8,
//         lsd_decode_steps=5,
//         eos_threshold=0.0
//     )
// else:
//     wav = model.generate(
//         text,
//         temperature=0.8,
//         lsd_decode_steps=5,
//         eos_threshold=0.0
//     )

// ta.save("${outPath.replace(/\\/g, "/")}", wav, model.sr)
// `;

//   try {
//     // Run python binary directly with the script
//     await execFileAsync(".venv/bin/python", ["-c", pythonScript]);
//   } catch (error) {
//     throw new Error(`Chatterbox synthesis failed: ${error.stderr || error.message}`);
//   }

//   // Calculate and return duration
//   let durationSec = await getAudioDurationSec(outPath);

//   return { durationSec };
// }