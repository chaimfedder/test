"""1:1 die-line split into A4 pages for printing, taping and tracing onto cardboard (black & white).

HAT_PARAMS=params_prototype.json python3 tile_pdf.py  ->  out_proto/template_A4_1to1.pdf
"""
import math
import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle, Circle
import numpy as np
from shapely.geometry import box, LineString, Polygon

import layout
import model

HERE = Path(__file__).parent
OUT = HERE / os.environ.get("HAT_OUT", "out_proto")
OUT.mkdir(exist_ok=True)
for w in ("400", "700"):
    font_manager.fontManager.addfont(str(HERE / "fonts" / f"Heebo-{w}.ttf"))
plt.rcParams["font.family"] = "Heebo"

PW, PH = 210.0, 297.0                      # A4 portrait, mm
ML, MR, MT, MB = 10.0, 10.0, 10.0, 16.0    # margins
CW, CH = PW - ML - MR, PH - MT - MB        # content window 190 x 271
OV = 12.0                                  # overlap between neighbouring pages
SX, SY = CW - OV, CH - OV                  # step
PAD = 3.0                                  # free border around the drawing
IN = 1 / 25.4

CUT = dict(color="black", lw=1.3, solid_capstyle="round")
VALLEY = dict(color="black", lw=1.0, ls=(0, (6, 3)))
MOUNTAIN = dict(color="black", lw=1.0, ls=(0, (7, 2.5, 1.5, 2.5)))


def mark_points(cut_lines, folds):
    """Points to prick/mark when tracing: corners of cut lines, ends of folds, and every ~12 mm on curves."""
    pts = []
    for c in cut_lines:
        c = np.asarray(c)
        n = len(c)
        for i in range(n - 1):
            a, b, d = c[i - 1] if i > 0 else c[-2], c[i], c[i + 1]
            v1, v2 = b - a, d - b
            if np.linalg.norm(v1) < 1e-6 or np.linalg.norm(v2) < 1e-6:
                continue
            ang = abs(math.degrees(math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1 @ v2)))
            if ang > 20:
                pts.append(b)
        # extra points along curves
        acc = 0.0
        for i in range(n - 1):
            seg = np.linalg.norm(c[i + 1] - c[i])
            acc += seg
            if seg < 6 and acc > 12:
                pts.append(c[i + 1])
                acc = 0.0
    for h, k, nm in folds:
        pts += [h[0], h[1]]
    # de-duplicate
    out = []
    for p_ in pts:
        if all(np.hypot(*(p_ - q)) > 2.0 for q in out):
            out.append(p_)
    return np.array(out)


def draw_dieline(ax, panels, blank, cut_lines, folds, waste, pts, labels=True, scale=1.0):
    for w in waste:
        for g in getattr(w, "geoms", [w]):
            x, y = g.exterior.xy
            ax.fill(x, y, facecolor="white", edgecolor="#777", hatch="////", lw=0.4, zorder=1)
    for c in cut_lines:
        ax.plot(c[:, 0], c[:, 1], zorder=3, **{**CUT, "lw": CUT["lw"] * scale})
    for h, k, n in folds:
        st = VALLEY if k == "valley" else MOUNTAIN
        ax.plot(h[:, 0], h[:, 1], zorder=4, **{**st, "lw": st["lw"] * scale})
    if pts is not None:
        for p_ in pts:
            ax.add_patch(Circle(p_, 1.1, fill=False, lw=0.5, color="black", zorder=5))
            ax.plot([p_[0]], [p_[1]], marker=".", ms=1.2, color="black", zorder=5)
    if labels:
        def T(pt, s, sz=11, w=700, rot=0):
            ax.text(pt[0], pt[1], s, ha="center", va="center", fontsize=sz * scale, weight=w, rotation=rot,
                    zorder=6, clip_on=True)
        C = lambda n, f=(0.5, 0.5): (lambda b: (b[0] + (b[2] - b[0]) * f[0], b[1] + (b[3] - b[1]) * f[1]))(panels[n].poly.bounds)
        for s in ("S1", "S2", "S3", "S4"):
            T(C(s + "_wall"), f"דופן {s[1]}", 14)
            T(C(s + "_leg"), f"רגל {s[1]}", 11, 400)
        for r in ("R_A", "R_B", "R_C", "R_D"):
            T(C(r + "_ret"), "תמיכה " + panels[r + "_tab"].label, 9)
        for n in panels:
            if "_rim" in n:
                T(C(n), "שפה", 7, 400, rot=90 if n.startswith(("S2", "S4")) else 0)
        b = panels["deck"].poly.bounds
        T((b[0] + 40, b[3] - 18), "משטח", 13)


