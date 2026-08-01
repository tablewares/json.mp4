import React, { useEffect, useState } from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { delayRender, continueRender, cancelRender } from "remotion";

/**
 * Loads an audio track, probes its duration, and creates a
 * frame-accurate Remotion <Sequence><Audio /></Sequence>.
 *
 * The audio starts at 0 and runs for its actual duration.
 */
export function AudioOverlay() {
  const { fps } = useVideoConfig();

  const audioPath = "audio/hardcoded_voice.wav";
  const src = staticFile(audioPath);

  const [duration, setDuration] = useState(null);

  useEffect(() => {
    const handle = delayRender("Loading audio and probing duration");

    let cancelled = false;

    const loadAudio = async () => {
      try {
        // Fetch/download the audio so it is available before probing.
        const response = await fetch(src);

        if (!response.ok) {
          throw new Error(
            `Failed to download audio: ${response.status} ${response.statusText}`
          );
        }

        const blob = await response.blob();

        // Create a local URL for the downloaded audio.
        const blobUrl = URL.createObjectURL(blob);

        try {
          // Probe the actual audio duration in seconds.
          const seconds = await getAudioDurationInSeconds(blobUrl);

          if (!cancelled) {
            setDuration(seconds);
            continueRender(handle);
          }
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } catch (error) {
        cancelRender(handle, error);
      }
    };

    loadAudio();

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (duration === null) {
    return null;
  }

  const durationInFrames = Math.ceil(duration * fps);

  return (
    <Sequence
      from={0}
      durationInFrames={durationInFrames}
      name="audio-hardcoded-tts-voice"
    >
      <Audio src={src} />
    </Sequence>
  );
}