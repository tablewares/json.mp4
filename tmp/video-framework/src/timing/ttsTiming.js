/**
 * Thin wrapper around the project's existing TTS timing function. That
 * function already exists elsewhere in the org's stack — this module is the
 * single seam the rest of the framework talks to, so swapping TTS providers
 * never touches pipeline2 or the renderer.
 *
 * Expected external signature (adjust the import below to the real module):
 *   generateTtsTiming(entries: {id, text}[], fullTranscript: string)
 *     => Promise<{ id: string, start: number, end: number }[]>   // seconds
 */
import { generateTtsTiming } from "../../external/tts-provider.js"; // TODO: point at the real existing TTS module

/**
 * @param {{id: string, text: string}[]} entries
 * @param {string} fullTranscript
 * @param {number} fps
 * @returns {Promise<Record<string, {startFrame:number, endFrame:number, durationInFrames:number, startSeconds:number, endSeconds:number}>>}
 */
export async function resolveNarrationTiming(entries, fullTranscript, fps) {
  const timing = await generateTtsTiming(entries, fullTranscript);

  const byId = {};
  for (const { id, start, end } of timing) {
    if (end <= start) {
      throw new Error(`TTS timing for "${id}" has non-positive duration (start=${start}, end=${end})`);
    }
    byId[id] = {
      startSeconds: start,
      endSeconds: end,
      startFrame: Math.round(start * fps),
      endFrame: Math.round(end * fps),
      durationInFrames: Math.round((end - start) * fps),
    };
  }
  return byId;
}

/**
 * Given a scene's narrationRef and the resolved timing map, returns the frame
 * budget the scene (and therefore its assets + transitions) must resolve
 * within. Throws early rather than letting an animation silently run past
 * its audio.
 */
export function sceneTimingBudget(narrationRef, timingById) {
  const t = timingById[narrationRef];
  if (!t) throw new Error(`No TTS timing resolved for narrationRef "${narrationRef}"`);
  return t;
}
