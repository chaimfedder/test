"""Composite the caption layer over the clean 3D frames: final = clean + captions.

Usage: python3 film/composite.py  (run from the hat-case folder)
Same result as the browser's own composite (source-over).
"""
from pathlib import Path

from PIL import Image

FRAMES = Path(__file__).resolve().parent / "frames"

count = 0
for shot in sorted((FRAMES / "clean").iterdir()):
    for clean in sorted(shot.glob("*.png")):
        cap = FRAMES / "captions" / shot.name / clean.name
        out = FRAMES / "final" / shot.name / clean.name
        base = Image.open(clean).convert("RGBA")
        layer = Image.open(cap).convert("RGBA")
        Image.alpha_composite(base, layer).convert("RGB").save(out, compress_level=1)
        count += 1
print(f"composited {count} frames")
