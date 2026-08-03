/**
 * Real TTS timing provider for the video framework.
 *
 * Combines the Kyutai local TTS server (pocket_tts/kyutai_tts.js) with
 * WhisperX-based alignment (pocket_tts/whisperAlign.mjs) to produce per-entry
 * start/end timing in seconds from a single synthesized audio pass.
 *
 * Signature (consumed by src/timing/ttsTiming.js):
 *   generateTtsTiming(
 *     entries: { id: string, text: string }[],
 *     fullTranscript: string
 *   ) => Promise<{ id: string, start: number, end: number }[]>  // seconds
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { synthesizeVoice } from "../pocket_tts/kyutai_tts.js";
import { alignAudioWords, alignStoryboardToTranscript } from "../pocket_tts/whisperAlign.mjs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function defaultWorkDir() {
  const dir = path.join(`${__dirname}`, "..","public", "audio");
  if (!existsSync(dir)) {
    // Best-effort; if it races with another caller that's fine.
    mkdir(dir, { recursive: true }).catch(() => {});
  }
  return dir;
}

/**
 * Synthesizes the concatenated transcript as one audio file via the local
 * Kyutai TTS server, then aligns each entry's text against the WhisperX
 * transcript of that audio to recover per-entry start/end times.
 *
 * @param {{id: string, text: string}[]} entries
 * @param {string} fullTranscript  Concatenation of entries' text (same string
 *   that gets synthesized; the caller owns the join policy so it matches
 *   whatever was fed to the storyboard).
 * @returns {Promise<{
 *   timing: {id: string, start: number, end: number, words: {word: string, start: number, end: number}[]}[],
 *   totalDuration: number,          // seconds — the synthesized audio's real length
 *   audioPath: string,             // path relative to public/ so Remotion's staticFile() can play it
 * }>}
 */
import fs from "fs";
import crypto from "crypto";

