"""Short silent visual: 4 bag designs arrive flat and open, the insert is folded, the hat goes in,
and the insert + hat is lowered into each bag. Bag size from out/checks.json (hat envelope + 2 cm).

usage: python3 bags/bags_video.py [open|build|pack ...]   -> bags/frames/<shot>/<i>.png (30 fps)
"""
import json
import math
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

import numpy as np
import bpy
import trimesh
from mathutils import Matrix

import anim
import model
import scene as S

FPS = 30
RES = (1280, 720)
SAMPLES = int(os.environ.get("SAMPLES", "4"))
CHK = json.load(open(HERE.parent / "out" / "checks.json"))
BAG = CHK["bag"]
SEAT = CHK["hat_seat_dz_mm"]
META = json.load(open(HERE / "tex_meta.json"))
p, D, P = anim.p, anim.D, anim.PANELS

WALL = BAG["wall"]
LM = BAG["inner_L"] + WALL            # panel mid-surface spacing
WM = BAG["inner_D"] + WALL            # gusset depth (insert stands on its side)
HB = BAG["inner_H"] + BAG["floor"]    # body height
FLOOR_TOP = WALL / 2                  # inner floor (bottom panel mid at z=0, insert stands on its top face)
D_FLAT = 8.0
SPACING = LM + 90.0
XS = [(-1.5 + i) * SPACING for i in range(4)]
DESIGNS = ["bag1", "bag2", "bag3", "bag4"]
HANDLE = dict(bag1=(0.02, 0.02, 0.02), bag2=(0.36, 0.15, 0.05), bag3=(0.02, 0.02, 0.02), bag4=(0.70, 0.64, 0.52))
INSIDE = dict(bag1=(0.02, 0.02, 0.02), bag2=(0.07, 0.065, 0.06), bag3=(0.55, 0.42, 0.28), bag4=(0.018, 0.028, 0.02))


def lin(c):
    c = np.asarray(c, float) / 255.0
    return tuple(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4))


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def seg(t, a, b):
    return ease((t - a) / (b - a))


# ------------------------------------------------------------------ bag geometry (local, mm)
def bag_quads(d):
    s = math.sqrt(max(0.0, (WM / 2) ** 2 - (d / 2) ** 2))
    L2 = LM / 2
    Q = {}
    Q["front"] = [(-L2, -d / 2, 0), (L2, -d / 2, 0), (L2, -d / 2, HB), (-L2, -d / 2, HB)]
    Q["back"] = [(L2, d / 2, 0), (-L2, d / 2, 0), (-L2, d / 2, HB), (L2, d / 2, HB)]
    for sx, nm in ((1, "R"), (-1, "L")):
        cx = sx * (L2 - s)
        Q["g" + nm + "a"] = [(sx * L2, -d / 2, 0), (cx, 0, 0), (cx, 0, HB), (sx * L2, -d / 2, HB)]
        Q["g" + nm + "b"] = [(cx, 0, 0), (sx * L2, d / 2, 0), (sx * L2, d / 2, HB), (cx, 0, HB)]
    Q["bf"] = [(-L2, -d / 2, 0), (L2, -d / 2, 0), (L2, 0, -s), (-L2, 0, -s)]
    Q["bb"] = [(L2, d / 2, 0), (-L2, d / 2, 0), (-L2, 0, -s), (L2, 0, -s)]
    return Q, s


def handle_mesh(a=75.0, h=105.0, w=22.0, leg=35.0, n=40):
    outer, inner = [], []
    for i in range(n + 1):
        th = math.pi * i / n
        outer.append((-(a + w / 2) * math.cos(th), HB + (h + w / 2) * math.sin(th)))
        inner.append((-(a - w / 2) * math.cos(th), HB + (h - w / 2) * math.sin(th)))
    pts = [(-(a + w / 2), HB - leg)] + outer + [(a + w / 2, HB - leg), (a - w / 2, HB - leg)] + inner[::-1] + [(-(a - w / 2), HB - leg)]
    from shapely.geometry import Polygon
    m = trimesh.creation.extrude_polygon(Polygon(pts), 2.0)
    # polygon in (x, z): extrusion along local z -> map (x, y, z) -> (x, z, y)
    V = m.vertices[:, [0, 2, 1]].copy()
    return V, m.faces[:, ::-1]


def bag_transform(theta_deg, off):
    th = math.radians(theta_deg)
    R = np.eye(4)
    R[1, 1], R[1, 2], R[2, 1], R[2, 2] = math.cos(th), -math.sin(th), math.sin(th), math.cos(th)
    T = np.eye(4)
    T[:3, 3] = off
    return T @ R


