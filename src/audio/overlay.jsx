import React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";

/**
 * Renders the resolved `audioOverlay` timeline as frame-accurate Remotion
 * <Sequence><Audio /></Sequence> pairs — one per track.
 *
 * The resolved graph (pipeline2) is the single source of truth for which
 * tracks play, when, and from what file. Each entry has the shape:
 *   { id: string, start: number, end: number, path: string }
 * where start/end are in seconds and `path` is relative to `public/` (so
 * Remotion's staticFile() accepts it). With narration, pipeline2 synthesizes
 * exactly one "voiceover" track whose path is the TTS provider's real output
 * and whose end is the audio's real duration; without narration, manifest
 * entries pass through verbatim.
 *
 * `end` is the close of the window — audio is trimmed to that end, so a
 * voiceover whose actual file is longer than the declared window (e.g.
 * narration totalDuration rounds up) is clipped, not overrun. Audio inside
 * the Composition is positioned in the SAME root frame space as the
 * TransitionSeries timeline (frame 0 = first scene start), so `start` lines
 * up with the scene boundaries the rest of the composition presents.
 *
 * @param {{tracks?: {id:string, start:number, end:number, path:string}[]}} props
 */
export function AudioOverlay({ tracks }) {
  const { fps } = useVideoConfig();

  if (!Array.isArray(tracks) || tracks.length === 0) {
    // Nothing to play. The parent (VideoComposition) already guards against
    // mounting <AudioOverlay> when the resolved audioOverlay is empty, but we
    // also no-op here so a stray render can never throw on an undefined src.
    return null;
  }

  return (
    <>
      {tracks.map((track) => {
        const fromFrame = Math.max(0, Math.round(track.start * fps));
        // end is required by the manifest schema and TTS resolver, so it is
        // always present. Convert to the Sequence duration. Clamp negative
        // durations to 0 (defensive — should never happen).
        const durationInFrames = Math.max(
          0,
          Math.round((track.end - track.start) * fps),
        );
        if (durationInFrames === 0) return null;
        return (
          <Sequence
            key={track.id}
            from={fromFrame}
            durationInFrames={durationInFrames}
            name={`audio-${track.id}`}
          >
            <Audio src={staticFile(track.path)} />
          </Sequence>
        );
      })}
    </>
  );
}
