"""Edit the final video: renders + diagrams + Hebrew labels + subtitles + ElevenLabs narration.

Every number shown on screen is read from model.derive / out/checks.json (same data as the model).
Output: out/hat_insert_explainer.mp4, out/subtitles_he.srt, out/narration_he.txt
"""
import json
import math
import re
import subprocess
import sys
import wave
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import anim
import model
import proj

HERE = Path(__file__).parent
OUT = HERE / "out"
FR = OUT / "frames"
AUD = OUT / "audio"
W, H, FPS = 1920, 1080, 30
FB = str(HERE / "fonts" / "Heebo-700.ttf")
FRG = str(HERE / "fonts" / "Heebo-400.ttf")
PREVIEW = "--preview" in sys.argv          # low-res quick check of the edit

p, D, P = anim.p, anim.D, anim.PANELS
CHK = json.load(open(OUT / "checks.json"))
SEAT = CHK["hat_seat_dz_mm"]
HM = CHK["heights_mm"]
PL = CHK["plan_mm"]
NARR = {d["id"]: d["text"] for d in json.load(open(HERE / "narration.json"))}
TF = model.poses(P, D)                        # final poses (mm)


def cm(v, nd=1):
    return f"{v / 10:.{nd}f}"


OUTER = PL["template_outer"]
BAG = anim.BAG
SHEET = CHK["flat"]["sheet_bbox_mm"]

COL = dict(ink=(25, 25, 25), blue=(20, 70, 170), green=(10, 115, 45), red=(180, 40, 20), orange=(200, 90, 0),
           brown=(110, 70, 20), grey=(90, 90, 90))


@lru_cache(None)
def font(sz, bold=True):
    return ImageFont.truetype(FB if bold else FRG, sz)


def tbox(d, xy, s, sz=34, fill=COL["ink"], bold=True, anchor="mm", bg=(255, 255, 255, 232), pad=(14, 9)):
    f = font(sz, bold)
    bb = d.textbbox(xy, s, font=f, anchor=anchor, direction="rtl", language="he")
    if bg:
        d.rounded_rectangle((bb[0] - pad[0], bb[1] - pad[1], bb[2] + pad[0], bb[3] + pad[1]), 12, fill=bg)
    d.text(xy, s, font=f, fill=fill, anchor=anchor, direction="rtl", language="he")
    return bb


def callout(d, pt, lab, s, color=COL["ink"], sz=32):
    pt = tuple(map(float, pt))
    d.line([pt, lab], fill=color + (255,), width=4)
    d.ellipse((pt[0] - 8, pt[1] - 8, pt[0] + 8, pt[1] + 8), fill=color + (255,))
    tbox(d, lab, s, sz, color)


def arrow(d, a, b, color=COL["red"], w=5, head=16, both=True):
    a, b = np.array(a, float), np.array(b, float)
    d.line([tuple(a), tuple(b)], fill=color + (255,), width=w)
    v = b - a
    n = v / (np.linalg.norm(v) + 1e-9)
    q = np.array([-n[1], n[0]])
    for tip, s in ((b, 1), (a, -1)) if both else ((b, 1),):
        base = tip - s * n * head
        d.polygon([tuple(tip), tuple(base + q * head * 0.5), tuple(base - q * head * 0.5)], fill=color + (255,))


def alpha_in(tau, t0, dur=0.35):
    return max(0.0, min(1.0, (tau - t0) / dur))


# ------------------------------------------------------------------ base images
@lru_cache(maxsize=8)
def load_img(path):
    im = Image.open(path).convert("RGB")
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    return im


def shot_frame(name, tau):
    files = sorted((FR / name).glob("*.png"))
    if not files:
        return Image.new("RGB", (W, H), (235, 235, 235))
    i = min(int(tau * anim.FPS_RENDER + 1e-6), len(files) - 1)
    return load_img(str(files[i]))


