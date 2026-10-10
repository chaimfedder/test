// Short film: forming and trimming of the plastic case, option 2 (dome back).
// One heated sheet over the shared tool, forming, cooling and release,
// trimming of the outline and the handle hole, the scrap lifted away, the
// fold. Same scene and forming principle as the "make" shot of
// film/plastic/film.js, on the dome design (src/designs/model.js?d=dome).
// Frames are rendered on request (window.film.renderFrame) by render.mjs.

import * as THREE from 'three';
import { createSheetMaterials, plainSheetMaterial, SHEET_UNIFORMS } from '../../src/plastic/sheetMaterials.js';
import { CASE, createStage, setPose } from '../plastic/scene.js';
import { FILM, SHOTS, STEPS, shotStarts, subtitleCards } from './shots.js';

const M = await import('../../src/designs/model.js?d=dome');
const { PLASTIC: P } = await import('../../src/designs/params.js?d=dome');

const q = new URLSearchParams(location.search);
const W = Number(q.get('w')) || FILM.width;
const H = Number(q.get('h')) || FILM.height;
const S = H / 1080; // overlay scale
const { starts } = shotStarts();
const CARDS = subtitleCards();

// ---------------------------------------------------------------------------
// Stage, the case (dome design)
// ---------------------------------------------------------------------------

const st = createStage(W, H, { antialias: q.get('aa') !== '0' });
const { renderer, scene, camera } = st;
document.body.appendChild(renderer.domElement);

const mats = await createSheetMaterials('../../');

function createCase(lod) {
  const sheet = M.buildSheet(mats, { lod });
  const holder = new THREE.Group(); // sheet -> case coordinates
  holder.position.y = M.SHEET.foldY;
  holder.add(sheet.root);
  const orient = new THREE.Group(); // case -> pose
  orient.add(holder);
  const pivot = new THREE.Group(); // yaw and placement
  pivot.add(orient);
  scene.add(pivot);
  return { sheet, holder, orient, pivot };
}
const caseLo = createCase('low');
const caseHi = createCase('high');

// ---------------------------------------------------------------------------
// Forming scene: blank (formed sheet before trimming), the shared tool, scrap
// ---------------------------------------------------------------------------

const BG = M.blankGeometries('low');
const toolMat = new THREE.MeshStandardMaterial({ ...P.materials.tool, name: 'Tool_Aluminium', side: THREE.DoubleSide });
const blankMat = plainSheetMaterial('PP_Blank', { hole: false }); // not cut yet
const TOOL_BOTTOM = CASE.zBack - 0.025;
const blank = new THREE.Group();
const tool = new THREE.Group();
const scrap = new THREE.Group();
const blankParts = [];
function cloneForBlank(geo, flatZ, nz) {
  const g = geo.clone();
  const formed = Float32Array.from(g.attributes.position.array);
  const formedN = Float32Array.from(g.attributes.normal.array);
  blankParts.push({ g, formed, formedN, flatZ, nz });
  return g;
}
const scrapMat = makeScrapMaterial();
for (const half of [BG.base, BG.lid]) {
  blank.add(new THREE.Mesh(cloneForBlank(half.inside, 0.004, 1), blankMat), new THREE.Mesh(cloneForBlank(half.outside, 0.004 - P.thickness, -1), blankMat));
  scrap.add(new THREE.Mesh(half.inside, scrapMat), new THREE.Mesh(half.outside, scrapMat));
  // tool: the outside surface of the formed sheet, and a skirt down to the bench
  const top = half.outside.clone();
  top.translate(0, 0, -0.0002);
  tool.add(new THREE.Mesh(top, toolMat), new THREE.Mesh(skirt(half), toolMat));
}
for (const g of [blank, tool, scrap]) g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
caseLo.holder.add(tool, blank, scrap);

