"""Flat die-line: SVG (1:1 mm), DXF, PDF and a labelled PNG preview, all from model.build()."""
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from bidi.algorithm import get_display
import numpy as np
import shapely
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union

import model

HERE = Path(__file__).parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
for w in ("400", "700"):
    font_manager.fontManager.addfont(str(HERE / "fonts" / f"Heebo-{w}.ttf"))
plt.rcParams["font.family"] = "Heebo"

CUT = "#d62728"
VALLEY = "#1f5fbf"
MOUNTAIN = "#7b2fbf"
WASTE = "#9a9a9a"


def H(s):
    return s  # matplotlib >= 3.10 lays out RTL text itself


def geometry():
    p, D, panels, cuts = model.build()
    polys = [shapely.set_precision(panels[n].poly, 0.001) for n in panels]
    blank = unary_union([pg.buffer(0.0005, join_style=2) for pg in polys]).buffer(-0.0005, join_style=2)
    cut_lines = [np.array(blank.exterior.coords)] + [np.array(i.coords) for i in blank.interiors]
    # slots that live inside a single panel (deck/rim holes) are already interiors of the union
    folds = []
    for n, pn in panels.items():
        if pn.hinge is None:
            continue
        ang = pn.final if pn.final is not None else model.tongue_angles(D)[1]
        folds.append((np.array(pn.hinge), "valley" if ang > 0 else "mountain", n))
    waste = cuts["waste"]
    return p, D, panels, blank, cut_lines, folds, waste


def write_svg(path, blank, cut_lines, folds, waste, margin=10):
    minx, miny, maxx, maxy = blank.bounds
    W, Hh = maxx - minx + 2 * margin, maxy - miny + 2 * margin
    def tr(pts):
        return " ".join(f"{x - minx + margin:.3f},{maxy - y + margin:.3f}" for x, y in pts)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.2f}mm" height="{Hh:.2f}mm" viewBox="0 0 {W:.3f} {Hh:.3f}">',
           '<!-- PROTOTYPE die-line, units mm, 1:1. Layers: CUT (red), CREASE_VALLEY (blue dash), CREASE_MOUNTAIN (purple dash-dot), WASTE (grey, removed at factory) -->']
    out.append('<g id="WASTE" fill="#cccccc" stroke="none">')
    for w in waste:
        for g in getattr(w, "geoms", [w]):
            out.append(f'<polygon points="{tr(g.exterior.coords)}"/>')
    out.append("</g>")
    out.append(f'<g id="CUT" fill="none" stroke="{CUT}" stroke-width="0.3">')
    for c in cut_lines:
        out.append(f'<polyline points="{tr(c)}"/>')
    out.append("</g>")
    for kind, col, dash in (("valley", VALLEY, "4,2"), ("mountain", MOUNTAIN, "4,1.5,1,1.5")):
        out.append(f'<g id="CREASE_{kind.upper()}" fill="none" stroke="{col}" stroke-width="0.3" stroke-dasharray="{dash}">')
        for h, k, n in folds:
            if k == kind:
                out.append(f'<polyline points="{tr(h)}"/>')
        out.append("</g>")
    out.append("</svg>")
    path.write_text("\n".join(out))


def write_dxf(path, cut_lines, folds, waste):
    """Minimal R12 ASCII DXF with layers CUT / CREASE_VALLEY / CREASE_MOUNTAIN / WASTE."""
    L = ["0", "SECTION", "2", "ENTITIES"]
    def poly(pts, layer, closed=False):
        nonlocal L
        L += ["0", "POLYLINE", "8", layer, "66", "1", "70", "1" if closed else "0"]
        for x, y in pts:
            L += ["0", "VERTEX", "8", layer, "10", f"{x:.4f}", "20", f"{y:.4f}", "30", "0.0"]
        L += ["0", "SEQEND"]
    for c in cut_lines:
        poly(c, "CUT")
    for h, k, n in folds:
        poly(h, "CREASE_" + k.upper())
    for w in waste:
        for g in getattr(w, "geoms", [w]):
            poly(g.exterior.coords, "WASTE", True)
    L += ["0", "ENDSEC", "0", "EOF"]
    path.write_text("\n".join(L))


