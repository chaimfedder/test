"""Parametric single-sheet hat insert ("Direction C").

All geometry (flat layout, fold hinges, 3D poses, hat, checks) derives from params.json.
Units: mm. Flat sheet coordinates: X = template length (hat front-back axis), Y = width.
Assembled: Z up, bag floor at Z = 0.

Kinematic convention: every panel is a child of exactly one parent across one hinge
line (p0 -> p1 in flat coordinates). The child lies on the LEFT of the hinge direction.
A positive fold angle rotates the child toward the parent's top face (+z local).
"""
import json
import math
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon, Point, box
from shapely import affinity

HERE = Path(__file__).parent


# ---------------------------------------------------------------- parameters
def load_params(path=None):
    """params.json, or the file named by $HAT_PARAMS. A file with "_base" overrides that base file."""
    import os
    path = Path(path or os.environ.get("HAT_PARAMS") or HERE / "params.json")
    with open(path) as f:
        p = json.load(f)
    if "_base" in p:
        base = load_params(path.parent / p["_base"])
        base.update({k: v for k, v in p.items() if not k.startswith("_")})
        return base
    return {k: v for k, v in p.items() if not k.startswith("_")}


def ellipse_perimeter(a, b, n=200000):
    th = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    return float(np.sum(np.sqrt((a * np.sin(th)) ** 2 + (b * np.cos(th)) ** 2)) * (2 * np.pi / n))


def solve_head_ellipse(perimeter, diam_diff):
    """Semi-axes (a, b) with 2a - 2b = diam_diff and exact perimeter."""
    d = diam_diff / 2.0
    lo, hi = 1.0, perimeter / 2.0
    for _ in range(100):
        b = 0.5 * (lo + hi)
        if ellipse_perimeter(b + d, b) > perimeter:
            hi = b
        else:
            lo = b
    b = 0.5 * (lo + hi)
    return b + d, b


def derive(p):
    t = p["board_thickness"]
    a_h, b_h = solve_head_ellipse(p["head_circumference"], p["head_oval_diff"])
    e = p["crown_ease_per_side"]
    a_c, b_c = a_h + e, b_h + e
    a_b, b_b = a_c + p["brim_width"], b_c + p["brim_width"]
    Hs = p["crown_height"] + p["bottom_clearance"]          # support (contact) level
    Hd = Hs - p["brim_cavity_below_support"]                # deck top surface
    hx, hy = a_c + p["hole_clearance"], b_c + p["hole_clearance"]
    cl = p["brim_side_clearance"]
    # outer-wall inner face sits at deck_edge + t/2  ->  interior half = deck half + t/2
    L = 2 * (a_b + cl - t / 2)
    W = 2 * (b_b + cl - t / 2)
    a = Hs - Hd                                             # riser tab: deck mid-plane -> apex mid
    d = p["riser_base_depth"]
    # return panel: apex mid (Hs - t/2) -> foot resting ON the deck top (lowest corner at Hd)
    alpha = math.atan2(d, a)
    for _ in range(50):
        dz = (Hs - t / 2) - (Hd + (t / 2) * math.sin(alpha))
        alpha = math.atan2(d, dz)
    b = math.hypot(d, dz)
    alpha = math.degrees(alpha)                             # angle of return from vertical
    D = dict(
        t=t, a_h=a_h, b_h=b_h, a_c=a_c, b_c=b_c, a_b=a_b, b_b=b_b,
        Hs=Hs, Hd=Hd, Hf=p["frame_height"], hx=hx, hy=hy, L=L, W=W,
        riser_a=a, riser_b=b, riser_d=d, riser_alpha=alpha,
        hS=Hd - t,                                          # leg (skirt) length
        hO_short=p["frame_height"] - t,                     # short wall: floor strip mid -> rim mid
        hO_long=p["frame_height"] - t - 0.5 - t / 2,        # long wall top edge just under short rim
        r=p["short_rim_depth"],
        crown_tip_z=Hs - p["crown_height"],
    )
    D["outer_L"] = L + 3 * t                                # short outer walls at x = +-(L/2 + t)
    D["outer_W"] = 2 * (W / 2 + t + p["short_wall_ear"])
    D["outer_H"] = p["frame_height"]
    return D


