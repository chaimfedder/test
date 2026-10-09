"""Height map for the embossed logo of the plastic case.

Usage:  python3 tools/make_emboss_mask.py  (run from the hat-case folder)

Reads the existing logo artwork (assets/logo-plate.png, the brand plate of
the approved design) and writes assets/logo-emboss.png, a soft grey-scale
height map: white = raised, black = flat sheet. The artwork in the plate
texture is drawn as dark contours (the bird, the brand name) and an orange
tagline; those exact strokes become the shallow relief, so the symbol and
the lettering are the ones of the file, not a re-typed font.
Needs numpy, scipy and Pillow.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "logo-plate.png"
DST = ROOT / "assets" / "logo-emboss.png"
ART_BOTTOM = 520  # px: below this the plate texture holds only a highlight
SOFTEN = 0.9  # px: rounds the relief edges (formed sheet, no sharp steps)

im = np.asarray(Image.open(SRC).convert("RGB")).astype(float)
lum = im @ np.array([0.299, 0.587, 0.114])
sat = im.max(-1) - im.min(-1)
background = ndi.gaussian_filter(lum, 40)
art = ((background - lum) > 22) | (sat > 45)  # dark contours and the orange tagline
art = ndi.binary_opening(art, iterations=1)

lab, k = ndi.label(art)
keep = np.zeros_like(art)
for i in range(1, k + 1):
    sel = lab == i
    ys, _ = np.nonzero(sel)
    if sel.sum() > 25 and ys.max() < ART_BOTTOM:
        keep[sel] = True

height = ndi.gaussian_filter(keep.astype(float), SOFTEN)
height = np.clip(height / max(height.max(), 1e-6), 0, 1)
pad = 16  # flat margin so the texture edge is flat sheet
out = np.pad(height, pad)
Image.fromarray((out * 255).round().astype(np.uint8)).save(DST)
print(f"saved {DST.relative_to(ROOT)} {out.shape[1]}x{out.shape[0]} (margin {pad}px)")
