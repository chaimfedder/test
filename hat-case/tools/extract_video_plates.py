"""Prepare the 2D material for the product video from the reference photo.

Usage:  python3 tools/extract_video_plates.py  (run from the hat-case folder)

1. assets/lid-label.png      - the small brand plate inside the lid
2. video/assets/backdrop.png - the photo with the right-hand case removed;
   the left (closed) case, the table and the room stay as photographed and
   the animated 3D case is rendered on top of it.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "reference-open-empty.png"

# Lid label corners in the photo (px): top-left, bottom-left, bottom-right, top-right
LABEL_QUAD = [(972.5, 310.5), (973.0, 388.0), (1070.0, 388.0), (1071.0, 310.0)]
LABEL_SIZE = (500, 400)

# Area covered by the right-hand case (lid, base, its shadow and reflection)
CASE_POLY = [
    (752, 330), (770, 190), (820, 110), (910, 70), (1010, 58), (1120, 70), (1215, 112), (1272, 180),
    (1298, 300), (1302, 520), (1318, 600), (1336, 660), (1343, 800), (1340, 960), (1312, 1060),
    (1240, 1147), (790, 1147), (733, 1070), (720, 930), (724, 700), (738, 610), (750, 520),
]


def label(img):
    flat = LABEL_QUAD[0] + LABEL_QUAD[1] + LABEL_QUAD[2] + LABEL_QUAD[3]
    out = img.transform(LABEL_SIZE, Image.QUAD, flat, resample=Image.BICUBIC)
    out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=50, threshold=2))
    out.save(ROOT / "assets" / "lid-label.png")


TABLE_TOP = 836  # rows below this are table top (wood grain runs horizontally)


def backdrop(img):
    w, h = img.size
    mask_img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask_img).polygon(CASE_POLY, fill=255)
    mask = np.asarray(mask_img) > 127
    rgb = np.asarray(img).astype(np.float32)
    out = rgb.copy()
    # table: interpolate along each row so the grain keeps running across
    for y in range(TABLE_TOP, h):
        xs = np.where(mask[y])[0]
        if not len(xs):
            continue
        x0, x1 = xs.min(), xs.max()
        left = rgb[y, max(x0 - 6, 0):max(x0 - 1, 1)].mean(0)
        right = rgb[y, min(x1 + 2, w - 1):min(x1 + 7, w)].mean(0) if x1 + 2 < w else left
        t = np.linspace(0, 1, x1 - x0 + 1)[:, None]
        out[y, x0:x1 + 1] = left * (1 - t) + right * t
    out[TABLE_TOP:] = np.asarray(
        Image.fromarray(np.clip(out[TABLE_TOP:], 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(1))
    ).astype(np.float32) * mask[TABLE_TOP:, :, None] + rgb[TABLE_TOP:] * (~mask[TABLE_TOP:, :, None])
    # room: continue the shelving seen between the two cases (mirrored
    # back and forth), then blend into the bright window on the right
    room = mask.copy()
    room[TABLE_TOP:] = False
    for y in range(TABLE_TOP):
        xs = np.where(room[y])[0]
        if not len(xs):
            continue
        x0, x1 = xs.min(), xs.max()
        src0, src1 = ((380, x0 - 2) if y < 215 else (692, x0 - 2))
        band = rgb[y, src0:src1]
        n = len(band)
        k = np.arange(x1 - x0 + 1)
        period = (k // n) % 2
        idx = np.where(period == 0, n - 1 - (k % n), k % n)  # mirror at the seam, then ping-pong
        row = band[idx]
        right = rgb[y, min(x1 + 2, w - 1):min(x1 + 7, w)].mean(0)
        ramp = np.clip((np.arange(x0, x1 + 1) - (x1 - 170)) / 170, 0, 1)[:, None]
        ramp = ramp * ramp * (3 - 2 * ramp)
        out[y, x0:x1 + 1] = row * (1 - ramp) + right * ramp
    soft = np.asarray(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(np.float32)
    out = np.where(room[..., None], soft, out)
    rng = np.random.default_rng(7)
    grain = rng.normal(0, 1.4, out.shape).astype(np.float32)
    feather = np.asarray(mask_img.filter(ImageFilter.GaussianBlur(3))).astype(np.float32)[..., None] / 255
    result = rgb * (1 - feather) + (out + grain) * feather
    Image.fromarray(np.clip(result, 0, 255).astype(np.uint8)).save(ROOT / "video" / "assets" / "backdrop.png")


def main():
    img = Image.open(SRC).convert("RGB")
    label(img)
    backdrop(img)
    print("saved assets/lid-label.png and video/assets/backdrop.png")


if __name__ == "__main__":
    main()
