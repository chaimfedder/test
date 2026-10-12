"""Render all unique animation frames (Cycles, 1280x720) + still shots.

usage: python3 render_anim.py [shot ...]      (default: all)
Frames: out/frames/<shot>/<idx>.png  (idx at 15 fps). Already rendered frames are skipped.
"""
import hashlib
import json
import math
import os
import shutil
import sys
from pathlib import Path

import numpy as np
import bpy
from mathutils import Matrix, Vector

import anim
import model
import scene as S

HERE = Path(__file__).parent
FR = HERE / "out" / "frames"
RES = (1280, 720)
SAMPLES = int(os.environ.get("SAMPLES", "5"))
p, D, P = anim.p, anim.D, anim.PANELS
SEAT = json.load(open(HERE / "out" / "checks.json"))["hat_seat_dz_mm"]


def build_bag(B):
    mat = S.mat_simple("bag", (0.025, 0.028, 0.035), rough=0.55, spec=0.4)
    glass = bpy.data.materials.new("bag_front")
    glass.use_nodes = True
    nt = glass.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.05, 0.06, 0.08, 1)
    b.inputs["Alpha"].default_value = 0.16
    b.inputs["Roughness"].default_value = 0.3
    Li, Wi, H, w, f = B["inner_L"], B["inner_W"], B["total_H"], B["wall"], B["floor"]
    obs = []
    def box(name, x0, x1, y0, y1, z0, z1, m):
        V = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        F = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(np.array(v) * S.MM) for v in V], [], F)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(m)
        obs.append(ob)
    box("bag_floor", -Li / 2 - w, Li / 2 + w, -Wi / 2 - w, Wi / 2 + w, 0, f, mat)
    box("bag_back", -Li / 2 - w, Li / 2 + w, Wi / 2, Wi / 2 + w, 0, H, mat)
    box("bag_front", -Li / 2 - w, Li / 2 + w, -Wi / 2 - w, -Wi / 2, 0, H, glass)
    box("bag_left", -Li / 2 - w, -Li / 2, -Wi / 2, Wi / 2, 0, H, mat)
    box("bag_right", Li / 2, Li / 2 + w, -Wi / 2, Wi / 2, 0, H, mat)
    # rope handles on the long sides
    rope = S.mat_simple("rope", (0.55, 0.45, 0.25), rough=0.7)
    for side in (1,):          # back handle only: the front wall is shown transparent
        y = side * (Wi / 2 + w + 2)
        pts = []
        for i in range(40):
            a = math.pi * i / 39
            pts.append((-70 * math.cos(a), y, H + 90 * math.sin(a)))
        cu = bpy.data.curves.new("rope", "CURVE")
        cu.dimensions = "3D"
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for i, q in enumerate(pts):
            sp.points[i].co = (q[0] * S.MM, q[1] * S.MM, q[2] * S.MM, 1)
        cu.bevel_depth = 0.004
        ob = bpy.data.objects.new("handle", cu)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(rope)
        obs.append(ob)
    return obs


def setup():
    S.reset()
    S.render_settings(*RES, samples=SAMPLES)
    sc = bpy.context.scene
    sc.cycles.max_bounces = 3
    sc.cycles.use_adaptive_sampling = False
    sc.render.use_persistent_data = True
    S.stage()
    obs = S.build_template(P, D["t"])
    root = bpy.data.objects.new("tpl_root", None)
    sc.collection.objects.link(root)
    hat_obs = S.build_hat(p, D, SEAT)
    hat_root = bpy.data.objects.new("hat_root", None)
    sc.collection.objects.link(hat_root)
    for o in hat_obs.values():
        o.parent = hat_root
    bag = build_bag(anim.BAG)
    cam = S.camera((1, -1, 1), (0, 0, 0))
    return obs, hat_root, list(hat_obs.values()), bag, cam


