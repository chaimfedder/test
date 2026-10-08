// Interactive viewer: scene, studio lighting, camera controls and export.
// The model itself is built in caseModel.js from the values in caseParams.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CASE_PARAMS } from './caseParams.js';
import { buildHatCase, setLogoTexture } from './caseModel.js';

const query = new URLSearchParams(location.search);
const capture = query.get('capture') === '1';
if (capture) document.body.classList.add('capture');

const container = document.getElementById('app');
const statusEl = document.getElementById('status');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(capture ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe4e4e6);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.65;

// Soft studio lighting: key light with soft shadow, gentle fill and rim
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(0.9, 1.6, 1.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -1;
key.shadow.camera.right = 1;
key.shadow.camera.top = 1;
key.shadow.camera.bottom = -1;
key.shadow.camera.near = 0.1;
key.shadow.camera.far = 5;
key.shadow.radius = 6;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.002;
scene.add(key);
const fill = new THREE.DirectionalLight(0xf3f1ee, 0.45);
fill.position.set(-1.2, 0.6, 0.8);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.6);
rim.position.set(-0.4, 1.2, -1.5);
scene.add(rim);
const backFill = new THREE.DirectionalLight(0xffffff, 0.5);
backFill.position.set(0.8, 0.9, -1.2);
scene.add(backFill);

// Floor that only shows the shadow
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 6),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.2 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(Number(query.get('fov')) || 30, window.innerWidth / window.innerHeight, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.35;
controls.maxDistance = 4;
controls.maxPolarAngle = Math.PI * 0.62;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

let model = null;
let logoTexture = null;

function loadTexture(url) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
}

async function buildModel() {
  try {
    logoTexture = await loadTexture(CASE_PARAMS.logoTexture);
  } catch (e) {
    console.warn('logo texture not found, plate stays plain silver', e);
  }
  model = buildHatCase(CASE_PARAMS, { logoTexture });
  scene.add(model);
}

// ---------------------------------------------------------------------------
// Camera presets
// ---------------------------------------------------------------------------

const b = CASE_PARAMS.body;
const targetY = (b.height + CASE_PARAMS.handle.height) * 0.5;
const target = new THREE.Vector3(0, targetY, 0);
const fitDistance = () => {
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const totalH = b.height + CASE_PARAMS.handle.height;
  const hDist = (totalH * 0.62) / Math.tan(vFov / 2);
  const wDist = (Math.max(b.width, b.depth) * 0.62) / (Math.tan(vFov / 2) * camera.aspect);
  return Math.max(hDist, wDist) + b.depth / 2;
};
const VIEWS = {
  front: (d) => new THREE.Vector3(0, targetY, d),
  side: (d) => new THREE.Vector3(d, targetY, 0),
  back: (d) => new THREE.Vector3(0, targetY, -d),
  threeQuarter: (d) => new THREE.Vector3(d * 0.68, targetY + d * 0.26, d * 0.68),
};

let anim = null;
function setView(name, instant = false) {
  const to = VIEWS[name](fitDistance());
  document.querySelectorAll('#views button[data-view]').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === name);
  });
  if (instant) {
    camera.position.copy(to);
    controls.target.copy(target);
    controls.update();
    anim = null;
    return;
  }
  anim = { from: camera.position.clone(), fromT: controls.target.clone(), to, t: 0 };
}

function stepAnimation(dt) {
  if (!anim) return;
  anim.t = Math.min(anim.t + dt / 0.7, 1);
  const k = anim.t * anim.t * (3 - 2 * anim.t);
  // move on a sphere around the target so the case stays framed
  const a = anim.from.clone().sub(anim.fromT);
  const c = anim.to.clone().sub(target);
  const dir = new THREE.Vector3().copy(a).normalize().lerp(c.clone().normalize(), k);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
  dir.normalize().multiplyScalar(THREE.MathUtils.lerp(a.length(), c.length(), k));
  controls.target.lerpVectors(anim.fromT, target, k);
  camera.position.copy(controls.target).add(dir);
  if (anim.t >= 1) anim = null;
}

controls.addEventListener('start', () => {
  anim = null;
  document.querySelectorAll('#views button.active').forEach((el) => el.classList.remove('active'));
});

// ---------------------------------------------------------------------------
// Export / logo replacement
// ---------------------------------------------------------------------------

function exportGLB() {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(model, resolve, reject, { binary: true, maxTextureSize: 4096 });
  });
}

function download(buffer, name) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function replaceLogo(file) {
  const url = URL.createObjectURL(file);
  const tex = await loadTexture(url);
  setLogoTexture(model.getObjectByName('PlateFace').material, tex);
  if (logoTexture) logoTexture.dispose();
  logoTexture = tex;
  statusEl.textContent = `לוגו הוחלף: ${file.name}`;
}

document.querySelectorAll('#views button[data-view]').forEach((el) => {
  el.addEventListener('click', () => setView(el.dataset.view));
});
document.getElementById('reset').addEventListener('click', () => setView('threeQuarter'));
document.getElementById('export').addEventListener('click', async () => {
  statusEl.textContent = 'מייצא…';
  download(await exportGLB(), 'hat-case.glb');
  statusEl.textContent = 'הקובץ hat-case.glb נשמר';
});
document.getElementById('logo-file').addEventListener('change', (e) => {
  if (e.target.files[0]) replaceLogo(e.target.files[0]);
});
document.getElementById('toggle-ref').addEventListener('click', (e) => {
  document.getElementById('reference').classList.toggle('show');
  e.currentTarget.classList.toggle('active');
});

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// In capture mode (tools/render.mjs) frames are drawn on request only
const clock = new THREE.Clock();
if (!capture) {
  renderer.setAnimationLoop(() => {
    stepAnimation(clock.getDelta());
    controls.update();
    renderer.render(scene, camera);
  });
}

await buildModel();
setView(query.get('view') && VIEWS[query.get('view')] ? query.get('view') : 'threeQuarter', true);
statusEl.textContent = 'גרירה לסיבוב · גלגלת / צביטה לזום · לחצן ימני / שתי אצבעות להזזה';

// Hooks used by tools/render.mjs (screenshots, GLB export and re-import check)
window.hatCase = {
  ready: true,
  setView: (name) => setView(name, true),
  setCamera(pos, look) {
    camera.position.set(...pos);
    controls.target.set(...look);
    controls.update();
  },
  renderNow: () => renderer.render(scene, camera),
  async exportBase64() {
    const buf = new Uint8Array(await exportGLB());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  },
  stats() {
    const out = [];
    model.traverse((o) => {
      if (o.isMesh) {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        out.push({
          name: o.name,
          vertices: o.geometry.attributes.position.count,
          triangles: o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3,
          min: bb.min.toArray().map((v) => +v.toFixed(4)),
          max: bb.max.toArray().map((v) => +v.toFixed(4)),
        });
      }
    });
    return out;
  },
  // Loads a GLB (base64) in place of the model, reports its content
  async loadGLB(b64) {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const gltf = await new GLTFLoader().parseAsync(bin.buffer, '');
    const report = { meshes: [], materials: {}, textures: [] };
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      report.meshes.push({ name: o.name, vertices: o.geometry.attributes.position.count });
      report.materials[m.name] = {
        type: m.type,
        color: '#' + m.color.getHexString(),
        roughness: m.roughness,
        metalness: m.metalness,
        clearcoat: m.clearcoat ?? null,
        map: m.map ? { w: m.map.image.width, h: m.map.image.height } : null,
      };
      if (m.map) report.textures.push(m.map.name || 'texture');
    });
    scene.remove(model);
    model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    scene.add(model);
    return report;
  },
};
