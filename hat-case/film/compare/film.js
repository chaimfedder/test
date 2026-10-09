// Comparison film: two back designs of the plastic case with a narrow groove
// (option 1: flat back, right half of the frame; option 2: dome back, left
// half), the same review of both at the same time, nesting stacks of ten,
// pros and cons, and a third design (a cradle shaped like the hat) at the end.
// Frames are rendered on request (window.film.renderFrame) by render.mjs.

import * as THREE from 'three';
import { HAT_PARAMS, CROWN_BASE } from '../../src/openCaseParams.js';
import { buildHat } from '../../src/openCaseModel.js';
import { createSheetMaterials, plainSheetMaterial, setSection, SHEET_UNIFORMS } from '../../src/plastic/sheetMaterials.js';
import { CASE, createStage, setPose } from '../plastic/scene.js';
import { DATA, FILM, SHOTS, shotStarts, subtitleCards } from './shots.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w')) || FILM.width;
const H = Number(q.get('h')) || FILM.height;
const S = H / 1080; // overlay scale
const { starts } = shotStarts();
const CARDS = subtitleCards();

// ---------------------------------------------------------------------------
// Stage, the three designs (each its own copy of the model modules)
// ---------------------------------------------------------------------------

const st = createStage(W, H, { antialias: q.get('aa') !== '0' });
const { renderer, scene, camera } = st;
document.body.appendChild(renderer.domElement);
camera.near = 0.005;

const mats = await createSheetMaterials('../../');
const plain = plainSheetMaterial('PP_Stack');
const plainSet = { baseIn: plain, baseOut: plain, lidIn: plain, lidOut: plain, edge: plain, fold: plain, depth: mats.depth };
const sheetMats = [mats.baseIn, mats.baseOut, mats.lidIn, mats.lidOut, mats.edge, mats.fold, plain];

const supportMat = new THREE.MeshStandardMaterial({ color: '#34373b', roughness: 0.75, metalness: 0.05, name: 'Support' });
const supportH = -CASE.zBack - CASE.lidOutsideApex;

const allCases = [];
const hatMats = [];
const supports = [];

function createCase(M, { lod, mats: m }) {
  const sheet = M.buildSheet(m, { lod });
  const holder = new THREE.Group(); // sheet -> case coordinates
  holder.position.y = M.SHEET.foldY;
  holder.add(sheet.root);
  const orient = new THREE.Group(); // case -> pose
  orient.add(holder);
  const pivot = new THREE.Group(); // yaw and placement
  pivot.add(orient);
  const c = { sheet, holder, orient, pivot };
  scene.add(pivot);
  allCases.push(c);
  return c;
}

// the hat resting on what supports its brim in this design (same rule as checks.js)
function createHat(M, P) {
  const hat = buildHat(HAT_PARAMS);
  let lift = -Infinity;
  for (let i = 0; i <= 1200; i++) {
    const d = (0.06 * i) / 1200;
    lift = Math.max(lift, M.supportZ(d) - hat.userData.brimUnderside(d));
  }
  delete hat.userData.brimUnderside;
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2; // hat +y (opening) -> case +z, hat z (length) -> case y
  holder.add(hat);
  hat.traverse((o) => o.isMesh && hatMats.push(o.material));
  return { hat, holder, rest: new THREE.Vector3(0, P.hatCenterY, lift), lift };
}

async function loadDesign(key, { down = true } = {}) {
  const M = await import(`../../src/designs/model.js?d=${key}`);
  const { PLASTIC: P } = await import(`../../src/designs/params.js?d=${key}`);
  const V = { key, M, P, data: DATA[key], pitch: DATA[key].pitch_mm / 1000 };
  V.hi = createCase(M, { lod: 'high', mats });
  V.lo = createCase(M, { lod: 'low', mats });
  V.up = [];
  V.down = [];
  for (let i = 0; i < 10; i++) {
    V.up.push(createCase(M, { lod: i === 9 ? 'low' : 'stack', mats: plainSet }));
    if (down) V.down.push(createCase(M, { lod: i === 9 ? 'low' : 'stack', mats: plainSet }));
  }
  V.hat = createHat(M, P);
  V.support = new THREE.Mesh(new THREE.BoxGeometry(0.16, supportH, 0.2), supportMat);
  V.support.castShadow = V.support.receiveShadow = true;
  supports.push(V.support);
  return V;
}

const F = await loadDesign('flat');
const D = await loadDesign('dome');
const C = await loadDesign('cradle', { down: false });
const SIDES = [
  [F, W / 2], // right half: option 1
  [D, 0], // left half: option 2
];

const P = F.P; // shared numbers (outline, lid, flange, hat center) are the same in all designs
const YC = P.hatCenterY;
const HI = P.inner.height;
const AX = CROWN_BASE.x;
const AY = CROWN_BASE.z;
const T = P.thickness;

