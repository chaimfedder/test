"""Collision / floor checks along every rendered frame of the animation (geometry only)."""
import itertools
import json
import sys
from pathlib import Path

import numpy as np

import anim
import checks
import model

HERE = Path(__file__).parent
p, D, P = anim.p, anim.D, anim.PANELS
SEAT = json.load(open(HERE / "out" / "checks.json"))["hat_seat_dz_mm"]
HAT = checks.hat_meshes(p, D)
PAIRS = [(a, b) for a, b in itertools.combinations(P, 2) if not checks.related(P, a, b)]


def check_state(st):
    T = model.poses(P, D, st["angles"], st["root"])
    off = np.array(st["tpl_off"], float)
    objs, zmin = {}, 1e9
    for n in P:
        if n in st["hide"]:
            continue
        m = checks.panel_mesh(P[n], T[n], D["t"])
        m.apply_translation(off)
        zmin = min(zmin, float(m.vertices[:, 2].min()) - off[2] + 0)
        objs[n] = checks.fcl_obj(m)
    hits = [(a, b) for a, b in PAIRS if a in objs and b in objs and checks.collide(objs[a], objs[b])]
    if st["hat"]:
        h = st["hat"]
        for hn in ("brim", "crown_outer", "band"):
            hm = HAT[hn].copy()
            hm.apply_translation((h["x"], h["y"], SEAT + h["dz"] + h["z0"]))
            ho = checks.fcl_obj(hm)
            for n, o in objs.items():
                if checks.collide(ho, o):
                    hits.append(("hat:" + hn, n))
    return hits, zmin


if __name__ == "__main__":
    names = sys.argv[1:] or [k for k in anim.SHOTS]
    report = {}
    for name in names:
        fn, L = anim.SHOTS[name]
        bad = []
        zlow = 1e9
        for t in anim.render_times(name):
            hits, zmin = check_state(fn(t))
            zlow = min(zlow, zmin)
            if hits:
                bad.append((round(t, 3), hits[:6]))
        report[name] = dict(frames=len(anim.render_times(name)), frames_with_collision=len(bad),
                            first=bad[:5], lowest_point_mm=round(zlow, 3))
        print(name, report[name], flush=True)
    out = HERE / "out" / "anim_checks.json"
    old = json.load(open(out)) if out.exists() else {}
    old.update(report)
    json.dump(old, open(out, "w"), indent=1, ensure_ascii=False)
