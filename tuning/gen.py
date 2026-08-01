#!/usr/bin/env python3

import argparse
import random
import subprocess
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--voice", required=True)
parser.add_argument("--text", required=True)
parser.add_argument("--count", type=int, default=100)
parser.add_argument("--binary", default="pocket-tts")
parser.add_argument("--output-dir", default="variants")

# CPU is the safe default.
parser.add_argument("--device", default="cpu")

parser.add_argument("--seed", type=int, default=42)

args = parser.parse_args()

random.seed(args.seed)

outdir = Path(args.output_dir)
outdir.mkdir(parents=True, exist_ok=True)


for i in range(args.count):
    temperature = round(random.uniform(0.45, 1.15), 2)
    decode_steps = random.choice([1, 2, 3, 4, 5, 6])
    eos_threshold = random.choice([-6, -5, -4, -3, -2])
    frames_after_eos = random.choice([5, 10, 15, 20, 30])

    use_noise = random.random() < 0.7
    noise_clamp = round(random.uniform(0.5, 3.0), 2)

    filename = (
        f"{i:04d}"
        f"_t{temperature}"
        f"_s{decode_steps}"
        f"_e{eos_threshold}"
        f"_f{frames_after_eos}"
    )

    if use_noise:
        filename += f"_n{noise_clamp}"

    outfile = outdir / f"{filename}.wav"

    cmd = [
        args.binary,
        "generate",
        "--voice", args.voice,
        "--text", args.text,
        "--output-path", str(outfile),
        "--device", args.device,
        "--temperature", str(temperature),
        "--lsd-decode-steps", str(decode_steps),
        "--eos-threshold", str(eos_threshold),
        "--frames-after-eos", str(frames_after_eos),
        "--quiet",
    ]

    if use_noise:
        cmd.extend([
            "--noise-clamp",
            str(noise_clamp),
        ])

    print(f"[{i + 1}/{args.count}] {outfile.name}")

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError:
        print(f"FAILED: {outfile.name}")
        print("Command:")
        print(" ".join(cmd))
        raise


print()
print(f"Generated {args.count} samples in:")
print(outdir.resolve())