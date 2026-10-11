"""Section drawing measured from the folded model + schematic comparison of directions A/B/C."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np
import trimesh

import model
import checks

HERE = Path(__file__).parent
OUT = HERE / "out"
for w in ("400", "700"):
    font_manager.fontManager.addfont(str(HERE / "fonts" / f"Heebo-{w}.ttf"))
plt.rcParams["font.family"] = "Heebo"
BG = "#f4f2ee"
KRAFT = "#a8783e"


def sections(axis="x"):
    """Return template and hat polylines cut by the plane x=0 (axis='x') or y=0 (axis='y')."""
    p, D, panels, cuts = model.build()
    chk = json.load(open(OUT / "checks.json"))
    T = model.poses(panels, D)
    normal = (1, 0, 0) if axis == "x" else (0, 1, 0)
    k = 1 if axis == "x" else 0          # horizontal coordinate kept in the drawing
    tpl = []
    for n, pn in panels.items():
        m = checks.panel_mesh(pn, T[n], D["t"], shrink=0.0, thk=1.0)
        s = m.section(plane_origin=(0.013, 0.013, 0), plane_normal=normal)
        if s is None:
            continue
        for e in s.discrete:
            tpl.append((n, e[:, [k, 2]]))
    hat = []
    for hn, hm in checks.hat_meshes(p, D).items():
        hm.apply_translation((0, 0, chk["hat_seat_dz_mm"]))
        if hn == "brim":
            s = hm.section(plane_origin=(0.013, 0.013, 0), plane_normal=normal)
            for e in s.discrete:
                hat.append((hn, e[:, [k, 2]]))
        else:   # open surfaces: use raw plane-intersection segments
            segs = trimesh.intersections.mesh_plane(hm, normal, (0.013, 0.013, 0))
            for sg in segs:
                hat.append((hn, sg[:, [k, 2]]))
    return p, D, chk, tpl, hat


def draw_section(ax, tpl, hat, color=KRAFT, lw=2.2, hat_color="#111"):
    for n, e in tpl:
        ax.fill(e[:, 0], e[:, 1], color=color, lw=0) if len(e) > 3 and np.allclose(e[0], e[-1]) else None
        ax.plot(e[:, 0], e[:, 1], color=color, lw=lw, solid_capstyle="butt")
    for n, e in hat:
        if n == "brim" and np.allclose(e[0], e[-1]):
            ax.fill(e[:, 0], e[:, 1], color=hat_color, lw=0)
        c = "#5a3416" if n == "sweat" else hat_color
        ax.plot(e[:, 0], e[:, 1], color=c, lw=2.6, solid_capstyle="round")


def height_marker(ax, x, z, text, side="right", color="#222", dx=12):
    ax.plot([x - 4, x + 4], [z, z], color=color, lw=1)
    ax.text(x + (dx if side == "right" else -dx), z, text, ha="left" if side == "right" else "right",
            va="center", fontsize=12, color=color)


def vdim(ax, x, z0, z1, text, color="#222", side="right"):
    ax.annotate("", xy=(x, z0), xytext=(x, z1), arrowprops=dict(arrowstyle="<->", lw=1.1, color=color, shrinkA=0, shrinkB=0))
    ax.text(x + (5 if side == "right" else -5), (z0 + z1) / 2, text, ha="left" if side == "right" else "right",
            va="center", fontsize=12, color=color, weight=700)


def section_figure():
    p, D, chk, tpl, hat = sections("x")
    h = chk["heights_mm"]
    fig, ax = plt.subplots(figsize=(16, 9), dpi=150)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.axhline(0, color="#777", lw=1.5)
    ax.fill_between([-260, 260], -6, 0, color="#ddd")
    draw_section(ax, tpl, hat)
    W2 = D["W"] / 2
    xr = W2 + 30
    # heights (all read from the model / checks.json)
    vdim(ax, -W2 - 40, 0, h["deck_top"], f"{h['deck_top']:.0f}", side="left")
    vdim(ax, -W2 - 85, 0, h["support_contact"], f"{h['support_contact']:.0f}", side="left")
    vdim(ax, -W2 - 130, 0, h["frame_top_short"], f"{h['frame_top_short']:.0f}", side="left")
    ax.text(-W2 - 40, -16, "משטח", ha="center", fontsize=11)
    ax.text(-W2 - 85, -16, "נקודת תמיכה", ha="center", fontsize=11)
    ax.text(-W2 - 130, -16, "מסגרת", ha="center", fontsize=11)
    ct = h["crown_tip_lowest"]
    vdim(ax, 25, 0, ct, f"{ct:.0f} מרווח", color="#b03000")
    vdim(ax, 60, ct, h["support_contact"], f"כתר {p['crown_height'] / 10:.1f} ס״מ", color="#0b3a8a")
    bl = h["brim_lowest"]
    vdim(ax, D["b_b"] + 2, h["deck_top"], bl, f"{bl - h['deck_top']:.0f}", color="#b03000")
    ax.text(D["b_b"] - 3, h["deck_top"] - 22, "מרווח מתחת לשוליים", ha="right", fontsize=11, color="#b03000")
    # labels
    ax.annotate("תמיכה א (מגע הכובע)", xy=(D["hy"] + 1, h["support_contact"]), xytext=(D["hy"] + 70, 172),
                fontsize=12, ha="center", arrowprops=dict(arrowstyle="->", lw=1))
    ax.annotate("רגל", xy=(W2, 45), xytext=(W2 + 55, 45), fontsize=12, va="center", arrowprops=dict(arrowstyle="->", lw=1))
    ax.annotate("דופן 1", xy=(W2 + 1, 120), xytext=(W2 + 55, 120), fontsize=12, va="center", arrowprops=dict(arrowstyle="->", lw=1))
    ax.annotate("לשונית נעילה בחריץ", xy=(D["hy"] + 17, 87), xytext=(D["hy"] + 60, 60), fontsize=11,
                arrowprops=dict(arrowstyle="->", lw=1))
    ax.text(0, 182, "חתך לרוחב התבנית (מבט מהצד) – תצוגת הסבר", ha="center", fontsize=17, weight=700)
    ax.text(0, 168, "כל המידות במ״מ ונמדדו מהמודל", ha="center", fontsize=11, color="#555")
    ax.set_aspect("equal")
    ax.set_xlim(-W2 - 175, W2 + 115)
    ax.set_ylim(-28, 192)
    ax.axis("off")
    fig.tight_layout()
    fig.savefig(OUT / "section.png", facecolor=BG)
    plt.close(fig)


def compare_figure():
    """Schematic half-sections (y >= 0, plane x = 0) of the three directions with the same hat."""
    p, D, chk, tpl, hat = sections("x")
    t = D["t"]
    hy, W2 = D["hy"], D["W"] / 2
    fig, axs = plt.subplots(1, 3, figsize=(16, 9), dpi=150)
    fig.patch.set_facecolor(BG)
    Hs = D["Hs"]
    seat = chk["hat_seat_dz_mm"]
    def frame(ax, deck):
        ax.plot([W2, W2], [0, deck], color=KRAFT, lw=2.4)                 # leg
        ax.plot([W2 + 1, W2 + 1], [0, 140], color=KRAFT, lw=2.4)          # wall
        ax.plot([hy, W2], [deck, deck], color=KRAFT, lw=2.4)              # deck
        ax.axhline(0, color="#777", lw=1.2)
    def hat_draw(ax, dz):
        sel = [(n, e + [0, dz]) for n, e in hat]
        for n, e in sel:
            m = e[:, 0] >= -1
            if n == "brim" and np.allclose(e[0], e[-1]):
                ee = e[e[:, 0] > 0]
                if len(ee):
                    ax.fill(e[:, 0], e[:, 1], color="#111", lw=0)
            ax.plot(e[:, 0], e[:, 1], color="#111", lw=1.4)
    titles = ["כיוון א: משטח 4 + תמיכות 8", "כיוון ב: משטח עליון 12, לשוניות למטה", "כיוון ג (נבחר): משטח 9 + משולשים 3"]
    notes = [
        "נפסל: תמיכה גבוהה 8 ס״מ עומדת חופשית\nאין מספיק חומר בחור לסגור אותה למשולש\nנשענת על קפיציות הקרטון",
        "נפסל: השוליים מתעקלים כלפי מטה בצדדים\nונלחצים על המשטח\n(מתאים רק לשוליים שטוחים)",
        "נבחר: משולש נעול בחריץ – לא נשען על קפיציות\n30 מ״מ חלל מתחת לנקודת התמיכה לשוליים\nכל החומר מהחור המרכזי",
    ]
    cols = ["#b00", "#b00", "#0a6a2a"]
    for i, ax in enumerate(axs[::-1]):   # Hebrew reading order: A on the right
        ax.set_facecolor(BG)
        if i == 0:
            deck = 40
            frame(ax, deck)
            ax.plot([hy, hy], [deck, deck + 80], color=KRAFT, lw=2.4)
            ax.plot([hy, hy + 8], [deck + 80, deck + 80], color=KRAFT, lw=2.4)
            hat_draw(ax, seat)
            ax.annotate("", xy=(hy + 18, deck + 70), xytext=(hy + 4, deck + 60), arrowprops=dict(arrowstyle="->", color="#b00", lw=1.6))
        elif i == 1:
            deck = 120
            frame(ax, deck)
            ax.plot([hy, hy], [deck, deck - 40], color=KRAFT, lw=2.4)
            hat_draw(ax, seat)
            ax.add_patch(plt.Circle((D["b_b"] - 10, 112), 18, fill=False, color="#b00", lw=2))
        else:
            for n, e in tpl:
                ax.plot(e[:, 0], e[:, 1], color=KRAFT, lw=2.4)
            hat_draw(ax, 0)
            ax.axhline(0, color="#777", lw=1.2)
        ax.set_title(titles[i], fontsize=15, weight=700, pad=12)
        ax.text(W2 / 2 + 10, -42, notes[i], ha="center", va="top", fontsize=11.5, color=cols[i], linespacing=1.6)
        ax.set_aspect("equal")
        ax.set_xlim(-5, W2 + 15)
        ax.set_ylim(-110, 160)
        ax.axis("off")
    fig.suptitle("השוואת כיוונים – חצי חתך, אותו כובע, אותן מידות", fontsize=19, weight=700, y=0.97)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(OUT / "compare.png", facecolor=BG)
    plt.close(fig)


if __name__ == "__main__":
    section_figure()
    compare_figure()
    print("ok")
