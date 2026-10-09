// Product film of the Prester hat case: studio scenes, camera moves, x-ray
// views and a caption layer with dimension lines anchored to the model.
// Frames are rendered on request (window.film.renderFrame) by render_film.mjs.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CASE_PARAMS, DESIGN } from '../src/caseParams.js';
import { CROWN_BASE, HAT_PARAMS, OPEN_CASE_PARAMS } from '../src/openCaseParams.js';
import { buildOpenCase } from '../src/openCaseModel.js';
import { runFitChecks } from '../src/fitChecks.js';
import { CAPTIONS, FILM, SHOTS } from './shots.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w')) || FILM.width;
const H = Number(q.get('h')) || FILM.height;
const S = H / 1080; // overlay scale

// ---------------------------------------------------------------------------
// Renderer, studio, lights
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: q.get('aa') !== '0', preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = q.get('shadow') === 'vsm' ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

// Seamless warm charcoal backdrop with a soft pool of light behind the product
function backdropTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 288;
  const g = c.getContext('2d');
  const lin = g.createLinearGradient(0, 0, 0, c.height);
  lin.addColorStop(0, '#26231f');
  lin.addColorStop(0.55, '#1b1916');
  lin.addColorStop(1, '#0f0e0d');
  g.fillStyle = lin;
  g.fillRect(0, 0, c.width, c.height);
  const rad = g.createRadialGradient(c.width * 0.5, c.height * 0.42, 10, c.width * 0.5, c.height * 0.45, c.width * 0.62);
  rad.addColorStop(0, 'rgba(120,104,84,0.33)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, c.width, c.height);
  const vig = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.3, c.width / 2, c.height / 2, c.width * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
scene.background = backdropTexture();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const lights = [];
function light(color, intensity, pos, shadow = false) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.set(...pos);
  if (shadow) {
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    Object.assign(l.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.3, far: 6 });
    l.shadow.radius = 7;
    l.shadow.blurSamples = 16;
    l.shadow.bias = -0.0004;
  }
  scene.add(l);
  lights.push(l);
  return l;
}
const keyLight = light('#fff2e2', 2.3, [-0.9, 1.9, 1.3], true); // soft key, front left, high
light('#ffd9b0', 1.6, [1.4, 0.9, -1.3]); // warm rim, back right: piping and silhouette
light('#e8eef8', 0.45, [1.2, 0.5, 1.2]); // cool fill
light('#ffffff', 0.5, [0, 2.5, 0]); // top

const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.5 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ---------------------------------------------------------------------------
// The case
// ---------------------------------------------------------------------------

const loader = new THREE.TextureLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
const [logo, label] = await Promise.all([load('../' + CASE_PARAMS.logoTexture), load('../' + OPEN_CASE_PARAMS.label.texture)]);
const box = buildOpenCase(CASE_PARAMS, OPEN_CASE_PARAMS, HAT_PARAMS, { logoTexture: logo, labelTexture: label });
const root = box.root;
const info = box.info;
const L = info.layout;
const hat = box.hatHolder.getObjectByName('Hat');
const pivot = new THREE.Group();
pivot.add(root);
scene.add(pivot);

const body = CASE_PARAMS.body;
const wall = body.wall;
const frontApex = L.zFrontPlane + body.frontDome;
const zMid = (frontApex + info.zRest) / 2;

function setPose(orient, yawDeg = 0) {
  if (orient === 'standing') {
    root.rotation.set(0, 0, 0);
    root.position.set(0, 0.0004, -zMid);
  } else {
    root.rotation.set(-Math.PI / 2, 0, 0);
    root.position.set(0, -info.zRest, body.height / 2);
  }
  pivot.rotation.set(0, THREE.MathUtils.degToRad(yawDeg), 0);
  scene.updateMatrixWorld(true);
}

