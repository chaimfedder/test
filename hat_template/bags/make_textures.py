"""Front-panel textures for the four bag designs, built from the logo crops of the reference images.
Panel aspect = bag outer length : body height (from out/checks.json)."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
B = json.load(open(HERE.parent / "out" / "checks.json"))["bag"]
PW = 2048
PH = int(round(PW * (B["inner_H"] + B["floor"]) / (B["inner_L"] + 2 * B["wall"])))


def border_color(im):
    a = np.asarray(im.convert("RGB"), float)
    e = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    return tuple(int(v) for v in np.median(e, axis=0))


def grain(img, amount=6, seed=0):
    rng = np.random.default_rng(seed)
    a = np.asarray(img, float)
    n = rng.normal(0, amount, a.shape[:2])[..., None]
    n = Image.fromarray(np.clip(n + 128, 0, 255).astype(np.uint8)[..., 0]).filter(ImageFilter.GaussianBlur(0.8))
    n = (np.asarray(n, float) - 128)[..., None]
    return Image.fromarray(np.clip(a + n, 0, 255).astype(np.uint8))


def paste_logo(base, crop, height_frac, cx=0.5, cy=0.5, feather=0.14):
    lh = int(PH * height_frac)
    lw = int(crop.width * lh / crop.height)
    lg = crop.resize((lw, lh), Image.LANCZOS)
    m = Image.new("L", (lw, lh), 0)
    f = int(min(lw, lh) * feather)
    ImageDraw.Draw(m).rectangle((f, f, lw - f, lh - f), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(f / 2))
    base.paste(lg, (int(PW * cx - lw / 2), int(PH * cy - lh / 2)), m)


def make():
    out = {}
    # 1 black + gold border + gold foil logo
    c1 = Image.open(HERE / "crop_bag1.png")
    col = border_color(c1)
    im = grain(Image.new("RGB", (PW, PH), col), 5, 1)
    d = ImageDraw.Draw(im)
    gold = (196, 150, 104)
    m = int(PW * 0.035)
    d.rounded_rectangle((m, m, PW - m, PH - m), radius=int(m * 0.8), outline=gold, width=4)
    paste_logo(im, c1, 0.36, cy=0.52)
    out["bag1"] = dict(tex=im, base=col)
    # 2 charcoal + blind emboss
    c2 = Image.open(HERE / "crop_bag2.png")
    col = border_color(c2)
    im = grain(Image.new("RGB", (PW, PH), col), 6, 2)
    paste_logo(im, c2, 0.36, cy=0.52, feather=0.1)
    out["bag2"] = dict(tex=im, base=col)
    # 3 kraft + black vertical band + cream logo
    c3 = Image.open(HERE / "crop_bag3.png")
    a = np.asarray(c3, float).mean(axis=2)
    dark = np.where(a.mean(axis=0) < 70)[0]
    x0, x1 = int(dark.min()) + 2, int(dark.max()) - 2
    band_logo = c3.crop((x0, 0, x1, c3.height))
    kraft = border_color(Image.open(HERE / "src" / "bag3_kraft_band.png").crop((150, 300, 400, 500)))
    im = grain(Image.new("RGB", (PW, PH), kraft), 10, 3)
    bw = int(PW * 0.15)
    bandcol = border_color(band_logo)
    ImageDraw.Draw(im).rectangle((PW // 2 - bw // 2, 0, PW // 2 + bw // 2, PH), fill=bandcol)
    lw = bw - 6
    lh = int(band_logo.height * lw / band_logo.width)
    lg = band_logo.resize((lw, lh), Image.LANCZOS)
    m = Image.new("L", (lw, lh), 0)
    f = int(lh * 0.10)
    ImageDraw.Draw(m).rectangle((0, f, lw, lh - f), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(f / 2))
    im.paste(lg, (PW // 2 - lw // 2, int(PH * 0.52) - lh // 2), m)
    out["bag3"] = dict(tex=im, base=kraft)
    # 4 dark green, vertical ribs, gold logo
    c4 = Image.open(HERE / "crop_bag4.png")
    col = border_color(c4)
    a = np.zeros((PH, PW, 3), float) + col
    x = np.arange(PW)
    rib = 0.5 + 0.5 * np.cos(2 * np.pi * x / (PW / (B["inner_L"] / 3.2)))
    a *= (0.86 + 0.18 * rib)[None, :, None]
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    paste_logo(im, c4, 0.32, cy=0.52, feather=0.22)
    out["bag4"] = dict(tex=im, base=col)
    for k, v in out.items():
        v["tex"].save(HERE / f"tex_{k}.png")
    meta = {k: dict(base=v["base"]) for k, v in out.items()}
    meta["bag3"]["gusset"] = border_color(Image.open(HERE / "src" / "bag3_kraft_band.png").crop((60, 450, 120, 560)))
    json.dump(meta, open(HERE / "tex_meta.json", "w"), indent=1)
    print(PW, PH, meta)


if __name__ == "__main__":
    make()
