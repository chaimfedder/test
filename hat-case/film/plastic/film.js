// Technical film of the plastic hat case (one formed PP sheet).
// Studio scenes, camera moves, sections, the forming principle, nesting of
// identical sheets in two directions, and a caption layer (dimension lines
// anchored to the model, counters, subtitles). Frames are rendered on
// request (window.film.renderFrame) by render_film.mjs.

import * as THREE from 'three';
import { HAT_PARAMS, CROWN_BASE } from '../../src/openCaseParams.js';
import { PLASTIC } from '../../src/plastic/plasticParams.js';
import {
  baseInside,
  blankGeometries,
  BLANK,
  holeSDF,
  lidInside,
  lidMatrix,
  RING,
  sheetGeometries,
  SHEET,
  trimSDF,
} from '../../src/plastic/sheetModel.js';
import { createSheetMaterials, plainSheetMaterial, setSection, SHEET_UNIFORMS } from '../../src/plastic/sheetMaterials.js';
import { runPlasticChecks } from '../../src/plastic/plasticChecks.js';
import { CASE, createCase, createHat, createStage, setPose } from './scene.js';
import { FILM, SHOTS, shotStarts, subtitleCards } from './shots.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w')) || FILM.width;
const H = Number(q.get('h')) || FILM.height;
const S = H / 1080; // overlay scale
const { starts } = shotStarts();
const CARDS = subtitleCards();

// ---------------------------------------------------------------------------
// Stage, case copies, hat
// ---------------------------------------------------------------------------

const st = createStage(W, H, { antialias: q.get('aa') !== '0' });
const { renderer, scene, camera } = st;
document.body.appendChild(renderer.domElement);

const mats = await createSheetMaterials('../../');
const caseHi = await createCase({ lod: 'high', mats });
const caseLo = await createCase({ lod: 'low', mats });
const plain = plainSheetMaterial('PP_Stack');
const plainSet = { baseIn: plain, baseOut: plain, lidIn: plain, lidOut: plain, edge: plain, fold: plain, depth: mats.depth };
const stackUp = [];
const stackDown = [];
for (let i = 0; i < 10; i++) {
  stackUp.push(await createCase({ lod: i === 9 ? 'low' : 'stack', mats: plainSet }));
  stackDown.push(await createCase({ lod: i === 9 ? 'low' : 'stack', mats: plainSet }));
}
const all = [caseHi, caseLo, ...stackUp, ...stackDown];
for (const c of all) scene.add(c.pivot);

const hat = createHat();
const hatMats = [];
hat.hat.traverse((o) => o.isMesh && hatMats.push(o.material));

const sheetMats = [mats.baseIn, mats.baseOut, mats.lidIn, mats.lidOut, mats.edge, mats.fold, plain];

const checks = runPlasticChecks();
const PITCH = checks.nesting.pitch;

// Support under the lid of the face-up stack (the open sheet as formed, 180 deg)
const supportH = -CASE.zBack - (PLASTIC.lid.edgeDepth + PLASTIC.lid.dome + PLASTIC.thickness);
const support = new THREE.Mesh(
  new THREE.BoxGeometry(0.16, supportH, 0.2),
  new THREE.MeshStandardMaterial({ color: '#34373b', roughness: 0.75, metalness: 0.05, name: 'Support' }),
);
support.castShadow = support.receiveShadow = true;

// ---------------------------------------------------------------------------
// Forming scene: blank (formed sheet before trimming), the shared tool, scrap
// ---------------------------------------------------------------------------

const BG = blankGeometries('low');
const toolMat = new THREE.MeshStandardMaterial({ ...PLASTIC.materials.tool, name: 'Tool_Aluminium', side: THREE.DoubleSide });
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
  blank.add(new THREE.Mesh(cloneForBlank(half.inside, 0.004, 1), blankMat), new THREE.Mesh(cloneForBlank(half.outside, 0.004 - PLASTIC.thickness, -1), blankMat));
  scrap.add(new THREE.Mesh(half.inside, scrapMat), new THREE.Mesh(half.outside, scrapMat));
  // tool: the outside surface of the formed sheet, and a skirt down to the bench
  const top = half.outside.clone();
  top.translate(0, 0, -0.0002);
  const tm = new THREE.Mesh(top, toolMat);
  tool.add(tm, new THREE.Mesh(skirt(half), toolMat));
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
  ring.forEach(([x, y, z], k) => pos.push(x, y, z, x, y, TOOL_BOTTOM));
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
  const x0 = -BLANK.x;
  const y0 = BLANK.y0;
  const w = 2 * BLANK.x;
  const h = PLASTIC.foldY - BLANK.y0;
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = Math.round((900 * h) / w);
  const g = c.getContext('2d');
  const img = g.createImageData(c.width, c.height);
  for (let j = 0; j < c.height; j++) {
    for (let i = 0; i < c.width; i++) {
      const x = x0 + ((i + 0.5) / c.width) * w;
      const y = y0 + h - ((j + 0.5) / c.height) * h;
      const inStrip = y >= SHEET.yTabTop && Math.abs(x) <= PLASTIC.handle.topWidth / 2;
      const inside = (trimSDF(x, y) <= 0 && holeSDF(x, y) >= 0) || inStrip;
      const o = (j * c.width + i) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = inside ? 255 : 0;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  const m = new THREE.MeshStandardMaterial({ ...PLASTIC.materials.sheet, name: 'PP_Scrap', transparent: true });
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

// ---------------------------------------------------------------------------
// Rest angle of the open lid when the case lies on a table (lid touches the table)
// ---------------------------------------------------------------------------

const PHI_REST = (() => {
  const p = sheetGeometries('low').lid.outside.attributes.position;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const lowest = (phi) => {
    lidMatrix(phi, m);
    let z = Infinity;
    for (let i = 0; i < p.count; i += 7) z = Math.min(z, v.fromBufferAttribute(p, i).applyMatrix4(m).z);
    return z;
  };
  let lo = -0.8;
  let hi = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lowest(mid) < CASE.zBack) lo = mid;
    else hi = mid;
  }
  return hi;
})();

