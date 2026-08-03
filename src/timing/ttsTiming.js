/**
 * Thin wrapper around the project's existing TTS timing function. That
 * function already exists elsewhere in the org's stack — this module is the
 * single seam the rest of the framework talks to, so swapping TTS providers
 * never touches pipeline2 or the renderer.
 *
 * TTS is the single source of truth for timing. The provider returns:
 *   - per-entry { id, start, end } (seconds) — where each narration entry
 *     actually starts/ends in the synthesized audio
 *   - totalDuration — the real synthesized audio length (seconds); this drives
 *     audioOverlay so the manifest never hand-authors a clip length
 *   - audioPath — the file TTS actually produced; the renderer plays this
 *
 * Expected external signature (adjust the import below to the real module):
 *   generateTtsTiming(entries: {id, text}[], fullTranscript: string)
 *     => Promise<{ timing, totalDuration, audioPath }>  // or a bare array
 */
import { generateTtsTiming } from "../../external/tts-provider.js"; // TODO: point at the real existing TTS module

/**
 * @param {{id: string, text: string}[]} entries
 * @param {string} fullTranscript
 * @param {number} fps
 * @returns {Promise<{
 *   byId: Record<string, {startFrame:number, endFrame:number, durationInFrames:number, startSeconds:number, endSeconds:number, words: {word:string, startFrame:number, endFrame:number}[]}>,
 *   totalDuration: number|null,  // seconds; null when the provider didn't report it
 *   audioPath: string|null,       // path TTS produced, relative to public/; null when N/A
 * }>}
 */
export async function resolveNarrationTiming(entries, fullTranscript, fps) {
  const result = await generateTtsTiming(entries, fullTranscript);
  // The provider returns { timing, totalDuration, audioPath }. Tolerate the
  // legacy bare-array shape too (no totalDuration/audioPath) so a provider
  // upgrade isn't a hard break.
  const timing = Array.isArray(result) ? result : result.timing;
  const totalDuration = Array.isArray(result) ? null : result.totalDuration ?? null;
  const audioPath = Array.isArray(result) ? null : result.audioPath ?? null;
  const byId = {};
  for (const { id, start, end, words } of timing) {
    if (end <= start) {
      throw new Error(`TTS timing for "${id}" has non-positive duration (start=${start}, end=${end})`);
    }
    console.log(`Timing for "${id}": start=${start}s end=${end}s (frames ${Math.round(start * fps)}–${Math.round(end * fps)})`);

    // Word frames are relative to THIS entry's own start (frame 0 == scene's
    // TTS start), i.e. the same frame space as enterAtFrame/exitAtFrame —
    // so an asset can compare them directly with no extra offset math.
    const wordFrames = (words ?? []).map((w) => ({
      word: w.word,
      startFrame: Math.round((w.start - start) * fps),
      endFrame: Math.round((w.end - start) * fps),
    }));

    byId[id] = {
      startSeconds: start,
      endSeconds: end,
      startFrame: Math.round(start * fps),
      endFrame: Math.round(end * fps),
      durationInFrames: Math.round((end - start) * fps),
      words: wordFrames,
    };
  }

  return { byId, totalDuration, audioPath };
}

// sceneTimingBudget unchanged
/**
 * Given a scene's narrationRef and the resolved timing map, returns the frame
 * budget the scene (and therefore its assets + transitions) must resolve
 * within — the narration entry's actual TTS window, never a calculated default.
 * Throws early rather than letting an animation silently run past its audio.
 *
 * @param {string} narrationRef
 * @param {Record<string, {startFrame:number, endFrame:number, durationInFrames:number, startSeconds:number, endSeconds:number}>} timingById
 */
export function sceneTimingBudget(narrationRef, timingById) {
  const t = timingById[narrationRef];
  if (!t) throw new Error(`No TTS timing resolved for narrationRef "${narrationRef}"`);
  return t;
}