def kenburns(path, tau, dur, z0=1.0, z1=1.05, cx=0.5, cy=0.5):
    im = load_img(str(path))
    z = z0 + (z1 - z0) * min(1, tau / max(dur, 0.1))
    w, h = W / z, H / z
    x0, y0 = (W - w) * cx, (H - h) * cy
    return im.crop((int(x0), int(y0), int(x0 + w), int(y0 + h))).resize((W, H), Image.BILINEAR)


def P2(cam, pt):
    return proj.project(cam, pt, W, H)


def panel_point(n, f=(0.5, 0.5), T=None):
    b = P[n].poly.bounds
    pt = (b[0] + (b[2] - b[0]) * f[0], b[1] + (b[3] - b[1]) * f[1])
    return model.apply((T or TF)[n], [pt])[0]


# ------------------------------------------------------------------ subtitles
def chunks(text):
    parts = re.split(r"(?<=[.:])\s+", text.strip())
    out = []
    for s in parts:
        if len(s) <= 78:
            out.append(s)
            continue
        cur = ""
        for w in s.split(", "):
            nxt = (cur + ", " + w) if cur else w
            if len(nxt) > 78 and cur:
                out.append(cur + ",")
                cur = w
            else:
                cur = nxt
        out.append(cur)
    return out


def sentence_times(text, dur):
    cs = chunks(text)
    L = sum(len(c) for c in cs)
    t, res = 0.0, []
    for c in cs:
        dt = dur * len(c) / L
        res.append((t, t + dt, c))
        t += dt
    return res


def subtitle(d, s):
    f = font(36, False)
    bb = d.textbbox((W / 2, H - 70), s, font=f, anchor="mm", direction="rtl", language="he")
    d.rounded_rectangle((bb[0] - 22, bb[1] - 12, bb[2] + 22, bb[3] + 12), 14, fill=(20, 20, 20, 190))
    d.text((W / 2, H - 70), s, font=f, fill=(255, 255, 255), anchor="mm", direction="rtl", language="he")


def counter(d, n, total=24):
    tbox(d, (150, 60), f"פעולות: {n} / {total}", 30, COL["ink"], anchor="mm")


def header(d, s, sub=None):
    tbox(d, (W - 60, 60), s, 40, COL["ink"], anchor="rm")
    if sub:
        tbox(d, (W - 60, 122), sub, 28, COL["grey"], bold=False, anchor="rm")


# ------------------------------------------------------------------ scene definitions
AUDIO_OFF = 0.4
TAIL = 0.9


def audio_len(sid):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                          str(AUD / f"{sid}.mp3")], capture_output=True, text=True).stdout
    return float(out)


def phase(tau, times):
    """index of the sentence active at time tau (times from sentence_times, offset by AUDIO_OFF)."""
    k = 0
    for i, (a, b, _) in enumerate(times):
        if tau >= a + AUDIO_OFF:
            k = i
    return k


# s01 -----------------------------------------------------------------------------
def s01(tau, ctx):
    im = shot_frame("intro", tau).copy()
    d = ImageDraw.Draw(im, "RGBA")
    if tau > 0.4:
        header(d, "תבנית פנימית לכובע", "גיליון קרטון אחד · מגיעה שטוחה · בלי דבק ובלי כלים")
    if tau > 6:
        tbox(d, (360, 960), f"תבנית: {cm(OUTER[0])} × {cm(OUTER[1])} × {cm(D['Hf'])} ס״מ", 32)
    return im, d


# s02 -----------------------------------------------------------------------------
HAT_TOP = dict(loc=(0, 0, 1.2), tgt=(0, 0, 0), ortho=0.62)
HAT_SIDE = dict(loc=(0, -1.5, 0.22), tgt=(0, 0, 0.06), ortho=0.46)
ZMAX = D["Hs"] + p["brim_front_rise"] + p["brim_thickness"] + SEAT


def upright(pt):
    x, y, z = pt
    return (x, -y, ZMAX - z)


S02_MAP = {0: 0, 1: 1, 2: 2, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4}     # subtitle chunk -> visual


