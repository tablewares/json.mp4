/**
 * Real TTS timing provider for the video framework.
 *
 * Combines the Kyutai local TTS server (pocket_tts/kyutai_tts.js) with
 * WhisperX-based alignment (pocket_tts/whisperAlign.mjs) to produce per-entry
 * start/end timing in seconds from a single synthesized audio pass.
 *
 * Signature (consumed by src/timing/ttsTiming.js):
 *   generateTtsTiming(
 *     entries: ({ id: string, text: string } | { id: string, kind: "silence", durationSeconds: number })[],
 *     fullTranscript: string
 *   ) => Promise<{ timing, totalDuration, audioPath }>
 *
 * Entries may mix spoken text with silent blocks (`{ id, kind: "silence",
 * durationSeconds }`, no narration segment, no TTS synthesis for that
 * entry). Silence is positioned purely by its place in the entries[] array
 * relative to its neighboring ids — see src/timing/silence.js for the pure
 * split/aggregate logic this module wires up to real synthesis + ffmpeg.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { synthesizeVoice } from "../pocket_tts/kyutai_tts.js";
import { alignAudioWords, alignStoryboardToTranscript } from "../pocket_tts/whisperAlign.mjs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { splitNarrationEntries, hasSilenceEntries, buildGlobalTiming } from "../src/timing/silence.js";
import { probeAudioFormat, generateSilenceClip, normalizeClip, concatClips } from "./audio-concat.js";
import fs from "fs";
import crypto from "crypto";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function defaultWorkDir() {
  const dir = path.join(`${__dirname}`, "..", "public", "audio");
  if (!existsSync(dir)) {
    // Best-effort; if it races with another caller that's fine.
    mkdir(dir, { recursive: true }).catch(() => {});
  }
  return dir;
}

// Helper to derive a deterministic hash from input transcript and entries.
// Includes silence-entry fields (kind/durationSeconds) so a silence block's
// duration change invalidates the cache the same way a text edit would.
function computeCacheKey(entries, fullTranscript) {
  const payload = JSON.stringify({
    fullTranscript,
    entries: entries.map((e) =>
      e.kind === "silence"
        ? { id: e.id, kind: e.kind, durationSeconds: e.durationSeconds }
        : { id: e.id, text: e.text },
    ),
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

/**
 * Synthesizes ONE run of consecutive spoken entries as a single audio clip,
 * then WhisperX-aligns each entry's text against that clip's transcript.
 * This is the pre-existing single-pass synthesis logic, unchanged, just
 * extracted so it can run once per "speech run" between silent blocks
 * instead of assuming the whole narration is one run.
 *
 * NOTE on `filename`/`actualPath`: `synthesizeVoice()` (pocket_tts/kyutai_tts.js)
 * always writes its output to `<cwd>/public/audio/<filename>` — it ignores
 * any directory component of `filename` and only uses its basename. So this
 * function takes a bare filename (not a full path) and returns the ACTUAL
 * absolute path the clip landed at, rather than assuming the caller's
 * intended path was honored (it previously wasn't — passing a tmp-dir path
 * here silently wrote into public/audio instead, and the subsequent
 * WhisperX alignment call failed with ENOENT on the tmp-dir path).
 *
 * @param {{id:string,text:string}[]} entries  spoken entries only
 * @param {string} filename  bare filename (no directory), e.g. "speech_0.wav"
 * @param {string|undefined} provider
 * @returns {Promise<{ timing: {id,start,end,words}[], clipDurationSeconds: number, actualPath: string }>}
 */
async function synthesizeSpeechRun(entries, filename, provider) {
  const segmentTranscript = entries.map((e) => e.text).join(" ");

  const { durationSec: clipDurationSeconds } = await synthesizeVoice({
    text: segmentTranscript,
    filename,
    voice: { name: "george" },
    provider,
  }).catch((err) => {
    throw new Error(`TTS synthesis failed: ${err?.message || err}`);
  });

  if (!clipDurationSeconds || !Number.isFinite(clipDurationSeconds)) {
    throw new Error(`TTS synthesis returned invalid duration: ${clipDurationSeconds}`);
  }

  // Mirrors synthesizeVoice's own output-path construction (both the http
  // and python branches write to <cwd>/public/audio/<filename>).
  const actualPath = path.join(process.cwd(), "public", "audio", filename);

  const transcriptWords = await alignAudioWords(actualPath, segmentTranscript, {
    device: "cpu",
  }).catch((err) => {
    throw new Error(`WhisperX alignment failed: ${err?.message || err}`);
  });

  if (transcriptWords.length === 0) {
    throw new Error("WhisperX produced no word-level timing");
  }

  const sceneVoiceoverTexts = entries.map((e) => e.text ?? "");
  let lowConfidence = null;
  const { sceneEndTimes, sceneWords } = alignStoryboardToTranscript(sceneVoiceoverTexts, transcriptWords, {
    onLowConfidence: (info) => {
      lowConfidence = info;
    },
  });

  if (lowConfidence) {
    console.warn(
      `[tts-provider] low alignment confidence: ` +
        `${lowConfidence.matchedCount}/${lowConfidence.totalTokens} tokens ` +
        `(${(lowConfidence.matchRatio * 100).toFixed(1)}%)`,
    );
  }

  const clamp = (t) => Math.min(Math.max(t, 0), clipDurationSeconds);

  const timing = [];
  let prevEnd = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const raw = sceneEndTimes[i] ?? 0;
    let end = Math.min(raw, clipDurationSeconds);
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

  // Last entry in the run must reach the end of its own clip.
  if (timing.length > 0 && entries[entries.length - 1].text?.trim() !== "") {
    const last = timing[timing.length - 1];
    if (last.end < clipDurationSeconds - 0.05) {
      last.end = clipDurationSeconds;
    }
  }

  return { timing, clipDurationSeconds, actualPath };
}