// X-ray: the case turns see-through, the hat stays solid
const caseMeshes = [];
root.traverse((o) => {
  if (o.isMesh && !isHat(o)) caseMeshes.push(o);
});
function isHat(o) {
  for (let p = o; p; p = p.parent) if (p === box.hatHolder) return true;
  return false;
}
const xrayTarget = (m) => (m === box.materials.velvet ? 0.16 : m === box.materials.trim ? 0.35 : 0.12);
const matsOf = (o) => (Array.isArray(o.material) ? o.material : [o.material]);
const original = new Map();
for (const o of caseMeshes) for (const m of matsOf(o)) original.set(m, { opacity: m.opacity, transparent: m.transparent });
let xrayNow = -1;
function setXray(f) {
  if (Math.abs(f - xrayNow) < 1e-4) return;
  xrayNow = f;
  for (const [m, o] of original) {
    const on = f > 0.001;
    if (m.transparent !== on) {
      m.transparent = on || o.transparent;
      m.needsUpdate = true;
    }
    m.opacity = on ? 1 - f * (1 - xrayTarget(m)) : o.opacity;
    m.depthWrite = !on;
  }
  for (const o of caseMeshes) o.castShadow = f < 0.5;
  keyLight.castShadow = f < 0.5;
}

// ---------------------------------------------------------------------------
// Reflection in the floor (skipped while x-ray is on)
// ---------------------------------------------------------------------------

