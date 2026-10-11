"""Animation timeline: every 3D shot is a function t(seconds) -> State, built from model.build().

All fold angles are rotations about the real hinge lines of the flat blank, so panel sizes
and connections are preserved in every frame (checked in anim_checks.py).
"""
import math

import numpy as np

import model

FPS_RENDER = 15

p, D, PANELS, CUTS = model.build()
T_ = D["t"]
TNG_SWING, TNG_FINAL = model.tongue_angles(D)
SEAT = None  # filled from checks.json by callers that need it


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def seg(t, t0, t1):
    return ease((t - t0) / (t1 - t0)) if t1 > t0 else float(t >= t1)


def lerp(a, b, u):
    return tuple(float(x) + (float(y) - float(x)) * u for x, y in zip(a, b))


def final_angles():
    return {n: (pn.final if pn.final is not None else TNG_FINAL) for n, pn in PANELS.items()}


def flat_angles():
    return {n: 0.0 for n in PANELS}


SIDES = ("S1", "S2", "S3", "S4")
RISERS = ("R_A", "R_B", "R_C", "R_D")
RIMS = [n for n in PANELS if "_rim" in n]
ALPHA = D["riser_alpha"]


def riser_angles(r, u_tab, u_ret, u_tng):
    """u_*: 0..1 progress of the three riser folds."""
    a = {}
    a[r + "_tab"] = 90.0 * u_tab
    a[r + "_ret"] = (180.0 - ALPHA) * u_ret
    # tongue: held folded up while the return swings, then dropped through the slot
    hold = TNG_SWING + 40.0
    a[r + "_tng"] = hold * min(1.0, u_ret * 3) if u_tng <= 0 else hold + (TNG_FINAL - hold) * u_tng
    return a


def frame_done(a):
    for s in SIDES:
        a[s + "_leg"] = -90.0
        a[s + "_strip"] = 90.0
        a[s + "_wall"] = 90.0
    for r in RIMS:
        a[r] = 90.0
    return a


def deck_root(z_mid):
    return model._T(0, 0, z_mid)


def legs_state(u):
    """Legs fold together while the deck rises; strips keep the walls lying on the table."""
    phi = 90.0 * u
    a = flat_angles()
    for s in SIDES:
        a[s + "_leg"] = -phi
        a[s + "_strip"] = phi
    z = T_ / 2 + D["hS"] * math.sin(math.radians(phi))
    return a, deck_root(z)


def state(angles=None, root=None, hat=None, bag=None, cam=None, hide=(), tpl_off=(0, 0, 0), tpl=True):
    return dict(angles=angles or final_angles(), root=root, hat=hat, bag=bag, cam=cam,
                hide=list(hide), tpl_off=tpl_off, tpl=tpl)


def hat_pose(dz=0.0, flip=False, x=0.0, y=0.0, z0=0.0):
    """dz relative to the seated position (positive = above)."""
    return dict(dz=dz, flip=flip, x=x, y=y, z0=z0)


# ------------------------------------------------------------------ cameras (metres)
CAM_WIDE_FLAT = dict(loc=(0.0, -1.20, 1.10), tgt=(0, 0.02, 0.02), lens=35)
CAM_FRAME = dict(loc=(0.62, -0.95, 0.78), tgt=(0, 0, 0.06), lens=40)
CAM_RISERS = dict(loc=(0.05, -0.43, 0.66), tgt=(0, 0.015, 0.095), lens=42)
CAM_HAT = dict(loc=(0.55, -0.85, 0.70), tgt=(0, 0, 0.08), lens=40)
CAM_CUT = dict(loc=(0.30, -0.95, 0.32), tgt=(0, 0, 0.07), lens=50)
CAM_BAG = dict(loc=(0.70, -1.25, 0.95), tgt=(0, 0, 0.12), lens=40)


def cam_orbit(t, T):
    ang = math.radians(-125 + 70 * ease(t / T))
    r, h = 1.0, 0.70
    return dict(loc=(r * math.cos(ang), r * math.sin(ang), h), tgt=(0, 0, 0.06), lens=45)


