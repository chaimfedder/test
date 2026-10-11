"""Geometric checks of the folded model. Writes out/checks.json and prints a summary.

What this proves: geometry only (single connected blank, no overlaps in the flat sheet,
no interpenetration in the folded state and along the assembly path, clearances, fit).
It does NOT prove board strength, crease fatigue or behaviour in transport.
"""
import itertools
import json
import math
from pathlib import Path

import fcl
import numpy as np
import trimesh
from shapely.geometry import Polygon
from shapely.ops import unary_union

import model

HERE = Path(__file__).parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

SHRINK = 0.15      # mm, removes exact face-to-face contacts from the collision test
THK = 0.9          # fraction of board thickness used for collision solids


def panel_mesh(pn, T, t, shrink=SHRINK, thk=THK):
    poly = pn.poly.buffer(-shrink, join_style=2)
    if poly.geom_type != "Polygon":
        poly = max(poly.geoms, key=lambda g: g.area)
    m = trimesh.creation.extrude_polygon(poly, t * thk)
    m.apply_translation((0, 0, -t * thk / 2))
    m.apply_transform(T)
    return m


def fcl_obj(m):
    bvh = fcl.BVHModel()
    bvh.beginModel(len(m.vertices), len(m.faces))
    bvh.addSubModel(np.asarray(m.vertices, float), np.asarray(m.faces, np.int32))
    bvh.endModel()
    return fcl.CollisionObject(bvh, fcl.Transform())


def collide(a, b):
    req = fcl.CollisionRequest()
    res = fcl.CollisionResult()
    return fcl.collide(a, b, req, res) > 0


def distance(a, b):
    req = fcl.DistanceRequest()
    res = fcl.DistanceResult()
    return fcl.distance(a, b, req, res)


def related(panels, a, b):
    pa, pb = panels[a].parent, panels[b].parent
    return pa == b or pb == a


def hat_meshes(p, D):
    S = model.hat_surfaces(p, D)
    return {k: trimesh.Trimesh(v, f, process=False) for k, (v, f) in S.items()}


def folded_collisions(panels, D, angles=None, hat_offset=None, p=None, hat=None):
    T = model.poses(panels, D, angles)
    meshes = {n: panel_mesh(panels[n], T[n], D["t"]) for n in panels}
    objs = {n: fcl_obj(m) for n, m in meshes.items()}
    hits = []
    for a, b in itertools.combinations(panels, 2):
        if related(panels, a, b):
            continue
        if collide(objs[a], objs[b]):
            hits.append((a, b))
    if hat is not None:
        for hn, hm in hat.items():
            hm2 = hm.copy()
            if hat_offset is not None:
                hm2.apply_translation(hat_offset)
            ho = fcl_obj(hm2)
            for n in panels:
                if collide(ho, objs[n]):
                    hits.append(("hat:" + hn, n))
    return hits, meshes, objs


