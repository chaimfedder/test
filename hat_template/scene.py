"""Blender (bpy) scene builder shared by stills and animation. 1 Blender unit = 1 m."""
import json
import math
from pathlib import Path

import bpy  # noqa: must precede addon_utils
import addon_utils
import numpy as np
import trimesh
from mathutils import Matrix, Vector

import model

HERE = Path(__file__).parent
MM = 0.001

GROUP_TINT = {
    "deck": (0.36, 0.21, 0.10),
    "leg": (0.04, 0.16, 0.55),
    "strip": (0.04, 0.16, 0.55),
    "wall": (0.62, 0.40, 0.06),
    "rim": (0.75, 0.16, 0.02),
    "riser": (0.03, 0.38, 0.10),
    "riser_tongue": (0.01, 0.18, 0.04),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable("cycles")


# ------------------------------------------------------------------ materials
def mat_cardboard(name="kraft", tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    base = (0.36, 0.21, 0.10) if tint is None else tint
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 900.0
    noise.inputs["Detail"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    c0 = [base[0] * 0.86, base[1] * 0.86, base[2] * 0.86, 1]
    c1 = [min(1, base[0] * 1.08), min(1, base[1] * 1.08), min(1, base[2] * 1.08), 1]
    ramp.color_ramp.elements[0].color = c0
    ramp.color_ramp.elements[1].color = c1
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    return m


def mat_simple(name, color, rough=0.5, sheen=0.0, spec=0.5, alpha=1.0, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    if sheen:
        b.inputs["Sheen Weight"].default_value = sheen
        b.inputs["Sheen Roughness"].default_value = 0.5
        b.inputs["Sheen Tint"].default_value = (0.35, 0.35, 0.37, 1)
    b.inputs["Specular IOR Level"].default_value = spec
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    if emission:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    return m


# ------------------------------------------------------------------ meshes
def mesh_from(name, V, F, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in (np.asarray(V) * MM)], [], [tuple(int(i) for i in f) for f in F])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    if smooth:
        for pg in me.polygons:
            pg.use_smooth = True
    return ob


def panel_object(pn, t, mat):
    m = trimesh.creation.extrude_polygon(pn.poly, t)
    m.apply_translation((0, 0, -t / 2))
    return mesh_from(pn.name, m.vertices, m.faces, mat)


def set_pose(ob, T, dz=0.0):
    M = np.array(T, float).copy()
    M[:3, 3] = M[:3, 3] * MM
    M[2, 3] += dz * MM
    # vertices are stored in mm*MM already; rotation part unchanged
    ob.matrix_world = Matrix(M.tolist())


def build_template(panels, t, tint=False):
    mats = {}
    obs = {}
    base = mat_cardboard()
    for n, pn in panels.items():
        if tint:
            g = pn.group
            if g not in mats:
                mats[g] = mat_cardboard("kraft_" + g, GROUP_TINT.get(g))
            m = mats[g]
        else:
            m = base
        obs[n] = panel_object(pn, t, m)
    return obs


def pose_template(obs, panels, D, angles=None, root=None):
    T = model.poses(panels, D, angles, root)
    for n, ob in obs.items():
        set_pose(ob, T[n])
    return T


def build_hat(p, D, dz):
    S = model.hat_surfaces(p, D)
    felt = mat_simple("felt", (0.008, 0.008, 0.009), rough=0.8, sheen=0.25, spec=0.2)
    felt_in = mat_simple("felt_in", (0.012, 0.012, 0.013), rough=0.85, sheen=0.2, spec=0.2)
    band = mat_simple("ribbon", (0.01, 0.01, 0.012), rough=0.35, spec=0.6)
    leather = mat_simple("sweat", (0.16, 0.09, 0.05), rough=0.45, spec=0.5)
    out = {}
    for k, (V, F) in S.items():
        V = np.asarray(V, float).copy()
        V[:, 2] += dz
        mat = {"crown_outer": felt, "crown_inner": felt_in, "brim": felt, "band": band, "sweat": leather}[k]
        out[k] = mesh_from("hat_" + k, V, F, mat, smooth=True)
    return out


# ------------------------------------------------------------------ stage
def stage(bg=(0.93, 0.93, 0.92), floor=True, floor_color=(0.86, 0.86, 0.85)):
    sc = bpy.context.scene
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (*bg, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    if floor:
        bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -0.0002))
        fl = bpy.context.object
        fl.name = "floor"
        fl.data.materials.append(mat_simple("floor", floor_color, rough=0.9, spec=0.2))
    def area(name, loc, energy, size, rot):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = rot
        sc.collection.objects.link(ob)
        return ob
    def aim(ob, target=(0, 0, 0.08)):
        d = Vector(target) - ob.location
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    k = area("key", (0.9, -0.9, 1.3), 45, 1.0, (0, 0, 0)); aim(k)
    f = area("fill", (-1.1, -0.5, 0.8), 18, 1.4, (0, 0, 0)); aim(f)
    r = area("rim", (-0.3, 1.2, 1.0), 25, 1.0, (0, 0, 0)); aim(r)
    tp = area("top", (0, 0, 1.6), 20, 1.5, (0, 0, 0)); aim(tp, (0, 0, 0))


def camera(loc, target, lens=50, ortho_scale=None, name="cam"):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new(name)
    if ortho_scale:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho_scale
    else:
        cd.lens = lens
    cd.clip_start = 0.01
    cd.clip_end = 20
    ob = bpy.data.objects.new(name, cd)
    sc.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.camera = ob
    return ob


def render_settings(w=1920, h=1080, samples=96, engine="CYCLES"):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    sc.view_settings.look = "None"
    if engine == "CYCLES":
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.cycles.device = "CPU"
        sc.cycles.max_bounces = 6
    sc.render.film_transparent = False


def render(path):
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def project(cam_ob, pt_mm):
    """3D point (mm) -> pixel (x, y) in the rendered image."""
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    co = world_to_camera_view(sc, cam_ob, Vector(np.asarray(pt_mm, float) * MM))
    return co.x * sc.render.resolution_x, (1 - co.y) * sc.render.resolution_y


def load_checks():
    with open(HERE / "out" / "checks.json") as f:
        return json.load(f)