def corner_of(rim):
    W = model.apply(model.poses(PANELS, D)[rim], np.array(PANELS[rim].poly.exterior.coords))
    c = W.mean(axis=0)
    return c


# ------------------------------------------------------------------ shots
def shot_intro(t):
    return state(hat=hat_pose(0), cam=cam_orbit(t, 10.0))


INTRO_LEN = 10.0


def shot_legs(t):
    a, root = legs_state(seg(t, 1.0, 7.0))
    return state(angles=a, root=root, cam=CAM_WIDE_FLAT)


LEGS_LEN = 7.5

WALL_ORDER = [("S1", 0.5, 3.0), ("S3", 3.3, 5.8), ("S2", 6.3, 8.8), ("S4", 9.1, 11.6)]
WALLS_LEN = 12.0


def shot_walls(t):
    a, root = legs_state(1.0)
    for s, t0, t1 in WALL_ORDER:
        a[s + "_wall"] = 90.0 * seg(t, t0, t1)
    cam = dict(loc=lerp(CAM_WIDE_FLAT["loc"], CAM_FRAME["loc"], seg(t, 0, 0.01)),
               tgt=CAM_FRAME["tgt"], lens=CAM_FRAME["lens"])
    return state(angles=a, root=root, cam=CAM_FRAME)


def _rim_sorted():
    cs = {r: corner_of(r) for r in RIMS}
    # start with the front-right corner (closest to the camera), then go round
    order = sorted(RIMS, key=lambda r: math.atan2(cs[r][1], cs[r][0]) - (-0.6))
    first = min(RIMS, key=lambda r: (cs[r][0] - 0.6 * 300) ** 2 + (cs[r][1] + 300) ** 2)
    rest = sorted([r for r in RIMS if r != first], key=lambda r: (math.atan2(cs[r][1], cs[r][0]) - math.atan2(cs[first][1], cs[first][0])) % (2 * math.pi))
    return [first] + rest, cs


RIM_ORDER, RIM_CORNERS = _rim_sorted()
LOCK_T = [(1.8, 4.0), (5.6, 7.1), (7.5, 9.0), (9.4, 10.9)]
LOCKS_LEN = 12.0


def shot_locks(t):
    a = frame_done({**flat_angles()})
    for r in RIMS:
        a[r] = 0.0
    for r, (t0, t1) in zip(RIM_ORDER, LOCK_T):
        a[r] = 90.0 * seg(t, t0, t1)
    a, root = _with_legs(a)
    c = RIM_CORNERS[RIM_ORDER[0]] * 0.001
    close = dict(loc=(c[0] + 0.20, c[1] - 0.30, c[2] + 0.22), tgt=(c[0] - 0.01, c[1] + 0.005, c[2] - 0.01), lens=50)
    u_in = seg(t, 0.0, 1.5)
    u_out = seg(t, 4.3, 5.4)
    if t < 4.3:
        cam = dict(loc=lerp(CAM_FRAME["loc"], close["loc"], u_in), tgt=lerp(CAM_FRAME["tgt"], close["tgt"], u_in), lens=40 + 10 * u_in)
    else:
        cam = dict(loc=lerp(close["loc"], CAM_FRAME["loc"], u_out), tgt=lerp(close["tgt"], CAM_FRAME["tgt"], u_out), lens=50 - 10 * u_out)
    return state(angles=a, root=root, cam=cam)


def _with_legs(a):
    for s in SIDES:
        a[s + "_leg"] = -90.0
        a[s + "_strip"] = 90.0
        a[s + "_wall"] = 90.0
    return a, None


RISER_T = {"R_A": (1.5, 3.5, 5.5, 6.8), "R_B": (8.0, 9.2, 10.4, 11.3), "R_C": (11.9, 13.1, 14.3, 15.2), "R_D": (15.8, 17.0, 18.2, 19.1)}
RISERS_LEN = 20.0