/**
 * Speech-only path (no silence entries present): byte-identical to the
 * pre-silence-feature behavior — one synthesis pass over the whole
 * transcript, one WhisperX alignment pass. Kept as a dedicated branch
 * (rather than always routing through the multi-segment splitter) so
 * existing narrated projects' cache records and audio filenames don't
 * change shape.
 */
async function synthesizeAllSpeech(entries, fullTranscript, audioFilename, provider) {
  const { timing, clipDurationSeconds } = await synthesizeSpeechRun(entries, audioFilename, provider);
  return { timing, totalDuration: clipDurationSeconds };
}

/**
 * Silence-aware path: splits entries into speech runs + silent blocks,
 * synthesizes each speech run as its own clip, generates a matching-format
 * silence clip for each silent block, concatenates everything in order into
 * one master wav at `audioPath`, and stitches the per-run timing onto the
 * master's global timeline via buildGlobalTiming.
 */
async function synthesizeWithSilence(entries, workDir, cacheKey, audioPath, provider) {
  const segments = splitNarrationEntries(entries);
  const tmpDir = path.join(workDir, `.silence_tmp_${cacheKey}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Pass 1: synthesize every speech run (sequential — WhisperX/Kyutai calls
  // don't parallelize safely against a single local server process). Each
  // clip is synthesized to a unique bare filename under public/audio/ (the
  // only place synthesizeVoice will actually write it), then its ACTUAL
  // path is used for alignment and later normalization.
  const speechResultsBySegmentIndex = new Array(segments.length).fill(null);
  let firstSpeechClipPath = null;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment.type !== "speech") continue;
    const filename = `silence_speech_${cacheKey}_${i}.wav`;
    const { timing, clipDurationSeconds, actualPath } = await synthesizeSpeechRun(segment.entries, filename, provider);
    speechResultsBySegmentIndex[i] = { timing, clipDurationSeconds, rawClipPath: actualPath };
    if (!firstSpeechClipPath) firstSpeechClipPath = actualPath;
  }

  if (!firstSpeechClipPath) {
    throw new Error("Narration entries contain only silence — at least one spoken entry is required to derive audio format.");
  }

  // Canonical format every clip (speech + generated silence) is normalized
  // to before the concat-demuxer stitch.
  const format = probeAudioFormat(firstSpeechClipPath);

  // Pass 2: normalize each speech clip and generate each silence clip, in
  // original segment order, building the final concat list.
  const clipPaths = [];
  const rawSpeechPaths = [];
  segments.forEach((segment, i) => {
    if (segment.type === "silence") {
      const silencePath = path.join(tmpDir, `silence_${i}.wav`);
      generateSilenceClip(segment.entry.durationSeconds, silencePath, format);
      clipPaths.push(silencePath);
    } else {
      const rawPath = speechResultsBySegmentIndex[i].rawClipPath;
      rawSpeechPaths.push(rawPath);
      const normalizedPath = path.join(tmpDir, `speech_norm_${i}.wav`);
      normalizeClip(rawPath, normalizedPath, format);
      clipPaths.push(normalizedPath);
    }
  });

  concatClips(clipPaths, audioPath);

  const { timing, totalDuration } = buildGlobalTiming(segments, speechResultsBySegmentIndex);

  // Best-effort cleanup of intermediate clips; the master file at
  // `audioPath` is what matters going forward. Cleans up both the tmpDir
  // (normalized/silence clips) and the raw per-run speech clips that
  // synthesizeVoice wrote directly into public/audio/.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  for (const rawPath of rawSpeechPaths) {
    try {
      fs.rmSync(rawPath, { force: true });
    } catch {}
  }

  return { timing, totalDuration };
}

export async function generateTtsTiming(entries, fullTranscript, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("generateTtsTiming() requires a non-empty entries array");
  }
  if (typeof fullTranscript !== "string" || fullTranscript.trim() === "") {
    throw new Error("generateTtsTiming() requires a non-empty fullTranscript");
  }

  const workDir = defaultWorkDir();
  const cacheKey = computeCacheKey(entries, fullTranscript);
  const cachePath = path.join(workDir, `tts_cache_${cacheKey}.json`);
  // Audio output filename is derived from the cache key so each distinct
  // transcript lands in its own wav (previously hardcoded to a single
  // "hardcoded_voice.wav" that every narration-bearing project overwrote).
  // Cache-hit fallback reuses whatever path the cache record stored, so older
  // records still point at the legacy single file.
  const audioFilename = `tts_${cacheKey}.wav`;
  const audioPath = path.join(workDir, audioFilename);
  const audioPathRelative = toPublicRelative(audioPath);

  // 0) Check cache: return previous timing output if cache file exists.
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

  const provider = options?.provider ?? options?.ttsProvider;
  const containsSilence = hasSilenceEntries(entries);

  const { timing, totalDuration } = containsSilence
    ? await synthesizeWithSilence(entries, workDir, cacheKey, audioPath, provider)
    : await synthesizeAllSpeech(entries, fullTranscript, audioFilename, provider);

  console.log("audiopath", audioPath);
  console.log(
    "entry timing:",
    timing.map((t) => `${t.id}: ${t.start.toFixed(2)}-${t.end.toFixed(2)}`),
  );

  // Save cache record before returning — store the full record so a later
  // cache hit still carries totalDuration + audioPath without re-synthesizing.
  const cacheRecord = { hash: cacheKey, timing, totalDuration, audioPath: audioPathRelative };
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cacheRecord, null, 2), "utf-8");
  } catch (err) {
    console.warn("[tts-provider] Failed to write cache file:", err);
  }

  return { timing, totalDuration, audioPath: audioPathRelative };
}