PART_NAMES = {"deck": "משטח"}


def part_name(n, panels):
    if n == "deck":
        return "משטח"
    if n.startswith("R_"):
        return "תמיכה " + panels[n[:3] + "_tab"].label
    s = n[1]
    if "_leg" in n:
        return f"רגל {s}"
    if "_wall" in n or "_strip" in n:
        return f"דופן {s}"
    if "_rim" in n:
        return f"שפת פינה (דופן {s})"
    return n


def label_points(panels):
    C = lambda n, f=(0.5, 0.5): (lambda b: (b[0] + (b[2] - b[0]) * f[0], b[1] + (b[3] - b[1]) * f[1]))(panels[n].poly.bounds)
    pts = [C(n) for n in panels if n.endswith(("_wall", "_leg", "_ret")) or "_rim" in n]
    b = panels["deck"].poly.bounds
    pts.append((b[0] + 40, b[3] - 18))
    return pts


INSET_W, INSET_H = 54.0, 50.0


def find_inset_spot(win, obstacles):
    """Lower-left-first search for an empty rectangle inside the page (away from overlap strips)."""
    x0, y0, x1, y1 = win
    best = None
    for yy in np.arange(y0 + OV + 3, y1 - OV - 3 - INSET_H, 3.0):
        for xx in np.arange(x0 + OV + 3, x1 - OV - 3 - INSET_W, 3.0):
            r = box(xx, yy, xx + INSET_W, yy + INSET_H)
            if not r.intersects(obstacles):
                return (xx, yy)
    return best


def draw_inset(ax, spot, pg, pages, blank, panels, cut_lines, folds, waste, names, total):
    """Small map of the whole template with this page highlighted, page id and the parts on it."""
    xx, yy = spot
    ax.add_patch(Rectangle((xx, yy), INSET_W, INSET_H, facecolor="white", edgecolor="black", lw=0.8, zorder=20))
    allb = np.array([q["win"] for q in pages])
    gx0, gy0, gx1, gy1 = allb[:, 0].min(), allb[:, 1].min(), allb[:, 2].max(), allb[:, 3].max()
    mw, mh = INSET_W - 4, INSET_H - 24
    sc = min(mw / (gx1 - gx0), mh / (gy1 - gy0))
    ox = xx + 2 + (mw - (gx1 - gx0) * sc) / 2
    oy = yy + 2
    T = lambda X, Y: (ox + (X - gx0) * sc, oy + (Y - gy0) * sc)
    for c in cut_lines:
        P_ = np.array([T(*q) for q in c])
        ax.plot(P_[:, 0], P_[:, 1], color="black", lw=0.35, zorder=21)
    for q in pages:
        if "n" not in q:
            continue
        a = T(q["win"][0], q["win"][1])
        me = q is pg
        ax.add_patch(Rectangle(a, CW * sc, CH * sc, facecolor="#555" if me else "none", alpha=0.45 if me else 1,
                               edgecolor="black", lw=0.6 if me else 0.25, zorder=22))
        ctr = T((q["win"][0] + q["win"][2]) / 2, (q["win"][1] + q["win"][3]) / 2)
        ax.text(ctr[0], ctr[1], q["id"], ha="center", va="center", fontsize=4.2 if not me else 6,
                weight=700, color="black", zorder=23)
    ax.text(xx + INSET_W - 2.5, yy + INSET_H - 5, "דף " + pg["id"], ha="right", va="center",
            fontsize=13, weight=700, zorder=23)
    ax.text(xx + 2.5, yy + INSET_H - 5, f"{pg['n']}/{total}", ha="left", va="center", fontsize=9, zorder=23)
    txt = "חלקים בדף: " + (", ".join(names) if names else "שוליים בלבד")
    maxc = int(INSET_W * 0.95)
    if len(txt) > maxc:                       # wrap at a comma near the middle
        cut = txt.rfind(",", 0, maxc)
        txt = txt[:cut + 1] + "\n" + txt[cut + 2:]
    ax.text(xx + INSET_W - 2.5, yy + INSET_H - 13, txt, ha="right", va="center", fontsize=6.0,
            zorder=23, linespacing=1.3)