def risers_progress(t, r):
    t0, t1, t2, t3 = RISER_T[r]
    return seg(t, t0, t1), seg(t, t1, t2), seg(t, t2, t3)


def shot_risers(t):
    a = frame_done(final_angles())
    for r in RISERS:
        a.update(riser_angles(r, *risers_progress(t, r)))
    u = seg(t, 0.0, 1.2)
    cam = dict(loc=lerp(CAM_FRAME["loc"], CAM_RISERS["loc"], u), tgt=lerp(CAM_FRAME["tgt"], CAM_RISERS["tgt"], u),
               lens=40 + 2 * u)
    return state(angles=a, cam=cam)


HAT_IN_LEN = 7.0


def shot_hat_in(t):
    dz = 260.0 * (1 - seg(t, 0.8, 6.5))
    return state(hat=hat_pose(dz), cam=CAM_HAT)


def shot_cutaway(t):
    return state(hat=hat_pose(0), cam=CAM_CUT, hide=("S3_wall", "S3_leg", "S3_strip"))


BAG = dict(inner_L=360.0, inner_W=330.0, usable_H=150.0, total_H=215.0, wall=2.0, floor=3.0)
BAG_LEN = 9.0


def shot_bag(t):
    tz = 260.0 * (1 - seg(t, 0.5, 3.8))
    hz = 330.0 * (1 - seg(t, 4.5, 8.5))
    show_hat = t >= 4.0
    return state(hat=hat_pose(hz, z0=BAG["floor"]) if show_hat else None, bag=dict(show=True),
                 tpl_off=(0, 0, BAG["floor"] + tz), cam=CAM_BAG)


END_LEN = 10.0


def shot_end(t):
    hz = 300.0 * seg(t, 0.2, 2.0)
    a = final_angles()
    u_r = 1 - seg(t, 2.4, 4.4)
    for r in RISERS:
        a.update(_riser_reverse(r, u_r))
    for r in RIMS:
        a[r] = 90.0 * (1 - seg(t, 4.5, 5.5))
    for s in SIDES:
        a[s + "_wall"] = 90.0 * (1 - seg(t, 5.6, 7.4))
    u_l = 1 - seg(t, 7.6, 9.6)
    al, root = legs_state(u_l)
    for s in SIDES:
        a[s + "_leg"] = al[s + "_leg"]
        a[s + "_strip"] = al[s + "_strip"]
    return state(angles=a, root=root, hat=hat_pose(hz) if hz < 299 else None,
                 cam=dict(loc=lerp(CAM_FRAME["loc"], CAM_WIDE_FLAT["loc"], seg(t, 5.6, 9.6)),
                          tgt=lerp(CAM_FRAME["tgt"], CAM_WIDE_FLAT["tgt"], seg(t, 5.6, 9.6)),
                          lens=40 - 5 * seg(t, 5.6, 9.6)))


def _riser_reverse(r, u):
    """u: 1 = folded riser, 0 = flat. Tongue lifts out first, then return, then tab."""
    u_tng = seg(u, 0.66, 1.0)
    u_ret = seg(u, 0.33, 0.66) if u < 0.66 else 1.0
    u_tab = seg(u, 0.0, 0.33) if u < 0.33 else 1.0
    return riser_angles(r, u_tab, u_ret, u_tng)


SHOTS = dict(intro=(shot_intro, INTRO_LEN), legs=(shot_legs, LEGS_LEN), walls=(shot_walls, WALLS_LEN),
             locks=(shot_locks, LOCKS_LEN), risers=(shot_risers, RISERS_LEN), hat_in=(shot_hat_in, HAT_IN_LEN),
             cutaway=(shot_cutaway, 0.0), bag=(shot_bag, BAG_LEN), end=(shot_end, END_LEN))


def render_times(name):
    fn, L = SHOTS[name]
    n = int(round(L * FPS_RENDER))
    return [i / FPS_RENDER for i in range(n + 1)]