def apply_state(env, st):
    obs, hat_root, hat_obs, bag, cam = env
    T = model.poses(P, D, st["angles"], st["root"])
    off = np.array(st["tpl_off"], float)
    for n, ob in obs.items():
        M = np.array(T[n]).copy()
        M[:3, 3] += off
        S.set_pose(ob, M)
        ob.hide_render = (n in st["hide"]) or not st["tpl"]
    h = st["hat"]
    for o in hat_obs:
        o.hide_render = h is None
    if h:
        hat_root.location = (h["x"] * S.MM, h["y"] * S.MM, (h["dz"] + h["z0"]) * S.MM)
        hat_root.rotation_euler = (0, 0, 0)
    show_bag = bool(st.get("bag"))
    for o in bag:
        o.hide_render = not show_bag
    c = st["cam"]
    cam.location = c["loc"]
    d = Vector(c["tgt"]) - Vector(c["loc"])
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO" if c.get("ortho") else "PERSP"
    if c.get("ortho"):
        cam.data.ortho_scale = c["ortho"]
    else:
        cam.data.lens = c["lens"]


def state_key(st):
    def r(x):
        if isinstance(x, dict):
            return {k: r(v) for k, v in sorted(x.items())}
        if isinstance(x, (list, tuple)):
            return [r(v) for v in x]
        if isinstance(x, np.ndarray):
            return [round(float(v), 4) for v in x.ravel()]
        if isinstance(x, float):
            return round(x, 4)
        return x
    return hashlib.md5(json.dumps(r(st), sort_keys=True, default=str).encode()).hexdigest()


def render_shot(env, name):
    fn, L = anim.SHOTS[name]
    out = FR / name
    out.mkdir(parents=True, exist_ok=True)
    prev_key, prev_file = None, None
    for i, t in enumerate(anim.render_times(name)):
        f = out / f"{i:04d}.png"
        st = fn(t)
        k = state_key(st)
        if f.exists():
            prev_key, prev_file = k, f
            continue
        if k == prev_key and prev_file is not None:
            shutil.copyfile(prev_file, f)
        else:
            apply_state(env, st)
            S.render(f)
        prev_key, prev_file = k, f
        print(f"[{name}] {i}", flush=True)


# ------------------------------------------------------------------ hat stills for the dimension scene
HAT_STILLS = {
    "hat_top": dict(cam=dict(loc=(0, 0, 1.2), tgt=(0, 0, 0), ortho=0.62)),
    "hat_side": dict(cam=dict(loc=(0, -1.5, 0.22), tgt=(0, 0, 0.06), ortho=0.46), upright=True),
    "hat_3q": dict(cam=dict(loc=(0.55, -0.75, 0.55), tgt=(0, 0, 0.06), lens=50), upright=True),
}


def render_hat_stills(env):
    obs, hat_root, hat_obs, bag, cam = env
    out = FR / "stills"
    out.mkdir(parents=True, exist_ok=True)
    for o in obs.values():
        o.hide_render = True
    for o in bag:
        o.hide_render = True
    for o in hat_obs:
        o.hide_render = False
    zmax = D["Hs"] + p["brim_front_rise"] + p["brim_thickness"] + SEAT
    for name, spec in HAT_STILLS.items():
        f = out / f"{name}.png"
        if f.exists():
            continue
        if spec.get("upright"):
            # flip 180 deg about X and rest the brim edge on the table
            hat_root.rotation_euler = (math.pi, 0, 0)
            hat_root.location = (0, 0, zmax * S.MM)
        else:
            hat_root.rotation_euler = (0, 0, 0)
            hat_root.location = (0, 0, 0)
        c = spec["cam"]
        cam.location = c["loc"]
        d = Vector(c["tgt"]) - Vector(c["loc"])
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.data.type = "ORTHO" if c.get("ortho") else "PERSP"
        if c.get("ortho"):
            cam.data.ortho_scale = c["ortho"]
        else:
            cam.data.lens = c["lens"]
        S.render(f)
    hat_root.rotation_euler = (0, 0, 0)


if __name__ == "__main__":
    names = sys.argv[1:] or ["stills"] + list(anim.SHOTS)
    env = setup()
    for n in names:
        if n == "stills":
            render_hat_stills(env)
        else:
            render_shot(env, n)
    print("ALL DONE", flush=True)