function skirt(half) {
  const G = half.grid;
  const p = half.outside.attributes.position;
  const pos = [];
  const idx = [];
  const ring = [];
  for (let k = 0; k < G.N; k++) {
    const i = 1 + k * G.nr + G.nr - 1;
    ring.push([p.getX(i), p.getY(i), p.getZ(i) - 0.0002]);
  }
  ring.forEach(([x, y, z]) => pos.push(x, y, z, x, y, TOOL_BOTTOM));
  for (let k = 0; k < ring.length; k++) {
    const a = k * 2;
    const b = ((k + 1) % ring.length) * 2;
    idx.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// f = 0: flat heated sheet; f = 1: formed on the tool
function setForming(f) {
  for (const { g, formed, formedN, flatZ, nz } of blankParts) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      p[i] = formed[i];
      p[i + 1] = formed[i + 1];
      p[i + 2] = flatZ + (formed[i + 2] - flatZ) * f;
      const x = formedN[i] * f;
      const y = formedN[i + 1] * f;
      const z = formedN[i + 2] * f + nz * (1 - f);
      const l = Math.hypot(x, y, z) || 1;
      n[i] = x / l;
      n[i + 1] = y / l;
      n[i + 2] = z / l;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.computeBoundingSphere();
  }
}

// Scrap: the blank minus the trimmed case (mask in outline coordinates)
function makeScrapMaterial() {
  const x0 = -M.BLANK.x;
  const y0 = M.BLANK.y0;
  const w = 2 * M.BLANK.x;
  const h = P.foldY - M.BLANK.y0;
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = Math.round((900 * h) / w);
  const g = c.getContext('2d');
  const img = g.createImageData(c.width, c.height);
  for (let j = 0; j < c.height; j++) {
    for (let i = 0; i < c.width; i++) {
      const x = x0 + ((i + 0.5) / c.width) * w;
      const y = y0 + h - ((j + 0.5) / c.height) * h;
      const inStrip = y >= M.SHEET.yTabTop && Math.abs(x) <= P.handle.topWidth / 2;
      const inside = (M.trimSDF(x, y) <= 0 && M.holeSDF(x, y) >= 0) || inStrip;
      const o = (j * c.width + i) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = inside ? 255 : 0;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  const m = new THREE.MeshStandardMaterial({ ...P.materials.sheet, name: 'PP_Scrap', transparent: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMask = { value: tex };
    shader.uniforms.uMaskBox = { value: new THREE.Vector4(x0, y0, w, h) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 rest;\nvarying vec2 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = rest;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMask;\nuniform vec4 uMaskBox;\nvarying vec2 vRest;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (texture2D(uMask, (vRest - uMaskBox.xy) / uMaskBox.zw).r > 0.5) discard;`,
      );
  };
  m.customProgramCacheKey = () => 'scrap';
  return m;
}
function scrapMatFade(a) {
  scrapMat.opacity = a;
  scrapMat.depthWrite = a > 0.99;
}

// ---------------------------------------------------------------------------
// Camera and timing helpers
// ---------------------------------------------------------------------------

const deg = THREE.MathUtils.degToRad;
const ease = (u) => {
  const t = Math.min(Math.max(u, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const lerp = (a, b, t) => a + (b - a) * t;
const span = (t, a, b) => Math.min(Math.max((t - a) / (b - a), 0), 1);
const inOut = (t, a, b, f = 0.4) => span(t, a, a + f) * (1 - span(t, b - f, b));
function camPose({ target, az, el, dist, fov = 30 }) {
  const [tx, ty, tz] = target;
  camera.fov = fov;
  camera.position.set(tx + dist * Math.cos(deg(el)) * Math.sin(deg(az)), ty + dist * Math.sin(deg(el)), tz + dist * Math.cos(deg(el)) * Math.cos(deg(az)));
  camera.up.set(0, 1, 0);
  camera.lookAt(tx, ty, tz);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
const mixCam = (a, b, t) => ({
  target: a.target.map((v, i) => lerp(v, b.target[i], t)),
  az: lerp(a.az, b.az, t),
  el: lerp(a.el, b.el, t),
  dist: lerp(a.dist, b.dist, t),
  fov: lerp(a.fov ?? 30, b.fov ?? 30, t),
});
function keys(list, t) {
  if (t <= list[0][0]) return list[0][1];
  for (let i = 0; i < list.length - 1; i++) {
    const [t0, a] = list[i];
    const [t1, b] = list[i + 1];
    if (t <= t1) {
      const u = ease((t - t0) / (t1 - t0));
      return typeof a === 'number' ? lerp(a, b, u) : mixCam(a, b, u);
    }
  }
  return list[list.length - 1][1];
}

// ---------------------------------------------------------------------------
// Caption layer
// ---------------------------------------------------------------------------

const overlay = document.createElement('canvas');
overlay.width = W;
overlay.height = H;
const g = overlay.getContext('2d');
const out = document.createElement('canvas');
out.width = W;
out.height = H;
const og = out.getContext('2d');

const IVORY = '#f6f2ea';
const AMBER = '#ff9a3c';

function screen(v) {
  const p = v.clone().project(camera);
  return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H];
}
const wc = (c, x, y, z) => c.orient.localToWorld(new THREE.Vector3(x, y, z)); // case -> world

function polyline(points, { t, t0, color = AMBER, width = 2.6, alpha = 1, draw = 1.0, closed = false }) {
  const grow = span(t, t0, t0 + draw);
  if (grow <= 0 || alpha <= 0) return;
  const pts = points.map(screen);
  if (closed) pts.push(pts[0]);
  const n = Math.max(2, Math.round(pts.length * grow));
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = width * S;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.shadowColor = color;
  g.shadowBlur = 14 * S;
  g.beginPath();
  g.moveTo(...pts[0]);
  for (let i = 1; i < n; i++) g.lineTo(...pts[i]);
  g.stroke();
  g.restore();
}

function pill(text, x, y, alpha, { size = 34, weight = 500 } = {}) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.font = `${weight} ${Math.round(size * S)}px Heebo`;
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = g.measureText(text).width + 44 * S;
  const h = (size + 30) * S;
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 18 * S;
  g.fillStyle = 'rgba(18,18,20,0.8)';
  g.beginPath();
  g.roundRect(x - w / 2, y - h / 2, w, h, 12 * S);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(240,194,122,0.8)';
  g.lineWidth = 1.5 * S;
  g.stroke();
  g.fillStyle = IVORY;
  g.fillText(text, x, y + 3 * S);
  g.restore();
}

function title(text, alpha, sub = null) {
  if (alpha <= 0) return;
  const y = 92 * S;
  g.save();
  g.globalAlpha = alpha;
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 ${Math.round(44 * S)}px Heebo`;
  const w1 = g.measureText(text).width;
  g.font = `400 ${Math.round(30 * S)}px Heebo`;
  const w2 = sub ? g.measureText(sub).width : 0;
  const w = Math.max(w1, w2) + 70 * S;
  const h = (sub ? 128 : 84) * S;
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 18 * S;
  g.fillStyle = 'rgba(18,18,20,0.78)';
  g.beginPath();
  g.roundRect(W / 2 - w / 2, y - 42 * S, w, h, 14 * S);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = AMBER;
  g.fillRect(W / 2 - w / 2 + 14 * S, y - 42 * S + h - 5 * S, w - 28 * S, 3 * S);
  g.fillStyle = IVORY;
  g.font = `600 ${Math.round(44 * S)}px Heebo`;
  g.fillText(text, W / 2, y + 2 * S);
  if (sub) {
    g.font = `400 ${Math.round(30 * S)}px Heebo`;
    g.fillStyle = 'rgba(246,242,234,0.88)';
    g.fillText(sub, W / 2, y + 50 * S);
  }
  g.restore();
}

// Step label (top right, reading order of Hebrew)
function step(text, alpha) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.font = `500 ${Math.round(32 * S)}px Heebo`;
  g.direction = 'rtl';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  const w = g.measureText(text).width + 40 * S;
  const x = W - 60 * S;
  const y = 270 * S;
  g.fillStyle = 'rgba(18,18,20,0.78)';
  g.beginPath();
  g.roundRect(x - w, y - 32 * S, w, 64 * S, 10 * S);
  g.fill();
  g.fillStyle = AMBER;
  g.fillRect(x - 6 * S, y - 32 * S, 6 * S, 64 * S);
  g.fillStyle = IVORY;
  g.fillText(text, x - 22 * S, y + 3 * S);
  g.restore();
}

function subtitles(Tm) {
  const c = CARDS.find((k) => Tm >= k.start && Tm < k.end);
  if (!c) return;
  const a = Math.min(span(Tm, c.start, c.start + 0.15), 1 - span(Tm, c.end - 0.15, c.end));
  g.save();
  g.globalAlpha = a;
  g.font = `500 ${Math.round(40 * S)}px Heebo`;
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = wrap(c.text, W * 0.72);
  const lh = 58 * S;
  const y0 = H - 70 * S - (lines.length - 1) * lh;
  const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 48 * S;
  g.fillStyle = 'rgba(10,10,12,0.84)';
  g.beginPath();
  g.roundRect(W / 2 - w / 2, y0 - lh / 2 - 6 * S, w, lh * lines.length + 12 * S, 10 * S);
  g.fill();
  g.fillStyle = '#ffffff';
  lines.forEach((l, i) => g.fillText(l, W / 2, y0 + i * lh + 3 * S));
  g.restore();
}
function wrap(text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (g.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

const YC = P.hatCenterY;

// outline of the trimmed half (and its mirror, the lid) and the handle hole, at height z
function trimOutline(c, mirror, z) {
  const pts = [];
  for (let i = 0; i < 420; i++) {
    const a = (i / 420) * Math.PI * 2;
    let lo = 0;
    let hi = 0.45;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if (M.trimSDF(Math.cos(a) * m, YC + Math.sin(a) * m) < 0) lo = m;
      else hi = m;
    }
    const x = Math.cos(a) * lo;
    const y = YC + Math.sin(a) * lo;
    pts.push(wc(c, x, mirror ? 2 * P.foldY - y : y, z));
  }
  return pts;
}
function holeOutline(c, mirror, z) {
  const pts = [];
  const { l, r, y: yh } = M.SHEET.hole;
  for (let i = 0; i <= 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    const x = Math.sign(Math.cos(a)) * l + r * Math.cos(a);
    const y = yh + r * Math.sin(a);
    pts.push(wc(c, x, mirror ? 2 * P.foldY - y : y, z));
  }
  return pts;
}

const SHOT = {
  // heated sheet, forming on the shared tool, cooling, trimming, fold
  make(t) {
    caseHi.pivot.visible = false;
    caseLo.pivot.visible = true;
    const [, f1] = STEPS.form;
    const trimmed = t >= 18.4;
    caseLo.sheet.root.visible = trimmed;
    blank.visible = !trimmed;
    scrap.visible = trimmed && t < 20.8;
    tool.visible = true;
    const heat = t < STEPS.form[0] ? 1 : 1 - span(t, 11.0, 13.6);
    SHEET_UNIFORMS.uHeat.value = 0.32 * heat * (trimmed ? 0 : 1);
    setForming(ease(span(t, STEPS.form[0] + 0.2, f1)));
    const up = 0.035 * ease(span(t, 12.6, 14.2)) + 0.12 * ease(span(t, 20.6, 21.8));
    blank.position.z = up;
    caseLo.sheet.root.position.z = up;
    scrap.position.z = up + 0.09 * ease(span(t, 18.6, 20.6));
    scrapMatFade(1 - span(t, 19.4, 20.6));
    caseLo.sheet.setFold(Math.PI * ease(span(t, 21.8, 25.8)));
    setPose(caseLo, 'lying', { lift: 0.025 });
    const a = { target: [0, 0.07, -0.05], az: 24, el: 36, dist: 1.9 };
    const b = { target: [0, 0.07, -0.05], az: 32, el: 44, dist: 1.75 };
    const c = { target: [0, 0.2, 0.05], az: 40, el: 26, dist: 1.5 };
    camPose(keys([[0, a], [12.0, b], [20.2, b], [26.4, c]], t));
    scene.updateMatrixWorld(true);
    title('עִקְרוֹן הַיִּצּוּר מִיְּרִיעָה אַחַת', inOut(t, 0.2, 6.6, 0.5), 'אֶפְשָׁרוּת 2 · גַּב כִּפָּה · הַדְמָיַת תִּכְנוּן בִּלְבַד');
    const st1 = (txt, [a0, a1]) => step(txt, inOut(t, a0 + 0.3, a1 + 0.2));
    st1('1 · יְרִיעָה מְחֻמֶּמֶת מֵעַל כְּלִי עִצּוּב מְשֻׁתָּף', STEPS.heat);
    st1('2 · עִצּוּב בְּוָאקוּם אוֹ בְּלַחַץ', STEPS.form);
    st1('3 · קֵרוּר וְשִׁחְרוּר', STEPS.cool);
    st1('4 · חִתּוּךְ הַהֶקֵּף וּפֶתַח הַיָּדִית', STEPS.trim);
    st1('5 · קִפּוּל וּסְגִירָה', [STEPS.fold[0], STEPS.fold[1] + 0.6]);
    // cut lines along the outline and the handle holes (both halves)
    if (t > 15.0 && t < 19.4) {
      const fade = 1 - span(t, 18.4, 19.4);
      for (const m of [false, true]) {
        polyline(trimOutline(caseLo, m, up + 0.0005), { t, t0: 15.4, draw: 2.8, alpha: fade, closed: true });
        polyline(holeOutline(caseLo, m, up + 0.0005), { t, t0: 17.2, draw: 0.8, alpha: fade });
      }
    }
  },

  // the finished case, closed, turning to its back
  closed(t, d) {
    caseLo.pivot.visible = false;
    caseHi.pivot.visible = true;
    caseHi.sheet.setFold(Math.PI);
    SHEET_UNIFORMS.uHeat.value = 0;
    setPose(caseHi, 'standing', { yaw: lerp(110, 200, ease(span(t, 0, d))), lift: 0.02 });
    camPose({ target: [0, 0.225, 0], az: 0, el: 6, dist: 1.5 });
    pill('אֶפְשָׁרוּת 2 · גַּב כִּפָּה', W / 2, 110 * S, span(t, 0.6, 1.1), { size: 36, weight: 600 });
  },
};

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------

for (const wgt of [400, 500, 600]) await document.fonts.load(`${wgt} ${Math.round(40 * S)}px Heebo`, 'עִקְרוֹן הַיִּצּוּר 2 ·');

function renderShot(i, t, draw3d = true) {
  const shot = SHOTS[i];
  g.clearRect(0, 0, W, H);
  SHOT[shot.id](t, shot.duration);
  scene.updateMatrixWorld(true);
  if (draw3d) renderer.render(scene, camera);
  subtitles(starts[i] + t);
}

function renderFrame(i, t) {
  renderShot(i, t, true);
  og.clearRect(0, 0, W, H);
  og.drawImage(renderer.domElement, 0, 0);
  return { clean: out.toDataURL('image/jpeg', 0.94), overlay: overlay.toDataURL('image/png') };
}
function renderOverlay(i, t) {
  renderShot(i, t, false);
  return overlay.toDataURL('image/png');
}
function renderPreview(i, t) {
  renderShot(i, t, true);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const cg = c.getContext('2d');
  cg.drawImage(renderer.domElement, 0, 0);
  cg.drawImage(overlay, 0, 0);
  return c.toDataURL('image/jpeg', 0.9);
}

window.film = {
  ready: true,
  shots: SHOTS.map((s) => ({ id: s.id, duration: s.duration })),
  renderFrame,
  renderOverlay,
  renderPreview,
  phiRest: 0,
};