// ---------------------------------------------------------------------------
// Camera and timing helpers
// ---------------------------------------------------------------------------

const deg = THREE.MathUtils.degToRad;
const ease = (u) => {
  const t = Math.min(Math.max(u, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const lerp = (a, b, t) => a + (b - a) * t;
const span = (t, a, b) => {
  if (!Number.isFinite(a)) return 0;
  return Math.min(Math.max((t - a) / (b - a), 0), 1);
};
function camPose({ target, az, el, dist, fov = 30 }, cam = camera) {
  const [tx, ty, tz] = target;
  cam.fov = fov;
  cam.position.set(tx + dist * Math.cos(deg(el)) * Math.sin(deg(az)), ty + dist * Math.sin(deg(el)), tz + dist * Math.cos(deg(el)) * Math.cos(deg(az)));
  cam.up.set(0, 1, 0);
  cam.lookAt(tx, ty, tz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}
const mixCam = (a, b, t) => ({
  target: a.target.map((v, i) => lerp(v, b.target[i], t)),
  az: lerp(a.az, b.az, t),
  el: lerp(a.el, b.el, t),
  dist: lerp(a.dist, b.dist, t),
  fov: lerp(a.fov ?? 30, b.fov ?? 30, t),
});
// keyframes [[t, value], ...] with eased segments (stops at each key)
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

const GOLD = '#f0c27a';
const IVORY = '#f6f2ea';
const AMBER = '#ff9a3c';
let view = { cam: camera, x: 0, w: W }; // current viewport for projections

function screen(v) {
  const p = v.clone().project(view.cam);
  return [view.x + ((p.x + 1) / 2) * view.w, ((1 - p.y) / 2) * H];
}
const wc = (c, x, y, z) => c.orient.localToWorld(new THREE.Vector3(x, y, z)); // case -> world

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

function pill(text, x, y, alpha, { size = 34, accent = 'rgba(240,194,122,0.8)' } = {}) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.font = `500 ${Math.round(size * S)}px Heebo`;
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = g.measureText(text).width + 44 * S;
  const h = (size + 28) * S;
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 18 * S;
  g.fillStyle = 'rgba(18,18,20,0.8)';
  g.beginPath();
  g.roundRect(x - w / 2, y - h / 2, w, h, 12 * S);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = accent;
  g.lineWidth = 1.5 * S;
  g.stroke();
  g.fillStyle = IVORY;
  g.fillText(text, x, y + 2 * S);
  g.restore();
}

// Dimension line between world points a and b (with arrow heads), drawn from the middle out
function dimension({ a, b, text, t, t0, t1 = Infinity, labelOffset = 70, side = 1, ext = [], labelAt = null }) {
  const grow = ease(span(t, t0, t0 + 0.8));
  const fadeOut = 1 - span(t, t1, t1 + 0.35);
  if (grow <= 0 || fadeOut <= 0) return;
  const A = screen(a);
  const B = screen(b);
  const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const len = Math.hypot(dx, dy) || 1;
  const u = [dx / len, dy / len];
  const n = [-u[1], u[0]];
  const a2 = [M[0] - (dx / 2) * grow, M[1] - (dy / 2) * grow];
  const b2 = [M[0] + (dx / 2) * grow, M[1] + (dy / 2) * grow];
  for (const [p, q2] of ext) strokeLine(screen(p), screen(q2), 1.4, IVORY, [5, 6], 0.8 * fadeOut * grow);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 6 * S;
  strokeLine(a2, b2, 2.6, GOLD, null, fadeOut);
  // arrow heads
  const ah = 14 * S;
  const aw = 6 * S;
  for (const [p, dir] of [[a2, -1], [b2, 1]]) {
    g.globalAlpha = fadeOut;
    g.fillStyle = GOLD;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] - dir * u[0] * ah + n[0] * aw, p[1] - dir * u[1] * ah + n[1] * aw);
    g.lineTo(p[0] - dir * u[0] * ah - n[0] * aw, p[1] - dir * u[1] * ah - n[1] * aw);
    g.closePath();
    g.fill();
  }
  g.restore();
  const la = span(t, t0 + 0.6, t0 + 1.1) * fadeOut;
  const L = labelAt ? [labelAt[0] * S, labelAt[1] * S] : [M[0] + n[0] * labelOffset * S * side, M[1] + n[1] * labelOffset * S * side];
  pill(text, L[0], L[1], la);
}

function polyline(points, { t, t0, t1 = Infinity, color = GOLD, width = 2.2, dash = null, closed = false, alpha = 1, draw = 1.0, glow = false }) {
  const grow = span(t, t0, t0 + draw);
  const fadeOut = 1 - span(t, t1, t1 + 0.35);
  if (grow <= 0 || fadeOut <= 0) return;
  const pts = points.map(screen);
  if (closed) pts.push(pts[0]);
  const n = Math.max(2, Math.round(pts.length * grow));
  g.save();
  g.globalAlpha = alpha * fadeOut;
  g.strokeStyle = color;
  g.lineWidth = width * S;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (dash) g.setLineDash(dash.map((d) => d * S));
  g.shadowColor = glow ? color : 'rgba(0,0,0,0.5)';
  g.shadowBlur = (glow ? 14 : 5) * S;
  g.beginPath();
  g.moveTo(...pts[0]);
  for (let i = 1; i < n; i++) g.lineTo(...pts[i]);
  g.stroke();
  g.restore();
}

function marker(p, alpha, label = null, labelSide = 1) {
  if (alpha <= 0) return;
  const [x, y] = screen(p);
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = AMBER;
  g.fillStyle = AMBER;
  g.lineWidth = 3 * S;
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 8 * S;
  g.beginPath();
  g.arc(x, y, 8 * S, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(x, y, 22 * S, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  if (label) pill(label, x + labelSide * 230 * S, y - 70 * S, alpha, { size: 30 });
}

// Title line at the top of the frame
function title(text, alpha, sub = null) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 14 * S;
  g.fillStyle = IVORY;
  g.font = `600 ${Math.round(44 * S)}px Heebo`;
  g.fillText(text, W / 2, 70 * S);
  if (sub) {
    g.font = `400 ${Math.round(28 * S)}px Heebo`;
    g.fillStyle = 'rgba(246,242,234,0.85)';
    g.fillText(sub, W / 2, 118 * S);
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
  const y = 190 * S;
  g.fillStyle = 'rgba(18,18,20,0.75)';
  g.beginPath();
  g.roundRect(x - w, y - 30 * S, w, 60 * S, 10 * S);
  g.fill();
  g.fillStyle = AMBER;
  g.fillRect(x - 6 * S, y - 30 * S, 6 * S, 60 * S);
  g.fillStyle = IVORY;
  g.fillText(text, x - 22 * S, y + 2 * S);
  g.restore();
}

function counter(n, alpha, label = 'קופסאות בערימה') {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.direction = 'rtl';
  g.textBaseline = 'middle';
  const x = W - 70 * S;
  const y = 110 * S;
  g.fillStyle = 'rgba(18,18,20,0.78)';
  g.beginPath();
  g.roundRect(x - 330 * S, y - 50 * S, 330 * S, 100 * S, 14 * S);
  g.fill();
  g.strokeStyle = 'rgba(240,194,122,0.8)';
  g.lineWidth = 1.5 * S;
  g.stroke();
  g.textAlign = 'right';
  g.fillStyle = 'rgba(246,242,234,0.85)';
  g.font = `400 ${Math.round(26 * S)}px Heebo`;
  g.fillText(label, x - 22 * S, y - 20 * S);
  g.fillStyle = GOLD;
  g.font = `600 ${Math.round(46 * S)}px Heebo`;
  g.textAlign = 'right';
  g.fillText(`${n} מתוך 10`, x - 22 * S, y + 22 * S);
  g.restore();
}

// Subtitles (by film time, so both shots of a dissolve show the same card)
function subtitles(T) {
  const c = CARDS.find((k) => T >= k.start && T < k.end);
  if (!c) return;
  const a = Math.min(span(T, c.start, c.start + 0.15), 1 - span(T, c.end - 0.15, c.end));
  g.save();
  g.globalAlpha = a;
  g.font = `500 ${Math.round(40 * S)}px Heebo`;
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = wrap(c.text, W * 0.72);
  const lh = 54 * S;
  const y0 = H - 70 * S - (lines.length - 1) * lh;
  const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 48 * S;
  g.fillStyle = 'rgba(10,10,12,0.62)';
  g.beginPath();
  g.roundRect(W / 2 - w / 2, y0 - lh / 2 - 6 * S, w, lh * lines.length + 12 * S, 10 * S);
  g.fill();
  g.fillStyle = '#ffffff';
  lines.forEach((l, i) => g.fillText(l, W / 2, y0 + i * lh + 2 * S));
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
// Scene state helpers
// ---------------------------------------------------------------------------

function only(...cases) {
  for (const c of all) c.pivot.visible = cases.includes(c);
  support.visible = false;
  tool.visible = blank.visible = scrap.visible = false;
  hat.holder.visible = false;
  SHEET_UNIFORMS.uHighlight.value = 0;
  SHEET_UNIFORMS.uHeat.value = 0;
  SHEET_UNIFORMS.uFlex.value = 0;
  setSection(sheetMats, null);
  setHatSection(null);
  for (const c of all) {
    c.sheet.root.visible = true;
    c.sheet.root.position.set(0, 0, 0);
  }
  blank.position.set(0, 0, 0);
  scrap.position.set(0, 0, 0);
}
function attachHat(c, lift = 0) {
  if (hat.holder.parent !== c.orient) c.orient.add(hat.holder);
  hat.holder.visible = true;
  hat.holder.position.set(hat.rest.x, hat.rest.y, hat.rest.z + lift);
}
function setHatSection(planes) {
  for (const m of hatMats) {
    m.clippingPlanes = planes;
    m.needsUpdate = true;
  }
}
const sectionX0 = () => [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)]; // keep x <= 0 (world)

// world height of a case-coordinate z when lying (lift included)
const YC = PLASTIC.hatCenterY;
const HI = PLASTIC.inner.height;
const AX = CROWN_BASE.x;
const AY = CROWN_BASE.z;

// rim outline (inside, z = 0) in case coordinates
const rimPts = (() => {
  const pts = [];
  for (let i = 0; i < 400; i++) {
    const a = (i / 400) * Math.PI * 2;
    // walk the rim outline by bisection along rays from the hat center
    let lo = 0;
    let hi = 0.4;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if (trimSDF(Math.cos(a) * m, YC + Math.sin(a) * m) + PLASTIC.flange.width < 0) lo = m;
      else hi = m;
    }
    pts.push([Math.cos(a) * lo, YC + Math.sin(a) * lo]);
  }
  return pts;
})();
const ovalPts = (d, z, n = 160) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [(AX + d) * Math.cos(a), YC + (AY + d) * Math.sin(a), z];
  });