def grid(bounds):
    x0, y0, x1, y1 = bounds
    x0, y0, x1, y1 = x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD
    nc = max(1, math.ceil(((x1 - x0) - CW) / SX) + 1)
    nr = max(1, math.ceil(((y1 - y0) - CH) / SY) + 1)
    # centre the grid on the drawing
    gx = x0 - ((CW + (nc - 1) * SX) - (x1 - x0)) / 2
    gy = y1 + ((CH + (nr - 1) * SY) - (y1 - y0)) / 2
    pages = []
    for r in range(nr):
        for c in range(nc):
            wx0 = gx + c * SX
            wy1 = gy - r * SY
            pages.append(dict(r=r, c=c, id=f"{'ABCDEFG'[r]}{c + 1}", win=(wx0, wy1 - CH, wx0 + CW, wy1)))
    return pages, nr, nc


def page_has_geometry(win, blank):
    return box(*win).intersects(blank.buffer(1.0))


def main():
    global INSET_W, INSET_H
    p, D, panels, blank, cut_lines, folds, waste = layout.geometry()
    pts = mark_points(cut_lines, folds)
    pages, nr, nc = grid(blank.bounds)
    used = [pg for pg in pages if page_has_geometry(pg["win"], blank)]
    for i, pg in enumerate(used):
        pg["n"] = i + 1
    t = p["board_thickness"]
    W = blank.bounds[2] - blank.bounds[0]
    Hh = blank.bounds[3] - blank.bounds[1]
    lines_ = [LineString(c) for c in cut_lines] + [LineString(h) for h, k, n in folds]
    from shapely.ops import unary_union as _uu
    from shapely.geometry import Point
    OBST = _uu([g.buffer(3.0) for g in lines_] + [Point(*q).buffer(3.5) for q in pts] +
               [Point(*q).buffer(16.0) for q in label_points(panels)])
    path = OUT / "template_A4_1to1.pdf"
    with PdfPages(path) as pdf:
        # ------------------------------------------------ cover page
        fig = plt.figure(figsize=(PW * IN, PH * IN))
        def txt(y, s, sz=11, w=400, color="black"):
            fig.text(1 - 12 / PW, 1 - y / PH, s, ha="right", va="top", fontsize=sz, weight=w, color=color)
        txt(12, "שבלונה בגודל אמיתי 1:1 – תבנית פנימית לכובע (אב טיפוס)", 15, 700)
        txt(22, f"קרטון גלי רגיל, עובי מחושב {t:.1f} מ״מ · גיליון נדרש {W / 10:.1f} × {Hh / 10:.1f} ס״מ · {len(used)} דפים", 10)
        lines = [
            "1. הדפס בגודל אמיתי (Actual size / 100%) – לא 'התאם לדף'.",
            "2. מדוד את הריבוע למטה: חייב לצאת 10 × 10 ס״מ בדיוק. אם לא – בדוק את הגדרות ההדפסה.",
            "3. סדר את הדפים לפי המפה. הנח כל דף מעל הדף שמימינו ושמתחתיו, כך שהפס האפור שלו מכסה",
            "    את שולי הדף השכן והצלבים (+) מתלבשים זה על זה (נוח לבדוק מול חלון). הדבק בסלוטייפ.",
            "4. העתק לקרטון: נקב בסיכה או בעט בכל עיגול קטן, ואז חבר את הנקודות בסרגל.",
            "5. קודם סמן את קווי הקיפול בלחץ (עט ריק / גב סכין), אחר כך חתוך את הקווים הרציפים.",
        ]
        for i, s in enumerate(lines):
            txt(32 + i * 6.2, s, 9.5)
        # legend
        lx = 0.06
        def leg(y, st, s):
            ax_ = fig.add_axes((1 - 60 / PW, 1 - (y + 2) / PH, 45 / PW, 4 / PH))
            ax_.plot([0, 1], [0.5, 0.5], **st)
            ax_.set_xlim(0, 1); ax_.set_ylim(0, 1); ax_.axis("off")
            fig.text(1 - 64 / PW, 1 - y / PH, s, ha="right", va="center", fontsize=9.5)
        fig.text(1 - 12 / PW, 1 - 75 / PH, "מקרא", ha="right", va="top", fontsize=11, weight=700)
        leg(85, CUT, "קו רציף – לחתוך")
        leg(93, VALLEY, "מקווקו – לקפל לכיוון הצד המסומן")
        leg(101, MOUNTAIN, "קו-נקודה – לקפל לצד השני")
        fig.text(1 - 12 / PW, 1 - 109 / PH, "שני קווים צמודים = קיפול כפול (קפל את שניהם)", ha="right", va="center", fontsize=9.5)
        fig.text(1 - 12 / PW, 1 - 116 / PH, "שטח מקווקו באלכסון = פחת, לחתוך ולזרוק · עיגול קטן = נקודת סימון להעתקה", ha="right", va="center", fontsize=9.5)
        fig.text(1 - 12 / PW, 1 - 123 / PH, "הצד המסומן = הצד העליון של המשטח (פנים התבנית). הרגליים מתקפלות לצד השני.", ha="right", va="center", fontsize=9.5)
        # scale square 100 x 100 mm
        sq = fig.add_axes((12 / PW, (PH - 230) / PH, 100 / PW, 100 / PH))
        sq.add_patch(Rectangle((0, 0), 100, 100, fill=False, lw=1.2))
        for k in range(0, 101, 10):
            sq.plot([k, k], [0, 3 if k % 50 else 6], color="black", lw=0.6)
        sq.text(50, 50, "100 × 100 מ״מ\nלמדוד!", ha="center", va="center", fontsize=11, weight=700)
        sq.set_xlim(0, 100); sq.set_ylim(0, 100); sq.axis("off")
        # page map
        mp = fig.add_axes((118 / PW, (PH - 290) / PH, 80 / PW, 112 / PH))
        draw_dieline(mp, panels, blank, cut_lines, folds, waste, None, labels=False, scale=0.25)
        for pg in pages:
            x0, y0, x1, y1 = pg["win"]
            used_ = "n" in pg
            mp.add_patch(Rectangle((x0, y0), CW, CH, fill=False, lw=0.6 if used_ else 0.3,
                                   ls="-" if used_ else ":", color="black" if used_ else "#aaa"))
            mp.text((x0 + x1) / 2, (y0 + y1) / 2, pg["id"] if used_ else "–", ha="center", va="center",
                    fontsize=8, weight=700, color="black" if used_ else "#aaa")
        mp.set_aspect("equal"); mp.axis("off")
        allb = np.array([pg["win"] for pg in pages])
        mp.set_xlim(allb[:, 0].min() - 5, allb[:, 2].max() + 5); mp.set_ylim(allb[:, 1].min() - 5, allb[:, 3].max() + 5)
        fig.text(1 - 12 / PW, 1 - 138 / PH, "מפת הדפים – למטה.", ha="right", va="top", fontsize=9.5)
        fig.text(1 - 12 / PW, 1 - 144 / PH, "שורות A–C מלמעלה למטה,", ha="right", va="top", fontsize=9.5)
        fig.text(1 - 12 / PW, 1 - 150 / PH, "עמודות 1–5 משמאל לימין.", ha="right", va="top", fontsize=9.5)
        fig.text(1 - 12 / PW, 1 - 158 / PH, "אב טיפוס – לבדיקה.", ha="right", va="top", fontsize=9.5, weight=700)
        fig.text(1 - 12 / PW, 1 - 164 / PH, "אם עובי הקרטון רחוק מ־3.5 מ״מ,", ha="right", va="top", fontsize=9.5, weight=700)
        fig.text(1 - 12 / PW, 1 - 170 / PH, "החריצים והלשוניות צריכים התאמה.", ha="right", va="top", fontsize=9.5, weight=700)
        pdf.savefig(fig)
        plt.close(fig)

        # ------------------------------------------------ drawing pages
        for pg in used:
            fig = plt.figure(figsize=(PW * IN, PH * IN))
            ax = fig.add_axes((ML / PW, MB / PH, CW / PW, CH / PH))
            x0, y0, x1, y1 = pg["win"]
            # overlap strips (right and bottom) where the next page is laid on top
            if pg["c"] < nc - 1 and any(q.get("n") and q["r"] == pg["r"] and q["c"] == pg["c"] + 1 for q in pages):
                ax.add_patch(Rectangle((x1 - OV, y0), OV, CH, color="#e9e9e9", zorder=0))
            if pg["r"] < nr - 1 and any(q.get("n") and q["c"] == pg["c"] and q["r"] == pg["r"] + 1 for q in pages):
                ax.add_patch(Rectangle((x0, y0), CW, OV, color="#e9e9e9", zorder=0))
            draw_dieline(ax, panels, blank, cut_lines, folds, waste, pts)
            # parts on this page + inset map placed in an empty spot
            wbox = box(*pg["win"]).buffer(-1)
            names = []
            for n, pn in panels.items():
                if pn.poly.intersection(wbox).area > 150:
                    nm_ = part_name(n, panels)
                    if nm_ not in names:
                        names.append(nm_)
            spot = None
            for INSET_W, INSET_H in ((54.0, 50.0), (46.0, 42.0), (40.0, 37.0)):
                spot = find_inset_spot(pg["win"], OBST)
                if spot is not None:
                    break
            if spot is not None:
                draw_inset(ax, spot, pg, pages, blank, panels, cut_lines, folds, waste, names, len(used))
            else:
                print("no free spot on page", pg["id"])
            # registration crosses on the page-grid lines (they appear on both neighbouring pages)
            for gx_ in (x0 + OV / 2, x1 - OV / 2):
                for gy_ in (y0 + OV / 2, y1 - OV / 2, (y0 + y1) / 2):
                    ax.plot([gx_ - 4, gx_ + 4], [gy_, gy_], color="black", lw=0.6, zorder=7)
                    ax.plot([gx_, gx_], [gy_ - 4, gy_ + 4], color="black", lw=0.6, zorder=7)
            for gy_ in (y0 + OV / 2, y1 - OV / 2):
                gx_ = (x0 + x1) / 2
                ax.plot([gx_ - 4, gx_ + 4], [gy_, gy_], color="black", lw=0.6, zorder=7)
                ax.plot([gx_, gx_], [gy_ - 4, gy_ + 4], color="black", lw=0.6, zorder=7)
            ax.add_patch(Rectangle((x0, y0), CW, CH, fill=False, lw=0.4, color="#999", zorder=8))
            ax.set_xlim(x0, x1); ax.set_ylim(y0, y1)
            ax.axis("off")
            # footer: page id, neighbours, 100 mm check bar
            fig.text(1 - ML / PW, 10 / PH, f"דף {pg['id']}  ({pg['n']} מתוך {len(used)})", ha="right", va="center", fontsize=11, weight=700)
            nb = []
            for dr, dc, s in ((0, -1, "משמאל"), (0, 1, "מימין"), (-1, 0, "מעל"), (1, 0, "מתחת")):
                q = next((q for q in pages if q["r"] == pg["r"] + dr and q["c"] == pg["c"] + dc and q.get("n")), None)
                if q:
                    nb.append(f"{s}: {q['id']}")
            fig.text(1 - ML / PW, 4 / PH, "שכנים – " + " · ".join(nb), ha="right", va="center", fontsize=7.5)
            bar = fig.add_axes((ML / PW, 5 / PH, 100 / PW, 6 / PH))
            bar.plot([0, 100], [1, 1], color="black", lw=0.8)
            for k in range(0, 101, 10):
                bar.plot([k, k], [1, 3 if k % 50 else 5], color="black", lw=0.6)
            bar.text(102, 2, "100 מ״מ", ha="left", va="center", fontsize=7)
            bar.set_xlim(0, 100); bar.set_ylim(0, 6); bar.axis("off")
            fig.text(1 - ML / PW, 1 - 5 / PH, "1:1 · להדפיס בגודל אמיתי 100%", ha="right", va="center", fontsize=7)
            pdf.savefig(fig)
            plt.close(fig)
    print(path, "pages:", len(used) + 1, "grid", nr, "x", nc, "sheet", round(W, 1), round(Hh, 1))
    return path


if __name__ == "__main__":
    main()