class Bag:
    def __init__(self, key):
        self.key = key
        tex = bpy.data.materials.new("tex_" + key)
        tex.use_nodes = True
        nt = tex.node_tree
        b = nt.nodes["Principled BSDF"]
        img = nt.nodes.new("ShaderNodeTexImage")
        img.image = bpy.data.images.load(str(HERE / f"tex_{key}.png"))
        nt.links.new(img.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.55 if key != "bag2" else 0.75
        self.m_tex = tex
        base = META[key].get("gusset", META[key]["base"])
        self.m_side = S.mat_simple("side_" + key, lin(base), rough=0.6)
        self.m_in = S.mat_simple("in_" + key, INSIDE[key], rough=0.8)
        self.m_handle = S.mat_simple("h_" + key, HANDLE[key], rough=0.5 if key == "bag2" else 0.8, sheen=0.3)
        self.obs = {}
        Q, _ = bag_quads(D_FLAT)
        for n, q in Q.items():
            me = bpy.data.meshes.new(n)
            me.from_pydata([tuple(np.array(v) * S.MM) for v in q], [], [(0, 1, 2, 3)])
            uv = me.uv_layers.new()
            for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
                uv.data[i].uv = c
            ob = bpy.data.objects.new(f"{key}_{n}", me)
            bpy.context.scene.collection.objects.link(ob)
            if n in ("front", "back"):
                ob.data.materials.append(self.m_tex)
            else:
                ob.data.materials.append(self.m_side)
            ob.data.materials.append(self.m_in)
            mod = ob.modifiers.new("solid", "SOLIDIFY")
            mod.thickness = WALL * S.MM
            mod.offset = -1.0
            mod.material_offset = 1
            mod.material_offset_rim = 1
            self.obs[n] = ob
        V, F = handle_mesh()
        self.handles = []
        for side in (-1, 1):
            me = bpy.data.meshes.new("handle")
            me.from_pydata([tuple(v * S.MM) for v in V], [], [tuple(int(i) for i in f) for f in F])
            ob = bpy.data.objects.new(f"{key}_handle", me)
            bpy.context.scene.collection.objects.link(ob)
            ob.data.materials.append(self.m_handle)
            self.handles.append((side, ob))

    def pose(self, d, theta, off):
        Q, s = bag_quads(d)
        M = bag_transform(theta, off)
        for n, q in Q.items():
            me = self.obs[n].data
            for i, v in enumerate(q):
                w = M @ np.array([*v, 1.0])
                me.vertices[i].co = tuple(w[:3] * S.MM)
            me.update()
        for side, ob in self.handles:
            y = side * (d / 2 + 2.0)
            H = M @ np.array([[1, 0, 0, 0], [0, 1, 0, y], [0, 0, 1, 0], [0, 0, 0, 1.0]])
            H[:3, 3] *= S.MM
            ob.matrix_world = Matrix(H.tolist())

    def min_z(self, d, theta):
        Q, s = bag_quads(d)
        M = bag_transform(theta, (0, 0, 0))
        z = min((M @ np.array([*v, 1.0]))[2] for q in Q.values() for v in q)
        return z


def bag_state(t, t0):
    """lying flat -> stands up -> opens. returns (d, theta, z_offset)."""
    u_rise = seg(t, t0 + 0.6, t0 + 1.9)
    u_open = seg(t, t0 + 2.1, t0 + 3.6)
    d = D_FLAT + (WM - D_FLAT) * u_open
    theta = -90.0 * (1 - u_rise)
    return d, theta


def place_bag(bag, x, t, t0):
    d, theta = bag_state(t, t0)
    lift = -bag.min_z(d, theta) + WALL / 2
    bag.pose(d, theta, (x, 0, lift))
    return d, theta, lift


# ------------------------------------------------------------------ insert + hat
class Insert:
    def __init__(self):
        self.obs = S.build_template(P, D["t"])
        self.hat = S.build_hat(p, D, SEAT)
        self.root = bpy.data.objects.new("hat_root", None)
        bpy.context.scene.collection.objects.link(self.root)
        for o in self.hat.values():
            o.parent = self.root

    def pose(self, angles, root, off, hat_dz=None, theta=0.0):
        """theta: rotation about the long (x) axis; 90 = standing on its side, hat front facing -y."""
        T = model.poses(P, D, angles, root)
        G = bag_transform(theta, off)
        for n, ob in self.obs.items():
            S.set_pose(ob, G @ np.array(T[n]))
        for o in self.hat.values():
            o.hide_render = hat_dz is None
        if hat_dz is not None:
            Hm = G @ np.array([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, hat_dz], [0, 0, 0, 1.0]])
            Hm[:3, 3] *= S.MM
            self.root.matrix_world = Matrix(Hm.tolist())


