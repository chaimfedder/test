"""Pinhole / ortho projection matching scene.camera() (Blender default 36 mm sensor, horizontal fit)."""
import numpy as np


def basis(loc, tgt):
    loc, tgt = np.asarray(loc, float), np.asarray(tgt, float)
    f = tgt - loc
    f /= np.linalg.norm(f)
    up = np.array([0.0, 0.0, 1.0])
    if abs(f @ up) > 0.999:          # looking straight down: x right, y up
        return f, np.array([1.0, 0, 0]), np.array([0, 1.0, 0])
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return f, r, u


def project(cam, pt_mm, W=1920, H=1080):
    loc = np.asarray(cam["loc"], float)
    f, r, u = basis(cam["loc"], cam["tgt"])
    d = np.asarray(pt_mm, float) * 0.001 - loc
    x, y, z = d @ r, d @ u, d @ f
    if cam.get("ortho"):
        s = W / cam["ortho"]
        return W / 2 + x * s, H / 2 - y * s
    k = (cam["lens"] / 36.0) * W
    return W / 2 + x / z * k, H / 2 - y / z * k