// Groove wall point (same wall seen from both sides): on the ring's outer face, +x side
const P_IN = (() => {
  const z = -0.05;
  const d = RING.outerTop + (RING.zTop - z) * Math.tan(PLASTIC.base.ringOuterDraft);
  return [AX + d, YC, z];
})();
const N_IN = [Math.cos(PLASTIC.base.ringOuterDraft), 0, Math.sin(PLASTIC.base.ringOuterDraft)];
const P_OUT = P_IN.map((v, i) => v - N_IN[i] * PLASTIC.thickness);

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

const LIE = (c, opts = {}) => setPose(c, 'lying', opts);

const SHOT = {
  // 1. closed case turning in place: front, sides, back (groove and logo), top, bottom
  turn(t) {
    only(caseLo);
    caseLo.sheet.setFold(Math.PI);
    const yaw = keys([[0, -32], [2.2, 0], [4.4, 90], [6.4, 180], [12.4, 180], [14.6, 270], [16.6, 360]], t);
    setPose(caseLo, 'standing', { yaw, lift: 0.02 });
    const base = { target: [0, 0.235, 0], az: 0, el: 7, dist: 1.5, fov: 30 };
    const back = { target: [0, 0.215, 0], az: 0, el: 4, dist: 1.02, fov: 30 };
    const top = { target: [0, 0.27, 0], az: 0, el: 68, dist: 1.45, fov: 30 };
    const bottom = { target: [0, 0.16, 0], az: 0, el: -52, dist: 1.45, fov: 30 };
    camPose(keys([[0, base], [6.6, base], [9.0, back], [11.4, back], [13.2, base], [16.6, base], [18.3, top], [18.7, top], [20.8, bottom]], t));
    scene.updateMatrixWorld(true);
    const lbl = (txt, a, b) => pill(txt, W / 2, 175 * S, span(t, a, a + 0.4) * (1 - span(t, b - 0.4, b)), { size: 30 });
    lbl('חזית', 1.8, 3.3);
    lbl('צד', 4.1, 5.4);
    lbl('גב: התעלה החיצונית והלוגו', 6.4, 12.2);
    lbl('צד', 14.3, 15.6);
    lbl('מבט מלמעלה', 17.9, 19.0);
    lbl('מבט מלמטה', 20.1, 21.5);
  },

  // 2. open on the table, the empty inside and the ring; main dimensions
  open(t) {
    only(caseLo);
    const phi = lerp(Math.PI, PHI_REST, ease(span(t, 0.4, 3.4)));
    caseLo.sheet.setFold(phi);
    LIE(caseLo);
    const a = { target: [0, 0.1, 0.05], az: 30, el: 32, dist: 1.6 };
    const b = { target: [0, 0.03, -0.12], az: 18, el: 40, dist: 1.85 };
    const c = { target: [0, 0.03, 0.17], az: -38, el: 34, dist: 0.95 };
    const d = { target: [0, 0.03, 0.17], az: 40, el: 30, dist: 0.95 };
    const top = { target: [0, 0.0, -0.02], az: 0, el: 84, dist: 1.18 };
    camPose(keys([[0, a], [3.4, b], [5.2, c], [8.6, d], [10.0, top], [22.0, top]], t));
    scene.updateMatrixWorld(true);
    const at = (x, y, z) => wc(caseLo, x, y, z);
    if (t > 9.6) polyline(rimPts.map(([x, y]) => at(x, y, 0)), { t, t0: 9.7, draw: 0.8, color: IVORY, width: 2, closed: true, alpha: 0.9, t1: 21.6 });
    const yTop = Math.max(...rimPts.map((p) => p[1]));
    const yTip = Math.min(...rimPts.map((p) => p[1]));
    const halfW = PLASTIC.inner.width / 2;
    let yWide = 0;
    {
      let best = 0;
      for (const [x, y] of rimPts) if (Math.abs(x) > best) [best, yWide] = [Math.abs(x), y];
    }
    dimension({ a: at(-0.17, yTop, 0), b: at(-0.17, yTip, 0), text: 'אורך פנימי: 37.41 ס״מ', t, t0: 10.0, t1: 13.9, labelOffset: 130, side: -1, ext: [[at(0, yTop, 0), at(-0.17, yTop, 0)], [at(0, yTip, 0), at(-0.17, yTip, 0)]] });
    dimension({ a: at(-halfW, yWide, 0), b: at(halfW, yWide, 0), text: 'רוחב פנימי מרבי: 29.41 ס״מ', t, t0: 14.2, t1: 18.3, labelOffset: 70, side: -1 });
    // ring at its top: outside oval and the width of the top
    const zr = 0.0;
    polyline(ovalPts(RING.outerTop, zr).map((p) => at(...p)), { t, t0: 18.6, draw: 0.6, color: GOLD, width: 2.2, closed: true, t1: 21.6 });
    dimension({ a: at(0, YC + AY + RING.outerTop, zr), b: at(0, YC - AY - RING.outerTop, zr), text: `טבעת, אורך חיצוני בשפה: ${checks.dimensions.ringTopOval_outside_cm.length.toFixed(2)} ס״מ`, t, t0: 18.8, t1: 21.6, labelAt: [960, 120] });
    dimension({ a: at(-AX - RING.outerTop, YC, zr), b: at(AX + RING.outerTop, YC, zr), text: `רוחב חיצוני בשפה: ${checks.dimensions.ringTopOval_outside_cm.width.toFixed(2)} ס״מ`, t, t0: 19.1, t1: 21.6, labelOffset: 60, side: -1 });
  },

  // 3a. outside: the oval channel in the back, a point on its wall
  grooveOut(t, d) {
    only(caseHi);
    caseHi.sheet.setFold(Math.PI);
    setPose(caseHi, 'standing', { yaw: 180, lift: 0.02 });
    scene.updateMatrixWorld(true);
    const p = wc(caseHi, ...P_OUT);
    const far = { target: [p.x * 0.6, p.y + 0.01, p.z], az: 0, el: 5, dist: 0.95 };
    const near = { target: [p.x, p.y, p.z], az: 25, el: 8, dist: 0.45 };
    camPose(mixCam(far, near, ease(span(t, 0, d - 0.4))));
    marker(p, span(t, 2.0, 2.5), 'נקודה על דופן התעלה, מבחוץ', 1);
  },

  // 3b. the same point from inside, then side by side with the wall highlighted
  ringIn(t, d) {
    only(caseHi);
    const inside = () => {
      caseHi.sheet.setFold(PHI_REST);
      LIE(caseHi);
      scene.updateMatrixWorld(true);
    };
    const outside = () => {
      caseHi.sheet.setFold(Math.PI);
      setPose(caseHi, 'standing', { yaw: 180, lift: 0.02 });
      scene.updateMatrixWorld(true);
    };
    SHEET_UNIFORMS.uHighlight.value = 0.42 * span(t, 3.6, 4.6) * (1 - span(t, 8.6, 9.3));
    const split = ease(span(t, 2.6, 3.4));
    const camIn = (cam) => {
      inside();
      const p = wc(caseHi, ...P_IN);
      camPose({ target: [p.x - 0.01, p.y + 0.01, p.z], az: 96, el: 66, dist: lerp(0.36, 0.42, split), fov: lerp(30, 34, split) }, cam);
      return p;
    };
    const camOut = (cam) => {
      outside();
      const p = wc(caseHi, ...P_OUT);
      camPose({ target: [p.x, p.y, p.z], az: 25, el: 8, dist: 0.45, fov: 34 }, cam);
      return p;
    };
    return { split, camIn, camOut };
  },

  // 4. section along the middle: the sheet rises and comes back (ring), depths
  section(t) {
    only(caseHi);
    caseHi.sheet.setFold(Math.PI);
    LIE(caseHi);
    attachHat(caseHi, 0);
    const planes = sectionX0();
    setSection(sheetMats, planes);
    setHatSection(planes);
    scene.updateMatrixWorld(true);
    const at = (y, z) => wc(caseHi, 0, y, z);
    const ringY = YC - AY - RING.mid; // ring on the tip side
    const full = { target: [0, 0.06, 0.02], az: 90, el: 4, dist: 1.25, fov: 30 };
    const pr = at(ringY, -0.05);
    const ring = { target: [pr.x, pr.y, pr.z], az: 90, el: 2, dist: 0.42, fov: 30 };
    const pc = at(ringY + 0.006, -0.0005);
    const cap = { target: [pc.x, pc.y, pc.z], az: 90, el: 0, dist: 0.055, fov: 30 };
    const mid = { target: [0, 0.07, -0.02], az: 90, el: 3, dist: 0.95, fov: 30 };
    const tip = { target: [0, 0.07, 0.07], az: 90, el: 3, dist: 0.95, fov: 30 };
    camPose(keys([[0, full], [1.4, full], [3.0, ring], [5.6, ring], [6.6, cap], [8.2, cap], [9.4, mid], [17.0, mid], [18.2, tip], [20.0, tip]], t));
    // profiles of the cut (inside and outside of the sheet)
    // sgn = 1: base (inside surface z = I, outside below it); sgn = -1: closed lid (z = -I, outside above)
    const prof = (fn, sgn, y0, y1, off) => {
      const pts = [];
      for (let i = 0; i <= 700; i++) {
        const y = y0 + ((y1 - y0) * i) / 700;
        const h = 1e-5;
        const z = sgn * fn(0, y);
        const dz = (sgn * fn(0, y + h) - sgn * fn(0, y - h)) / (2 * h);
        const l = Math.hypot(1, dz);
        // upward normal of the curve: (-dz, 1) / l
        const k = sgn > 0 ? -off : off;
        pts.push(at(y - (k * dz) / l, z + k / l));
      }
      return pts;
    };
    const yLo = -0.0095;
    const yHi = PLASTIC.foldY - SHEET.foldWidth / 2;
    const show = (t0) => ({ t, t0, draw: 1.2 });
    polyline(prof(baseInside, 1, yLo, yHi, 0), { ...show(0.5), color: GOLD, width: 1.6 });
    polyline(prof(baseInside, 1, yLo, yHi, PLASTIC.thickness), { ...show(0.5), color: GOLD, width: 1.6 });
    polyline(prof(lidInside, -1, yLo, yHi, 0), { ...show(0.7), color: IVORY, width: 1.4, alpha: 0.8 });
    polyline(prof(lidInside, -1, yLo, yHi, PLASTIC.thickness), { ...show(0.7), color: IVORY, width: 1.4, alpha: 0.8 });
    // ring height: from the root (outer side) to the top
    const yRoot = YC - AY - RING.root - 0.004;
    dimension({ a: at(yRoot - 0.012, RING.zRoot), b: at(yRoot - 0.012, RING.zTop), text: 'גובה המבנה הטבעתי: 10 ס״מ', t, t0: 3.0, t1: 5.7, labelOffset: 170, side: 1, ext: [[at(YC - AY - RING.root, RING.zRoot), at(yRoot - 0.016, RING.zRoot)], [at(YC - AY - RING.mid, RING.zTop), at(yRoot - 0.016, RING.zTop)]] });
    if (t > 6.4 && t < 8.6) pill('עובי היריעה בהדמיה: 0.6 מ״מ', W / 2, 160 * S, span(t, 6.6, 7.0) * (1 - span(t, 8.1, 8.4)));
    // crown area: 11.5 total, then 10 + 1.5
    const xIn = YC + 0.03;
    dimension({ a: at(xIn, RING.zFloor), b: at(xIn, 0), text: 'מרווח פנימי באזור הכתר: 11.5 ס״מ', t, t0: 9.8, t1: 13.6, labelOffset: 210, side: 1, ext: [[at(YC - AY - RING.mid, 0), at(YC + AY + RING.mid, 0)]] });
    const lift = hat.lift;
    const yCrown = YC + 0.05;
    const crownTop = lift - HAT_PARAMS.crownHeight;
    dimension({ a: at(yCrown, lift), b: at(yCrown, crownTop), text: 'גובה כתר: 10 ס״מ', t, t0: 13.9, t1: 17.4, labelOffset: 160, side: -1 });
    dimension({ a: at(YC - 0.05, crownTop), b: at(YC - 0.05, RING.zFloor), text: 'מרווח נוסף: 1.5 ס״מ', t, t0: 15.4, t1: 17.4, labelOffset: 200, side: 1 });
    dimension({ a: at(0.03, 0), b: at(0.03, -PLASTIC.base.edgeDepth), text: 'עומק באזור השוליים: 3 ס״מ', t, t0: 18.0, labelOffset: 200, side: -1 });
  },

  // 5a. forming principle: heated sheet, shared tool, forming, cooling, trimming, fold
  make(t) {
    only(caseLo);
    const lift = 0.025;
    // product appears when the trim is done
    const trimmed = t >= 15.0;
    caseLo.sheet.root.visible = trimmed;
    blank.visible = !trimmed;
    scrap.visible = trimmed && t < 17.6;
    tool.visible = true;
    const heat = t < 2.5 ? 1 : 1 - span(t, 7.0, 9.5);
    SHEET_UNIFORMS.uHeat.value = 0.32 * heat * (trimmed ? 0 : 1);
    setForming(ease(span(t, 2.6, 7.0)));
    const up = 0.035 * ease(span(t, 9.5, 11.0)) + 0.12 * ease(span(t, 17.6, 19.2));
    blank.position.z = up;
    caseLo.sheet.root.position.z = up;
    scrap.position.z = up + 0.09 * ease(span(t, 15.4, 17.4));
    scrapMatFade(1 - span(t, 16.2, 17.4));
    const phi = Math.PI * ease(span(t, 19.4, 23.2));
    caseLo.sheet.setFold(phi);
    LIE(caseLo, { lift });
    const a = { target: [0, 0.07, -0.05], az: 24, el: 36, dist: 1.9 };
    const b = { target: [0, 0.07, -0.05], az: 32, el: 44, dist: 1.75 };
    const c = { target: [0, 0.2, 0.05], az: 40, el: 26, dist: 1.5 };
    camPose(keys([[0, a], [9.5, b], [17.0, b], [22.5, c]], t));
    scene.updateMatrixWorld(true);
    title('המחשת עקרון הייצור מיריעה אחת', span(t, 0.2, 0.8), 'הדמיית תכנון בלבד – התהליך טרם אושר מול יצרן');
    const st1 = (txt, a0, a1) => step(txt, span(t, a0, a0 + 0.4) * (1 - span(t, a1 - 0.4, a1)));
    st1('1 · יריעה מחוממת מעל כלי עיצוב משותף', 0.3, 2.9);
    st1('2 · עיצוב בוואקום או בלחץ', 2.7, 7.3);
    st1('3 · קירור ושחרור', 7.1, 11.2);
    st1('4 · חיתוך ההיקף ופתח הידית', 11.0, 17.8);
    st1('5 · קיפול וסגירה', 17.6, 23.6);
    // cut lines along the trim outline and the finger holes (both halves)
    if (t > 11.0 && t < 17.6) {
      const ptsHalf = (mirror) => {
        const pts = [];
        for (let i = 0; i < 420; i++) {
          const a = (i / 420) * Math.PI * 2;
          let lo = 0;
          let hi = 0.45;
          for (let k = 0; k < 40; k++) {
            const m = (lo + hi) / 2;
            if (trimSDF(Math.cos(a) * m, YC + Math.sin(a) * m) < 0) lo = m;
            else hi = m;
          }
          const x = Math.cos(a) * lo;
          const y = YC + Math.sin(a) * lo;
          const Y = mirror ? 2 * PLASTIC.foldY - y : y;
          pts.push(wc(caseLo, x, Y, up + 0.0005));
        }
        return pts;
      };
      const holePts = (mirror) => {
        const pts = [];
        const { l, r, y: yh } = SHEET.hole;
        for (let i = 0; i <= 80; i++) {
          const a = (i / 80) * Math.PI * 2;
          const x = Math.sign(Math.cos(a)) * l + r * Math.cos(a);
          const y = yh + r * Math.sin(a);
          pts.push(wc(caseLo, x, mirror ? 2 * PLASTIC.foldY - y : y, up + 0.0005));
        }
        return pts;
      };
      const fade = 1 - span(t, 16.4, 17.4);
      for (const m of [false, true]) {
        polyline(ptsHalf(m), { t, t0: 11.4, draw: 3.0, color: AMBER, width: 2.6, alpha: fade, glow: true, closed: true });
        polyline(holePts(m), { t, t0: 13.4, draw: 0.9, color: AMBER, width: 2.6, alpha: fade, glow: true });
      }
    }
  },

  // 5b. closing rims: the rib of the base enters the lid's channel (section, close up)
  snap(t, d) {
    only(caseHi);
    const phi = lerp(Math.PI * 0.955, Math.PI, ease(span(t, 0.3, 3.4)));
    caseHi.sheet.setFold(phi);
    LIE(caseHi);
    // local flex of the lid's flange while the channel rides over the rib
    const k = span(t, 2.2, 3.4);
    SHEET_UNIFORMS.uFlex.value = 0.00035 * Math.sin(Math.PI * k);
    scene.updateMatrixWorld(true);
    const ySec = 0.2;
    const x0 = PLASTIC.inner.width / 2 - PLASTIC.flange.ribCenter;
    const p0 = wc(caseHi, 0, ySec, 0);
    // cut across the side flange (keep the tip side of the plane)
    const n = wc(caseHi, 0, -1, 0).sub(wc(caseHi, 0, 0, 0)).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0);
    setSection(sheetMats, [plane]);
    const p = wc(caseHi, x0 - 0.002, ySec, 0.0005);
    camPose({ target: [p.x, p.y, p.z], az: lerp(172, 184, span(t, 0, d)), el: 6, dist: 0.05, fov: 30 });
    title('שפות הסגירה: זכר ונקבה', span(t, 0.1, 0.6), 'חתך בשפה – הצלע בבסיס נכנסת לתעלה שבמכסה');
    const at = (x, z) => wc(caseHi, x, ySec, z);
    pill('בסיס – צלע (זכר)', W * 0.68, H * 0.72, span(t, 0.6, 1.0), { size: 30 });
    pill('מכסה – תעלה (נקבה)', W * 0.68, H * 0.26, span(t, 0.9, 1.3), { size: 30 });
    if (t > 2.4) pill('לחיצה – גמישות מקומית של השפה', W / 2, H - 200 * S, span(t, 2.4, 2.8), { size: 28 });
    void at;
  },

  // 6. the hat goes in upside down, the lid closes
  hat(t) {
    only(caseLo);
    const phi = lerp(PHI_REST, Math.PI, ease(span(t, 5.0, 8.4)));
    caseLo.sheet.setFold(phi);
    LIE(caseLo);
    attachHat(caseLo, 0.3 * (1 - ease(span(t, 0.3, 4.6))));
    camPose(keys([[0, { target: [0, 0.12, 0.1], az: 30, el: 34, dist: 1.5 }], [8.8, { target: [0, 0.1, 0.12], az: 18, el: 30, dist: 1.4 }]], t));
  },

  // 7. nesting, open, inside up: ten identical sheets, one after the other
  nestUp(t) {
    return nest(t, stackUp, 'up');
  },
  // 8. nesting, open and upside down
  nestDown(t) {
    return nest(t, stackDown, 'down');
  },

  // 9. both stacks side by side
  compare(t, d) {
    only(...stackUp, ...stackDown);
    // both stacks turned so their length runs across the frame
    const zc = HI / 2 - PLASTIC.foldY; // fold line (middle of the open sheet) along the stack
    placeStack(stackUp, 'up', 10, 1e9, -0.5, 0, 90);
    placeStack(stackDown, 'down', 10, 1e9, 0.5, 0, 90);
    stackUp.forEach((c) => (c.pivot.position.x = -0.5 - zc));
    stackDown.forEach((c) => (c.pivot.position.x = 0.5 - zc));
    support.visible = true;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(stackUp[9].pivot).union(new THREE.Box3().setFromObject(stackDown[9].pivot));
    const c = box.getCenter(new THREE.Vector3());
    const tg = [c.x, 0.08, c.z];
    camPose(mixCam({ target: tg, az: -8, el: 30, dist: 2.7 }, { target: tg, az: 8, el: 27, dist: 2.55 }, ease(span(t, 0, d))));
    scene.updateMatrixWorld(true);
    const lbl = (x, text, sub) => {
      const p = screen(new THREE.Vector3(x - zc, 0.0, c.z));
      pill(text, p[0], 260 * S, span(t, 0.6, 1.2), { size: 32 });
      pill(sub, p[0], 334 * S, span(t, 0.9, 1.5), { size: 26 });
    };
    lbl(-0.5, 'פנים כלפי מעלה', 'הטבעת התחתונה נכנסת לתעלה שמעליה');
    lbl(0.5, 'הפוכות – פנים כלפי מטה', 'הטבעת העליונה נכנסת לתעלה שמתחתיה');
    pill(`10 קופסאות בכל ערימה · מרווח קינון ${checks.nesting.pitch_mm.toFixed(1)} מ״מ`, W / 2, 150 * S, span(t, 1.4, 2.0), { size: 30 });
  },
};