const reflectionTarget = new THREE.WebGLRenderTarget(Math.round(W / 2), Math.round(H / 2), { samples: 4 });
reflectionTarget.texture.colorSpace = THREE.SRGBColorSpace;
const reflectionQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: { map: { value: reflectionTarget.texture }, strength: { value: 0.18 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float strength; varying vec2 vUv;
      void main() { vec4 c = texture2D(map, vUv); gl_FragColor = vec4(c.rgb, c.a * strength); }`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }),
);
reflectionQuad.frustumCulled = false;
reflectionQuad.renderOrder = -10;
scene.add(reflectionQuad);

function renderScene(reflect) {
  if (reflect) {
    reflectionQuad.visible = false;
    floor.visible = false;
    const bg = scene.background;
    scene.background = null;
    pivot.scale.y = -1;
    for (const l of lights) l.position.y *= -1;
    renderer.setRenderTarget(reflectionTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    for (const l of lights) l.position.y *= -1;
    pivot.scale.y = 1;
    scene.background = bg;
    floor.visible = true;
  }
  reflectionQuad.visible = reflect;
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(30, W / H, 0.02, 30);
const deg = THREE.MathUtils.degToRad;
const ease = (u) => {
  const t = Math.min(Math.max(u, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const lerp = (a, b, t) => a + (b - a) * t;
const span = (t, a, b) => {
  if (!Number.isFinite(a)) return 0; // e.g. a caption with no end time never fades out
  return Math.min(Math.max((t - a) / (b - a), 0), 1);
};
function setCamera({ target, az, el, dist, fov = 30 }) {
  const [tx, ty, tz] = target;
  camera.fov = fov;
  camera.position.set(
    tx + dist * Math.cos(deg(el)) * Math.sin(deg(az)),
    ty + dist * Math.sin(deg(el)),
    tz + dist * Math.cos(deg(el)) * Math.cos(deg(az)),
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(tx, ty, tz);
  camera.updateProjectionMatrix();
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
}
function mixCam(a, b, t) {
  return {
    target: a.target.map((v, i) => lerp(v, b.target[i], t)),
    az: lerp(a.az, b.az, t),
    el: lerp(a.el, b.el, t),
    dist: lerp(a.dist, b.dist, t),
    fov: lerp(a.fov ?? 30, b.fov ?? 30, t),
  };
}

// ---------------------------------------------------------------------------
// Caption layer (2D canvas over the render)
// ---------------------------------------------------------------------------

const overlay = document.createElement('canvas');
overlay.width = W;
overlay.height = H;
const g = overlay.getContext('2d');
const out = document.createElement('canvas');
out.width = W;
out.height = H;
const og = out.getContext('2d');
document.body.appendChild(out);

const GOLD = '#e4c48f';
const IVORY = '#f4eee4';

const caseToWorld = (p) => root.localToWorld(new THREE.Vector3(...p));
const hatToWorld = (p) => hat.localToWorld(new THREE.Vector3(...p));
function screen(v) {
  const p = v.clone().project(camera);
  return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H];
}

function strokeLine(a, b, width, color, dash = null, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = width * S;
  g.lineCap = 'round';
  if (dash) g.setLineDash(dash.map((d) => d * S));
  g.beginPath();
  g.moveTo(...a);
  g.lineTo(...b);
  g.stroke();
  g.restore();
}

function pill(text, x, y, alpha) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.font = `500 ${Math.round(34 * S)}px Heebo`;
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = g.measureText(text).width + 44 * S;
  const h = 62 * S;
  const r = 12 * S;
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 18 * S;
  g.fillStyle = 'rgba(16,14,12,0.78)';
  g.beginPath();
  g.roundRect(x - w / 2, y - h / 2, w, h, r);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(228,196,143,0.75)';
  g.lineWidth = 1.5 * S;
  g.stroke();
  g.fillStyle = IVORY;
  g.fillText(text, x, y + 2 * S);
  g.restore();
}

// Dimension line between world points a and b, drawn from the middle out.
// ext: pairs [from, to] of world points for extension lines.
function dimension({ a, b, text, t, t0, t1 = Infinity, labelOffset = 70, side = 1, ext = [] }) {
  const grow = ease(span(t, t0, t0 + 0.8));
  const fadeOut = 1 - span(t, t1, t1 + 0.35);
  if (grow <= 0 || fadeOut <= 0) return;
  const A = screen(a);
  const B = screen(b);
  const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const len = Math.hypot(dx, dy) || 1;
  const n = [-dy / len, dx / len];
  const a2 = [M[0] - (dx / 2) * grow, M[1] - (dy / 2) * grow];
  const b2 = [M[0] + (dx / 2) * grow, M[1] + (dy / 2) * grow];
  for (const [p, q2] of ext) strokeLine(screen(p), screen(q2), 1.4, IVORY, [5, 6], 0.75 * fadeOut * grow);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 6 * S;
  strokeLine(a2, b2, 2.6, GOLD, null, fadeOut);
  const tick = 13 * S;
  for (const p of [a2, b2]) {
    strokeLine([p[0] - n[0] * tick, p[1] - n[1] * tick], [p[0] + n[0] * tick, p[1] + n[1] * tick], 2.6, GOLD, null, fadeOut);
  }
  g.restore();
  const la = span(t, t0 + 0.6, t0 + 1.1) * fadeOut;
  pill(text, M[0] + n[0] * labelOffset * S * side, M[1] + n[1] * labelOffset * S * side, la);
}

function polyline(points, { t, t0, t1 = Infinity, color = GOLD, width = 2.2, dash = null, closed = true, alpha = 1, draw = 1.0 }) {
  const grow = span(t, t0, t0 + draw);
  const fadeOut = 1 - span(t, t1, t1 + 0.35);
  if (grow <= 0 || fadeOut <= 0) return;
  const pts = points.map(screen);
  if (closed) pts.push(pts[0]);
  const n = Math.max(2, Math.round(pts.length * ease(grow)));
  g.save();
  g.globalAlpha = alpha * fadeOut;
  g.strokeStyle = color;
  g.lineWidth = width * S;
  g.lineJoin = 'round';
  if (dash) g.setLineDash(dash.map((d) => d * S));
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 5 * S;
  g.beginPath();
  g.moveTo(...pts[0]);
  for (let i = 1; i < n; i++) g.lineTo(...pts[i]);
  g.stroke();
  g.restore();
}

// Area between two closed curves (the space around the brim), softly filled
function ring2d(outerPts, innerPts, { t, t0, t1 = Infinity, alpha = 0.13 }) {
  const f = span(t, t0, t0 + 0.8) * (1 - span(t, t1, t1 + 0.35));
  if (f <= 0) return;
  g.save();
  g.globalAlpha = alpha * f;
  g.fillStyle = GOLD;
  g.beginPath();
  outerPts.map(screen).forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
  g.closePath();
  innerPts.map(screen).forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
  g.closePath();
  g.fill('evenodd');
  g.restore();
}

// Cross-section of a mesh with the plane x = 0 (in its own coordinates)
function sectionOf(mesh) {
  const p = mesh.geometry.attributes.position;
  const idx = mesh.geometry.index ? mesh.geometry.index.array : null;
  const segs = [];
  const tri = idx ? idx.length / 3 : p.count / 3;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < tri; i++) {
    for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(p, idx ? idx[i * 3 + k] : i * 3 + k);
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      if ((a.x > 0) !== (b.x > 0)) {
        const s = a.x / (a.x - b.x);
        pts.push(a.clone().lerp(b, s));
      }
    }
    if (pts.length === 2) segs.push(pts);
  }
  return segs;
}
const sections = {};
for (const name of ['BaseShell', 'BaseLining', 'LidShell', 'LidLining', 'InsertRing']) {
  const m = root.getObjectByName(name);
  sections[name] = { mesh: m, segs: sectionOf(m) };
}
function drawSection(names, { t, t0, t1 = Infinity, color, width, alpha = 1 }) {
  const f = span(t, t0, t0 + 0.7) * (1 - span(t, t1, t1 + 0.35));
  if (f <= 0) return;
  g.save();
  g.globalAlpha = alpha * f;
  g.strokeStyle = color;
  g.lineWidth = width * S;
  g.lineCap = 'round';
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 4 * S;
  g.beginPath();
  for (const n of names) {
    const { mesh, segs } = sections[n];
    for (const [a, b] of segs) {
      g.moveTo(...screen(mesh.localToWorld(a.clone())));
      g.lineTo(...screen(mesh.localToWorld(b.clone())));
    }
  }
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------------------
// Geometry used by the captions (case coordinates, meters)
// ---------------------------------------------------------------------------

const innerOutline = L.outline.map(({ p, n }) => [p.x - n.x * wall, p.y - n.y * wall]);
const innerTop = Math.max(...innerOutline.map((p) => p[1]));
const innerTip = Math.min(...innerOutline.map((p) => p[1]));
const maxHalf = Math.max(...innerOutline.map((p) => Math.abs(p[0])));
const widest = innerOutline.filter((p) => Math.abs(p[0]) > maxHalf - 1e-5).map((p) => p[1]);
const yWidest = (Math.min(...widest) + Math.max(...widest)) / 2;
const hole = info.hole;
const lining = (x, y) => L.backZ(x, y, 0.5) + wall;
const zLiningCenter = lining(hole.x, hole.y);
const yShallow = 0.03; // a point in the brim area, near the tip
const zLiningEdge = L.zBaseBack + wall;
const outlineAt = (z, step = 4) => innerOutline.filter((_, i) => i % step === 0).map(([x, y]) => [x, y, z]);
const ovalAt = (ax, az, h, n = 160) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [ax * Math.cos(a), h, az * Math.sin(a)];
  });
const hp = HAT_PARAMS;
const ip = OPEN_CASE_PARAMS.insert;
const brim = { x: CROWN_BASE.x + hp.brimWidth, z: CROWN_BASE.z + hp.brimWidth };
const opening = { x: CROWN_BASE.x - hp.felt, z: CROWN_BASE.z - hp.felt };
const ringLip = info.ringTop - info.pad;
const ringText = CAPTIONS.ringLip.replace('{ring}', (Math.round(ringLip * 1000) / 10).toFixed(1));
// brim at rest seen from above (case coordinates)
const brimCase = (z) =>
  Array.from({ length: 160 }, (_, i) => {
    const a = (i / 160) * Math.PI * 2;
    return [hole.x + brim.x * Math.cos(a), hole.y + brim.z * Math.sin(a), z];
  });

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

// Turntable with slow passes through the two side views (where the depth
// profile reads best); returns the yaw in degrees for u in 0..1
const turntable = (() => {
  const start = 28;
  const n = 2000;
  const speed = (a) => {
    const d = (x) => {
      const diff = ((((a - x) % 360) + 540) % 360) - 180;
      return Math.exp(-((diff / 26) ** 2));
    };
    return 1 - 0.6 * (d(90) + d(270));
  };
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + 1 / speed(start + (360 * (i - 0.5)) / n));
  const total = cum[n];
  return (u) => {
    const target = ease(u) * total;
    let i = 0;
    while (i < n && cum[i + 1] < target) i++;
    const f = (target - cum[i]) / (cum[i + 1] - cum[i] || 1);
    return start + (360 * (i + f)) / n;
  };
})();

const camLying = (az, el, dist, target = [0, 0.085, 0], fov = 30) => ({ target, az, el, dist, fov });
const holeWorldZ = body.height / 2 - hole.y;

const SHOT = {
  hero(t, d) {
    setPose('standing', t < 4.6 ? 28 : turntable(span(t, 4.6, d - 0.35)));
    box.setLid(0);
    box.hatHolder.visible = false;
    setXray(0);
    const a = { target: [0, 0.205, 0], az: 0, el: 9, dist: 1.3, fov: 28 };
    const b = { target: [0, 0.2, 0], az: 0, el: 6, dist: 1.06, fov: 28 };
    setCamera(mixCam(a, b, ease(span(t, 0, 4.8))));
    return { reflect: true };
  },
  length(t) {
    setPose('lying');
    box.setLid(0);
    box.hatHolder.visible = false;
    setXray(ease(span(t, 0.2, 1.2)));
    setCamera(mixCam(camLying(90, 50, 0.9), camLying(84, 47, 0.86), ease(span(t, 0, 6))));
    polyline(outlineAt(0).map(caseToWorld), { t, t0: 0.8, draw: 1.0, color: IVORY, width: 2 });
    dimension({
      a: caseToWorld([0, innerTop, 0]),
      b: caseToWorld([0, innerTip, 0]),
      text: CAPTIONS.length,
      t,
      t0: 1.6,
      labelOffset: 66,
      side: -1,
    });
    return { reflect: false };
  },
  width(t) {
    setPose('lying');
    box.setLid(0);
    box.hatHolder.visible = false;
    setXray(1);
    setCamera(mixCam(camLying(0, 82, 0.98, [0, 0.08, 0.0]), camLying(0, 84, 0.94, [0, 0.08, 0.0]), ease(span(t, 0, 5.6))));
    const outline = outlineAt(0).map(caseToWorld);
    const brimPts = brimCase(-0.005).map(caseToWorld);
    polyline(outline, { t, t0: 0, draw: 0.01, color: IVORY, width: 2 });
    ring2d(outline, brimPts, { t, t0: 0.5 });
    polyline(brimPts, { t, t0: 0.5, draw: 0.9, color: GOLD, width: 1.8, dash: [10, 8], alpha: 0.9 });
    dimension({
      a: caseToWorld([-maxHalf, yWidest, 0]),
      b: caseToWorld([maxHalf, yWidest, 0]),
      text: CAPTIONS.width,
      t,
      t0: 1.0,
      labelOffset: 64,
      side: 1,
    });
    return { reflect: false };
  },
  depth(t, d) {
    setPose('lying');
    box.setLid(0);
    box.hatHolder.visible = false;
    setXray(1);
    setCamera(mixCam(camLying(90, 7, 0.84, [0, 0.07, 0]), camLying(90, 5, 0.8, [0, 0.07, 0]), ease(span(t, 0, d))));
    drawSection(['BaseShell', 'LidShell'], { t, t0: 0.2, color: IVORY, width: 1.4, alpha: 0.55 });
    drawSection(['BaseLining'], { t, t0: 0.4, color: GOLD, width: 2.2 });
    // reference: the rim (seam) plane along the length
    strokeLine(screen(caseToWorld([0, innerTop, 0])), screen(caseToWorld([0, innerTip, 0])), 1.4, IVORY, [7, 7], 0.6 * span(t, 0.6, 1.2));
    const T = DEPTH_CUES;
    dimension({
      a: caseToWorld([0, hole.y, 0]),
      b: caseToWorld([0, hole.y, zLiningCenter]),
      text: CAPTIONS.depthCenter,
      t,
      t0: T.center,
      t1: T.centerOut,
      labelOffset: 210,
      side: 1,
    });
    dimension({
      a: caseToWorld([0, yShallow, 0]),
      b: caseToWorld([0, yShallow, zLiningEdge]),
      text: CAPTIONS.depthEdge,
      t,
      t0: T.edge,
      labelOffset: 260,
      side: 1,
    });
    return { reflect: false };
  },
  open(t) {
    setPose('lying');
    box.setLid(102 * ease(span(t, 0.4, 3.4)));
    box.hatHolder.visible = false;
    setXray(0);
    const a = camLying(0, 36, 1.12, [0, 0.12, -0.03]);
    const b = camLying(-22, 24, 0.66, [0, 0.07, holeWorldZ + 0.05]);
    setCamera(mixCam(a, b, ease(span(t, 3.6, 8.0))));
    // ring lip: from the padding up to the top of the ring, beside its near side
    const yNear = hole.y - (CROWN_BASE.z + ip.ringOuter) - 0.008;
    dimension({
      a: caseToWorld([0, yNear, info.pad]),
      b: caseToWorld([0, yNear, info.ringTop]),
      text: ringText,
      t,
      t0: 6.9,
      labelOffset: 175,
      side: 1,
      ext: [[caseToWorld([0, hole.y - (CROWN_BASE.z + ip.ringOuter - ip.ringRound), info.ringTop]), caseToWorld([0, yNear, info.ringTop])]],
    });
    return { reflect: false };
  },
  hat(t) {
    setPose('lying');
    box.setLid(102);
    box.hatHolder.visible = true;
    setXray(0);
    const hover = 0.24;
    const lift = t < 14.0 ? lerp(0.66, hover, 1 - (1 - span(t, 0, 2.3)) ** 3) : hover * (1 - ease(span(t, 14.0, 17.6)));
    box.setHatLift(lift);
    hat.rotation.y = 0;
    const a = camLying(0, 47, 1.1, [0, 0.17, -0.02]);
    const b = camLying(4, 44, 1.04, [0, 0.13, -0.02]);
    setCamera(mixCam(a, b, ease(span(t, 0, 19))));
    scene.updateMatrixWorld(true);
    const top = hp.brimThickness;
    const C = HAT_CUES;
    dimension({
      a: hatToWorld([0, top, opening.z]),
      b: hatToWorld([0, top, -opening.z]),
      text: CAPTIONS.openingLength,
      t,
      t0: C.length,
      t1: C.length + 2.3,
      labelOffset: 150,
      side: 1,
    });
    dimension({
      a: hatToWorld([-opening.x, top, 0]),
      b: hatToWorld([opening.x, top, 0]),
      text: CAPTIONS.openingWidth,
      t,
      t0: C.width,
      t1: C.width + 2.3,
      labelOffset: 120,
      side: -1,
    });
    polyline(ovalAt(opening.x, opening.z, top).map(hatToWorld), { t, t0: C.circ, t1: C.circ + 2.2, draw: 1.2, color: GOLD, width: 3 });
    if (t > C.circ + 0.7 && t < C.circ + 2.55) {
      const p = screen(hatToWorld([0, top, opening.z]));
      pill(CAPTIONS.circumference, p[0], p[1] - 110 * S, span(t, C.circ + 0.7, C.circ + 1.2) * (1 - span(t, C.circ + 2.2, C.circ + 2.55)));
    }
    dimension({
      a: hatToWorld([CROWN_BASE.x, top, 0]),
      b: hatToWorld([brim.x, top, 0]),
      text: CAPTIONS.brim,
      t,
      t0: C.brim,
      t1: C.brim + 2.3,
      labelOffset: 80,
      side: -1,
      ext: [[hatToWorld([brim.x, -hp.brimCurl, 0]), hatToWorld([brim.x, top, 0])]],
    });
    return { reflect: false };
  },
  clearance(t, d) {
    setPose('lying');
    box.setLid(102);
    box.hatHolder.visible = true;
    box.setHatLift(0);
    setXray(ease(span(t, 0, 0.9)));
    setCamera(mixCam(camLying(90, 6, 0.78, [0, 0.07, -0.02]), camLying(90, 4, 0.74, [0, 0.07, -0.02]), ease(span(t, 0, d))));
    drawSection(['BaseShell'], { t, t0: 0.5, color: IVORY, width: 1.4, alpha: 0.5 });
    drawSection(['BaseLining'], { t, t0: 0.6, color: GOLD, width: 2.2 });
    const C = CLEARANCE_CUES;
    const yOut = hole.y - CROWN_BASE.z - 0.028; // beside the crown, toward the tip
    const yBottom = hole.y - 0.062; // where the crown's underside is flat (outside the dent)
    dimension({
      a: caseToWorld([0, yOut, 0]),
      b: caseToWorld([0, yOut, -hp.crownHeight]),
      text: CAPTIONS.crown,
      t,
      t0: C.crown,
      t1: C.crownOut,
      labelOffset: 200,
      side: 1,
      ext: [
        [caseToWorld([0, hole.y - CROWN_BASE.z, 0]), caseToWorld([0, yOut, 0])],
        [caseToWorld([0, yBottom, -hp.crownHeight]), caseToWorld([0, yOut, -hp.crownHeight])],
      ],
    });
    dimension({
      a: caseToWorld([0, yBottom, -hp.crownHeight]),
      b: caseToWorld([0, yBottom, lining(0, yBottom)]),
      text: CAPTIONS.clearance,
      t,
      t0: C.clear,
      labelOffset: 230,
      side: 1,
    });
    return { reflect: false };
  },
  close(t) {
    setPose('lying');
    box.setLid(102 * (1 - ease(span(t, 0.5, 3.55))));
    box.hatHolder.visible = true;
    box.setHatLift(0);
    setXray(0);
    setCamera(mixCam(camLying(-6, 40, 1.0, [0, 0.12, -0.03]), camLying(0, 34, 1.1, [0, 0.11, -0.01]), ease(span(t, 0, 4.6))));
    return { reflect: false };
  },
  end(t, d) {
    setPose('standing', lerp(42, 18, ease(span(t, 0, d))));
    box.setLid(0);
    box.hatHolder.visible = false;
    setXray(0);
    setCamera(mixCam({ target: [0, 0.2, 0], az: 0, el: 7, dist: 1.04, fov: 28 }, { target: [0, 0.205, 0], az: 0, el: 8, dist: 1.16, fov: 28 }, ease(span(t, 0, d))));
    return { reflect: true };
  },
};

// Cue times tuned to the narration (seconds from the start of each shot)
const DEPTH_CUES = { center: 1.2, centerOut: 4.9, edge: 5.3 };
const HAT_CUES = { length: 2.8, width: 5.0, circ: 8.9, brim: 11.3 };
const CLEARANCE_CUES = { crown: 1.5, crownOut: 4.6, clear: 4.95 };

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------

await document.fonts.load(`500 ${Math.round(34 * S)}px Heebo`, 'אורך 37.41');

// Caption layer only (the 3D frame is not rendered): same state as renderFrame
function renderOverlay(shotIndex, t) {
  const shot = SHOTS[shotIndex];
  g.clearRect(0, 0, W, H);
  SHOT[shot.id](t, shot.duration);
  return overlay.toDataURL('image/png');
}

function renderFrame(shotIndex, t, withLayers = false) {
  const shot = SHOTS[shotIndex];
  g.clearRect(0, 0, W, H);
  const { reflect } = SHOT[shot.id](t, shot.duration);
  scene.updateMatrixWorld(true);
  // captions were drawn with the camera set inside the shot; redraw after the render
  renderScene(reflect);
  og.clearRect(0, 0, W, H);
  og.drawImage(renderer.domElement, 0, 0);
  const clean = withLayers ? out.toDataURL('image/png') : null;
  og.drawImage(overlay, 0, 0);
  return { frame: out.toDataURL('image/png'), clean, overlay: withLayers ? overlay.toDataURL('image/png') : null };
}

// Make sure the caption numbers match the model
const checks = runFitChecks(box, CASE_PARAMS, OPEN_CASE_PARAMS, HAT_PARAMS, DESIGN);
const mismatches = Object.entries(checks.dimensions).filter(([, v]) => v.design_cm !== null && Math.abs(v.model_cm - v.design_cm) > 0.015);
if (mismatches.length) console.error('dimension mismatch', JSON.stringify(mismatches));

window.film = {
  ready: true,
  shots: SHOTS.map((s) => ({ id: s.id, duration: s.duration })),
  renderFrame,
  renderOverlay,
  checks: () => checks,
  ringLip,
};
