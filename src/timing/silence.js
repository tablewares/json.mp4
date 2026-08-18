// src/timing/silence.js
//
// Pure logic for splitting a manifest.narration.entries[] array (which may
// mix spoken entries with silent-block entries) into synthesis-ready
// segments, and for stitching per-segment TTS results back into one
// composition-global timing map. No I/O, no ffmpeg, no TTS calls — this
// module is deliberately importable/testable without a TTS server or
// ffmpeg on PATH.
//
// Authoring model (manifest.schema.json narration.entries item):
//   spoken:  { id, text }
//   silence: { id, kind: "silence", durationSeconds }
//
// A silent block is positioned purely by where it sits in the entries[]
// array (relative to its neighboring entry ids) — never by an absolute
// timeline offset. This is the "relative, id-anchored, not raw values"
// contract: authors inject silence anywhere by inserting a { kind:
// "silence" } object between two entry ids; nothing elsewhere in the
// manifest needs to know the resulting absolute seconds/frames.

/** @param {{id:string,text?:string,kind?:string,durationSeconds?:number}} entry */
export function isSilenceEntry(entry) {
  return entry?.kind === "silence";
}

/**
 * Splits an ordered entries[] array into a list of segments preserving
 * original order:
 *   { type: "speech", entries: [{id,text}, ...] }   — one or more
 *     consecutive spoken entries, synthesized together as ONE TTS pass
 *     (preserves the existing single-pass-per-run alignment quality).
 *   { type: "silence", entry: {id, durationSeconds} } — one silent block.
 *
 * @param {Array<{id:string,text?:string,kind?:string,durationSeconds?:number}>} entries
 * @returns {Array<{type:"speech",entries:any[]}|{type:"silence",entry:any}>}
 */
export function splitNarrationEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("splitNarrationEntries() requires an entries array");
  }
  const segments = [];
  let currentSpeechRun = null;

  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new Error(`Narration entry missing a non-empty "id": ${JSON.stringify(entry)}`);
    }
    if (isSilenceEntry(entry)) {
      if (typeof entry.durationSeconds !== "number" || !(entry.durationSeconds > 0)) {
        throw new Error(
          `Silence entry "${entry.id}" must have a positive numeric "durationSeconds" (got ${entry.durationSeconds}).`,
        );
      }
      currentSpeechRun = null;
      segments.push({ type: "silence", entry: { id: entry.id, durationSeconds: entry.durationSeconds } });
      continue;
    }
    if (typeof entry.text !== "string" || entry.text.trim() === "") {
      throw new Error(`Spoken narration entry "${entry.id}" must have non-empty "text".`);
    }
    if (!currentSpeechRun) {
      currentSpeechRun = { type: "speech", entries: [] };
      segments.push(currentSpeechRun);
    }
    currentSpeechRun.entries.push({ id: entry.id, text: entry.text });
  }

  return segments;
}

/** True when at least one entry in the array is a silence block. */
export function hasSilenceEntries(entries) {
  return Array.isArray(entries) && entries.some(isSilenceEntry);
}

/**
 * Builds the composition-global per-entry timing map by walking segments in
 * order and accumulating a cursor (seconds). For "speech" segments, the
 * caller supplies the ALREADY-ALIGNED per-entry local {start,end,words}
 * (local to that segment's own synthesized clip, i.e. start at 0) via
 * `speechResultsBySegmentIndex` — this function only shifts them onto the
 * global cursor and advances it by the segment's own clip duration. For
 * "silence" segments, it emits a zero-word entry spanning exactly
 * `durationSeconds` and advances the cursor by that amount.
 *
 * @param {Array<{type:"speech",entries:any[]}|{type:"silence",entry:any}>} segments
 * @param {Array<{clipDurationSeconds:number, timing:{id:string,start:number,end:number,words:any[]}[]}|null>} speechResultsBySegmentIndex
 *   One entry per segment; null/undefined for silence segments (ignored).
 * @returns {{ timing: {id:string,start:number,end:number,words:any[]}[], totalDuration: number, clipOrder: Array<{type:"speech"|"silence", durationSeconds:number, segmentIndex:number}> }}
 */
export function buildGlobalTiming(segments, speechResultsBySegmentIndex) {
  const timing = [];
  const clipOrder = [];
  let cursor = 0;

  segments.forEach((segment, index) => {
    if (segment.type === "silence") {
      const duration = segment.entry.durationSeconds;
      timing.push({ id: segment.entry.id, start: cursor, end: cursor + duration, words: [] });
      clipOrder.push({ type: "silence", durationSeconds: duration, segmentIndex: index });
      cursor += duration;
      return;
    }

    const result = speechResultsBySegmentIndex[index];
    if (!result) {
      throw new Error(`buildGlobalTiming: missing speech synthesis result for segment index ${index}`);
    }
    for (const entryTiming of result.timing) {
      timing.push({
        id: entryTiming.id,
        start: cursor + entryTiming.start,
        end: cursor + entryTiming.end,
        words: (entryTiming.words ?? []).map((w) => ({
          word: w.word,
          start: cursor + w.start,
          end: cursor + w.end,
        })),
      });
    }
    clipOrder.push({ type: "speech", durationSeconds: result.clipDurationSeconds, segmentIndex: index });
    cursor += result.clipDurationSeconds;
  });

  return { timing, totalDuration: cursor, clipOrder };
}