// Stack: box i rests at i * pitch; it comes down from above at times[i]
const DROP = 0.24;
function placeStack(stack, dir, count, times, x = 0, tNow = 0, yaw = 0) {
  stack.forEach((c, i) => {
    const t0 = Array.isArray(times) ? times[i] : -1;
    const dur = Array.isArray(times) && i === 3 ? 3.2 : 0.9;
    const visible = i < count && (!Array.isArray(times) || tNow >= t0 - 0.6);
    c.pivot.visible = visible;
    if (!visible) return;
    const k = Array.isArray(times) ? 1 - ease(span(tNow, t0 - 0.6, t0 - 0.6 + dur)) : 0;
    const lift = (dir === 'up' ? 0 : SHEET_RIB) + i * PITCH + DROP * k * k * (3 - 2 * k);
    c.sheet.setFold(0);
    setPose(c, dir === 'up' ? 'lying' : 'flipped', { x, lift, yaw });
  });
  if (dir === 'up') {
    // support under the lid of the bottom sheet (z of the lid's middle), turns with the stack
    const zl = -(2 * PLASTIC.foldY - YC) + HI / 2;
    if (support.parent !== stack[0].pivot) stack[0].pivot.add(support);
    support.position.set(0, supportH / 2, zl);
  }
}
const SHEET_RIB = PLASTIC.flange.ribHeight; // the base's rib is the lowest point upside down

