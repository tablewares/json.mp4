import React from "react";
import { Audio, Sequence, staticFile, useVideoConfig, interpolate } from "remotion";

function resolveVolume(track, durationInFrames, fps) {
  const baseVolume = track.volume ?? 1;
  const fadeInFrames = Math.round((track.fadeInSeconds ?? 0) * fps);
  const fadeOutFrames = Math.round((track.fadeOutSeconds ?? 0) * fps);
  if (fadeInFrames === 0 && fadeOutFrames === 0) return baseVolume;
  return (frame) => {
    const fadeIn = fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, baseVolume], { extrapolateRight: "clamp" })
      : baseVolume;
    const fadeOut = fadeOutFrames > 0
      ? interpolate(frame, [durationInFrames - fadeOutFrames, durationInFrames], [baseVolume, 0], { extrapolateLeft: "clamp" })
      : baseVolume;
    return Math.min(fadeIn, fadeOut);
  };
}

export function AudioOverlay({ tracks }) {
  const { fps } = useVideoConfig();
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  return (
    <>
      {tracks.map((track) => {
        const fromFrame = Math.max(0, Math.round(track.start * fps));
        const durationInFrames = Math.max(0, Math.round((track.end - track.start) * fps));
        if (durationInFrames === 0) return null;
        return (
          <Sequence key={track.id} from={fromFrame} durationInFrames={durationInFrames} name={`audio-${track.id}`}>
            <Audio
              src={staticFile(track.path)}
              volume={resolveVolume(track, durationInFrames, fps)}
              loop={Boolean(track.loop)}
            />
          </Sequence>
        );
      })}
    </>
  );
}