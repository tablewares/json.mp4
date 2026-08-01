// src/utils/whisperAlign.mjs
//
// Support for "single-pass" voice synthesis: instead of calling the TTS
// engine once per scene, the caller concatenates every scene's voiceover
// text, synthesizes it as ONE audio file, and inserts that single file as
// the audio track for the whole video (no per-scene splitting/re-synthesis).
//
// To recover per-scene durations from that single file, we transcribe it
// with WhisperX and align the storyboard's own voiceover text against the
// transcript of what was *actually spoken* — not against a second,
// separately-synthesized copy of the text (comparing synthesis-to-synthesis
// tells you nothing about what the TTS engine actually produced; comparing
// storyboard-text-to-transcript does).
//
// Requires:
//   - `whisperx` on PATH (pip install whisperx)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

/**
 * Runs WhisperX on an audio file and returns a flat, time-ordered list of
 * word-level timestamps: [{ word, start, end }, ...]
 */
export async function alignAudioWords(
  audioPath,
  { workDir, model = "small", language = "en", device = "cpu", computeType } = {}
) {
  const outDir = workDir || path.dirname(audioPath);

  const isWindows = process.platform === "win32";
  // Resolve the venv python relative to THIS module (pocket_tts/.venv), not
  // the caller's cwd. Falls back to a system `python` on PATH if the venv
  // binary is missing — so this also works in environments without a venv.
  const venv = path.join(path.dirname(fileURLToPath(import.meta.url)), ".venv");
  const venvPython = isWindows
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const pythonBin = existsSync(venvPython) ? venvPython : "python";

  await execFileAsync(
  pythonBin,
  [
    "-m",
    "whisperx",
    audioPath,
    "--model", model,
    "--language", language,
    "--device", device,
    "--output_format", "json",
    "--output_dir", outDir,
    "--compute_type", computeType || (device === "cpu" ? "int8" : "float16"),
  ],
  { maxBuffer: 1024 * 1024 * 64 }
);

  const base = path.basename(audioPath).replace(/\.[^/.]+$/, "");
  const jsonPath = path.join(outDir, `${base}.json`);
  const raw = await readFile(jsonPath, "utf8");
  const parsed = JSON.parse(raw);

  const words = [];
  for (const segment of parsed.segments || []) {
    for (const w of segment.words || []) {
      if (typeof w.start === "number" && typeof w.end === "number" && w.word) {
        words.push({ word: w.word.trim(), start: w.start, end: w.end });
      }
    }
  }
  return words;
}

function normalizeToken(word) {
  return (word || "").toLowerCase().replace(/[^a-z0-9']/g, "");
}

function tokenize(text) {
  return (text || "").trim().split(/\s+/).filter(Boolean);
}

/**
 * Aligns two normalized token sequences via longest-common-subsequence
 * dynamic programming and returns the matched index pairs, in order.
 *
 * O(n*m) time/space — fine for narration-length scripts (hundreds to a few
 * thousand words). For very long scripts this would want to move to a
 * banded/Hirschberg-style alignment instead.
 */
function alignTokenSequences(aTokens, bTokens) {
  const n = aTokens.length;
  const m = bTokens.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) dp[i] = new Uint32Array(m + 1);

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (aTokens[i - 1] === bTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const matches = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (aTokens[i - 1] === bTokens[j - 1]) {
      matches.push({ aIndex: i - 1, bIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  matches.reverse();
  return matches;
}

/**
 * Aligns the storyboard's own per-scene voiceover text against the WhisperX
 * transcript of the combined audio, and returns one cumulative end-time (in
 * seconds, into the combined audio) per scene — i.e. where each scene's
 * speech actually finishes, according to what was actually spoken.
 *
 * `transcriptWords` — WhisperX word list for the combined audio (see
 * alignAudioWords). `sceneVoiceoverTexts` — storyboard voiceover strings,
 * in scene order (same strings that were concatenated for synthesis).
 */
export function alignStoryboardToTranscript(sceneVoiceoverTexts, transcriptWords, { onLowConfidence } = {}) {
  const sceneTokenCounts = sceneVoiceoverTexts.map((t) => tokenize(t).length);
  const storyboardTokens = sceneVoiceoverTexts.flatMap((t) => tokenize(t)).map(normalizeToken);
  const transcriptTokens = transcriptWords.map((w) => normalizeToken(w.word));

  const matches = alignTokenSequences(storyboardTokens, transcriptTokens);
  const matchRatio = storyboardTokens.length > 0 ? matches.length / storyboardTokens.length : 1;
  if (matchRatio < 0.6) {
    onLowConfidence?.({ matchRatio, matchedCount: matches.length, totalTokens: storyboardTokens.length });
  }

  const matchMap = new Array(storyboardTokens.length).fill(-1);
  for (const { aIndex, bIndex } of matches) matchMap[aIndex] = bIndex;

  // For a storyboard token with no direct transcript match (TTS mispronounced
  // it, WhisperX misheard it, etc.), fall back to the nearest matched
  // neighbor — preferring to look backward, since we want an "end of speech
  // so far" boundary.
  const resolveTime = (tokenIndex) => {
    for (let k = tokenIndex; k >= 0; k -= 1) {
      if (matchMap[k] !== -1) return transcriptWords[matchMap[k]].end;
    }
    for (let k = tokenIndex + 1; k < matchMap.length; k += 1) {
      if (matchMap[k] !== -1) return transcriptWords[matchMap[k]].start;
    }
    return null;
  };

  const sceneEndTimes = [];
  let cursor = 0;
  let lastEnd = 0;
  for (const count of sceneTokenCounts) {
    let endTime;
    if (count === 0) {
      endTime = lastEnd;
    } else {
      const lastTokenIdx = cursor + count - 1;
      endTime = resolveTime(lastTokenIdx);
      if (endTime === null) endTime = lastEnd;
    }
    // Boundaries must be monotonically non-decreasing along the single
    // audio track — guard against any local mis-ordering from the alignment.
    endTime = Math.max(endTime, lastEnd);
    sceneEndTimes.push(endTime);
    lastEnd = endTime;
    cursor += count;
  }

  return sceneEndTimes;
}