def s02(tau, ctx):
    k = S02_MAP[phase(tau, ctx["times"])]
    a_h, b_h, zt = D["a_h"], D["b_h"], D["Hs"] + SEAT
    if k == 0:
        im = load_img(str(FR / "stills" / "hat_3q.png")).copy()
        d = ImageDraw.Draw(im, "RGBA")
        header(d, "הכובע", "המידות מהעבודה הקודמת")
    elif k in (1, 2):
        im = load_img(str(FR / "stills" / "hat_top.png")).copy()
        d = ImageDraw.Draw(im, "RGBA")
        header(d, "פתח הראש", "מבט מלמעלה")
        pts = [P2(HAT_TOP, (a_h * math.cos(t), b_h * math.sin(t), zt)) for t in np.linspace(0, 2 * math.pi, 181)]
        d.line(pts, fill=(255, 170, 30, 255), width=6)
        if k == 1:
            tbox(d, (W / 2, 140), f"היקף פתח הראש: {p['head_circumference'] / 10:.0f} ס״מ", 40, COL["orange"])
        else:
            L0, L1 = P2(HAT_TOP, (-a_h, 0, zt)), P2(HAT_TOP, (a_h, 0, zt))
            S0, S1 = P2(HAT_TOP, (0, -b_h, zt)), P2(HAT_TOP, (0, b_h, zt))
            arrow(d, L0, L1, COL["red"])
            arrow(d, S0, S1, COL["blue"])
            tbox(d, (L1[0] - 140, L1[1] - 40), f"אורך {cm(2 * a_h, 2)} ס״מ", 34, COL["red"])
            tbox(d, (S1[0] + 150, S1[1] + 40), f"רוחב {cm(2 * b_h, 2)} ס״מ", 34, COL["blue"])
            tbox(d, (W / 2, 140), f"הפרש בין האורך לרוחב: {p['head_oval_diff'] / 10:.0f} ס״מ (אליפסה)", 36, COL["ink"])
    elif k == 3:
        im = load_img(str(FR / "stills" / "hat_side.png")).copy()
        d = ImageDraw.Draw(im, "RGBA")
        header(d, "גובה הכתר והשוליים", "מבט צד")
        z_brim = D["Hs"] + SEAT
        x = D["a_c"] + 20
        a = P2(HAT_SIDE, upright((x, 0, z_brim)))
        b = P2(HAT_SIDE, upright((x, 0, HM["crown_tip_lowest"])))
        arrow(d, a, b, COL["red"])
        tbox(d, (b[0] + 190, (a[1] + b[1]) / 2), f"כתר {p['crown_height'] / 10:.1f} ס״מ", 36, COL["red"])
        c0 = P2(HAT_SIDE, upright((-D["a_c"], 0, z_brim + 4)))
        c1 = P2(HAT_SIDE, upright((-D["a_b"], 0, z_brim + 4 + p["brim_front_rise"] * 0.5)))
        c0 = (c0[0], c0[1] - 50)
        c1 = (c1[0], c0[1])
        arrow(d, c0, c1, COL["blue"])
        tbox(d, ((c0[0] + c1[0]) / 2, c0[1] - 45), f"שוליים {p['brim_width'] / 10:.0f} ס״מ", 34, COL["blue"])
        tbox(d, (W / 2, 950), "השוליים מעוקלים – התבנית שומרת על הקימור", 30, COL["ink"], bold=False)
    else:
        im = load_img(str(FR / "cutaway" / "0000.png")).copy()
        d = ImageDraw.Draw(im, "RGBA")
        header(d, "הכובע מונח הפוך", "הכתר למטה · פתח הראש למעלה")
    return im, d


# s03 -----------------------------------------------------------------------------
def s03(tau, ctx):
    k = phase(tau, ctx["times"])
    im = load_img(str(OUT / "compare.png")).copy()
    d = ImageDraw.Draw(im, "RGBA")
    focus = None if k == 0 else (0 if k <= 3 else 1 if k <= 5 else 2)   # 0 = A (right third)
    if focus is not None:
        for j in range(3):
            x0 = W - (j + 1) * W / 3
            if j != focus:
                d.rectangle((x0, 95, x0 + W / 3, H), fill=(244, 242, 238, 175))
    return im, d