def preview(path_png, path_pdf, p, D, panels, blank, cut_lines, folds, waste, labels=True, focus=None):
    minx, miny, maxx, maxy = blank.bounds
    fig, ax = plt.subplots(figsize=(16, 9), dpi=150)
    fig.patch.set_facecolor("#f4f2ee")
    ax.set_facecolor("#f4f2ee")
    # board fill
    xs, ys = blank.exterior.xy
    ax.fill(xs, ys, color="#c9a46a", zorder=0)
    for i in blank.interiors:
        x, y = i.xy
        ax.fill(x, y, color="#f4f2ee", zorder=0)
    for w in waste:
        for g in getattr(w, "geoms", [w]):
            x, y = g.exterior.xy
            ax.fill(x, y, facecolor="#e6e6e6", edgecolor=WASTE, hatch="///", lw=0.6, zorder=1)
    if focus is not None:
        for n, pn in panels.items():
            if pn.group not in focus:
                x, y = pn.poly.exterior.xy
                ax.fill(x, y, color="#f4f2ee", alpha=0.72, lw=0, zorder=2)
        if "waste" not in focus:
            for w in waste:
                for g in getattr(w, "geoms", [w]):
                    x, y = g.exterior.xy
                    ax.fill(x, y, color="#f4f2ee", alpha=0.72, lw=0, zorder=2)
    for c in cut_lines:
        ax.plot(c[:, 0], c[:, 1], color=CUT, lw=1.3, zorder=3)
    for h, k, n in folds:
        ax.plot(h[:, 0], h[:, 1], color=VALLEY if k == "valley" else MOUNTAIN, lw=1.3,
                ls=(0, (5, 3)) if k == "valley" else (0, (6, 2, 1.5, 2)), zorder=4)
    if labels:
        T0 = lambda n, f=(0.5, 0.5): (lambda b: (b[0] + (b[2] - b[0]) * f[0], b[1] + (b[3] - b[1]) * f[1]))(panels[n].poly.bounds)
        def tx(pt, s, size=13, color="#222", weight=700):
            ax.text(pt[0], pt[1], H(s), ha="center", va="center", fontsize=size, color=color, weight=weight, zorder=6)
        names = {"S1": "1", "S2": "2", "S3": "3", "S4": "4"}
        for s, num in names.items():
            tx(T0(s + "_wall"), f"דופן {num}", 15)
            tx(T0(s + "_leg"), f"רגל {num}", 11, "#0b3a8a", 400)
            if s + "_rim" in panels:
                c = T0(s + "_rim")
                ax.text(c[0], c[1], f"שפה {num}", ha="center", va="center", fontsize=9, color="#9a2a00", rotation=90, zorder=6)
        for r in ("R_A", "R_B", "R_C", "R_D"):
            tx(T0(r + "_ret"), panels[r + "_tab"].label, 15, "#0d5a1c")
        tx((-D["L"] / 2 + 45, D["W"] / 2 - 25), "משטח", 13)
        ax.text(D["hx"] - 30, D["hy"] - 22, "פחת", ha="center", va="center", fontsize=9, color="#555", zorder=6)
        # overall dimensions
        def dim(p0, p1, off, text, vertical=False):
            (x0, y0), (x1, y1) = p0, p1
            ax.annotate("", xy=(x0, y0), xytext=(x1, y1), arrowprops=dict(arrowstyle="<->", lw=0.9, color="#333"))
            mx, my = (x0 + x1) / 2, (y0 + y1) / 2
            ax.text(mx + (off if vertical else 0), my + (0 if vertical else off), text, ha="center", va="center",
                    fontsize=11, rotation=90 if vertical else 0, color="#222")
        dim((minx, miny - 25), (maxx, miny - 25), -14, f"{maxx - minx:.0f} mm")
        dim((maxx + 25, miny), (maxx + 25, maxy), 16, f"{maxy - miny:.0f} mm", vertical=True)
        dim((-D["L"] / 2, -D["W"] / 2 + 10), (D["L"] / 2, -D["W"] / 2 + 10), 9, f"{D['L']:.1f}")
        # legend
        lx, ly = minx - 10, maxy - 10
        items = [(CUT, "-", "חיתוך מלא"), (VALLEY, "--", "קיפול (כלפי מעלה)"),
                 (MOUNTAIN, "-.", "קיפול (כלפי מטה)"), (WASTE, "hatch", "פחת – מוסר במפעל")]
        for i, (col, st, s) in enumerate(items):
            yy = ly - i * 28
            if st == "hatch":
                ax.add_patch(plt.Rectangle((lx, yy - 6), 40, 12, facecolor="#e6e6e6", edgecolor=WASTE, hatch="///"))
            else:
                ax.plot([lx, lx + 40], [yy, yy], color=col, lw=2, ls={"-": "-", "--": (0, (5, 3)), "-.": (0, (6, 2, 1.5, 2))}[st])
            ax.text(lx + 48, yy, H(s), ha="left", va="center", fontsize=12)
        ax.text(maxx + 10, maxy - 10, H("אב טיפוס – לא לייצור"), ha="right", va="center", fontsize=12, color="#b00", weight=700)
        ax.text(maxx + 10, maxy - 38, H(f"עובי קרטון ניסיוני: {p['board_thickness']:.1f} מ״מ"), ha="right", va="center", fontsize=10)
    ax.set_aspect("equal")
    ax.set_xlim(minx - 30, maxx + 50)
    ax.set_ylim(miny - 50, maxy + 15)
    ax.axis("off")
    fig.tight_layout()
    fig.savefig(path_png, facecolor=fig.get_facecolor())
    if path_pdf:
        fig.savefig(path_pdf, facecolor=fig.get_facecolor())
    plt.close(fig)


if __name__ == "__main__":
    p, D, panels, blank, cut_lines, folds, waste = geometry()
    write_svg(OUT / "dieline.svg", blank, cut_lines, folds, waste)
    write_dxf(OUT / "dieline.dxf", cut_lines, folds, waste)
    preview(OUT / "layout_preview.png", OUT / "layout_prototype.pdf", p, D, panels, blank, cut_lines, folds, waste)
    V = OUT / "layout_variants"
    V.mkdir(exist_ok=True)
    for name, f in (("frame", {"deck", "leg", "strip", "wall", "rim"}), ("risers", {"riser", "riser_tongue"}),
                    ("waste", {"waste"}), ("deck", {"deck"})):
        preview(V / f"{name}.png", None, p, D, panels, blank, cut_lines, folds, waste, focus=f)
    print("bbox", [round(v, 1) for v in blank.bounds], "folds", len(folds), "cut loops", len(cut_lines))
