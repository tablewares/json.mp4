import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import { useEffect } from "react";

/**
 * Converts [{ id, start, end, path }] (seconds) into frame-accurate Remotion
 * <Sequence><Audio/></Sequence> elements. Remotion composites these directly
 * during render — there is no separate mux step.
 *
 * @param {{id:string, start:number, end:number, path:string}[]} tracks
 * @param {number} fps
 */


export function AudioOverlay({ fps = 30 }) {
  // Hardcoded audio track details
  const hardcodedTrack = {
    id: "hardcoded-tts-voice",
    start: 0, // start time in seconds
    end: 5,   // duration in seconds
    path: "audio/hardcoded_voice.wav",
  };

  const src = staticFile(hardcodedTrack.path);

  // Hardcode preloading / downloading audio on component mount
  useEffect(() => {
    const audioElement = new window.Audio();
    audioElement.src = src;
    audioElement.preload = "auto";
  }, [src]);

  const from = Math.round(hardcodedTrack.start * fps);
  const durationInFrames = Math.round((hardcodedTrack.end - hardcodedTrack.start) * fps);

  return (
    <Sequence
      key={hardcodedTrack.id}
      from={from}
      durationInFrames={durationInFrames}
      name={`audio-${hardcodedTrack.id}`}
    >
      <Audio src={src} />
    </Sequence>
  );
}