# s04 -----------------------------------------------------------------------------
def s04(tau, ctx):
    k = phase(tau, ctx["times"])
    src = {2: "frame", 3: "risers", 4: "waste"}.get(k)
    path = OUT / "layout_variants" / f"{src}.png" if src else OUT / "layout_preview.png"
    im = kenburns(path, tau, ctx["dur"], 1.0, 1.03)
    d = ImageDraw.Draw(im, "RGBA")
    if k == 1:
        d.rounded_rectangle((330, 15, 820, 230), 16, outline=(200, 40, 20, 255), width=5)
    if k == 5:
        tbox(d, (W / 2, 120), f"גודל הגיליון לפני קיפול: {cm(SHEET[0])} × {cm(SHEET[1])} ס״מ", 40, COL["red"])
    return im, d


# 3D assembly scenes ----------------------------------------------------------------
def ops_done(tau, scene):
    n = 0
    if scene in ("s05", "s06", "s07", "s08"):
        if scene == "s05":
            return 4 if tau >= 7.0 else 0
        n = 4
    if scene == "s06":
        return n + sum(1 for _, t0, t1 in anim.WALL_ORDER if tau >= t1)
    n += 4
    if scene == "s07":
        return n + sum(1 for t0, t1 in anim.LOCK_T if tau >= t1)
    n += 4
    if scene == "s08":
        return n + sum(1 for r in anim.RISERS for tt in anim.RISER_T[r][1:] if tau >= tt)
    return n


def s05(tau, ctx):
    im = shot_frame("legs", tau).copy()
    d = ImageDraw.Draw(im, "RGBA")
    cam = anim.CAM_WIDE_FLAT
    header(d, "שלב 1: ארבע רגליים", "קיפול כלפי מטה – המשטח עולה")
    counter(d, ops_done(tau, "s05"))
    if tau >= 7.0:
        for s, f in (("S1", (0.5, 0.5)), ("S2", (0.5, 0.5)), ("S3", (0.5, 0.5)), ("S4", (0.5, 0.5))):
            pt = P2(cam, panel_point(s + "_leg", f))
            tbox(d, (pt[0], pt[1]), f"רגל {s[1]}", 28, COL["blue"])
        pt = P2(cam, (0, D["W"] / 2 - 40, D["Hd"]))
        callout(d, pt, (pt[0] + 330, pt[1] - 170), f"משטח בגובה {cm(D['Hd'], 0)} ס״מ", COL["brown"])
    return im, d


def s06(tau, ctx):
    im = shot_frame("walls", tau).copy()
    d = ImageDraw.Draw(im, "RGBA")
    cam = anim.CAM_FRAME
    header(d, "שלב 2: ארבע דפנות", "קודם הארוכות (1, 3), אחר כך הקצרות (2, 4)")
    counter(d, ops_done(tau, "s06"))
    for s, t0, t1 in anim.WALL_ORDER:
        if tau >= t0:
            pt = P2(cam, panel_point(s + "_wall", (0.5, 0.55)))
            tbox(d, pt, f"דופן {s[1]}", 32, COL["brown"])
    if 0.6 < tau < 6.0:
        pt = P2(cam, (60, -(D["W"] / 2 + 0.5), 0))
        callout(d, pt, (pt[0] - 260, pt[1] + 120), "קיפול כפול בתחתית", COL["blue"], 30)
    return im, d


def s07(tau, ctx):
    im = shot_frame("locks", tau).copy()
    d = ImageDraw.Draw(im, "RGBA")
    header(d, "שלב 3: נעילת הפינות", "שפה קטנה נסגרת על לשונית")
    counter(d, ops_done(tau, "s07"))
    st = anim.shot_locks(tau)
    cam = st["cam"]
    r0 = anim.RIM_ORDER[0]
    if 1.6 < tau < 4.4:
        c = anim.RIM_CORNERS[r0]
        tab = (math.copysign(D["L"] / 2 - p["lock_tab_inset"], c[0]), math.copysign(D["W"] / 2 + D["t"], c[1]), D["Hf"] + 1)
        pt = P2(cam, tab)
        callout(d, pt, (pt[0] - 330, pt[1] - 170), "לשונית הדופן הארוכה", COL["green"], 30)
        pt2 = P2(cam, c)
        callout(d, (pt2[0], pt2[1]), (pt2[0] + 260, pt2[1] - 220), "שפה עם חריץ", COL["orange"], 30)
    if tau >= anim.LOCK_T[-1][1]:
        tbox(d, (W / 2, 950), "ארבע הפינות נעולות · השפות רק בפינות, השוליים עוברים ביניהן", 32)
    return im, d