function nest(t, stack, dir) {
  only(...stack);
  const times = dir === 'up' ? [0, 1.1, 2.0, 3.0, 7.4, 8.2, 9.0, 9.8, 10.6, 11.4] : [0, 1.0, 1.8, 2.7, 6.3, 7.0, 7.7, 8.4, 9.1, 9.8];
  placeStack(stack, dir, 10, times, 0, t);
  support.visible = dir === 'up';
  const landed = times.filter((x, i) => t >= x - 0.6 + (i === 3 ? 3.2 : 0.9) || i === 0).length;
  const closeA = times[3] - 0.4;
  const closeB = times[3] + 2.9;
  const section = t > closeA && t < closeB;
  setSection(sheetMats, section ? sectionX0() : null);
  scene.updateMatrixWorld(true);
  // close-up on the ring entering the channel (tip side of the ring)
  const yRing = YC - AY - RING.mid;
  const zW = -yRing + HI / 2;
  const hRing = dir === 'up' ? -CASE.zBack - 0.05 + 3 * PITCH : SHEET_RIB + 0.05 + 3 * PITCH;
  const wide = { target: [0, 0.12, -0.02], az: dir === 'up' ? 38 : -38, el: 26, dist: 2.0 };
  const close = { target: [0, hRing, zW], az: 90, el: 4, dist: 0.5 };
  const side = { target: [0, 0.1, -0.2], az: 90, el: 4, dist: 1.6 };
  const top = { target: [0, 0.12, -0.02], az: 90, el: 80, dist: 2.2 };
  const end = dir === 'up' ? 15.5 : 14.0;
  camPose(
    keys(
      [
        [0, wide],
        [closeA - 0.6, wide],
        [closeA, close],
        [closeB, close],
        [closeB + 0.7, wide],
        [end - 3.0, wide],
        [end - 1.9, side],
        [end - 1.3, side],
        [end - 0.2, top],
        [end, top],
      ],
      t,
    ),
  );
  counter(Math.min(landed, 10), span(t, 0.3, 0.8));
  if (section) {
    const a = span(t, closeA + 0.2, closeA + 0.6) * (1 - span(t, closeB - 0.4, closeB));
    pill(dir === 'up' ? 'הטבעת של היחידה התחתונה נכנסת לתעלה של היחידה שמעליה' : 'הטבעת של היחידה העליונה נכנסת לתעלה של היחידה שמתחתיה', W / 2, 160 * S, a, { size: 30 });
  }
  if (t > end - 3.0) {
    pill(`מרווח קינון: ${checks.nesting.pitch_mm.toFixed(1)} מ״מ ליחידה`, W / 2, 160 * S, span(t, end - 2.9, end - 2.4), { size: 30 });
  }
  title(dir === 'up' ? 'קינון: פתוחות, הפנים כלפי מעלה' : 'קינון: פתוחות והפוכות', span(t, 0.1, 0.6) * (1 - span(t, closeA - 0.5, closeA)) + span(t, closeB, closeB + 0.5) * (1 - span(t, end - 3.2, end - 2.9)));
}

