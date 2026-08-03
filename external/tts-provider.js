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
 * @returns {Promise<{id: string, start: number, end: number}[]>}
 */
export async function generateTtsTiming(entries, fullTranscript) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("generateTtsTiming() requires a non-empty entries array");
  }
  if (typeof fullTranscript !== "string" || fullTranscript.trim() === "") {
    throw new Error("generateTtsTiming() requires a non-empty fullTranscript");
  }

  const workDir = defaultWorkDir();
  const audioPath = path.join(workDir, `hardcoded_voice.wav`);

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
  console.log("audiopath", audioPath)
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
  //    + a real timestamp for every individual word.
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
    // eslint-disable-next-line no-console
    console.warn(
      `[tts-provider] low alignment confidence: ` +
      `${lowConfidence.matchedCount}/${lowConfidence.totalTokens} tokens ` +
      `(${(lowConfidence.matchRatio * 100).toFixed(1)}%)`
    );
  }
  console.log("sceneEndTimes:", sceneEndTimes);

  const clamp = (t) => Math.min(Math.max(t, 0), totalDuration);

  // 4) Build per-entry {start, end, words} from cumulative end times. start
  // of entry N = end of entry N-1 (0 for the first). Clamp the final end to
  // the real synthesized duration so a WhisperX tail overhang can't extend
  // past audio; word timestamps get the same clamp.
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

  return timing;
}
