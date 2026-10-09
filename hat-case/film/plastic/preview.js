// Quick still renders of the plastic case for checking the geometry.
import * as THREE from 'three';
import { createStage, createCase, createHat, setPose } from './scene.js';
import { setSection } from '../../src/plastic/sheetMaterials.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w')) || 1280;
const H = Number(q.get('h')) || 720;
const st = createStage(W, H, { antialias: q.get('aa') !== '0' });
if (q.get('shadow') === '0') st.renderer.shadowMap.enabled = false;
if (q.get('shadow') === 'pcf') st.renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(st.renderer.domElement);
const c = await createCase({ lod: q.get('lod') || 'high' });
st.scene.add(c.pivot);
const hat = createHat();
c.orient.add(hat.holder);
hat.holder.visible = false;
const allMats = Object.values(c.mats).filter((m) => m && m.isMeshStandardMaterial);
const stack = [];
for (let i = 0; i < 10; i++) {
  const s = await createCase({ lod: 'low', plain: true });
  s.sheet.setFold(0);
  stack.push(s);
}

window.preview = {
  ready: true,
  hatLift: hat.lift,
  view({ stackN = 0, pitch = 0.0098, pose = 'standing', yaw = 0, fold = Math.PI, target = [0, 0.2, 0], az = 0, el = 10, dist = 1.2, fov = 30, hat: showHat = false, section = null, highlight = 0 }) {
    for (let i = 0; i < stack.length; i++) {
      const on = i < stackN;
      if (on && !stack[i].pivot.parent) st.scene.add(stack[i].pivot);
      if (!on && stack[i].pivot.parent) st.scene.remove(stack[i].pivot);
      if (on) setPose(stack[i], 'lying', { x: 0.0, lift: i * pitch });
    }
    c.pivot.visible = stackN === 0;
    c.sheet.setFold(fold);
    setPose(c, pose, { yaw });
    hat.holder.visible = showHat;
    st.scene.updateMatrixWorld(true);
    setSection(allMats, section ? [new THREE.Plane(new THREE.Vector3(...section.n), section.c)] : null);
    const [tx, ty, tz] = target;
    const d = THREE.MathUtils.degToRad;
    st.camera.fov = fov;
    st.camera.position.set(tx + dist * Math.cos(d(el)) * Math.sin(d(az)), ty + dist * Math.sin(d(el)), tz + dist * Math.cos(d(el)) * Math.cos(d(az)));
    st.camera.lookAt(tx, ty, tz);
    st.camera.updateProjectionMatrix();
    const t0 = performance.now();
    st.renderer.render(st.scene, st.camera);
    const px = new Uint8Array(4);
    const gl = st.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t1 = performance.now();
    const url = st.renderer.domElement.toDataURL('image/jpeg', 0.92);
    const ms = performance.now() - t0;
    return { url, ms: [Math.round(t1 - t0), Math.round(performance.now() - t1)] };
  },
};
