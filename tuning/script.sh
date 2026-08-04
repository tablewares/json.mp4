#!/usr/bin/env bash
# human_tts.sh
# Generates speech with Kyutai Pocket TTS, then applies a post-processing
# chain in ffmpeg to make it sound warmer, more impactful, and less jarring
# than raw TTS output. Outputs a final MP3.
#
# Requirements:
#   pip install pocket-tts   (or: uvx pocket-tts ...)
#   ffmpeg installed and on PATH
#
# Usage:
#   ./human_tts.sh "Your text here" [voice] [output_basename]
#
# Examples:
#   ./human_tts.sh "Welcome to the show." 
#   ./human_tts.sh "Welcome to the show." "hf://kyutai/tts-voices/jessica-jian/casual.wav" welcome

set -euo pipefail

TEXT="${1:?Usage: $0 \"text\" [voice] [output_basename]}"
VOICE="${2:-}"
BASENAME="${3:-tts_output}"

RAW_WAV="${BASENAME}_raw.wav"
FINAL_MP3="${BASENAME}.mp3"

# ---------------------------------------------------------------------------
# 1. Generate raw speech with Pocket TTS
# ---------------------------------------------------------------------------
# Tuning rationale (per the CLI's Generation Parameters):
#   --lsd-decode-steps 4   more denoising steps than the default (1) gives
#                          cleaner, less "gritty"/artifact-y audio (default
#                          docs example uses 5 for "higher quality")
#   --temperature 0.65     slightly below default (0.7) trims some of the
#                          erratic prosody swings that read as jarring,
#                          while staying above the very flat ~0.5 range
#   --eos-threshold -3.5   finishes phrases a touch more decisively than the
#                          default -4.0, avoiding long trailing silences that
#                          break flow between sentences


GEN_CMD=(pocket-tts generate
  --text "$TEXT"
  --output-path "$RAW_WAV"
  --lsd-decode-steps 1
  --temperature 0.6
  --eos-threshold 0.2
)

if [[ -n "$VOICE" ]]; then
  GEN_CMD+=(--voice "$VOICE")
fi

echo ">> Generating raw TTS audio..."
"${GEN_CMD[@]}"

# ---------------------------------------------------------------------------
# 2. Post-process with ffmpeg for a more human, impactful, less jarring feel
# ---------------------------------------------------------------------------
# Chain, in order:
#   highpass=f=70            remove sub-bass rumble/DC offset
#   acompressor(...)         gentle-to-moderate compression: adds "punch"/
#                             impact and evens out level jumps between words
#   equalizer f=250 g=1.5    slight low-mid boost = more chest/warmth, less thin
#   equalizer f=3500 g=-2.5  trims the harsh upper-mid "digital" edge common
#                             in synthesized speech
#   equalizer f=8000 g=-1.5  gentle high shelf-ish cut = softer, less sibilant/jarring
#   aecho=...                very short, low-mix echo simulates a small room
#                             instead of the dry/dead sound of raw TTS
#   loudnorm=...              consistent, broadcast-style loudness (-16 LUFS,
#                             true peak -1.5dB) so output isn't too quiet/loud
#   fade in/out (via areverse trick) so start/end aren't abrupt clicks
FFMPEG_FILTERS="highpass=f=70,\
acompressor=threshold=-18dB:ratio=2.5:attack=5:release=100:makeup=2,\
equalizer=f=250:t=q:w=1:g=1.5,\
equalizer=f=3500:t=q:w=1:g=-2.5,\
equalizer=f=8000:t=q:w=1:g=-1.5,\
aecho=0.8:0.6:18:0.12,\
loudnorm=I=-16:TP=-1.5:LRA=9,\
afade=t=in:d=0.04,areverse,afade=t=in:d=0.12,areverse"

echo ">> Post-processing audio..."
ffmpeg -y -i "$RAW_WAV" -af "$FFMPEG_FILTERS" -codec:a libmp3lame -q:a 2 "$FINAL_MP3"

rm -f "$RAW_WAV"

echo ">> Done: $FINAL_MP3"