def build_angles(t):
    """fast assembly: legs, long walls, short walls, corner rims, 4 risers together."""
    a, root = anim.legs_state(seg(t, 0.3, 1.6))
    for s_, (t0, t1) in (("S1", (1.8, 2.8)), ("S3", (1.8, 2.8)), ("S2", (2.9, 3.9)), ("S4", (2.9, 3.9))):
        a[s_ + "_wall"] = 90.0 * seg(t, t0, t1)
    for r in anim.RIMS:
        a[r] = 90.0 * seg(t, 4.0, 4.8)
    for r in anim.RISERS:
        a.update(anim.riser_angles(r, seg(t, 5.0, 5.8), seg(t, 5.8, 6.6), seg(t, 6.6, 7.1)))
    if t >= 1.6:
        root = None
    return a, root


BUILD_LEN, OPEN_LEN, PACK_LEN = 9.6, 5.0, 8.0
HAT_DROP = (7.4, 8.8)


# ------------------------------------------------------------------ shots
CAM_ROW = dict(loc=(0.0, -2.15, 1.25), tgt=(0, 0.04, 0.17), lens=38)
CAM_BUILD = dict(loc=(0.60, -0.92, 0.80), tgt=(0, 0, 0.06), lens=38)


def set_cam(cam, c):
    from mathutils import Vector
    cam.location = c["loc"]
    cam.rotation_euler = (Vector(c["tgt"]) - Vector(c["loc"])).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = c["lens"]


def setup():
    S.reset()
    S.render_settings(*RES, samples=SAMPLES)
    sc = bpy.context.scene
    sc.cycles.max_bounces = 3
    sc.cycles.use_adaptive_sampling = False
    sc.render.use_persistent_data = True
    S.stage(bg=(0.80, 0.77, 0.72), floor_color=(0.70, 0.66, 0.61))
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.exposure = -0.35
    return sc, S.camera((1, -1, 1), (0, 0, 0))


def render_shot(name):
    sc, cam = setup()
    out = HERE / ("test" if os.environ.get("TEST_TIMES") else "frames") / name
    out.mkdir(parents=True, exist_ok=True)
    bags, inserts = [], []
    if name in ("open", "pack"):
        bags = [Bag(k) for k in DESIGNS]
    if name == "build":
        inserts = [Insert()]
    if name == "pack":
        inserts = [Insert() for _ in DESIGNS]
    L = dict(open=OPEN_LEN, build=BUILD_LEN, pack=PACK_LEN)[name]
    prev = None
    times = [float(x) for x in os.environ.get("TEST_TIMES", "").split(",") if x]
    for i in (range(len(times)) if times else range(int(L * FPS) + 1)):
        t = times[i] if times else i / FPS
        f = out / f"{i:04d}.png"
        if f.exists():
            continue
        key = None
        if name == "open":
            for j, b in enumerate(bags):
                place_bag(b, XS[j], t, 0.25 * j)
            set_cam(cam, CAM_ROW)
            key = round(min(t, 0.25 * 3 + 3.6), 4)
        elif name == "build":
            a, root = build_angles(t)
            dz = 260.0 * (1 - seg(t, *HAT_DROP)) if t >= HAT_DROP[0] - 0.4 else None
            inserts[0].pose(a, root, (0, 0, 0), dz)
            u = seg(t, 0, BUILD_LEN)
            c = dict(loc=tuple(np.array(CAM_BUILD["loc"]) * (1.0 - 0.05 * u)), tgt=CAM_BUILD["tgt"], lens=CAM_BUILD["lens"])
            set_cam(cam, c)
        else:
            for j, (b, ins) in enumerate(zip(bags, inserts)):
                place_bag(b, XS[j], 99.0, 0)
                t0 = 0.3 * j
                th = 90.0 * seg(t, t0 + 0.2, t0 + 1.3)               # stand the insert up, above the bag
                zf = FLOOR_TOP + BAG["insert_lift_mm"]
                yf = BAG["inner_D"] / 2 - 0.5                         # insert floor against the back wall
                z = zf + 520.0 * (1 - seg(t, t0 + 1.4, t0 + 3.0))
                y = yf * seg(t, t0 + 0.2, t0 + 1.3)
                ins.pose(anim.final_angles(), None, (XS[j], y, z), 0.0, theta=th)
            u = seg(t, 4.3, PACK_LEN)
            c = dict(loc=(0.15 * u, -2.10 + 0.95 * u, 1.75 + 0.15 * u), tgt=(0, 0.04 - 0.02 * u, 0.22 - 0.03 * u), lens=38 + 2 * u)
            set_cam(cam, c)
        if key is not None and prev is not None and key == prev[0]:
            shutil.copyfile(prev[1], f)
        else:
            S.render(f)
        prev = (key, f) if key is not None else None
        print(f"[{name}] {i}", flush=True)


if __name__ == "__main__":
    for n in sys.argv[1:] or ["open", "build", "pack"]:
        render_shot(n)
    print("ALL DONE", flush=True)