# ---------------------------------------------------------------- panels
class Panel:
    def __init__(self, name, poly, parent=None, hinge=None, final=0.0, group="", label="",
                 holes=(), color="board"):
        self.name = name
        self.poly = Polygon(poly, [list(h) for h in holes]) if not isinstance(poly, Polygon) else poly
        self.parent = parent
        self.hinge = hinge            # (p0, p1) flat coords
        self.final = final            # final fold angle, degrees
        self.group = group
        self.label = label
        self.color = color


def _xf(pts, rot_deg, tx, ty):
    c, s = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))
    return [(c * x - s * y + tx, s * x + c * y + ty) for x, y in pts]


def rounded_rect(hx, hy, R, n=24):
    pts = []
    for cx, cy, a0 in ((hx - R, hy - R, 0), (-hx + R, hy - R, 90), (-hx + R, -hy + R, 180), (hx - R, -hy + R, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + R * math.cos(a), cy + R * math.sin(a)))
    return pts


def lock_tab_outline(w, h, ear):
    """Arrow-head lock tab standing on y=0, centred on x=0 (open polyline from left base to right base)."""
    hw = w / 2
    return [(-hw, 0), (-hw, h * 0.45), (-hw - ear, h * 0.45), (-hw + 1.0, h), (hw - 1.0, h),
            (hw + ear, h * 0.45), (hw, h * 0.45), (hw, 0)]