// Helper to derive a deterministic hash from input transcript and entries
function computeCacheKey(entries, fullTranscript) {
  const payload = JSON.stringify({
    fullTranscript,
    entries: entries.map((e) => ({ id: e.id, text: e.text })),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

// Convert an absolute filesystem path that lives under <repo>/public/ into a
// path relative to public/ (e.g. "/abs/.../public/audio/foo.wav" →
// "audio/foo.wav"). Remotion's staticFile() only accepts the relative form.
function toPublicRelative(absPath) {
  const idx = absPath.replace(/\\/g, "/").indexOf("public/");
  if (idx < 0) throw new Error(`TTS audio path is not under public/: ${absPath}`);
  return absPath.slice(idx + "public/".length);
}

// Probe an audio file's duration in seconds via ffprobe. Used to backfill
// `totalDuration` when an older cache record (from before the provider
// returned { totalDuration, audioPath }) is loaded and the synthesized wav
// still lives on disk. Returns null if ffprobe is unavailable or the file
// is missing so callers can fall back gracefully.
import { execFileSync } from "node:child_process";
function probeAudioDurationSeconds(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", absPath],
      { encoding: "utf-8" },
    ).trim();
    const n = parseFloat(out);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function generateTtsTiming(entries, fullTranscript) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("generateTtsTiming() requires a non-empty entries array");
  }
  if (typeof fullTranscript !== "string" || fullTranscript.trim() === "") {
    throw new Error("generateTtsTiming() requires a non-empty fullTranscript");
  }

  const workDir = defaultWorkDir();
  const cacheKey = computeCacheKey(entries, fullTranscript);
  const cachePath = path.join(workDir, `tts_cache_${cacheKey}.json`);
  const audioPath = path.join(workDir, `hardcoded_voice.wav`);
  const audioPathRelative = toPublicRelative(audioPath);

  // 0) Check cache: return previous timing output if cache file exists.
  // The cache stores the full { timing, totalDuration, audioPath } record so
  // a cache hit still carries enough for resolve.js to build audioOverlay
  // without re-synthesizing. Records written by older provider versions only
  // had { hash, timing } — backfill totalDuration by probing the existing
  // synthesized wav on disk (the cache implies it was written) and persist
  // the upgraded record so the next hit is clean.
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      console.log(`[tts-provider] Cache hit for key: ${cacheKey}`);
      let totalDuration = cached.totalDuration;
      if (totalDuration == null) {
        totalDuration = probeAudioDurationSeconds(audioPath);
      }
      if (!cached.totalDuration || !cached.audioPath) {
        try {
          fs.writeFileSync(
            cachePath,
            JSON.stringify(
              { hash: cacheKey, timing: cached.timing, totalDuration, audioPath: cached.audioPath ?? audioPathRelative },
              null,
              2,
            ),
            "utf-8",
          );
        } catch {}
      }
      return {
        timing: cached.timing,
        totalDuration,
        audioPath: cached.audioPath ?? audioPathRelative,
      };
    } catch (e) {
      console.warn("[tts-provider] Cache read failed, re-computing...", e);
    }
  }

  // 1) Single-pass synthesis of the whole transcript.
  const { durationSec: totalDuration } = await synthesizeVoice({
    text: fullTranscript,
    outPath: audioPath,
    voice: { name: "george" },
  }).catch((err) => {
    throw new Error(`TTS synthesis failed: ${err?.message || err}`);
  });

  if (!totalDuration || !Number.isFinite(totalDuration)) {
    throw new Error(`TTS synthesis returned invalid duration: ${totalDuration}`);
  }
  console.log("audiopath", audioPath);

  // 2) WhisperX word-level alignment of the combined audio.
  const transcriptWords = await alignAudioWords(audioPath, fullTranscript, {
    device: "cpu",
  }).catch((err) => {
    throw new Error(`WhisperX alignment failed: ${err?.message || err}`);
  });

  if (transcriptWords.length === 0) {
    throw new Error("WhisperX produced no word-level timing");
  }
  
  // 3) Align storyboard entries to transcript → cumulative end time per entry
  const sceneVoiceoverTexts = entries.map((e) => e.text ?? "");
  let lowConfidence = null;
  const { sceneEndTimes, sceneWords } = alignStoryboardToTranscript(
    sceneVoiceoverTexts,
    transcriptWords,
    {
      onLowConfidence: (info) => { lowConfidence = info; },
    },
  );

  if (lowConfidence) {
    console.warn(
      `[tts-provider] low alignment confidence: ` +
      `${lowConfidence.matchedCount}/${lowConfidence.totalTokens} tokens ` +
      `(${(lowConfidence.matchRatio * 100).toFixed(1)}%)`
    );
  }
  console.log("sceneEndTimes:", sceneEndTimes);

  const clamp = (t) => Math.min(Math.max(t, 0), totalDuration);

  // 4) Build per-entry {start, end, words} from cumulative end times.
  const timing = [];
  let prevEnd = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const raw = sceneEndTimes[i] ?? 0;
    let end = Math.min(raw, totalDuration);
    if (end < prevEnd) end = prevEnd; // monotonic guard
    const start = prevEnd;
    const words = (sceneWords[i] ?? []).map((w) => ({
      word: w.word,
      start: clamp(w.start),
      end: clamp(w.end),
    }));
    timing.push({ id: entries[i].id, start, end, words });
    prevEnd = end;
  }

  // Last entry must reach the end of the audio unless it had no text.
  if (timing.length > 0 && entries[entries.length - 1].text?.trim() !== "") {
    const last = timing[timing.length - 1];
    if (last.end < totalDuration - 0.05) {
      last.end = totalDuration;
    }
  }

  // 5) Save cache record before returning — store the full record so a later
  // cache hit still carries totalDuration + audioPath without re-synthesizing.
  const cacheRecord = { hash: cacheKey, timing, totalDuration, audioPath: audioPathRelative };
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cacheRecord, null, 2), "utf-8");
  } catch (err) {
    console.warn("[tts-provider] Failed to write cache file:", err);
  }

  return { timing, totalDuration, audioPath: audioPathRelative };
}