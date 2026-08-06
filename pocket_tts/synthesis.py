import argparse
import sys
from pathlib import Path
import torch
import torchaudio as ta
from chatterbox.tts import ChatterboxTTS

def parse_args():
    parser = argparse.ArgumentParser(description="Chatterbox TTS Generator CLI")
    parser.add_argument("--text", type=str, required=True, help="Text to synthesize")
    parser.add_argument("--output", type=str, required=True, help="Absolute path to output WAV file")
    parser.add_argument("--voice", type=str, default="", help="Path to reference WAV file for voice cloning")
    return parser.parse_args()

def main():
    args = parse_args()

    # Determine execution device
    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    model = ChatterboxTTS.from_pretrained(device=device)

    # Generate audio with or without voice cloning reference
    voice_path = Path(args.voice)
    if voice_path.exists() and voice_path.is_file():
        wav = model.generate(args.text, audio_prompt_path=str(voice_path))
    else:
        wav = model.generate(args.text)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    ta.save(str(output_path), wav, model.sr)

if __name__ == "__main__":
    main()