def s08(tau, ctx):
    im = shot_frame("risers", tau).copy()
    d = ImageDraw.Draw(im, "RGBA")
    header(d, "שלב 4: ארבע תמיכות במרכז", "כל תמיכה: 3 קיפולים ויוצא משולש נעול")
    counter(d, ops_done(tau, "s08"))
    cam = anim.CAM_RISERS
    names = {"R_A": "א", "R_B": "ב", "R_C": "ג", "R_D": "ד"}
    steps = ["1. מרימים את הלשונית", "2. מקפלים כלפי חוץ ומטה", "3. לשונית קטנה לחריץ"]
    for r in anim.RISERS:
        t0, t1, t2, t3 = anim.RISER_T[r]
        if tau >= t0:
            apex = panel_point(r + "_tab", (0.5, 0.98))
            apex = (apex[0], apex[1], D["Hs"] + 8)
            pt = P2(cam, apex)
            tbox(d, (pt[0], pt[1] - 40), names[r], 40, COL["green"])
        if t0 <= tau < t3 + 0.6:
            cur = 0 if tau < t1 else 1 if tau < t2 else 2
            for i, s in enumerate(steps):
                tbox(d, (W - 60, 210 + i * 62), s, 30, COL["green"] if i == cur else COL["grey"], bold=(i == cur), anchor="rm")
    if tau >= anim.RISER_T["R_D"][3]:
        tbox(d, (W / 2, 950), "הקיר הפנימי ממרכז את הכתר · הקודקוד הוא נקודת המגע", 32)
    return im, d


def s09(tau, ctx):
    if tau < anim.HAT_IN_LEN:
        im = shot_frame("hat_in", tau).copy()
        d = ImageDraw.Draw(im, "RGBA")
        header(d, "הכנסת הכובע", "הפוך: הכתר יורד דרך הפתח")
        return im, d
    im = shot_frame("cutaway", 0).copy()
    d = ImageDraw.Draw(im, "RGBA")
    header(d, "איך הכובע יושב", "תצוגת הסבר: דופן 3 הוסתרה")
    cam = anim.CAM_CUT
    ap = panel_point("R_D_tab", (0.5, 0.98)); ap = (ap[0], ap[1], D["Hs"])
    callout(d, P2(cam, ap), (330, 300), "מגע: השוליים על קודקוד התמיכה", COL["green"], 30)
    tip = (0, -40, HM["crown_tip_lowest"])
    callout(d, P2(cam, tip), (1500, 880), f"קצה הכתר {HM['crown_tip_clearance_to_floor'] / 10:.1f} ס״מ מעל התחתית", COL["red"], 30)
    bl = (D["b_b"] * 0.0 - 120, -D["b_b"] + 20, HM["brim_lowest"] - 2)
    callout(d, P2(cam, (-150, -95, D["Hd"])), (330, 640), f"משטח {cm(D['Hd'], 0)} ס״מ · {HM['brim_lowest_minus_deck']:.0f} מ״מ מתחת לשוליים", COL["brown"], 30)
    callout(d, P2(cam, (D["L"] / 2, 60, 125)), (1620, 300), f"{PL['brim_to_wall_x']:.0f} מ״מ בין השוליים לדופן", COL["blue"], 30)
    return im, d


def s10(tau, ctx):
    im = kenburns(OUT / "section.png", tau, ctx["dur"], 1.0, 1.04, 0.5, 0.45)
    d = ImageDraw.Draw(im, "RGBA")
    return im, d


