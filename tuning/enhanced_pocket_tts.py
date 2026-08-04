#!/usr/bin/env python3
"""
human_tts.py

Pipeline
--------
1. Generate raw speech with Kyutai Pocket TTS (via its CLI).
2. Transcribe that raw audio with WhisperX to get word-level timestamps.
3. Use those timestamps to rebuild the waveform with:
     - punctuation-aware, jittered pauses (longer after '.', '!', '?',
       medium after ',', ';', ':', tiny random jitter everywhere else)
       instead of the TTS's naturally uniform gaps
     - a small random per-word time-stretch, so the speaking rate drifts
       around a center instead of holding a dead-flat WPM
4. Run a final ffmpeg pass (highpass, compression, EQ, short room echo,
   loudness normalization, fade in/out) and export as MP3.

Requirements
------------
    pip install pocket-tts whisperx librosa soundfile numpy
    ffmpeg must be installed and on PATH

Usage
-----
    python human_tts.py "Your text here"
    python human_tts.py "Your text here" --voice "hf://kyutai/tts-voices/jessica-jian/casual.wav" --out welcome
    python human_tts.py "Your text here" --whisper-model small --seed 7
"""

import argparse
import random
import subprocess
import sys
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf


# ---------------------------------------------------------------------------
# Step 1: Generate raw TTS audio (Pocket TTS CLI)
# ---------------------------------------------------------------------------
def generate_tts(text, voice, out_wav,
                  lsd_decode_steps=4, temperature=0.65, eos_threshold=-3.5):
    """
    Params tuned per Pocket TTS's documented `generate` flags:
      --lsd-decode-steps 4   more denoising steps than default (1) -> cleaner audio
      --temperature 0.65     slightly below default (0.7) -> less erratic prosody
      --eos-threshold -3.5   a touch tighter than default (-4.0) -> less trailing dead air
    """
    cmd = [
        "pocket-tts", "generate",
        "--text", text,
        "--output-path", str(out_wav),
        "--lsd-decode-steps", str(lsd_decode_steps),
        "--temperature", str(temperature),
        "--eos-threshold", str(eos_threshold),
        "--quantize",
    ]
    if voice:
        cmd += ["--voice", voice]
    print(">> Generating raw TTS audio...")
    subprocess.run(cmd, check=True)


# ---------------------------------------------------------------------------
# Step 2: Transcribe with WhisperX for word-level timestamps
# ---------------------------------------------------------------------------
def transcribe(wav_path, device="cpu", model_size="base", language="en"):
    import whisperx

    print(">> Transcribing with WhisperX for word-level timing...")
    compute_type = "int8" if device == "cpu" else "float16"

    audio = whisperx.load_audio(str(wav_path))
    model = whisperx.load_model(model_size, device, compute_type=compute_type, language=language)
    result = model.transcribe(audio, batch_size=8)

    align_model, metadata = whisperx.load_align_model(
        language_code=result["language"], device=device
    )
    result = whisperx.align(
        result["segments"], align_model, metadata, audio, device,
        return_char_alignments=False,
    )
    return result["segments"]  # each segment has a "words" list of {"word","start","end"}