function scrapMatFade(a) {
  scrapMat.opacity = a;
  scrapMat.depthWrite = a > 0.99;
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------

for (const wgt of [400, 500, 600]) await document.fonts.load(`${wgt} ${Math.round(40 * S)}px Heebo`, 'אורך 37.41 מתוך');

function drawShot(i, t) {
  const shot = SHOTS[i];
  g.clearRect(0, 0, W, H);
  view = { cam: camera, x: 0, w: W };
  const r = SHOT[shot.id](t, shot.duration);
  return r;
}

// Split screen for the ring shot: left = outside (channel), right = inside (ring)
const camL = new THREE.PerspectiveCamera(30, W / 2 / H, 0.005, 30);
const camR = new THREE.PerspectiveCamera(30, W / 2 / H, 0.005, 30);
camera.near = 0.005;
camera.updateProjectionMatrix();

function renderShot(i, t, wantCaptions) {
  const shot = SHOTS[i];
  g.clearRect(0, 0, W, H);
  view = { cam: camera, x: 0, w: W };
  if (shot.id === 'ringIn') {
    const s = SHOT.ringIn(t, shot.duration);
    renderer.setScissorTest(true);
    const wR = Math.round(lerp(W, W / 2, s.split));
    const xR = W - wR;
    // right: inside
    camR.aspect = wR / H;
    const pIn = s.camIn(camR);
    renderer.setViewport(xR, 0, wR, H);
    renderer.setScissor(xR, 0, wR, H);
    renderer.render(scene, camR);
    view = { cam: camR, x: xR, w: wR };
    marker(pIn, span(t, 0.5, 1.0) * (1 - span(t, 8.8, 9.3)), s.split < 0.5 ? 'אותה נקודה, מבפנים' : null, -1);
    if (s.split > 0.01) {
      camL.aspect = xR / H;
      const pOut = s.camOut(camL);
      renderer.setViewport(0, 0, xR, H);
      renderer.setScissor(0, 0, xR, H);
      renderer.render(scene, camL);
      view = { cam: camL, x: 0, w: xR };
      marker(pOut, span(t, 3.0, 3.5) * (1 - span(t, 8.8, 9.3)), null);
      view = { cam: camera, x: 0, w: W };
      g.save();
      g.globalAlpha = s.split;
      g.fillStyle = 'rgba(246,242,234,0.85)';
      g.fillRect(xR - 1.5 * S, 0, 3 * S, H);
      g.restore();
      pill('מבחוץ: התעלה', xR / 2, 150 * S, span(t, 3.2, 3.7), { size: 32 });
      pill('מבפנים: הטבעת', xR + wR / 2, 150 * S, span(t, 3.2, 3.7), { size: 32 });
      pill('אותה דופן מעוצבת', W / 2, H - 230 * S, span(t, 4.4, 4.9) * (1 - span(t, 8.6, 9.1)), { size: 30, accent: 'rgba(255,154,60,0.9)' });
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
  } else {
    drawShot(i, t);
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
  }
  view = { cam: camera, x: 0, w: W };
  subtitles(starts[i] + t);
  void wantCaptions;
}

// clean 3D frame (JPEG) and the caption layer (PNG with alpha)
function renderFrame(i, t) {
  renderShot(i, t, true);
  og.clearRect(0, 0, W, H);
  og.drawImage(renderer.domElement, 0, 0);
  return { clean: out.toDataURL('image/jpeg', 0.94), overlay: overlay.toDataURL('image/png') };
}
// caption layer only: run the shot (state + overlay) without rendering 3D
function renderOverlay(i, t) {
  const shot = SHOTS[i];
  g.clearRect(0, 0, W, H);
  if (shot.id === 'ringIn') renderShot(i, t, true);
  else {
    drawShot(i, t);
    view = { cam: camera, x: 0, w: W };
    subtitles(starts[i] + t);
  }
  return overlay.toDataURL('image/png');
}
// preview: composite
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
  checks: () => checks,
  phiRest: PHI_REST,
};