def build(p=None):
    p = p or load_params()
    D = derive(p)
    t, L, W, Hf = D["t"], D["L"], D["W"], D["Hf"]
    hS, r = D["hS"], D["r"]
    c = p["leg_corner_gap"]
    panels = {}
    cuts = {"slots": [], "waste": []}

    # ---- deck with central hole and riser-tongue slots
    hole = rounded_rect(D["hx"], D["hy"], p["hole_corner_radius"])
    deck_holes = [hole]

    # ---- risers (tabs cut out of the hole)
    a, b, dd, alpha = D["riser_a"], D["riser_b"], D["riser_d"], D["riser_alpha"]
    e = p["riser_tongue_length"]
    riser_specs = [  # name, label, rot, tx, ty, width
        ("R_A", "א", 180, 0.0, D["hy"], p["riser_width_long"]),
        ("R_B", "ב", 90, D["hx"], 0.0, p["riser_width_short"]),
        ("R_C", "ג", 0, 0.0, -D["hy"], p["riser_width_long"]),
        ("R_D", "ד", -90, -D["hx"], 0.0, p["riser_width_short"]),
    ]
    riser_parts = []
    for nm, lab, rot, tx, ty, w in riser_specs:
        hw = w / 2
        tw = w * p["riser_tongue_width_ratio"] / 2
        X = lambda pts: _xf(pts, rot, tx, ty)
        tab = X([(-hw, 0), (hw, 0), (hw, a), (-hw, a)])
        ret = X([(-hw, a), (hw, a), (hw, a + b), (-hw, a + b)])
        tng = X([(-tw, a + b), (tw, a + b), (tw - 1, a + b + e), (-tw + 1, a + b + e)])
        h_tab = tuple(X([(-hw, 0), (hw, 0)]))
        h_ret = tuple(X([(-hw, a), (hw, a)]))
        h_tng = tuple(X([(-tw, a + b), (tw, a + b)]))
        panels[nm + "_tab"] = Panel(nm + "_tab", tab, "deck", h_tab, 90.0, "riser", lab)
        panels[nm + "_ret"] = Panel(nm + "_ret", ret, nm + "_tab", h_ret, 180.0 - alpha, "riser", lab)
        panels[nm + "_tng"] = Panel(nm + "_tng", tng, nm + "_ret", h_tng, None, "riser_tongue", lab)
        # slot for tongue in deck: inward of the return foot (deck local: base at ly = -dd from hinge)
        t_ = p["board_thickness"]
        s0, s1 = -dd - t_ / 2 - 0.5, -dd + e + t_ / 2 + 1.0       # room for the tongue thickness
        sl = X([(-tw - 0.5, s0), (tw + 0.5, s0), (tw + 0.5, s1), (-tw - 0.5, s1)])
        deck_holes.append(sl)
        cuts["slots"].append(sl)
        riser_parts.append(Polygon(tab).union(Polygon(ret)).union(Polygon(tng)))

    deck_poly = Polygon([(-L / 2, -W / 2), (L / 2, -W / 2), (L / 2, W / 2), (-L / 2, W / 2)], deck_holes)
    panels["deck"] = Panel("deck", deck_poly, None, None, 0.0, "deck", "משטח")
    waste = Polygon(hole)
    for rp in riser_parts:
        waste = waste.difference(rp.buffer(0.01))
    cuts["waste"].append(waste)

    # ---- wall chains
    sides = [  # name, label, rot, tx, ty, half-edge, kind
        ("S1", "1", 0, 0.0, W / 2, L / 2, "long"),
        ("S2", "2", -90, L / 2, 0.0, W / 2, "short"),
        ("S3", "3", 180, 0.0, -W / 2, L / 2, "long"),
        ("S4", "4", 90, -L / 2, 0.0, W / 2, "short"),
    ]
    tw_, th_, te_ = p["lock_tab_width"], p["lock_tab_height"], p["lock_tab_ear"]
    for nm, lab, rot, tx, ty, E, kind in sides:
        X = lambda pts: _xf(pts, rot, tx, ty)
        y0 = 0.0
        leg = [(-(E - c), y0), (E - c, y0), (E - c, y0 + hS), (-(E - c), y0 + hS)]
        panels[nm + "_leg"] = Panel(nm + "_leg", X(leg), "deck", tuple(X([(-(E - c), y0), (E - c, y0)])), -90.0, "leg", lab)
        y1 = y0 + hS
        sw = t                     # floor double-score strip
        strip = [(-(E - c), y1), (E - c, y1), (E - c, y1 + sw), (-(E - c), y1 + sw)]
        panels[nm + "_strip"] = Panel(nm + "_strip", X(strip), nm + "_leg", tuple(X([(-(E - c), y1), (E - c, y1)])), 90.0, "strip", lab)
        y2 = y1 + sw
        if kind == "long":
            H = D["hO_long"]
            xe = E
            # outline with two arrow lock tabs on the top edge
            cx = E - p["lock_tab_inset"]
            tabL = [(x - cx, y) for x, y in lock_tab_outline(tw_, th_, te_)]
            tabR = [(x + cx, y) for x, y in lock_tab_outline(tw_, th_, te_)]
            outline = [(-xe, y2), (xe, y2), (xe, y2 + H)]
            outline += [(x, y2 + H + y) for x, y in reversed(tabR)]
            outline += [(x, y2 + H + y) for x, y in reversed(tabL)]
            outline += [(-xe, y2 + H)]
            panels[nm + "_wall"] = Panel(nm + "_wall", X(outline), nm + "_strip", tuple(X([(-(E - c), y2), (E - c, y2)])), 90.0, "wall", lab)
        else:
            H = D["hO_short"]
            xe = E + t + p["short_wall_ear"]
            wall = [(-xe, y2), (xe, y2), (xe, y2 + H), (-xe, y2 + H)]
            panels[nm + "_wall"] = Panel(nm + "_wall", X(wall), nm + "_strip", tuple(X([(-(E - c), y2), (E - c, y2)])), 90.0, "wall", lab)
            y3 = y2 + H
            # two corner rim flaps (only at the corners, so the brim can pass between them)
            # each carries a slot that receives the long-wall lock tab
            ys = y3 + (p["lock_tab_inset"] + t)          # slot centre distance from rim crease
            fl = p["rim_flap_length"]
            for side, sx in (("a", -(E + t)), ("b", E + t)):
                x0, x1 = (-xe, -xe + fl) if side == "a" else (xe - fl, xe)
                sh = (t + 1.0) / 2                       # slot width = board thickness + 1 mm
                sl = X([(sx - sh, ys - (tw_ + 1) / 2), (sx + sh, ys - (tw_ + 1) / 2),
                        (sx + sh, ys + (tw_ + 1) / 2), (sx - sh, ys + (tw_ + 1) / 2)])
                cuts["slots"].append(sl)
                rim = X([(x0, y3), (x1, y3), (x1, y3 + r), (x0, y3 + r)])
                panels[nm + "_rim" + side] = Panel(nm + "_rim" + side, Polygon(rim, [sl]), nm + "_wall",
                                                   tuple(X([(x0, y3), (x1, y3)])), 90.0, "rim", lab)

    return p, D, panels, cuts