# ---------------------------------------------------------------------------
# Step 3: Rebuild the waveform with punctuation-aware pauses + rate variation
# ---------------------------------------------------------------------------
def resynthesize_with_dynamics(y, sr, segments, seed=None,
                                rate_range=(0.92, 1.10),
                                sentence_pause=(0.28, 0.48),
                                clause_pause=(0.14, 0.24),
                                word_gap=(0.03, 0.07)):
    """
    Walk through WhisperX word timings and rebuild the waveform:
      - each word's audio chunk gets a small random time-stretch factor,
        so local speaking rate isn't a perfectly flat WPM
      - gaps between words are replaced with jittered silence, scaled by
        whether the previous word ended a sentence, a clause, or neither
    """
    rng = random.Random(seed)
    words = [w for seg in segments for w in seg.get("words", []) if "start" in w and "end" in w]

    if not words:
        print("!! No word-level alignment found, skipping dynamic resynthesis.")
        return y

    out_chunks = []
    prev_end = 0.0

    for i, w in enumerate(words):
        start, end = float(w["start"]), float(w["end"])

        # --- gap before this word: replace with jittered, context-aware silence ---
        gap = start - prev_end
        if gap > 0.01:
            prev_word = words[i - 1]["word"].strip() if i > 0 else ""
            if prev_word.endswith((".", "!", "?")):
                target = rng.uniform(*sentence_pause)
            elif prev_word.endswith((",", ";", ":")):
                target = rng.uniform(*clause_pause)
            else:
                target = rng.uniform(*word_gap)
            silence_dur = float(np.clip(target, 0.02, gap + 0.15))
            out_chunks.append(np.zeros(int(silence_dur * sr), dtype=y.dtype))
        elif gap > 0:
            out_chunks.append(np.zeros(int(gap * sr), dtype=y.dtype))

        # --- the word itself: light random time-stretch for rate variation ---
        s_idx, e_idx = int(start * sr), int(end * sr)
        chunk = y[s_idx:e_idx]
        if len(chunk) > 256:
            rate = rng.uniform(*rate_range)  # >1 = faster/shorter, <1 = slower/longer
            try:
                chunk = librosa.effects.time_stretch(chunk, rate=rate)
            except Exception:
                pass  # fall back to the untouched chunk on any stretch failure
        out_chunks.append(chunk)
        prev_end = end

    tail_start = int(prev_end * sr)
    if tail_start < len(y):
        out_chunks.append(y[tail_start:])

    return np.concatenate(out_chunks) if out_chunks else y


# ---------------------------------------------------------------------------
# Step 4: Final spectral/loudness pass + MP3 export via ffmpeg
# ---------------------------------------------------------------------------
def post_process_ffmpeg(in_wav, out_mp3):
    """
    highpass            remove sub-bass rumble
    acompressor          punch/impact, evens out level jumps
    equalizer f=250      warms up low-mids
    equalizer f=3500     trims harsh "synthetic" upper-mid edge
    equalizer f=8000     softens sibilance
    aecho                short, low-mix echo -> small room feel, not dry/dead
    loudnorm             consistent -16 LUFS loudness
    afade (areverse trick) smooth fade in/out, no start/end clicks
    """
    filters = (
        "highpass=f=70,"
        "acompressor=threshold=-18dB:ratio=2.5:attack=5:release=100:makeup=2,"
        "equalizer=f=250:t=q:w=1:g=1.5,"
        "equalizer=f=3500:t=q:w=1:g=-2.5,"
        "equalizer=f=8000:t=q:w=1:g=-1.5,"
        "aecho=0.8:0.6:18:0.12,"
        "loudnorm=I=-16:TP=-1.5:LRA=9,"
        "afade=t=in:d=0.04,areverse,afade=t=in:d=0.12,areverse"
    )
    print(">> Applying EQ/compression/reverb/loudness and exporting MP3...")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(in_wav), "-af", filters,
         "-codec:a", "libmp3lame", "-q:a", "2", str(out_mp3)],
        check=True,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Human-sounding TTS: Pocket TTS + WhisperX-guided pacing + ffmpeg polish"
    )
    parser.add_argument("text", help="Text to synthesize")
    parser.add_argument("--voice", default=None, help="Pocket TTS voice path/URL")
    parser.add_argument("--out", default="tts_output", help="Output basename (no extension)")
    parser.add_argument("--whisper-model", default="base",
                         help="WhisperX model size: tiny/base/small/medium/large-v3")
    parser.add_argument("--device", default="cpu", help="cpu or cuda")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for pause/rate jitter")
    parser.add_argument("--skip-dynamics", action="store_true",
                         help="Skip the WhisperX step and only apply the ffmpeg pass")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        raw_wav = Path(tmp) / "raw.wav"
        dynamic_wav = Path(tmp) / "dynamic.wav"
        final_mp3 = Path(f"{args.out}.mp3")

        generate_tts(args.text, args.voice, raw_wav)

        if args.skip_dynamics:
            dynamic_wav = raw_wav
        else:
            segments = transcribe(raw_wav, device=args.device, model_size=args.whisper_model)
            y, sr = librosa.load(str(raw_wav), sr=None)
            y_dynamic = resynthesize_with_dynamics(y, sr, segments, seed=args.seed)
            sf.write(str(dynamic_wav), y_dynamic, sr)

        post_process_ffmpeg(dynamic_wav, final_mp3)

    print(f">> Done: {final_mp3}")


if __name__ == "__main__":
    sys.exit(main())