def s11(tau, ctx):
    im = shot_frame("bag", tau).copy()
    d = ImageDraw.Draw(im, "RGBA")
    header(d, "התבנית בתוך השקית", "חלק נפרד · חזית השקית שקופה לצורך ההסבר")
    cam = anim.CAM_BAG
    if tau >= 3.8:
        pt = P2(cam, (D["L"] / 2, -D["W"] / 2, D["Hf"] + BAG["floor"]))
        callout(d, pt, (pt[0] + 280, pt[1] + 200), f"תבנית {cm(OUTER[0])} × {cm(OUTER[1])} × {cm(D['Hf'])} ס״מ", COL["brown"], 30)
    if tau >= 9.0:
        u = (0, BAG["inner_W"] / 2, BAG["floor"] + BAG["usable_H"])
        callout(d, P2(cam, (-120, BAG["inner_W"] / 2, BAG["floor"] + BAG["usable_H"])), (330, 330),
                f"גובה שימושי {cm(BAG['usable_H'], 0)} ס״מ", COL["orange"], 30)
        callout(d, P2(cam, (-150, BAG["inner_W"] / 2, BAG["total_H"] - 15)), (330, 200), "אזור סגירה וידיות – מעל", COL["grey"], 28)
        tbox(d, (W / 2, 940), f"חלל שקית מינימלי: {cm(BAG['inner_L'], 0)} × {cm(BAG['inner_W'], 0)} ס״מ · גובה שימושי {cm(BAG['usable_H'], 0)} ס״מ", 34)
    return im, d


def s12(tau, ctx):
    im = shot_frame("end", tau).copy()
    d = ImageDraw.Draw(im, "RGBA")
    if tau < anim.END_LEN:
        header(d, "פירוק", "חוזרת למצב שטוח")
        return im, d
    a = alpha_in(tau, anim.END_LEN, 0.6)
    d.rectangle((0, 0, W, H), fill=(244, 242, 238, int(225 * a)))
    if a > 0.5:
        lines = [("סיכום", 52, COL["ink"]),
                 (f"גיליון קרטון אחד · {cm(SHEET[0])} × {cm(SHEET[1])} ס״מ", 38, COL["ink"]),
                 ("24 פעולות קיפול · בלי דבק · בלי כלים", 38, COL["ink"]),
                 (f"תבנית {cm(OUTER[0])} × {cm(OUTER[1])} × {cm(D['Hf'])} ס״מ", 38, COL["brown"]),
                 (f"משטח {cm(D['Hd'], 0)} · תמיכה {cm(D['Hs'], 0)} · מסגרת {cm(D['Hf'], 0)} ס״מ · קצה הכתר {HM['crown_tip_lowest'] / 10:.1f} ס״מ מעל התחתית", 32, COL["ink"]),
                 (f"שקית: לפחות {cm(BAG['inner_L'], 0)} × {cm(BAG['inner_W'], 0)} ס״מ, גובה שימושי {cm(BAG['usable_H'], 0)} ס״מ", 34, COL["orange"]),
                 ("אב טיפוס – חוזק ועמידות לבדיקה בדגם פיזי", 34, COL["red"])]
        y = 210
        for s, sz, c in lines:
            tbox(d, (W / 2, y), s, sz, c, bg=None)
            y += sz + 50
    return im, d


SCENES = [("s01_intro", s01, anim.INTRO_LEN), ("s02_hat", s02, 0), ("s03_options", s03, 0), ("s04_layout", s04, 0),
          ("s05_legs", s05, anim.LEGS_LEN), ("s06_walls", s06, anim.WALLS_LEN), ("s07_locks", s07, anim.LOCKS_LEN),
          ("s08_risers", s08, anim.RISERS_LEN), ("s09_hat_in", s09, anim.HAT_IN_LEN + 3), ("s10_section", s10, 0),
          ("s11_bag", s11, anim.BAG_LEN + 3), ("s12_end", s12, anim.END_LEN + 6)]


