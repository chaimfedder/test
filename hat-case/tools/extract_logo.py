"""Extract the brand-plate artwork from the reference photo into a flat texture.

Usage:  python3 tools/extract_logo.py  (run from the hat-case folder)

The crop box below is the bounding box of the silver inner plate in the
reference photo (pixel coordinates of assets/reference.jpg). The output
texture maps 1:1 onto the bounding box of the plate's inner face in the
3D model (see `plate.inner` in src/caseParams.js).

Pixels outside the face outline (dark frame, background) and a thin band
along it are replaced by colours propagated from the silver area, so no
dark rim shows up on the 3D plate.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "reference.jpg"
DST = ROOT / "assets" / "logo-plate.png"

# Silver inner plate in the reference photo: left, top, right, bottom (px).
# The photo is almost frontal at the plate, so a corner-to-corner warp
# (top-left, bottom-left, bottom-right, top-right) is enough to square it.
QUAD = [(123.4, 183.3), (123.4, 268.3), (191.6, 268.3), (191.6, 183.3)]
OUT_W, OUT_H = 512, 640
# Must match `plate.inner` in src/caseParams.js
PLATE = dict(width=0.122, height=0.153, topBulge=0.0015, topCornerRadius=0.007,
             sideArcRadius=0.1027, tipRadius=0.012)
EDGE_SHRINK = 0.06  # ignore this much (fraction of width) along the face outline


def warp(img):
    big = 8
    w, h = OUT_W // big * 2, OUT_H // big * 2
    flat = QUAD[0] + QUAD[1] + QUAD[2] + QUAD[3]
    small = img.transform((w, h), Image.QUAD, flat, resample=Image.BICUBIC)
    return small.resize((OUT_W, OUT_H), Image.LANCZOS)


def shield_polygon(width, height, top_bulge, corner_r, side_arc_r, tip_r, n=90):
    """Same outline as shieldOutline() in src/caseModel.js (tip at y=0)."""
    w2, sb = width / 2, max(top_bulge, 1e-5)
    r_top = (w2 * w2 + sb * sb) / (2 * sb)
    c_top = (0.0, height - r_top)
    c_cor = (w2 - corner_r, height - r_top + np.sqrt((r_top - corner_r) ** 2 - (w2 - corner_r) ** 2))
    ys = tip_r + np.sqrt((side_arc_r - tip_r) ** 2 - (w2 - side_arc_r) ** 2)
    c_side = (w2 - side_arc_r, ys)
    c_tip = (0.0, tip_r)
    a1 = np.arctan2(c_cor[1] - c_top[1], c_cor[0] - c_top[0])
    a2 = np.arctan2(c_tip[1] - c_side[1], c_tip[0] - c_side[0])

    def arc(c, r, a, b):
        t = np.linspace(a, b, n)
        return np.stack([c[0] + r * np.cos(t), c[1] + r * np.sin(t)], 1)

    right = np.concatenate([
        arc(c_top, r_top, np.pi / 2, a1),
        arc(c_cor, corner_r, a1, 0),
        arc(c_side, side_arc_r, 0, a2),
        arc(c_tip, tip_r, a2, -np.pi / 2),
    ])
    left = right[::-1] * np.array([-1, 1])
    return np.concatenate([right, left])


def shield_mask(shrink):
    """Pixels inside the plate face outline, shrunk by `shrink` (fraction of width)."""
    p = PLATE
    f = -shrink * p["width"]
    w2, sb = p["width"] / 2, p["topBulge"]
    r_top = (w2 * w2 + sb * sb) / (2 * sb) + f
    poly = shield_polygon(p["width"] + 2 * f, p["height"] + 2 * f,
                          r_top - np.sqrt(r_top ** 2 - (w2 + f) ** 2),
                          p["topCornerRadius"] + f, p["sideArcRadius"] + f, p["tipRadius"] + f)
    poly[:, 1] -= f  # keep the shrunk outline centred on the original one
    px = (poly[:, 0] / p["width"] + 0.5) * OUT_W
    py = (1 - poly[:, 1] / p["height"]) * OUT_H
    img = Image.new("L", (OUT_W, OUT_H), 0)
    ImageDraw.Draw(img).polygon(list(zip(px, py)), fill=255)
    return np.asarray(img) > 127


def fill_from_inside(rgb, keep):
    """Grow the kept pixels outward, one ring at a time (average of known neighbours)."""
    out = rgb.copy()
    known = keep.copy()
    shifts = [(0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)]
    while not known.all():
        acc = np.zeros_like(out)
        cnt = np.zeros(known.shape, np.float32)
        for dy, dx in shifts:
            k = np.roll(known, (dy, dx), (0, 1))
            acc += np.roll(out, (dy, dx), (0, 1)) * k[..., None]
            cnt += k
        new = (~known) & (cnt > 0)
        out[new] = acc[new] / cnt[new][:, None]
        known |= new
    # soften the grown area so it does not show streaks
    soft = np.asarray(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)))
    return np.where(keep[..., None], out, soft.astype(np.float32))


def main():
    img = Image.open(SRC).convert("RGB")
    flat = warp(img)
    flat = flat.filter(ImageFilter.UnsharpMask(radius=3, percent=70, threshold=2))
    rgb = np.asarray(flat).astype(np.float32)
    filled = fill_from_inside(rgb, shield_mask(EDGE_SHRINK))
    result = Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8))
    result.save(DST)
    print(f"saved {DST} ({OUT_W}x{OUT_H})")


if __name__ == "__main__":
    main()
