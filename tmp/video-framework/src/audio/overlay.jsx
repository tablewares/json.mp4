import React from "react";
import { Audio, Sequence, staticFile } from "remotion";

/**
 * Converts [{ id, start, end, path }] (seconds) into frame-accurate Remotion
 * <Sequence><Audio/></Sequence> elements. Remotion composites these directly
 * during render — there is no separate mux step.
 *
 * @param {{id:string, start:number, end:number, path:string}[]} tracks
 * @param {number} fps
 */
export function AudioOverlay({ tracks, fps }) {
  return tracks.map(({ id, start, end, path }) => {
    const from = Math.round(start * fps);
    const durationInFrames = Math.round((end - start) * fps);
    return (
      <Sequence key={id} from={from} durationInFrames={durationInFrames} name={`audio-${id}`}>
        <Audio src={path.startsWith("http") ? path : staticFile(path)} />
      </Sequence>
    );
  });
}