# ---------------------------------------------------------------- kinematics
def rot_about_axis(p0, p1, ang_deg):
    p0 = np.array([p0[0], p0[1], 0.0])
    u = np.array([p1[0] - p0[0], p1[1] - p0[1], 0.0])
    u /= np.linalg.norm(u)
    th = math.radians(ang_deg)
    K = np.array([[0, -u[2], u[1]], [u[2], 0, -u[0]], [-u[1], u[0], 0]])
    R = np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * K @ K
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = p0 - R @ p0
    return T


def tongue_angles(D):
    """(angle while swinging = lying flat inward at the end, final angle = straight down through slot)."""
    al = D["riser_alpha"]
    # return continuation direction is (alpha - 90) deg in the (outward, up) plane;
    # flat-inward tongue = 180 deg, down = 270 deg.  Positive fold = toward return's top face.
    return 90.0 + al, al  # verified numerically in checks.py


def poses(panels, D, angles=None, root=None):
    """World 4x4 transform per panel. angles: dict name->deg (defaults to final)."""
    out = {}
    order = []
    def visit(n):
        if n in out:
            return
        pn = panels[n]
        if pn.parent is None:
            out[n] = root if root is not None else _T(0, 0, D["Hd"] - D["t"] / 2)
        else:
            visit(pn.parent)
            ang = (angles or {}).get(n, pn.final if pn.final is not None else tongue_angles(D)[1])
            out[n] = out[pn.parent] @ rot_about_axis(pn.hinge[0], pn.hinge[1], ang)
        order.append(n)
    for n in panels:
        visit(n)
    return out


def _T(x, y, z):
    T = np.eye(4)
    T[:3, 3] = (x, y, z)
    return T


def apply(T, pts2d, z=0.0):
    P = np.c_[np.asarray(pts2d, float), np.full(len(pts2d), z), np.ones(len(pts2d))]
    return (T @ P.T).T[:, :3]