// Rest angle of the open lid when the case lies on a table (the lid is the same in all designs)
const PHI_REST = (() => {
  const p = F.M.sheetGeometries('low').lid.outside.attributes.position;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const lowest = (phi) => {
    F.M.lidMatrix(phi, m);
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

// Groove mouth seen from outside, on the +x side of the ring at the hat center
// (case coordinates of the two edges, on the outside surface)
function grooveMouth(V) {
  const R = V.M.RING;
  const zi = (x) => V.M.baseInside(x, YC);
  const zIn = zi(AX + R.innerBottom - 0.008); // floor on the crown side
  const zOut = zi(AX + R.root + 0.008); // floor on the side-wall side
  const zM = Math.max(zIn, zOut) + P.base.rootRadius; // above both root roundings
  let x1 = AX + R.innerBottom - 0.008;
  while (zi(x1) < zM) x1 += 0.00002;
  let x2 = AX + R.root + 0.008;
  while (zi(x2) < zM) x2 -= 0.00002;
  const z = zM - T;
  return { a: [x1 + T, YC, z], b: [x2 - T, YC, z], width: x2 - x1 - 2 * T };
}
for (const V of [F, D]) {
  V.groove = grooveMouth(V);
  console.log(`${V.key}: groove width at the mouth ${(V.groove.width * 100).toFixed(2)} cm`);
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
const GREEN = '#9ad48f';
const RED = '#ff8f80';
let view = { x: 0, w: W }; // current viewport for projections

function screen(v) {
  const p = v.clone().project(camera);
  return [view.x + ((p.x + 1) / 2) * view.w, ((1 - p.y) / 2) * H];
}
const wc = (c, x, y, z) => c.orient.localToWorld(new THREE.Vector3(x, y, z)); // case -> world
const vcx = () => view.x + view.w / 2; // middle of the current viewport

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

function pill(text, x, y, alpha, { size = 34, accent = 'rgba(240,194,122,0.8)', color = IVORY, weight = 500 } = {}) {
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
  g.strokeStyle = accent;
  g.lineWidth = 1.5 * S;
  g.stroke();
  g.fillStyle = color;
  g.fillText(text, x, y + 3 * S);
  g.restore();
}

// Dimension line between world points a and b (arrow heads), drawn from the middle out.
// The label goes to `labelAt` (frame pixels) or beside the line.
function dimension({ a, b, text, t, t0, t1 = Infinity, labelOffset = 70, side = 1, ext = [], labelAt = null, size = 30 }) {
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
  const L = labelAt || [M[0] + n[0] * labelOffset * S * side, M[1] + n[1] * labelOffset * S * side];
  if (labelAt) strokeLine(M, L, 1.2, GOLD, [4, 5], 0.7 * la);
  pill(text, L[0], L[1], la, { size });
}

function polyline(points, { t, t0, t1 = Infinity, color = GOLD, width = 2.2, dash = null, closed = false, alpha = 1, draw = 1.0 }) {
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
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 5 * S;
  g.beginPath();
  g.moveTo(...pts[0]);
  for (let i = 1; i < n; i++) g.lineTo(...pts[i]);
  g.stroke();
  g.restore();
}

// a point on the model with a leader line to a label
function callout(p, text, dx, dy, alpha) {
  if (alpha <= 0) return;
  const [x, y] = screen(p);
  const L = [x + dx * S, y + dy * S];
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = AMBER;
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 8 * S;
  g.beginPath();
  g.arc(x, y, 7 * S, 0, Math.PI * 2);
  g.fill();
  g.restore();
  strokeLine([x, y], L, 2, AMBER, null, alpha);
  pill(text, L[0], L[1], alpha, { size: 30, accent: 'rgba(255,154,60,0.9)' });
}

function title(text, alpha, sub = null, y = 150) {
  if (alpha <= 0) return;
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
  g.roundRect(W / 2 - w / 2, y * S - 42 * S, w, h, 14 * S);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = AMBER;
  g.fillRect(W / 2 - w / 2 + 14 * S, y * S - 42 * S + h - 5 * S, w - 28 * S, 3 * S);
  g.fillStyle = IVORY;
  g.font = `600 ${Math.round(44 * S)}px Heebo`;
  g.fillText(text, W / 2, y * S + 2 * S);
  if (sub) {
    g.font = `400 ${Math.round(30 * S)}px Heebo`;
    g.fillStyle = 'rgba(246,242,234,0.88)';
    g.fillText(sub, W / 2, y * S + 50 * S);
  }
  g.restore();
}

// boxes counter in the outer top corner of the current viewport (or the frame)
function counter(n, alpha, corner = 'right') {
  if (alpha <= 0) return;
  const bw = 330 * S;
  const x0 = corner === 'right' ? view.x + view.w - 40 * S - bw : view.x + 40 * S;
  const y = 170 * S;
  g.save();
  g.globalAlpha = alpha;
  g.direction = 'rtl';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(18,18,20,0.78)';
  g.beginPath();
  g.roundRect(x0, y - 50 * S, bw, 100 * S, 14 * S);
  g.fill();
  g.strokeStyle = 'rgba(240,194,122,0.8)';
  g.lineWidth = 1.5 * S;
  g.stroke();
  g.textAlign = 'right';
  g.fillStyle = 'rgba(246,242,234,0.88)';
  g.font = `400 ${Math.round(26 * S)}px Heebo`;
  g.fillText('קֻפְסָאוֹת בָּעֲרֵמָה', x0 + bw - 22 * S, y - 20 * S);
  g.fillStyle = GOLD;
  g.font = `600 ${Math.round(44 * S)}px Heebo`;
  g.fillText(`${n} מִתּוֹךְ 10`, x0 + bw - 22 * S, y + 24 * S);
  g.restore();
}

// Pros and cons card. rows: [{ kind: 'head'|'pros'|'cons'|'+'|'-', text, at }]
function card(x, y, w, rows, t, alpha = 1) {
  if (alpha <= 0) return;
  const lh = { head: 64, pros: 50, cons: 56, '+': 44, '-': 44 };
  const h = rows.reduce((a, r) => a + lh[r.kind] * S, 0) + 34 * S;
  const a0 = alpha * span(t, rows[0].at - 0.2, rows[0].at + 0.3);
  if (a0 <= 0) return;
  g.save();
  g.globalAlpha = a0;
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 22 * S;
  g.fillStyle = 'rgba(16,16,18,0.84)';
  g.beginPath();
  g.roundRect(x, y, w, h, 16 * S);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(240,194,122,0.75)';
  g.lineWidth = 1.5 * S;
  g.stroke();
  g.restore();
  g.save();
  g.direction = 'rtl';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  let yy = y + 17 * S;
  const xr = x + w - 30 * S;
  for (const r of rows) {
    const hh = lh[r.kind] * S;
    const a = alpha * span(t, r.at - 0.1, r.at + 0.4);
    const slide = (1 - ease(span(t, r.at - 0.1, r.at + 0.5))) * 18 * S;
    g.globalAlpha = a;
    const cy = yy + hh / 2;
    if (r.kind === 'head') {
      g.font = `600 ${Math.round(36 * S)}px Heebo`;
      g.fillStyle = GOLD;
      g.fillText(r.text, xr - slide, cy);
      g.fillStyle = 'rgba(240,194,122,0.35)';
      g.fillRect(x + 26 * S, yy + hh - 6 * S, w - 52 * S, 1.5 * S);
    } else if (r.kind === 'pros' || r.kind === 'cons') {
      g.font = `600 ${Math.round(30 * S)}px Heebo`;
      g.fillStyle = r.kind === 'pros' ? GREEN : RED;
      g.fillText(r.text, xr - slide, cy + 6 * S);
    } else {
      const col = r.kind === '+' ? GREEN : RED;
      g.fillStyle = col;
      g.beginPath();
      g.arc(xr - 10 * S - slide, cy, 12 * S, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#141416';
      g.lineWidth = 3 * S;
      g.beginPath();
      g.moveTo(xr - 16 * S - slide, cy);
      g.lineTo(xr - 4 * S - slide, cy);
      if (r.kind === '+') {
        g.moveTo(xr - 10 * S - slide, cy - 6 * S);
        g.lineTo(xr - 10 * S - slide, cy + 6 * S);
      }
      g.stroke();
      g.font = `400 ${Math.round(29 * S)}px Heebo`;
      g.fillStyle = IVORY;
      g.fillText(r.text, xr - 36 * S - slide, cy + 2 * S);
    }
    yy += hh;
  }
  g.restore();
}

// Subtitles (by film time, so both shots of a dissolve show the same card)
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
  g.fillStyle = 'rgba(10,10,12,0.66)';
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

// Split screen: divider and the two design labels
const LABEL = { flat: 'אֶפְשָׁרוּת 1 · גַּב שָׁטוּחַ', dome: 'אֶפְשָׁרוּת 2 · גַּב כִּפָּה' };
function splitFrame(alpha = 1, focus = null) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(246,242,234,0.85)';
  g.fillRect(W / 2 - 1.5 * S, 0, 3 * S, H);
  g.restore();
  for (const [V, x] of SIDES) {
    const on = focus && focus(V.key);
    pill(LABEL[V.key], x + W / 4, 60 * S, alpha, {
      size: 32,
      weight: 600,
      accent: on ? 'rgba(255,154,60,1)' : 'rgba(240,194,122,0.8)',
      color: on ? '#ffd9a8' : IVORY,
    });
  }
}
function dimHalf(x, a) {
  if (a <= 0) return;
  g.save();
  g.fillStyle = `rgba(8,8,10,${0.45 * a})`;
  g.fillRect(x, 0, W / 2, H);
  g.restore();
}

// ---------------------------------------------------------------------------
// Scene state helpers
// ---------------------------------------------------------------------------

const ALL_HATS = [F.hat, D.hat, C.hat];
function only(...cases) {
  for (const c of allCases) {
    c.pivot.visible = cases.includes(c);
    c.sheet.root.position.set(0, 0, 0);
  }
  for (const s of supports) s.visible = false;
  for (const h of ALL_HATS) h.holder.visible = false;
  SHEET_UNIFORMS.uHighlight.value = 0;
  SHEET_UNIFORMS.uHeat.value = 0;
  SHEET_UNIFORMS.uFlex.value = 0;
  setSection(sheetMats, null);
  setHatSection(null);
}
function attachHat(V, c, lift = 0) {
  const h = V.hat;
  if (h.holder.parent !== c.orient) c.orient.add(h.holder);
  h.holder.visible = true;
  h.holder.position.set(h.rest.x, h.rest.y, h.rest.z + lift);
}
let hatPlanes = null;
function setHatSection(planes) {
  if (planes === hatPlanes) return;
  hatPlanes = planes;
  for (const m of hatMats) {
    m.clippingPlanes = planes;
    m.needsUpdate = true;
  }
}
const SECTION = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)]; // keep x <= 0 (world)
const LIE = (c, opts = {}) => setPose(c, 'lying', opts);

// profiles of the cut at x = 0 (inside and outside of the sheet), closed case lying
function sectionProfiles(V, c, t, t0) {
  const at = (y, z) => wc(c, 0, y, z);
  const prof = (fn, sgn, y0, y1, off) => {
    const pts = [];
    for (let i = 0; i <= 700; i++) {
      const y = y0 + ((y1 - y0) * i) / 700;
      const h = 1e-5;
      const z = sgn * fn(0, y);
      const dz = (sgn * fn(0, y + h) - sgn * fn(0, y - h)) / (2 * h);
      const l = Math.hypot(1, dz);
      const k = sgn > 0 ? -off : off;
      pts.push(at(y - (k * dz) / l, z + k / l));
    }
    return pts;
  };
  const yLo = -0.0095;
  const yHi = P.foldY - V.M.SHEET.foldWidth / 2;
  const show = { t, t0, draw: 1.2 };
  polyline(prof(V.M.baseInside, 1, yLo, yHi, 0), { ...show, color: GOLD, width: 1.6 });
  polyline(prof(V.M.baseInside, 1, yLo, yHi, T), { ...show, color: GOLD, width: 1.6 });
  polyline(prof(V.M.lidInside, -1, yLo, yHi, 0), { ...show, color: IVORY, width: 1.4, alpha: 0.8 });
  polyline(prof(V.M.lidInside, -1, yLo, yHi, T), { ...show, color: IVORY, width: 1.4, alpha: 0.8 });
}

// Stack: box i rests at i * pitch; it comes down from above at times[i]
const DROP = 0.24;
const SHEET_RIB = P.flange.ribHeight; // the base's rib is the lowest point upside down
function placeStack(V, stack, dir, times, tNow, slow = 3) {
  stack.forEach((c, i) => {
    const t0 = times[i];
    const dur = i === slow ? 3.2 : 0.9;
    const visible = tNow >= t0 - 0.6;
    c.pivot.visible = visible;
    if (!visible) return;
    const k = 1 - ease(span(tNow, t0 - 0.6, t0 - 0.6 + dur));
    const lift = (dir === 'up' ? 0 : SHEET_RIB) + i * V.pitch + DROP * k * k * (3 - 2 * k);
    c.sheet.setFold(0);
    setPose(c, dir === 'up' ? 'lying' : 'flipped', { lift });
  });
  if (dir === 'up') {
    // support under the lid of the bottom sheet
    const zl = -(2 * P.foldY - YC) + HI / 2;
    if (V.support.parent !== stack[0].pivot) stack[0].pivot.add(V.support);
    V.support.visible = true;
    V.support.position.set(0, supportH / 2, zl);
  }
  return times.filter((x, i) => tNow >= x - 0.6 + (i === slow ? 3.2 : 0.9) || i === 0).length;
}

// ---------------------------------------------------------------------------
// Shots. Split shots run once per design (V) with the viewport set, then
// COMMON draws what belongs to the whole frame.
// ---------------------------------------------------------------------------

const NEST_TIMES = {
  up: [0, 1.1, 2.0, 3.0, 7.4, 8.2, 9.0, 9.8, 10.6, 11.4],
  down: [0, 1.0, 1.8, 2.7, 6.3, 7.0, 7.7, 8.4, 9.1, 9.8],
};

const SHOT = {
  // 1. both cases, closed, the same turn: front, side, back
  intro(t, d, V) {
    only(V.lo);
    V.lo.sheet.setFold(Math.PI);
    const yaw = keys([[0, -30], [2.4, -30], [5.0, 0], [8.4, 0], [11.0, 90], [13.6, 180], [16, 180]], t);
    setPose(V.lo, 'standing', { yaw, lift: 0.02 });
    camPose(keys([[0, { target: [0, 0.235, 0], az: 0, el: 9, dist: 1.85 }], [16, { target: [0, 0.225, 0], az: 0, el: 5, dist: 1.6 }]], t));
  },

  // 2. the backs: the groove, the shape of the back (side view), the groove width
  back(t, d, V) {
    only(V.hi);
    V.hi.sheet.setFold(Math.PI);
    setPose(V.hi, 'standing', { yaw: 180, lift: 0.02 });
    scene.updateMatrixWorld(true);
    const pa = wc(V.hi, ...V.groove.a);
    const pb = wc(V.hi, ...V.groove.b);
    const m = pa.clone().add(pb).multiplyScalar(0.5);
    const full = { target: [0, 0.225, 0], az: 0, el: 5, dist: 1.6 };
    const side = { target: [0, 0.225, -0.02], az: -84, el: 3, dist: 1.55 };
    // close-up: the case cut across at the hat center, seen from above; the groove in profile
    const close = { target: [m.x, m.y, m.z], az: 0, el: 65, dist: 0.14 };
    camPose(keys([[0, full], [4.6, full], [6.4, side], [9.6, side], [11.2, close], [14, close]], t));
    if (t > 10.7) {
      const yW = wc(V.hi, 0, YC, 0).y;
      setSection(sheetMats, [new THREE.Plane(new THREE.Vector3(0, -1, 0), yW)]);
      const pin = [];
      const pout = [];
      for (let i = 0; i <= 400; i++) {
        const x = AX - 0.02 + (0.055 * i) / 400;
        const h = 1e-5;
        const z = V.M.baseInside(x, YC);
        const dz = (V.M.baseInside(x + h, YC) - V.M.baseInside(x - h, YC)) / (2 * h);
        const l = Math.hypot(1, dz);
        pin.push(wc(V.hi, x, YC, z));
        pout.push(wc(V.hi, x + (T * dz) / l, YC, z - T / l));
      }
      polyline(pin, { t, t0: 10.8, draw: 0.6, color: GOLD, width: 1.8 });
      polyline(pout, { t, t0: 10.8, draw: 0.6, color: GOLD, width: 1.8 });
    }
    dimension({ a: pa, b: pb, text: `רֹחַב הֶחָרִיץ בַּפֶּתַח: ${(V.groove.width * 100).toFixed(1)} ס״מ`, t, t0: 11.4, labelAt: [vcx(), 300 * S] });
    if (V.key === 'dome') pill('הָרִצְפָּה גְּבוֹהָה יוֹתֵר לְיַד הֶחָרִיץ', vcx(), 380 * S, span(t, 12.2, 12.7), { size: 26 });
  },

  // 3. open on the table: the inside and the ring (the same wall as the groove)
  open(t, d, V) {
    only(V.lo);
    V.lo.sheet.setFold(lerp(Math.PI, PHI_REST, ease(span(t, 0.3, 2.8))));
    LIE(V.lo);
    SHEET_UNIFORMS.uHighlight.value = 0.42 * span(t, 3.4, 4.4) * (1 - span(t, 9.6, 10.4));
    const a = { target: [0, 0.1, 0.05], az: 30, el: 32, dist: 2.1 };
    const b = { target: [0, 0.03, -0.1], az: 18, el: 42, dist: 2.3 };
    const c = { target: [0, 0.02, 0.12], az: -24, el: 46, dist: 1.45 };
    camPose(keys([[0, a], [2.8, b], [5.0, c], [10.6, { ...c, az: -8, el: 52 }]], t));
  },

  // 4. section along the middle with the hat: ring 11.5 = crown 10 + 1.5, depth near the tip
  section(t, d, V) {
    only(V.hi);
    V.hi.sheet.setFold(Math.PI);
    LIE(V.hi);
    attachHat(V, V.hi);
    setSection(sheetMats, SECTION);
    setHatSection(SECTION);
    scene.updateMatrixWorld(true);
    const full = { target: [0, 0.06, 0.02], az: 90, el: 4, dist: 1.5 };
    const mid = { target: [0, 0.06, -0.01], az: 90, el: 3, dist: 1.05 };
    const tip = { target: [0, 0.06, 0.1], az: 90, el: 3, dist: 0.95 };
    camPose(keys([[0, full], [1.0, full], [2.4, mid], [10.6, mid], [11.8, tip], [20, tip]], t));
    const at = (y, z) => wc(V.hi, 0, y, z);
    sectionProfiles(V, V.hi, t, 0.4);
    const R = V.M.RING;
    const yA = YC - AY - R.mid;
    const yB = YC + AY + R.mid;
    const xIn = YC + 0.03;
    dimension({ a: at(xIn, R.zFloor), b: at(xIn, 0), text: 'גֹּבַהּ הַטַּבַּעַת: 11.5 ס״מ', t, t0: 1.6, t1: 10.6, labelAt: [vcx(), 250 * S], ext: [[at(yA, 0), at(yB, 0)]] });
    const lift = V.hat.lift;
    const crownTop = lift - HAT_PARAMS.crownHeight;
    const yCrown = YC + 0.05;
    dimension({ a: at(yCrown, lift), b: at(yCrown, crownTop), text: 'גֹּבַהּ כֶּתֶר: 10 ס״מ', t, t0: 5.0, t1: 10.6, labelAt: [vcx() - 150 * S, H - 250 * S] });
    dimension({ a: at(YC - 0.05, crownTop), b: at(YC - 0.05, R.zFloor), text: 'מִרְוָח נוֹסָף: 1.5 ס״מ', t, t0: 7.0, t1: 10.6, labelAt: [vcx() + 150 * S, H - 320 * S] });
    const zTip = V.M.baseInside(0, 0.03);
    dimension({ a: at(0.03, 0), b: at(0.03, zTip), text: `עֹמֶק 3 ס״מ מֵהַקָּצֶה: ${V.data.depthTip_cm.toFixed(1)} ס״מ`, t, t0: 12.4, labelAt: [vcx(), 250 * S] });
  },

  // 5-6. nesting: ten identical open sheets in each design, the same moves
  nestUp(t, d, V) {
    nest(t, d, V, 'up');
  },
  nestDown(t, d, V) {
    nest(t, d, V, 'down');
  },

  // 7. pros and cons of each design, over the closed case
  cards(t, d, V) {
    only(V.lo);
    V.lo.sheet.setFold(Math.PI);
    setPose(V.lo, 'standing', { yaw: 180 + 28 * Math.sin((t / d) * Math.PI * 1.2 - 0.3), lift: 0.02 });
    camPose({ target: [0, -0.13, 0], az: 0, el: 4, dist: 2.45 });
    const x = view.x + 46 * S;
    const w = view.w - 92 * S;
    const y = 468 * S;
    if (V.key === 'flat') {
      card(x, y, w, [
        { kind: 'pros', text: 'יִתְרוֹנוֹת', at: 1.4 },
        { kind: '+', text: 'מַרְאֶה נָקִי: חָרִיץ אֶחָד בִּלְבַד', at: 2.0 },
        { kind: '+', text: 'נֶפַח פְּנִימִי גָּדוֹל', at: 4.4 },
        { kind: '+', text: 'עֹמֶק אָחִיד עַד הַדְּפָנוֹת', at: 5.4 },
        { kind: 'cons', text: 'חֶסְרוֹנוֹת', at: 6.6 },
        { kind: '-', text: 'קֻפְסָה עֲמֻקָּה בְּכָל שִׁטְחָהּ', at: 7.2 },
        { kind: '-', text: 'יוֹתֵר חֹמֶר', at: 10.0 },
        { kind: '-', text: `מִרְוַח קִנּוּן ${F.data.pitch_mm} מ״מ`, at: 11.0 },
      ], t);
    } else {
      card(x, y, w, [
        { kind: 'pros', text: 'יִתְרוֹנוֹת', at: 13.4 },
        { kind: '+', text: 'צוּרָה רַכָּה וּמְעֻגֶּלֶת', at: 14.0 },
        { kind: '+', text: 'פָּחוֹת חֹמֶר', at: 15.4 },
        { kind: '+', text: 'אֵזוֹר שׁוּלַיִם רָדוּד', at: 16.6 },
        { kind: 'cons', text: 'חֶסְרוֹנוֹת', at: 18.6 },
        { kind: '-', text: 'הַמֶּרְכָּז בּוֹלֵט מֵעַל הַכִּפָּה', at: 19.6 },
        { kind: '-', text: 'הֶחָרִיץ אֵינוֹ הַפְּרָט הַיָּחִיד', at: 21.4 },
        { kind: '-', text: `מִרְוַח קִנּוּן ${D.data.pitch_mm} מ״מ`, at: 23.4 },
      ], t);
    }
  },

  // 8. the third design: a cradle shaped like the hat, closed, turning
  cradleTurn(t) {
    only(C.lo);
    C.lo.sheet.setFold(Math.PI);
    const yaw = keys([[0, -30], [1.6, -30], [4.6, 90], [7.0, 180], [9.0, 205]], t);
    setPose(C.lo, 'standing', { yaw, lift: 0.02 });
    camPose(keys([[0, { target: [0, 0.235, 0], az: 0, el: 8, dist: 1.6 }], [9, { target: [0, 0.225, 0], az: 0, el: 12, dist: 1.4 }]], t));
    title('אֶפְשָׁרוּת 3 · עֲרִיסָה בְּצוּרַת הַכּוֹבַע', inOut(t, 0.4, 8.6, 0.5), 'בְּלִי טַבַּעַת וּבְלִי חָרִיץ', 130);
    pill('מִבַּחוּץ: כִּיס בּוֹלֵט בַּגַּב', W / 2, H - 230 * S, inOut(t, 6.8, 9.0), { size: 30 });
  },

  // 9. section with the hat: the crown in the pocket, the brim on the cradle
  cradleSection(t, d) {
    only(C.hi);
    C.hi.sheet.setFold(Math.PI);
    LIE(C.hi);
    attachHat(C, C.hi);
    setSection(sheetMats, SECTION);
    setHatSection(SECTION);
    scene.updateMatrixWorld(true);
    camPose(mixCam({ target: [0, 0.06, 0.0], az: 90, el: 4, dist: 1.05 }, { target: [0, 0.055, 0.03], az: 90, el: 3, dist: 0.85 }, ease(span(t, 0, d))));
    sectionProfiles(C, C.hi, t, 0.3);
    const at = (y, z) => wc(C.hi, 0, y, z);
    callout(at(YC - AY - 0.006, -0.07), 'כִּיס לַכֶּתֶר', 160, -300, span(t, 1.0, 1.5));
    const yb = YC - AY - 0.03;
    callout(at(yb, C.M.supportZ(0.03)), 'מִשְׁטָח לַשּׁוּלַיִם', -40, -300, span(t, 3.4, 3.9));
  },

  // 10. nesting of the cradle: tight
  cradleNest(t, d) {
    only(...C.up);
    const times = [0, 0.7, 1.3, 1.9, 2.5, 3.1, 3.7, 4.3, 4.9, 5.5];
    const landed = placeStack(C, C.up, 'up', times, t, -1);
    scene.updateMatrixWorld(true);
    const wide = { target: [0, 0.08, -0.02], az: 38, el: 26, dist: 2.0 };
    const side = { target: [0, 0.07, -0.15], az: 90, el: 5, dist: 1.35 };
    camPose(keys([[0, wide], [6.2, wide], [7.8, side], [d, side]], t));
    title('קִנּוּן: פְּתוּחוֹת, הַפָּנִים כְּלַפֵּי מַעְלָה', inOut(t, 0.1, 6.4, 0.5));
    counter(Math.min(landed, 10), span(t, 0.3, 0.8));
    pill(`קִנּוּן הָדוּק: ${C.data.pitch_mm} מ״מ לַיְּחִידָה`, W / 2, 150 * S, span(t, 6.6, 7.1), { size: 32 });
  },

  // 11. pros and cons of the cradle
  cradleCard(t, d) {
    only(C.lo);
    C.lo.sheet.setFold(Math.PI);
    setPose(C.lo, 'standing', { yaw: 180 + 30 * Math.sin((t / d) * Math.PI * 1.2 - 0.3), lift: 0.02 });
    camPose({ target: [-0.36, 0.235, 0], az: 0, el: 6, dist: 1.75 });
    card(90 * S, 150 * S, 860 * S, [
      { kind: 'head', text: 'אֶפְשָׁרוּת 3 · עֲרִיסָה בְּצוּרַת הַכּוֹבַע', at: 0.3 },
      { kind: 'pros', text: 'יִתְרוֹנוֹת', at: 0.8 },
      { kind: '+', text: 'הַשּׁוּלַיִם נִתְמָכִים לְכָל רָחְבָּם', at: 1.6 },
      { kind: '+', text: 'יִצּוּר פָּשׁוּט יוֹתֵר, בְּלִי לַהַב גָּבוֹהַּ', at: 4.0 },
      { kind: '+', text: `קִנּוּן הָדוּק: ${C.data.pitch_mm} מ״מ לַיְּחִידָה`, at: 6.4 },
      { kind: 'cons', text: 'חֶסְרוֹנוֹת', at: 10.0 },
      { kind: '-', text: 'מֻתְאֶמֶת לְמִדַּת כּוֹבַע מְסֻיֶּמֶת', at: 10.8 },
      { kind: '-', text: 'רְגִישָׁה לְצוּרַת הַשּׁוּלַיִם', at: 13.2 },
      { kind: '-', text: 'מִבַּחוּץ רוֹאִים כִּיס בּוֹלֵט', at: 15.6 },
    ], t);
  },

  // 12. the three designs side by side
  end(t, d) {
    only(F.lo, D.lo, C.lo);
    const row = [[F, 0.52], [D, 0], [C, -0.52]];
    for (const [V, x] of row) {
      V.lo.sheet.setFold(Math.PI);
      setPose(V.lo, 'standing', { yaw: 180, x, lift: 0.02 });
    }
    camPose(mixCam({ target: [0, 0.2, 0], az: 0, el: 8, dist: 2.75 }, { target: [0, 0.2, 0], az: 0, el: 6, dist: 2.55 }, ease(span(t, 0, d))));
    scene.updateMatrixWorld(true);
    const names = [
      ['אֶפְשָׁרוּת 1', 'גַּב שָׁטוּחַ'],
      ['אֶפְשָׁרוּת 2', 'גַּב כִּפָּה'],
      ['אֶפְשָׁרוּת 3', 'עֲרִיסָה'],
    ];
    row.forEach(([, x], i) => {
      const [sx] = screen(new THREE.Vector3(x, 0, 0));
      pill(names[i][0], sx, 228 * S, span(t, 0.5 + i * 0.25, 1.0 + i * 0.25), { size: 32, weight: 600 });
      pill(names[i][1], sx, 296 * S, span(t, 0.7 + i * 0.25, 1.2 + i * 0.25), { size: 28 });
    });
    title('כָּל הַבְּדִיקוֹת נַעֲשׂוּ בְּמוֹדֶל – יֵשׁ לְאַמֵּת עַל דֻּגְמָה פִיזִית', span(t, 1.2, 1.8), null, 110);
  },
};

function nest(t, d, V, dir) {
  const stack = dir === 'up' ? V.up : V.down;
  only(...stack);
  const times = NEST_TIMES[dir];
  const landed = placeStack(V, stack, dir, times, t);
  const closeA = times[3] - 0.4;
  const closeB = times[3] + 2.9;
  const section = t > closeA && t < closeB;
  setSection(sheetMats, section ? SECTION : null);
  scene.updateMatrixWorld(true);
  // close-up on the ring entering the groove (tip side of the ring)
  const yRing = YC - AY - V.M.RING.mid;
  const zW = -yRing + HI / 2;
  const hRing = dir === 'up' ? -CASE.zBack - 0.05 + 3 * V.pitch : SHEET_RIB + 0.05 + 3 * V.pitch;
  const wide = { target: [0, 0.14, -0.02], az: dir === 'up' ? 38 : -38, el: 26, dist: 2.45 };
  const close = { target: [0, hRing, zW], az: 90, el: 4, dist: 0.5 };
  const side = { target: [0, 0.12, -0.1], az: 90, el: 4, dist: 1.9 };
  const top = { target: [0, 0.14, -0.02], az: 90, el: 80, dist: 2.5 };
  camPose(
    keys(
      [
        [0, wide],
        [closeA - 0.6, wide],
        [closeA, close],
        [closeB, close],
        [closeB + 0.7, wide],
        [d - 3.0, wide],
        [d - 1.9, side],
        [d - 1.3, side],
        [d - 0.2, top],
        [d, top],
      ],
      t,
    ),
  );
  counter(Math.min(landed, 10), span(t, 0.3, 0.8), V.key === 'flat' ? 'right' : 'left');
}

const COMMON = {
  intro(t) {
    const C02 = 7.2;
    splitFrame(span(t, 0.2, 0.9), (k) => (k === 'flat' ? t > C02 && t < C02 + 3.9 : t > C02 + 3.9 && t < C02 + 8.3));
    title('שְׁתֵּי אֶפְשָׁרֻיּוֹת עִם חָרִיץ צַר', inOut(t, 0.3, 6.8, 0.5), 'אוֹתָהּ טַבַּעַת, שְׁנֵי עִצּוּבִים שֶׁל הַגַּב');
    const lbl = (txt, a, b) => pill(txt, W / 2, 160 * S, inOut(t, a, b), { size: 30 });
    lbl('חֲזִית', 7.0, 8.6);
    lbl('צַד', 10.2, 11.8);
    lbl('גַּב', 13.4, 16.0);
  },
  back(t) {
    splitFrame();
    pill('גַּב – מַבָּט מֵאָחוֹר', W / 2, 160 * S, inOut(t, 0.4, 4.8), { size: 30 });
    pill('מַבָּט מֵהַצַּד: צוּרַת הַגַּב', W / 2, 160 * S, inOut(t, 6.2, 9.8), { size: 30 });
  },
  open(t) {
    splitFrame();
    pill('אוֹתָהּ דֹּפֶן: טַבַּעַת מִבִּפְנִים, חָרִיץ מִבַּחוּץ', W / 2, 160 * S, inOut(t, 5.6, 10.6), { size: 30, accent: 'rgba(255,154,60,0.9)' });
  },
  section(t) {
    splitFrame();
    pill('חֲתָךְ לְאֹרֶךְ הַמֶּרְכָּז', W / 2, 160 * S, inOut(t, 0.3, 2.6), { size: 30 });
  },
  nestUp(t, d) {
    nestCommon(t, d, 'up');
  },
  nestDown(t, d) {
    nestCommon(t, d, 'down');
  },
  cards(t) {
    splitFrame(1, (k) => (k === 'flat' ? t > 0.6 && t < 12.6 : t > 12.8 && t < 24.8));
    dimHalf(0, span(t, 0.8, 1.4) * (1 - span(t, 12.4, 13.0)));
    dimHalf(W / 2, span(t, 12.8, 13.4) * (1 - span(t, 24.6, 25.2)));
    pill('בִּשְׁתֵּיהֶן: חָרִיץ צַר כָּל כָּךְ דּוֹרֵשׁ בְּדִיקַת יַצְרָן', W / 2, 160 * S, span(t, 25.3, 25.9), { size: 32, accent: 'rgba(255,154,60,0.95)' });
  },
};
function nestCommon(t, d, dir) {
  splitFrame();
  const times = NEST_TIMES[dir];
  const closeA = times[3] - 0.4;
  const closeB = times[3] + 2.9;
  if (t > closeA && t < closeB) {
    pill(dir === 'up' ? 'הַטַּבַּעַת שֶׁל הַתַּחְתּוֹנָה נִכְנֶסֶת לֶחָרִיץ שֶׁל הָעֶלְיוֹנָה' : 'הַטַּבַּעַת שֶׁל הָעֶלְיוֹנָה נִכְנֶסֶת לֶחָרִיץ שֶׁל הַתַּחְתּוֹנָה', W / 2, 170 * S, inOut(t, closeA + 0.2, closeB), { size: 30 });
  }
  if (t > d - 3.0) pill(`מִרְוַח קִנּוּן: ${F.data.pitch_mm} מ״מ לַיְּחִידָה`, W / 2, 170 * S, span(t, d - 2.9, d - 2.4), { size: 30 });
  title(dir === 'up' ? 'קִנּוּן: פְּתוּחוֹת, הַפָּנִים כְּלַפֵּי מַעְלָה' : 'קִנּוּן: פְּתוּחוֹת וַהֲפוּכוֹת', inOut(t, 0.1, closeA, 0.5) + inOut(t, closeB, d - 2.9, 0.5), null, 170);
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------

for (const wgt of [400, 500, 600]) await document.fonts.load(`${wgt} ${Math.round(40 * S)}px Heebo`, 'שְׁתֵּי אֶפְשָׁרֻיּוֹת 0.8 ס״מ');

function renderShot(i, t, draw3d = true) {
  const shot = SHOTS[i];
  const d = shot.duration;
  g.clearRect(0, 0, W, H);
  if (shot.split) {
    renderer.setScissorTest(true);
    for (const [V, x] of SIDES) {
      view = { x, w: W / 2 };
      camera.aspect = W / 2 / H;
      g.save();
      g.beginPath();
      g.rect(x, 0, W / 2, H);
      g.clip();
      SHOT[shot.id](t, d, V);
      g.restore();
      scene.updateMatrixWorld(true);
      if (draw3d) {
        renderer.setViewport(x, 0, W / 2, H);
        renderer.setScissor(x, 0, W / 2, H);
        renderer.render(scene, camera);
      }
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    view = { x: 0, w: W };
    camera.aspect = W / H;
    COMMON[shot.id]?.(t, d);
  } else {
    view = { x: 0, w: W };
    camera.aspect = W / H;
    SHOT[shot.id](t, d);
    scene.updateMatrixWorld(true);
    if (draw3d) renderer.render(scene, camera);
  }
  subtitles(starts[i] + t);
}

// clean 3D frame (JPEG) and the caption layer (PNG with alpha)
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
  phiRest: PHI_REST,
  grooves: { flat: F.groove.width, dome: D.groove.width },
};
