// external/audio-concat.js
//
// Small ffmpeg-backed helpers for building a single narration audio track
// out of multiple synthesized speech clips interspersed with generated
// silence clips. Kept separate from tts-provider.js so the ffmpeg-shelling
// concerns (format probing, silence generation, concat-demuxer stitching)
// are unit-testable / swappable independent of the Kyutai/WhisperX calls.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Probes an audio file's sample rate + channel count via ffprobe. Used to
 * pick the canonical format every clip (including generated silence) gets
 * normalized to before concatenation — ffmpeg's concat DEMUXER (`-f concat
 * -c copy`) requires every input to already share codec/format, so
 * mismatched sample rates between the TTS engine's native output and a
 * naively-generated silence clip would otherwise produce a corrupted or
 * silently-truncated concat.
 *
 * @param {string} absPath
 * @returns {{ sampleRate: number, channels: number }}
 */
export function probeAudioFormat(absPath) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=sample_rate,channels",
      "-of", "default=noprint_wrappers=1",
      absPath,
    ],
    { encoding: "utf-8" },
  );
  const sampleRateMatch = out.match(/sample_rate=(\d+)/);
  const channelsMatch = out.match(/channels=(\d+)/);
  if (!sampleRateMatch || !channelsMatch) {
    throw new Error(`ffprobe could not determine sample_rate/channels for ${absPath}: ${out}`);
  }
  return { sampleRate: Number(sampleRateMatch[1]), channels: Number(channelsMatch[1]) };
}

/**
 * Generates a digital-silence wav of exactly `durationSeconds`, encoded to
 * the given sample rate/channel count (matching the speech clips it will be
 * concatenated with).
 *
 * @param {number} durationSeconds
 * @param {string} outPath
 * @param {{ sampleRate: number, channels: number }} format
 */
export function generateSilenceClip(durationSeconds, outPath, format) {
  if (!(durationSeconds > 0)) {
    throw new Error(`generateSilenceClip: durationSeconds must be > 0 (got ${durationSeconds})`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const channelLayout = format.channels === 1 ? "mono" : format.channels === 2 ? "stereo" : `${format.channels}c`;
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", `anullsrc=r=${format.sampleRate}:cl=${channelLayout}`,
    "-t", String(durationSeconds),
    "-c:a", "pcm_s16le",
    outPath,
  ]);
}

/**
 * Re-encodes `inPath` to the target sample rate/channels/codec so it can be
 * concatenated (via the concat demuxer's stream copy) with clips that are
 * already in that format. No-op re-encode is cheap relative to TTS
 * synthesis time; always run it rather than trying to detect "already
 * matches" to keep the codec (pcm_s16le) guaranteed uniform too.
 *
 * @param {string} inPath
 * @param {string} outPath
 * @param {{ sampleRate: number, channels: number }} format
 */
export function normalizeClip(inPath, outPath, format) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-i", inPath,
    "-ar", String(format.sampleRate),
    "-ac", String(format.channels),
    "-c:a", "pcm_s16le",
    outPath,
  ]);
}

/**
 * Concatenates already-format-matched wav clips, IN ORDER, via ffmpeg's
 * concat demuxer with `-c copy` (fast, lossless — no re-encode needed since
 * every input was already normalized to the same format).
 *
 * @param {string[]} clipPaths absolute paths, in the order they should play
 * @param {string} outPath
 */
export function concatClips(clipPaths, outPath) {
  if (clipPaths.length === 0) {
    throw new Error("concatClips: clipPaths must be non-empty");
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const listPath = path.join(os.tmpdir(), `concat_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContent, "utf-8");
  try {
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
  } finally {
    fs.unlinkSync(listPath);
  }
}
