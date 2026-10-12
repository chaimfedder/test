"""Save an editable Blender file of the assembled insert with the hat (out/hat_insert_model.blend)."""
import json
from pathlib import Path
import bpy
import anim
import render_anim as R

HERE = Path(__file__).parent
env = R.setup()
R.apply_state(env, anim.shot_intro(10.0))
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "out" / "hat_insert_model.blend"), compress=True)
print("saved")