# ---------------------------------------------------------------- hat geometry
def hat_surfaces(p, D, n_phi=144, n_s=40, n_u=16):
    """Return dict of (verts, faces) for crown outer, crown inner, brim top/bottom, band, sweat."""
    a_c, b_c, Hs = D["a_c"], D["b_c"], D["Hs"]
    H = p["crown_height"]
    phis = np.linspace(0, 2 * np.pi, n_phi, endpoint=False)

    def crown_scale(s):
        # gentle taper toward the crown top, rounded edge in the last 12%
        k = 1.0 - 0.08 * s
        edge = np.clip((s - 0.88) / 0.12, 0, 1)
        return k * np.sqrt(np.clip(1 - edge ** 2 * 0.55, 0, 1))

    def crease(x, y):
        # centre crease (teardrop dent) lifts the inverted crown top upward
        return 22.0 * np.exp(-((x / (0.55 * a_c)) ** 2 + (y / (0.22 * b_c)) ** 2))

    def ring(s, inset=0.0):
        k = crown_scale(s)
        x = (a_c - inset) * k * np.cos(phis)
        y = (b_c - inset) * k * np.sin(phis)
        z = np.full_like(x, Hs - H * s)
        return np.c_[x, y, z]

    # crown wall (s from 0 to 1) + top cap with crease
    rings = [ring(s) for s in np.linspace(0, 1, n_s)]
    cap_rings = []
    for f in np.linspace(1, 0.02, 24)[1:]:
        rr = ring(1.0)
        rr[:, 0] *= f
        rr[:, 1] *= f
        rr[:, 2] = Hs - H + crease(rr[:, 0], rr[:, 1]) * (1 - f ** 2) ** 0.5 * 1.0 + 0 * f
        cap_rings.append(rr)
    crown_outer = _loft(rings + cap_rings, close_end=True)

    # inside of the crown (felt 2 mm), open at head opening
    t_f = p["crown_ease_per_side"]
    rings_i = [ring(s, inset=t_f) + np.array([0, 0, 0.0]) for s in np.linspace(0, 1, n_s)]
    for rr in rings_i:
        rr[:, 2] = np.minimum(rr[:, 2] + 0.0, Hs)
    rings_i[-1][:, 2] += t_f
    cap_i = []
    for f in np.linspace(1, 0.02, 24)[1:]:
        rr = ring(1.0, inset=t_f)
        rr[:, 0] *= f
        rr[:, 1] *= f
        rr[:, 2] = Hs - H + t_f + crease(rr[:, 0], rr[:, 1]) * (1 - f ** 2) ** 0.5
        cap_i.append(rr)
    crown_inner = _loft(rings_i + cap_i, close_end=True, flip=True)

    # brim: offset outward along ellipse normal, curl as function of direction
    bw, drop, rise, bt = p["brim_width"], p["brim_side_drop"], p["brim_front_rise"], p["brim_thickness"]
    nx = np.cos(phis) / a_c
    ny = np.sin(phis) / b_c
    nn = np.hypot(nx, ny)
    nx, ny = nx / nn, ny / nn
    x0, y0 = a_c * np.cos(phis), b_c * np.sin(phis)
    us = np.linspace(0, bw, n_u)
    bot, top = [], []
    for u in us:
        w = (u / bw) ** 2
        dz = w * (rise * nx ** 2 - drop * ny ** 2)
        x, y = x0 + u * nx, y0 + u * ny
        bot.append(np.c_[x, y, Hs + dz])
        top.append(np.c_[x, y, Hs + dz + bt])
    brim = _brim_solid(bot, top)

    # head-opening sweatband (visible from above) and ribbon band outside the crown
    sweat = _loft([ring(0.0, inset=t_f + 0.2) + [0, 0, 0.0], ring(0.30, inset=t_f + 0.2)], flip=True)
    band = _loft([ring(s, inset=-0.8) for s in np.linspace(0.02, 0.33, 4)])
    return dict(crown_outer=crown_outer, crown_inner=crown_inner, brim=brim, sweat=sweat, band=band)


def _loft(rings, close_end=False, flip=False):
    n = len(rings[0])
    V = np.vstack(rings)
    F = []
    for i in range(len(rings) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            c, d = a + n, b + n
            F += [(a, b, d), (a, d, c)]
    if close_end:
        V = np.vstack([V, rings[-1].mean(axis=0)])
        cidx = len(V) - 1
        base = (len(rings) - 1) * n
        for j in range(n):
            F.append((base + j, base + (j + 1) % n, cidx))
    F = np.array(F)
    if flip:
        F = F[:, ::-1]
    return V, F


def _brim_solid(bot, top):
    n = len(bot[0])
    m = len(bot)
    V = np.vstack(bot + top)
    F = []
    off = m * n
    for i in range(m - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            c, d = a + n, b + n
            F += [(a, d, b), (a, c, d)]                         # bottom (normals down)
            F += [(off + a, off + b, off + d), (off + a, off + d, off + c)]  # top
    for i in (0, m - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            if i == 0:
                F += [(a, b, off + b), (a, off + b, off + a)]
            else:
                F += [(a, off + b, b), (a, off + a, off + b)]
    return V, np.array(F)


if __name__ == "__main__":
    p, D, panels, cuts = build()
    for k in ("a_h", "b_h", "a_c", "b_c", "a_b", "b_b", "Hs", "Hd", "hx", "hy", "L", "W", "outer_L", "outer_W", "riser_b", "riser_alpha"):
        print(f"{k:10s} {D[k]:9.3f}")
    print("panels", len(panels))