def run():
    p, D, panels, cuts = model.build()
    t = D["t"]
    rep = {"params": p, "derived": {k: round(v, 3) for k, v in D.items()}}

    # ---- 1. flat blank: one connected piece, no overlapping panels
    flat = [panels[n].poly for n in panels]
    blank = unary_union([pg.buffer(0.001) for pg in flat])
    overl = 0.0
    for a, b in itertools.combinations(flat, 2):
        overl = max(overl, a.intersection(b).area)
    minx, miny, maxx, maxy = blank.bounds
    rep["flat"] = dict(
        single_piece=blank.geom_type == "Polygon",
        pieces=1 if blank.geom_type == "Polygon" else len(blank.geoms),
        max_panel_overlap_mm2=round(overl, 4),
        sheet_bbox_mm=[round(maxx - minx, 1), round(maxy - miny, 1)],
        part_area_m2=round(blank.area / 1e6, 4),
        factory_waste_hole_m2=round(sum(w.area for w in cuts["waste"]) / 1e6, 4),
    )

    # ---- 2. panel sizes are constant (rigid transforms): check edge lengths after fold
    T = model.poses(panels, D)
    worst = 0.0
    for n, pn in panels.items():
        pts = np.array(pn.poly.exterior.coords)
        W = model.apply(T[n], pts)
        d0 = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        d1 = np.linalg.norm(np.diff(W, axis=0), axis=1)
        worst = max(worst, float(np.max(np.abs(d0 - d1))))
    rep["rigid_panels_max_edge_change_mm"] = worst

    # ---- 3. folded state, template only and with hat
    hat = hat_meshes(p, D)
    _, meshes, objs = folded_collisions(panels, D)
    # seat the hat: lowest vertical position with no interpenetration (it rests on the risers)
    def hat_hits(dz):
        for hn in ("brim", "crown_outer"):
            hm = hat[hn].copy()
            hm.apply_translation((0, 0, dz))
            ho = fcl_obj(hm)
            for n in panels:
                if collide(ho, objs[n]):
                    return True
        return False
    lo, hi = -2.0, 3.0
    assert hat_hits(lo) and not hat_hits(hi)
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if hat_hits(mid) else (lo, mid)
    seat = hi + (SHRINK + D["t"] * (1 - THK) / 2)   # undo the collision shrink -> true contact
    for hm in hat.values():
        hm.apply_translation((0, 0, seat))
    rep["hat_seat_dz_mm"] = round(seat, 3)
    hits, meshes, objs = folded_collisions(panels, D, hat={k: v.copy() for k, v in hat.items()}, hat_offset=(0, 0, 0.2))
    rep["folded_collisions_with_hat_lifted_0.2mm"] = hits
    hits0, _, _ = folded_collisions(panels, D)
    rep["folded_collisions"] = hits0

    # key heights measured from the folded model
    def zr(n):
        W = model.apply(T[n], np.array(panels[n].poly.exterior.coords))
        return float(W[:, 2].min() - t / 2), float(W[:, 2].max() + t / 2)
    apex_top = max(zr(n)[1] for n in panels if n.endswith("_tab"))
    deck_top = D["Hd"]
    frame_top = max(zr(n)[1] for n in panels if "_rim" in n)
    long_top = max(zr(n)[1] for n in panels if n in ("S1_wall", "S3_wall"))
    crown = hat["crown_outer"]
    brim = hat["brim"]
    rep["heights_mm"] = dict(
        deck_top=round(deck_top, 2),
        support_contact=round(apex_top, 2),
        crown_tip_lowest=round(float(crown.vertices[:, 2].min()), 2),
        crown_tip_clearance_to_floor=round(float(crown.vertices[:, 2].min()), 2),
        brim_lowest=round(float(brim.vertices[:, 2].min()), 2),
        brim_highest=round(float(brim.vertices[:, 2].max()), 2),
        brim_lowest_minus_deck=round(float(brim.vertices[:, 2].min()) - deck_top, 2),
        frame_top_short=round(frame_top, 2),
        frame_top_long_incl_lock_tabs=round(long_top, 2),
        frame_top_minus_brim_highest=round(frame_top - float(brim.vertices[:, 2].max()), 2),
    )
    # plan clearances
    bx = float(np.abs(brim.vertices[:, 0]).max())
    by = float(np.abs(brim.vertices[:, 1]).max())
    rep["plan_mm"] = dict(
        brim_envelope=[round(2 * bx, 2), round(2 * by, 2)],
        crown_envelope=[round(2 * D["a_c"], 2), round(2 * D["b_c"], 2)],
        head_opening=[round(2 * D["a_h"], 2), round(2 * D["b_h"], 2)],
        head_perimeter_check=round(model.ellipse_perimeter(D["a_h"], D["b_h"]), 3),
        hole=[round(2 * D["hx"], 2), round(2 * D["hy"], 2)],
        interior=[round(D["L"] + t, 2), round(D["W"] + t, 2)],
        brim_to_wall_x=round((D["L"] / 2 + t / 2) - bx, 2),
        brim_to_wall_y=round((D["W"] / 2 + t / 2) - by, 2),
        template_outer=[round(D["outer_L"], 1), round(D["outer_W"], 1), round(long_top, 1)],
    )
    # crown vs hole: minimum horizontal gap at the deck plane and along the crown
    hole_poly = Polygon(model.rounded_rect(D["hx"], D["hy"], p["hole_corner_radius"]))
    ring = Polygon(np.c_[D["a_c"] * np.cos(np.linspace(0, 2 * np.pi, 720)), D["b_c"] * np.sin(np.linspace(0, 2 * np.pi, 720))])
    rep["plan_mm"]["crown_to_hole_min_gap"] = round(hole_poly.exterior.distance(ring), 2)
    # distances hat <-> template
    ho = {k: fcl_obj(m) for k, m in hat.items()}
    dmin = {}
    for hk in ("crown_outer", "brim"):
        best = (1e9, None)
        for n in panels:
            dd = distance(ho[hk], objs[n])
            if dd < best[0]:
                best = (dd, n)
        dmin[hk] = [round(best[0], 2), best[1]]
    rep["hat_min_distance_mm"] = dmin
    # which panels touch the hat (support): distance < 0.5 mm
    touch = []
    for n in panels:
        if distance(ho["brim"], objs[n]) < 0.6 and n.startswith("R_"):
            touch.append(n)
    rep["hat_support_contacts"] = touch
    # gap under the supports the hat does not touch
    rep["hat_gap_per_support_mm"] = {r: round(distance(ho["brim"], objs[r + "_tab"]) if distance(ho["brim"], objs[r + "_tab"]) > 0 else 0.0, 2)
                                     for r in ("R_A", "R_B", "R_C", "R_D")}

    # ---- 3b. hat insertion path: lowered vertically from 200 mm above its seat
    worst = []
    for dz in np.arange(200.0, 0.19, -2.0):
        for hn in ("brim", "crown_outer", "band"):
            hm = hat[hn].copy()
            hm.apply_translation((0, 0, dz))
            ho2 = fcl_obj(hm)
            for n in panels:
                if collide(ho2, objs[n]):
                    worst.append((round(float(dz), 1), hn, n))
    rep["hat_insertion_collisions"] = worst[:20]

    # ---- 4. lock geometry
    locks = []
    for rim in [n for n in panels if "_rim" in n]:
        Tr = T[rim]
        for hole in panels[rim].poly.interiors:
            c = np.array(Polygon(hole).centroid.coords[0])
            locks.append(model.apply(Tr, [c])[0])
    tabs = []
    for wall in ("S1_wall", "S3_wall"):
        W = model.apply(T[wall], np.array(panels[wall].poly.exterior.coords))
        top = W[W[:, 2] > W[:, 2].max() - 0.01]
        for sgn in (-1, 1):
            sel = top[np.sign(top[:, 0]) == sgn]
            tabs.append(sel.mean(axis=0))
    pair = []
    for tb in tabs:
        d = min(np.linalg.norm((tb - s)[:2]) for s in locks)
        pair.append(round(float(d), 3))
    rep["rim_slot_to_tab_offset_mm"] = pair
    rep["slot_sizes_mm"] = dict(
        rim_slot=[2.5, p["lock_tab_width"] + 1],
        rim_tab_with_ears=p["lock_tab_width"] + 2 * p["lock_tab_ear"],
        riser_slot=[round(p["riser_width_long"] * p["riser_tongue_width_ratio"] + 1, 1), p["riser_tongue_length"] + 2],
    )

    # ---- 5. bag (derived from the template, not the other way round)
    m = 3.0
    rep["bag_min_inner_mm"] = [round(D["outer_L"] + 2 * m), round(D["outer_W"] + 2 * m), round(long_top + 8)]

    with open(OUT / "checks.json", "w") as f:
        json.dump(rep, f, ensure_ascii=False, indent=1, default=float)
    return rep


if __name__ == "__main__":
    r = run()
    for k, v in r.items():
        if k in ("params",):
            continue
        print(k, ":", v)