def silences(sid):
    """mid-points of pauses in the narration (used to snap subtitle boundaries)."""
    err = subprocess.run(["ffmpeg", "-v", "info", "-i", str(AUD / f"{sid}.mp3"), "-af", "silencedetect=n=-38dB:d=0.15",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    return [(a + b) / 2 for a, b in zip(st, en)]


def snap(times, sil, al):
    out, prev = [], 0.0
    for i, (a, b, c) in enumerate(times):
        if i < len(times) - 1:
            cand = [m for m in sil if abs(m - b) < 1.3 and m > prev + 0.6]
            if cand:
                b = min(cand, key=lambda m: abs(m - b))
        else:
            b = al
        out.append((prev, b, c))
        prev = b
    return out


def build_timeline():
    tl, t = [], 0.0
    for sid, fn, vis in SCENES:
        al = audio_len(sid)
        dur = max(al + AUDIO_OFF + TAIL, vis)
        times = snap(sentence_times(NARR[sid], al), silences(sid), al)
        tl.append(dict(sid=sid, fn=fn, start=t, dur=dur, audio=al, times=times))
        t += dur
    return tl, t


def write_audio(tl, total, path):
    sr = 44100
    buf = np.zeros(int((total + 1) * sr), np.float32)
    for sc in tl:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(AUD / f"{sc['sid']}.mp3"), "-f", "s16le", "-ac", "1",
                              "-ar", str(sr), "-"], capture_output=True).stdout
        a = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
        i0 = int((sc["start"] + AUDIO_OFF) * sr)
        buf[i0:i0 + len(a)] += a
    buf = np.clip(buf, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((buf * 32767).astype(np.int16).tobytes())


def srt_time(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(tl, path):
    i, L = 1, []
    for sc in tl:
        for a, b, s in sc["times"]:
            L += [str(i), f"{srt_time(sc['start'] + AUDIO_OFF + a)} --> {srt_time(sc['start'] + AUDIO_OFF + b)}", s, ""]
            i += 1
    path.write_text("\n".join(L), encoding="utf-8")


def main():
    tl, total = build_timeline()
    print("total", round(total, 1), "s")
    for sc in tl:
        print(f"  {sc['sid']:12s} start {sc['start']:6.1f} dur {sc['dur']:5.1f} audio {sc['audio']:5.1f}")
    write_audio(tl, total, OUT / "narration_mix.wav")
    write_srt(tl, OUT / "subtitles_he.srt")
    (OUT / "narration_he.txt").write_text("\n\n".join(f"[{sc['sid']}]\n{NARR[sc['sid']]}" for sc in tl), encoding="utf-8")
    scale = 0.5 if PREVIEW else 1.0
    ow, oh = int(W * scale), int(H * scale)
    out = OUT / ("preview_edit.mp4" if PREVIEW else "hat_insert_explainer.mp4")
    fps = 10 if PREVIEW else FPS
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ow}x{oh}",
                           "-r", str(fps), "-i", "-", "-i", str(OUT / "narration_mix.wav"),
                           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                           "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out)],
                          stdin=subprocess.PIPE)
    nfr = int(total * fps)
    for k in range(nfr):
        t = k / fps
        sc = next(s for s in tl if s["start"] <= t < s["start"] + s["dur"] + 1e-9) if t < total else tl[-1]
        tau = t - sc["start"]
        im, d = sc["fn"](tau, sc)
        # subtitles
        for a, b, s in sc["times"]:
            if a + AUDIO_OFF <= tau < b + AUDIO_OFF:
                subtitle(d, s)
        # short fade from the previous scene
        if tau < 0.3 and sc is not tl[0]:
            d.rectangle((0, 0, W, H), fill=(245, 245, 245, int(255 * (1 - tau / 0.3))))
        if scale != 1:
            im = im.resize((ow, oh), Image.BILINEAR)
        ff.stdin.write(im.tobytes())
        if k % 300 == 0:
            print("frame", k, "/", nfr, flush=True)
    ff.stdin.close()
    ff.wait()
    print("wrote", out)


if __name__ == "__main__":
    main()
