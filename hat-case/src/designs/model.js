// Design variants of the plastic case (comparison film). Copy of
// src/plastic/sheetModel.js with a different base: see params.js.
//
// Thin-sheet plastic hat case: one continuous formed sheet.
//
// The inside surface of the sheet is a height field over the flat sheet
// (as formed, open 180 deg, inside up): every part of the case (rim flange,
// side walls, floor, the ring, the closing rib and channel, the handle tabs,
// the fold strip) is one function z = I(x, y) per half. A height field has
// no undercuts, which is what lets the sheet be formed on one tool and lets
// identical sheets nest. The outside surface is the inside surface moved by
// the sheet thickness along its normal, so the wall is the same everywhere.
//
// Pure model code (geometry and checks); materials live in sheetMaterials.js.

import * as THREE from 'three';
import { CASE_PARAMS } from '../caseParams.js';
import { buildReliefLines, reliefHeight } from '../caseModel.js';
// the variant's parameters (same query as this module, see params.js)
const { PLASTIC: P, VARIANT } = await import('./params.js' + new URL(import.meta.url).search);
export { VARIANT };

const T = P.thickness;
const B = P.base;
const LD = P.lid;
const FL = P.flange;
const HD = P.handle;
const HI = P.inner.height;
const YC = P.hatCenterY;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
// polynomial smooth minimum / maximum (k = blend size, in the units of a and b)
export const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};
export const smax = (a, b, k) => -smin(-a, -b, k);

// ---------------------------------------------------------------------------
// Rim outline: signed distance (exact, the outline is made of arcs and lines)
// ---------------------------------------------------------------------------

function outlinePieces(p) {
  const W2 = p.width / 2;
  const H = p.height;
  const sb = p.topBulge;
  const Rtop = (W2 * W2 + sb * sb) / (2 * sb);
  const Rc = p.topCornerRadius;
  const Ra = p.sideArcRadius;
  const Rt = p.tipRadius;
  const ctop = [0, H - Rtop];
  const ccor = [W2 - Rc, H - Rtop + Math.sqrt((Rtop - Rc) ** 2 - (W2 - Rc) ** 2)];
  const ys = Rt + Math.sqrt((Ra - Rt) ** 2 - (W2 - Ra) ** 2);
  const cside = [W2 - Ra, ys];
  const ctip = [0, Rt];
  const a1 = Math.atan2(ccor[1] - ctop[1], ccor[0] - ctop[0]);
  const a2 = Math.atan2(ctip[1] - cside[1], ctip[0] - cside[0]);
  return [
    { c: ctop, r: Rtop, a: Math.min(a1, Math.PI / 2), b: Math.max(a1, Math.PI / 2) },
    { c: ccor, r: Rc, a: 0, b: a1 },
    { line: true, x: W2, y0: ys, y1: ccor[1] },
    { c: cside, r: Ra, a: a2, b: 0 },
    { c: ctip, r: Rt, a: -Math.PI / 2, b: a2 },
  ];
}
const PIECES = outlinePieces(P.inner);

// Inward distance from the rim outline: > 0 inside, < 0 outside
export function rimDistance(x, y) {
  const ax = Math.abs(x);
  let best = Infinity;
  let sign = 1;
  for (const pc of PIECES) {
    let qx;
    let qy;
    let nx;
    let ny;
    if (pc.line) {
      qx = pc.x;
      qy = Math.min(Math.max(y, pc.y0), pc.y1);
      nx = 1;
      ny = 0;
    } else {
      let ang = Math.atan2(y - pc.c[1], ax - pc.c[0]);
      ang = Math.min(Math.max(ang, pc.a), pc.b);
      nx = Math.cos(ang);
      ny = Math.sin(ang);
      qx = pc.c[0] + pc.r * nx;
      qy = pc.c[1] + pc.r * ny;
    }
    const dx = ax - qx;
    const dy = y - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      sign = dx * nx + dy * ny > 0 ? -1 : 1;
    }
  }
  return sign * Math.sqrt(best);
}

// ---------------------------------------------------------------------------
// Crown ovals: d = how far a point is outward from the crown's outside oval,
// in the same family of ovals as the hat model (semi-axes grow by d).
// ---------------------------------------------------------------------------

const AX = P.crown.x; // across the case
const AY = P.crown.z; // along the case
export function ovalOffset(x, y) {
  const u = x;
  const v = y - YC;
  const lo0 = -Math.min(AX, AY) + 1e-7;
  // f(d) = u^2/(AX+d)^2 + v^2/(AY+d)^2 - 1 decreases with d: plain bisection (robust everywhere)
  const f = (d) => (u * u) / ((AX + d) * (AX + d)) + (v * v) / ((AY + d) * (AY + d)) - 1;
  if (f(lo0) <= 0) return lo0;
  let lo = lo0;
  let hi = 1;
  for (let i = 0; i < 56; i++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Ring profile z(d): floor of the crown cavity -> inner face -> rounded top
// -> outer face (straight lines joined by round fillets)
// ---------------------------------------------------------------------------

function filletPath(points, radii, seg = 24) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const r = radii[i] || 0;
    const u = norm2(sub2(p, points[i - 1]));
    const v = norm2(sub2(points[i + 1], p));
    const turn = Math.acos(Math.min(Math.max(u[0] * v[0] + u[1] * v[1], -1), 1));
    if (r <= 0 || turn < 1e-6) {
      out.push(p);
      continue;
    }
    const l = r * Math.tan(turn / 2);
    const t1 = [p[0] - u[0] * l, p[1] - u[1] * l];
    const cross = u[0] * v[1] - u[1] * v[0];
    const n = cross > 0 ? [-u[1], u[0]] : [u[1], -u[0]]; // toward the inside of the turn
    const c = [t1[0] + n[0] * r, t1[1] + n[1] * r];
    const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    const sgn = cross > 0 ? 1 : -1;
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (sgn * turn * k) / seg;
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const norm2 = (a) => {
  const l = Math.hypot(a[0], a[1]);
  return [a[0] / l, a[1] / l];
};

const tanI = Math.tan(B.ringInnerDraft);
const tanO = Math.tan(B.ringOuterDraft);
const ZC = B.ringTop - B.cavityDepth; // floor of the crown cavity at the center (inside)
const Z_DEEP = -0.3; // the ring's faces are drawn this deep; the floor cuts them (see ringOnFloor)
const ZR = B.ringTop - B.ringHeight; // root of the ring (outer side)
export const RING = {
  innerTop: B.ringInnerAtTop,
  outerTop: B.ringOuterAtTop,
  innerBottom: B.ringInnerAtTop + (ZC - B.ringTop) * tanI, // where the inner face meets the (center) floor
  root: B.ringOuterAtTop + (B.ringTop - ZR) * tanO, // where the outer face meets the (center) floor
  mid: (B.ringInnerAtTop + B.ringOuterAtTop) / 2,
  zTop: B.ringTop,
  zFloor: ZC,
  zRoot: ZR,
};
const ringPath = filletPath(
  [
    [B.ringInnerAtTop + Z_DEEP * tanI - 0.001, Z_DEEP - 0.001 / tanI],
    [B.ringInnerAtTop, B.ringTop],
    [B.ringOuterAtTop, B.ringTop],
    [B.ringOuterAtTop - Z_DEEP * tanO + 0.001, Z_DEEP - 0.001 / tanO],
  ],
  [0, B.ringTopRadius, B.ringTopRadius, 0],
  40,
);
RING.path = ringPath;
// resample z(d) on a fine table (d is monotonic along the path)
const RT = (() => {
  const d0 = B.ringInnerAtTop + Z_DEEP * tanI;
  const d1 = B.ringOuterAtTop - Z_DEEP * tanO;
  const step = 0.000005;
  const n = Math.round((d1 - d0) / step) + 1;
  const z = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = d0 + i * step;
    while (j < ringPath.length - 2 && ringPath[j + 1][0] < d) j++;
    const [xa, za] = ringPath[j];
    const [xb, zb] = ringPath[j + 1];
    const t = xb > xa ? Math.min(Math.max((d - xa) / (xb - xa), 0), 1) : 0;
    z[i] = za + (zb - za) * t;
  }
  return { d0, step, n, z };
})();
// faces and rounded top only (the faces go on down to Z_DEEP)
function ringFaces(d) {
  const f = (d - RT.d0) / RT.step;
  if (f <= 0) return Z_DEEP;
  if (f >= RT.n - 1) return Z_DEEP;
  const i = Math.floor(f);
  return RT.z[i] + (RT.z[i + 1] - RT.z[i]) * (f - i);
}

// The ring standing on a floor at level F (exact round fillets of radius r at
// both feet; F is taken at the point itself, so a floor that changes slowly
// gives a smooth surface)
function ringOnFloor(d, F) {
  const r = B.rootRadius;
  if (d < RING.mid) {
    const a = B.ringInnerDraft;
    const dc = B.ringInnerAtTop + (F - B.ringTop) * tanI; // virtual corner
    const l = r * Math.tan((Math.PI / 2 - a) / 2);
    const t1 = dc + l * Math.sin(a);
    const t2 = dc - l;
    if (d <= t2) return F;
    if (d < t1) {
      const c = dc - l;
      return F + r - Math.sqrt(Math.max(r * r - (d - c) ** 2, 0));
    }
    return Math.max(ringFaces(d), F);
  }
  const a = B.ringOuterDraft;
  const dc = B.ringOuterAtTop - (F - B.ringTop) * tanO;
  const l = r * Math.tan((Math.PI / 2 - a) / 2);
  const t1 = dc - l * Math.sin(a);
  const t2 = dc + l;
  if (d >= t2) return F;
  if (d > t1) {
    const c = dc + l;
    return F + r - Math.sqrt(Math.max(r * r - (d - c) ** 2, 0));
  }
  return Math.max(ringFaces(d), F);
}
export function ringZ(d) {
  return ringOnFloor(d, ZC); // on the center floor (used for the hat's support)
}

// Cradle variant: pocket for the crown, and a surface just under the brim
const HAT_BRIM = (() => {
  // brim underside of the hat model (resting with the crown base at z = 0), from openCaseModel buildHat
  const fillet = 0.006;
  const edgeD = 0.06 - 0.004 / 2;
  const curl = (d) => -0.016 * (Math.max(d - fillet, 0) / (edgeD - fillet)) ** 2;
  return (d) => (d < fillet ? -fillet + Math.sqrt(Math.max(fillet * fillet - (d - fillet) ** 2, 0)) : curl(d));
})();
const POCKET_TOP = B.ringInnerAtTop; // pocket wall at the crown base (clearance to the crown)
function cradleZ(d) {
  const brimEdge = 0.058;
  if (d <= brimEdge) return HAT_BRIM(Math.max(d, 0)) - B.cradleGap;
  // past the brim's edge: keep falling gently toward the side wall
  const z0 = HAT_BRIM(brimEdge) - B.cradleGap;
  const s0 = (HAT_BRIM(brimEdge) - HAT_BRIM(brimEdge - 0.0005)) / 0.0005;
  const zz = z0 + s0 * (d - brimEdge);
  return Math.max(zz, -B.cradleEdgeDepth);
}
function pocketZ(d) {
  // pocket wall (leans inward going down) meeting the cradle at its top edge, and the crown floor
  const tanP = Math.tan(B.pocketDraft);
  const wall = (d - POCKET_TOP) / tanP; // z on the wall line at oval offset d
  const top = smin(cradleZ(d), wall, B.pocketEdgeBlend);
  return smax(top, ZC, B.cavityFloorRadius);
}

// The variant's floor at (x, y) for the two ring variants
function floorAt(x, y) {
  if (VARIANT === 'dome') {
    const yy = y - YC;
    const r = Math.hypot(x / (P.inner.width / 2), yy / (yy > 0 ? DESIGN_TOP : DESIGN_TIP));
    return ZC + (B.edgeDepth + ZC) * -smoothstep(B.domeFlat, 1.0, r);
  }
  return ZC; // flat back at full depth
}
const DESIGN_TOP = P.inner.height - YC; // hat center to the inside top edge
const DESIGN_TIP = YC; // hat center to the tip

// profile used to place mesh samples across the ring / pocket (same on every ray)
export function profileZ(d) {
  return VARIANT === 'cradle' ? pocketZ(d) : ringOnFloor(d, ZC);
}
// what the brim rests on (for placing the hat)
export function supportZ(d) {
  return VARIANT === 'cradle' ? cradleZ(d) : ringZ(d);
}

// ---------------------------------------------------------------------------
// Inside surface of each half (outline coordinates, z = 0 rim plane)
// ---------------------------------------------------------------------------

// Closing rib (base) and channel (lid) across the flange; e = rim distance
function rib(e) {
  const a = Math.abs(e - FL.ribCenter);
  return FL.ribHeight * (1 - smoothstep(FL.ribTopHalf, FL.ribHalfWidth, a));
}
function channel(e) {
  const a = Math.abs(e - FL.ribCenter);
  return -FL.channelDepth * (1 - smoothstep(FL.channelTopHalf, FL.channelHalfWidth, a));
}
// Fold strip: the tabs step down to it near the fold line
const yStep0 = P.foldY - P.fold.stepFrom;
const yStep1 = P.foldY - P.fold.stepTo;
const foldStep = (y) => -P.fold.drop * smoothstep(yStep0, yStep1, y);

function shellWall(e, draft) {
  return -e / Math.tan(draft);
}

export function baseInside(x, y, info = null) {
  const e = rimDistance(x, y);
  const d = ovalOffset(x, y);
  if (info) {
    info.e = e;
    info.d = d;
  }
  if (VARIANT === 'cradle') {
    const inner = pocketZ(d);
    const basin = smax(inner, shellWall(e, B.wallDraft), B.wallBottomBlend);
    return smin(rib(e), basin, B.rimBlend) + foldStep(y);
  }
  const F = floorAt(x, y);
  const basin = smax(F, shellWall(e, B.wallDraft), B.wallBottomBlend);
  const rim = smin(rib(e), basin, B.rimBlend);
  return Math.max(ringOnFloor(d, F), rim) + foldStep(y);
}

// Relief lines of the approved front, sampled once on a grid (lid only)
const RELIEF = (() => {
  const params = { body: { width: P.inner.width, height: P.inner.height }, frontRelief: CASE_PARAMS.frontRelief };
  const lines = buildReliefLines(params);
  const x0 = -0.16;
  const y0 = -0.01;
  const step = 0.001;
  const nx = 321;
  const ny = 401;
  const h = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = reliefHeight(lines, CASE_PARAMS.frontRelief, x0 + i * step, y0 + j * step);
  return (x, y) => {
    const fx = Math.min(Math.max((x - x0) / step, 0), nx - 1.001);
    const fy = Math.min(Math.max((y - y0) / step, 0), ny - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const a = h[j * nx + i] + (h[j * nx + i + 1] - h[j * nx + i]) * tx;
    const b = h[(j + 1) * nx + i] + (h[(j + 1) * nx + i + 1] - h[(j + 1) * nx + i]) * tx;
    return a + (b - a) * ty;
  };
})();

export function lidInside(x, y, info = null) {
  const e = rimDistance(x, y);
  if (info) {
    info.e = e;
    info.d = ovalOffset(x, y);
  }
  const w = Math.min(Math.max(e, 0) / LD.domeReach, 1);
  const dome = 1 - (1 - w) * (1 - w);
  const fade = smoothstep(LD.reliefFade[0], LD.reliefFade[1], e);
  // relief stands outward (toward the outside of the lid = -Z when open)
  const depth = -(LD.edgeDepth + LD.dome * dome) - RELIEF(x, y) * LD.reliefScale * fade;
  const basin = smax(depth, shellWall(e, LD.wallDraft), LD.wallBottomBlend);
  return smin(channel(e), basin, LD.rimBlend) + foldStep(y);
}

// ---------------------------------------------------------------------------
// Trim outline (cut edge) of one half and the finger hole
// ---------------------------------------------------------------------------

const yTabTop = P.foldY - P.foldWidth / 2; // top edge of the handle tab = start of the fold strip
// tapered tab (convex), counter-clockwise; its bottom is hidden in the flange
const TAB = [
  [-HD.bottomWidth / 2, HI - 0.012],
  [HD.bottomWidth / 2, HI - 0.012],
  [HD.topWidth / 2, yTabTop],
  [-HD.topWidth / 2, yTabTop],
];
// signed distance to a convex polygon (exact on the edges, sharp corners)
function convexSDF(poly, x, y) {
  let m = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ey = by - ay;
    const l = Math.hypot(ex, ey);
    // outward normal for a counter-clockwise polygon
    m = Math.max(m, ((x - ax) * ey - (y - ay) * ex) / l);
  }
  return m;
}
export function trimSDF(x, y) {
  const flange = -rimDistance(x, y) - FL.width;
  const tab = convexSDF(TAB, x, y);
  return smin(flange, tab, HD.joinBlend);
}
const HOLE = { y: HI + HD.hole.centerAbove, l: HD.hole.halfLength, r: HD.hole.radius };
export function holeSDF(x, y) {
  const qx = Math.max(Math.abs(x) - HOLE.l, 0);
  return Math.hypot(qx, y - HOLE.y) - HOLE.r;
}

// ---------------------------------------------------------------------------
// Surface mesh of one half: rays from the hat center out to the trim
// ---------------------------------------------------------------------------

const ORIGIN = [0, YC];
const RAY_MAX = 0.45;

function boundaryRadius(sdf, th) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  let lo = 0;
  let hi = RAY_MAX;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) / 2;
    if (sdf(ORIGIN[0] + c * m, ORIGIN[1] + s * m) < 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

// Ray directions: denser where the trim outline turns quickly (handle tab)
function rayAngles(sdf, count, corners) {
  const n = 4096;
  const R = [];
  for (let i = 0; i < n; i++) R.push(boundaryRadius(sdf, (i / n) * Math.PI * 2 - Math.PI / 2));
  const w = [];
  for (let i = 0; i < n; i++) {
    const dl = Math.abs(Math.log(R[(i + 1) % n]) - Math.log(R[(i + n - 1) % n])) / ((2 * 2 * Math.PI) / n);
    w.push(1 + 2.5 * Math.min(dl, 6));
  }
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + w[i]);
  const total = cum[n];
  const out = [];
  let i = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (cum[i + 1] < target) i++;
    const f = (target - cum[i]) / (cum[i + 1] - cum[i]);
    out.push(((i + f) / n) * Math.PI * 2 - Math.PI / 2);
  }
  // make rays pass exactly through sharp corners of the trim
  for (const [cx, cy] of corners) {
    let a = Math.atan2(cy - ORIGIN[1], cx - ORIGIN[0]);
    if (a < -Math.PI / 2) a += Math.PI * 2;
    let best = 0;
    for (let k = 1; k < count; k++) if (Math.abs(out[k] - a) < Math.abs(out[best] - a)) best = k;
    out[best] = a;
  }
  return out;
}

// Oval levels across the ring / pocket: evenly spaced along the profile
// (arc length + curvature), the same on every ray so the steep faces mesh cleanly
const levelCache = new Map();
function RING_LEVELS(n) {
  if (levelCache.has(n)) return levelCache.get(n);
  const d0 = -0.08;
  const d1 = 0.042;
  const N = 12000;
  const ds = [];
  const w = [0];
  let prevA = null;
  for (let i = 0; i <= N; i++) {
    const d = d0 + ((d1 - d0) * i) / N;
    ds.push(d);
    if (i) {
      const dz = profileZ(d) - profileZ(ds[i - 1]);
      const dd = d - ds[i - 1];
      const a = Math.atan2(dz, dd);
      const curv = prevA === null ? 0 : Math.abs(a - prevA);
      prevA = a;
      w.push(w[i - 1] + Math.hypot(dd, dz) + curv * 0.004);
    }
  }
  const out = [];
  let j = 0;
  for (let m = 1; m <= n; m++) {
    const t = (w[N] * m) / n;
    while (j < N - 1 && w[j + 1] < t) j++;
    const f = (t - w[j]) / (w[j + 1] - w[j] || 1);
    out.push(ds[j] + (ds[j + 1] - ds[j]) * f);
  }
  levelCache.set(n, out);
  return out;
}

// Segment index along a ray (non-decreasing outward); counts per segment
const SEGMENT_EDGES = { base: { d: 0.042, e: 0.016 }, lid: { d: Infinity, e: 0.016 }, eFlange: -FL.width - 0.0003, eDome: 0.045 };

function sampleRay(fn, kind, th, R, counts, curvGain) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const step = 0.00025;
  const n = Math.max(Math.ceil(R / step), 8);
  const rs = [];
  const zs = [];
  const seg = [];
  const info = {};
  const edges = SEGMENT_EDGES[kind];
  for (let i = 0; i <= n; i++) {
    const r = (R * i) / n;
    const x = ORIGIN[0] + c * r;
    const y = ORIGIN[1] + s * r;
    zs.push(fn(x, y, info));
    rs.push(r);
    let k;
    if (kind === 'base') k = (info.d >= edges.d ? 1 : 0) + (info.e <= edges.e ? 1 : 0) + (info.e <= SEGMENT_EDGES.eFlange ? 1 : 0);
    else k = (info.e <= SEGMENT_EDGES.eDome ? 1 : 0) + (info.e <= edges.e ? 1 : 0) + (info.e <= SEGMENT_EDGES.eFlange ? 1 : 0);
    seg.push(k);
  }
  for (let i = 1; i <= n; i++) seg[i] = Math.max(seg[i], seg[i - 1]);
  // weighted arc length: steep and curved parts get more samples
  const wcum = [0];
  for (let i = 1; i <= n; i++) {
    const dr = rs[i] - rs[i - 1];
    const dz = zs[i] - zs[i - 1];
    let curv = 0;
    if (i < n) {
      const s1 = (zs[i] - zs[i - 1]) / dr;
      const s2 = (zs[i + 1] - zs[i]) / dr;
      curv = Math.abs(Math.atan(s2) - Math.atan(s1)) / dr;
    }
    wcum.push(wcum[i - 1] + Math.hypot(dr, dz) * (1 + curvGain * curv));
  }
  // segment k covers dense samples [edge[k], edge[k + 1]]
  const edge = [0];
  for (let k = 1; k < 4; k++) {
    const f = seg.findIndex((v) => v >= k);
    edge.push(f < 0 ? n : Math.max(f, edge[k - 1]));
  }
  edge.push(n);
  const out = [];
  if (kind === 'base') {
    // segment 0: the same oval levels d on every ray
    for (const dT of RING_LEVELS(counts[0])) {
      let lo = 0;
      let hi = rs[edge[1]] || R;
      for (let it = 0; it < 40; it++) {
        const m = (lo + hi) / 2;
        if (ovalOffset(ORIGIN[0] + c * m, ORIGIN[1] + s * m) < dT) lo = m;
        else hi = m;
      }
      out.push((lo + hi) / 2);
    }
  }
  for (let k = kind === 'base' ? 1 : 0; k < 4; k++) {
    const i0 = edge[k];
    const i1 = edge[k + 1];
    const w0 = wcum[i0];
    const w1 = wcum[i1];
    let j = i0;
    for (let m = 1; m <= counts[k]; m++) {
      if (i1 <= i0) {
        out.push(rs[i0]);
        continue;
      }
      const target = w0 + ((w1 - w0) * m) / counts[k];
      while (j < i1 - 1 && wcum[j + 1] < target) j++;
      const span = wcum[j + 1] - wcum[j];
      const f = span > 0 ? Math.min(Math.max((target - wcum[j]) / span, 0), 1) : 1;
      out.push(rs[j] + (rs[j + 1] - rs[j]) * f);
    }
  }
  out[out.length - 1] = R; // last sample exactly on the trim
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1]);
  return out;
}

export const LOD = {
  high: { rays: 720, counts: [240, 26, 70, 22], curvGain: 0.03 },
  mid: { rays: 480, counts: [150, 18, 46, 14], curvGain: 0.02 },
  low: { rays: 340, counts: [110, 12, 34, 12], curvGain: 0.02 },
  stack: { rays: 240, counts: [80, 9, 26, 9], curvGain: 0.02 },
  tiny: { rays: 160, counts: [34, 7, 20, 7], curvGain: 0.012 },
};

const halfCache = new Map();

// One half (kind 'base' | 'lid') as a ray grid in outline coordinates.
// Sheet before trimming (formed blank): a rectangle per half, up to the fold line
export const BLANK = { x: 0.2, y0: -0.035 };
export function blankSDF(x, y) {
  return Math.max(Math.abs(x) - BLANK.x, BLANK.y0 - y, y - P.foldY);
}

function buildHalfGrid(kind, lod, blank = false) {
  const key = kind + lod + (blank ? 'blank' : '');
  if (halfCache.has(key)) return halfCache.get(key);
  const L = LOD[lod];
  const fn = kind === 'base' ? baseInside : lidInside;
  const sdf = blank ? blankSDF : trimSDF;
  const corners = blank
    ? [[BLANK.x, P.foldY], [-BLANK.x, P.foldY], [BLANK.x, BLANK.y0], [-BLANK.x, BLANK.y0]]
    : [
        [HD.topWidth / 2, yTabTop],
        [-HD.topWidth / 2, yTabTop],
      ];
  const angles = rayAngles(sdf, L.rays, corners);
  const nr = L.counts.reduce((a, b) => a + b, 0);
  const N = angles.length;
  const xs = new Float64Array(N * nr);
  const ys = new Float64Array(N * nr);
  const zs = new Float64Array(N * nr);
  for (let k = 0; k < N; k++) {
    const th = angles[k];
    const R = boundaryRadius(sdf, th);
    const radii = sampleRay(fn, kind, th, R, L.counts, L.curvGain);
    for (let j = 0; j < nr; j++) {
      const x = ORIGIN[0] + Math.cos(th) * radii[j];
      const y = ORIGIN[1] + Math.sin(th) * radii[j];
      xs[k * nr + j] = x;
      ys[k * nr + j] = y;
      zs[k * nr + j] = fn(x, y);
    }
  }
  const grid = { kind, angles, N, nr, xs, ys, zs, center: [ORIGIN[0], ORIGIN[1], fn(ORIGIN[0], ORIGIN[1])] };
  halfCache.set(key, grid);
  return grid;
}

// Map outline coordinates to sheet coordinates
const toSheetY = (kind, y) => (kind === 'base' ? y - P.foldY : P.foldY - y);

// ---------------------------------------------------------------------------
// Logo placement (texture coordinates for the shallow emboss)
// ---------------------------------------------------------------------------

export const LOGO_ASPECT = 672 / 544; // height / width of assets/logo-emboss.png
// Area covered by each emboss texture (meters). The back texture is drawn in
// sheetMaterials.js: the logo inside a shield-shaped frame, as in the photo.
export const LOGO = {
  // back of the base: centered on the crown floor; reads from outside with the case standing
  base: { cx: 0, cy: YC, w: 0.1, aspect: 1.25, flipU: true, flipV: false },
  // inside of the lid: reads from inside with the lid open (top of the logo toward the lid's tip)
  lid: { cx: 0, cy: HI - P.logo.lid.centerFromTop, w: P.logo.lid.width, aspect: LOGO_ASPECT, flipU: false, flipV: true },
};
function logoUV(kind, x, y) {
  const L = LOGO[kind];
  const h = L.w * L.aspect;
  let u = (x - L.cx) / L.w;
  let v = (y - L.cy) / h;
  if (L.flipU) u = -u;
  if (L.flipV) v = -v;
  return [0.5 + u, 0.5 + v];
}

// ---------------------------------------------------------------------------
// Geometry of one half: inside surface, outside surface and the cut edge
// ---------------------------------------------------------------------------

function ringZone(d) {
  return smoothstep(RING.innerBottom - 0.012, RING.innerBottom - 0.006, d) * (1 - smoothstep(RING.root + 0.002, RING.root + 0.008, d));
}

function halfGeometries(kind, lod, blank = false) {
  const G = buildHalfGrid(kind, lod, blank);
  const { N, nr } = G;
  const count = 1 + N * nr;
  const pos = new Float32Array(count * 3);
  const rest = new Float32Array(count * 2);
  const uv = new Float32Array(count * 2);
  const zone = new Float32Array(count);
  const flexW = new Float32Array(count);
  const put = (i, x, y, z) => {
    pos[i * 3] = x;
    pos[i * 3 + 1] = toSheetY(kind, y);
    pos[i * 3 + 2] = z;
    rest[i * 2] = x;
    rest[i * 2 + 1] = y;
    const [u, v] = logoUV(kind, x, y);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
    const e = rimDistance(x, y);
    zone[i] = kind === 'base' ? ringZone(ovalOffset(x, y)) : 0;
    flexW[i] = 1 - smoothstep(0.0005, 0.005, Math.abs(e - FL.ribCenter));
  };
  put(0, ...G.center);
  for (let k = 0; k < N; k++) for (let j = 0; j < nr; j++) put(1 + k * nr + j, G.xs[k * nr + j], G.ys[k * nr + j], G.zs[k * nr + j]);
  const at = (k, j) => 1 + (k % N) * nr + j;
  const idx = [];
  for (let k = 0; k < N; k++) idx.push(0, at(k, 0), at(k + 1, 0));
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < nr - 1; j++) {
      const a = at(k, j);
      const b = at(k + 1, j);
      const c = at(k + 1, j + 1);
      const d = at(k, j + 1);
      idx.push(a, c, b, a, d, c);
    }
  }
  // the lid is mirrored (Y = foldY - y): flip the winding so the inside faces +Z
  if (kind === 'lid') for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];

  const inside = new THREE.BufferGeometry();
  inside.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  inside.setAttribute('rest', new THREE.BufferAttribute(rest, 2));
  inside.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  inside.setAttribute('zone', new THREE.BufferAttribute(zone, 1));
  inside.setAttribute('flexW', new THREE.BufferAttribute(flexW, 1));
  inside.setIndex(idx);
  inside.computeVertexNormals();
  // empty segments put several samples on one point: give those the normal of the point before
  const nrm = inside.attributes.normal;
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < nr; j++) {
      const i = at(k, j);
      if (Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) < 0.5) {
        const p = j > 0 ? at(k, j - 1) : 0;
        nrm.setXYZ(i, nrm.getX(p), nrm.getY(p), nrm.getZ(p));
      }
    }
  }
  // where samples coincide, use one normal for all of them (keeps the outside offset continuous)
  for (let k = 0; k < N; k++) {
    for (let j = nr - 2; j >= 0; j--) {
      const i = at(k, j);
      const q = at(k, j + 1);
      if (Math.abs(pos[i * 3] - pos[q * 3]) + Math.abs(pos[i * 3 + 1] - pos[q * 3 + 1]) < 1e-9) nrm.setXYZ(i, nrm.getX(q), nrm.getY(q), nrm.getZ(q));
    }
  }

  // outside surface: moved by the thickness along the normal, reversed winding
  const outside = inside.clone();
  const op = outside.attributes.position;
  for (let i = 0; i < count; i++) op.setXYZ(i, pos[i * 3] - nrm.getX(i) * T, pos[i * 3 + 1] - nrm.getY(i) * T, pos[i * 3 + 2] - nrm.getZ(i) * T);
  const oidx = outside.index.array;
  for (let i = 0; i < oidx.length; i += 3) [oidx[i + 1], oidx[i + 2]] = [oidx[i + 2], oidx[i + 1]];
  outside.index.needsUpdate = true;
  outside.computeVertexNormals();
  const onrm = outside.attributes.normal;
  for (let i = 0; i < count; i++) onrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));

  // cut edge along the trim (not where the fold strip continues the sheet)
  const onFold = (k) => {
    const x = G.xs[k * nr + nr - 1];
    const y = G.ys[k * nr + nr - 1];
    if (blank) return Math.abs(y - P.foldY) < 1e-6; // the two halves of the blank meet at the fold line
    return Math.abs(y - yTabTop) < 1e-6 && Math.abs(x) <= HD.topWidth / 2 + 1e-6;
  };
  const rimPos = [];
  const rimNrm = [];
  const rimRest = [];
  const rimIdx = [];
  const foldCols = [];
  for (let k = 0; k < N; k++) if (onFold(k)) foldCols.push({ k, x: G.xs[k * nr + nr - 1], i: at(k, nr - 1) });
  for (let k = 0; k < N; k++) {
    const k2 = (k + 1) % N;
    if (onFold(k) && onFold(k2)) continue;
    const ia = at(k, nr - 1);
    const ib = at(k2, nr - 1);
    const base = rimPos.length / 3;
    for (const i of [ia, ib]) {
      rimPos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      rimPos.push(op.getX(i), op.getY(i), op.getZ(i));
      rimRest.push(rest[i * 2], rest[i * 2 + 1], rest[i * 2], rest[i * 2 + 1]);
    }
    // outward normal of the cut, from the trim distance field
    for (const i of [ia, ib]) {
      const x = rest[i * 2];
      const y = rest[i * 2 + 1];
      const h = 1e-5;
      const f = blank ? blankSDF : trimSDF;
      let gx = (f(x + h, y) - f(x - h, y)) / (2 * h);
      let gy = (f(x, y + h) - f(x, y - h)) / (2 * h);
      const l = Math.hypot(gx, gy) || 1;
      gx /= l;
      gy /= l;
      const sy = kind === 'base' ? gy : -gy;
      rimNrm.push(gx, sy, 0, gx, sy, 0);
    }
    // a: inside top, b: outside top (point ia); c, d: point ib
    rimIdx.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
  rim.setAttribute('normal', new THREE.Float32BufferAttribute(rimNrm, 3));
  rim.setAttribute('rest', new THREE.Float32BufferAttribute(rimRest, 2));
  rim.setIndex(rimIdx);
  orientByNormals(rim);
  foldCols.sort((a, b) => a.x - b.x);
  return { inside, outside, rim, foldCols, grid: G };
}

// make each triangle's winding agree with its vertex normals
function orientByNormals(geo) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const idx = geo.index.array;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]);
    b.fromBufferAttribute(p, idx[i + 1]);
    c.fromBufferAttribute(p, idx[i + 2]);
    const f = b.sub(a).cross(c.sub(a));
    const nn = new THREE.Vector3().fromBufferAttribute(n, idx[i]);
    if (f.dot(nn) < 0) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  }
}

// ---------------------------------------------------------------------------
// Finger hole edge (cut) and the fold strip
// ---------------------------------------------------------------------------

function holeRim(kind) {
  const pos = [];
  const nrm = [];
  const rest = [];
  const idx = [];
  const n = 160;
  const pts = [];
  // stadium outline, counter-clockwise
  const { l, r, y: yh } = HOLE;
  const per = 4 * l + 2 * Math.PI * r;
  for (let i = 0; i < n; i++) {
    let s = (i / n) * per;
    let x;
    let y;
    let nx;
    let ny;
    if (s < 2 * l) {
      x = -l + s;
      y = yh - r;
      nx = 0;
      ny = -1;
    } else if ((s -= 2 * l) < Math.PI * r) {
      const a = -Math.PI / 2 + s / r;
      x = l + r * Math.cos(a);
      y = yh + r * Math.sin(a);
      nx = Math.cos(a);
      ny = Math.sin(a);
    } else if ((s -= Math.PI * r) < 2 * l) {
      x = l - s;
      y = yh + r;
      nx = 0;
      ny = 1;
    } else {
      s -= 2 * l;
      const a = Math.PI / 2 + s / r;
      x = -l + r * Math.cos(a);
      y = yh + r * Math.sin(a);
      nx = Math.cos(a);
      ny = Math.sin(a);
    }
    pts.push([x, y, -nx, -ny]); // the cut face looks into the hole
  }
  for (let i = 0; i < n; i++) {
    const [x, y, nx, ny] = pts[i];
    const z = 0; // the tab is flat at the rim plane around the hole
    const Y = toSheetY(kind, y);
    const sy = kind === 'base' ? ny : -ny;
    pos.push(x, Y, z, x, Y, z - T);
    nrm.push(nx, sy, 0, nx, sy, 0);
    rest.push(x, y, x, y);
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('rest', new THREE.Float32BufferAttribute(rest, 2));
  g.setIndex(idx);
  orientByNormals(g);
  return g;
}

const W_FOLD = P.foldWidth;
const Z_MID = -P.fold.drop - T / 2; // mid-surface of the fold strip, flat
const ROWS = 18;

// Fold strip geometry: columns at the x positions of the halves' edge vertices
function foldStrip(cols) {
  const xs = cols.map((c) => c.x);
  const nx = xs.length;
  const count = nx * (ROWS + 1);
  const g = new THREE.BufferGeometry();
  // inside, outside, two end cuts
  const total = count * 2 + (ROWS + 1) * 4;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  const rest = new Float32Array(total * 2);
  const idx = [];
  const I = (side, i, r) => side * count + r * nx + i;
  for (let side = 0; side < 2; side++) {
    for (let r = 0; r <= ROWS; r++) {
      for (let i = 0; i < nx; i++) {
        rest[I(side, i, r) * 2] = xs[i];
        rest[I(side, i, r) * 2 + 1] = P.foldY;
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = I(side, i, r);
        const b = I(side, i + 1, r);
        const c = I(side, i + 1, r + 1);
        const d = I(side, i, r + 1);
        if (side === 0) idx.push(a, b, c, a, c, d);
        else idx.push(a, c, b, a, d, c);
      }
    }
  }
  const endBase = count * 2;
  // end cuts: a = inside, a + 1 = outside at row r; a + 2, a + 3 at row r + 1
  for (let e = 0; e < 2; e++) {
    for (let r = 0; r < ROWS; r++) {
      const a = endBase + e * (ROWS + 1) * 2 + r * 2;
      if (e === 1) idx.push(a, a + 1, a + 3, a, a + 3, a + 2); // faces +x
      else idx.push(a, a + 3, a + 1, a, a + 2, a + 3); // faces -x
    }
  }
  g.setAttribute('rest', new THREE.BufferAttribute(rest, 2));
  g.setIndex(idx);
  g.userData = { xs, nx, count, endBase };
  return g;
}

// Bend the strip to fold angle phi (0 = open flat, PI = closed)
function bendStrip(g, phi) {
  const { xs, nx, count, endBase } = g.userData;
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const sinc = (a) => (Math.abs(a) < 1e-6 ? 1 - (a * a) / 6 : Math.sin(a) / a);
  const cosc = (a) => (Math.abs(a) < 1e-6 ? a / 2 : (1 - Math.cos(a)) / a);
  const at = (s, off) => {
    const th = (s / W_FOLD) * phi;
    // mid-surface point (Y, Z) and the normal toward the inside of the bend
    const Y = -W_FOLD / 2 + s * sinc(th);
    const Z = Z_MID + s * cosc(th);
    const ny = -Math.sin(th);
    const nz = Math.cos(th);
    return [Y + ny * off, Z + nz * off, ny, nz];
  };
  for (let r = 0; r <= ROWS; r++) {
    const s = (W_FOLD * r) / ROWS;
    const [Yi, Zi, ny, nz] = at(s, T / 2);
    const [Yo, Zo] = at(s, -T / 2);
    for (let i = 0; i < nx; i++) {
      p.setXYZ(r * nx + i, xs[i], Yi, Zi);
      n.setXYZ(r * nx + i, 0, ny, nz);
      p.setXYZ(count + r * nx + i, xs[i], Yo, Zo);
      n.setXYZ(count + r * nx + i, 0, -ny, -nz);
    }
    for (let e = 0; e < 2; e++) {
      const x = e === 0 ? xs[0] : xs[nx - 1];
      const a = endBase + e * (ROWS + 1) * 2 + r * 2;
      p.setXYZ(a, x, Yi, Zi);
      p.setXYZ(a + 1, x, Yo, Zo);
      const sx = e === 0 ? -1 : 1;
      n.setXYZ(a, sx, 0, 0);
      n.setXYZ(a + 1, sx, 0, 0);
    }
  }
  p.needsUpdate = true;
  n.needsUpdate = true;
  g.computeBoundingSphere();
  g.computeBoundingBox();
}

// Rigid motion of the lid for fold angle phi (sheet coordinates)
export function lidMatrix(phi, target = new THREE.Matrix4()) {
  const sinc = (a) => (Math.abs(a) < 1e-6 ? 1 - (a * a) / 6 : Math.sin(a) / a);
  const cosc = (a) => (Math.abs(a) < 1e-6 ? a / 2 : (1 - Math.cos(a)) / a);
  const endY = -W_FOLD / 2 + W_FOLD * sinc(phi);
  const endZ = Z_MID + W_FOLD * cosc(phi);
  const m1 = new THREE.Matrix4().makeTranslation(0, -W_FOLD / 2, -Z_MID);
  const r = new THREE.Matrix4().makeRotationX(phi);
  const m2 = new THREE.Matrix4().makeTranslation(0, endY, endZ);
  return target.copy(m2).multiply(r).multiply(m1);
}

// ---------------------------------------------------------------------------
// Assembly: one sheet (base + fold strip + lid), with a fold angle
// ---------------------------------------------------------------------------

const geoCache = new Map();
export function sheetGeometries(lod = 'high') {
  if (geoCache.has(lod)) return geoCache.get(lod);
  const base = halfGeometries('base', lod);
  const lid = halfGeometries('lid', lod);
  const g = { base, lid, baseHole: holeRim('base'), lidHole: holeRim('lid') };
  geoCache.set(lod, g);
  return g;
}

// Formed sheet before trimming (both halves, open flat), for the forming scene
export function blankGeometries(lod = 'low') {
  const key = 'blank' + lod;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = { base: halfGeometries('base', lod, true), lid: halfGeometries('lid', lod, true) };
  geoCache.set(key, g);
  return g;
}

// materials: { baseIn, baseOut, lidIn, lidOut, edge, fold } (see sheetMaterials.js)
export function buildSheet(materials, { lod = 'high' } = {}) {
  const G = sheetGeometries(lod);
  const strip = foldStrip(G.base.foldCols);
  const mk = (geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    if (materials.depth) m.customDepthMaterial = materials.depth; // keeps the finger hole open in shadows
    if (/Inside|CutEdge|HoleEdge/.test(name)) m.castShadow = false; // the outside surface casts the same shadow
    return m;
  };
  const root = new THREE.Group();
  root.name = 'PlasticCase';
  const base = new THREE.Group();
  base.name = 'Base';
  base.add(
    mk(G.base.inside, materials.baseIn, 'BaseInside'),
    mk(G.base.outside, materials.baseOut, 'BaseOutside'),
    mk(G.base.rim, materials.edge, 'BaseCutEdge'),
    mk(G.baseHole, materials.edge, 'BaseHoleEdge'),
  );
  const lid = new THREE.Group();
  lid.name = 'Lid';
  lid.matrixAutoUpdate = false;
  lid.add(
    mk(G.lid.inside, materials.lidIn, 'LidInside'),
    mk(G.lid.outside, materials.lidOut, 'LidOutside'),
    mk(G.lid.rim, materials.edge, 'LidCutEdge'),
    mk(G.lidHole, materials.edge, 'LidHoleEdge'),
  );
  const fold = mk(strip, materials.fold, 'FoldStrip');
  root.add(base, fold, lid);
  let phiNow = null;
  const api = {
    root,
    base,
    lid,
    fold,
    setFold(phi) {
      if (phi === phiNow) return;
      phiNow = phi;
      bendStrip(strip, phi);
      lidMatrix(phi, lid.matrix);
      lid.matrixWorldNeedsUpdate = true;
    },
    get phi() {
      return phiNow;
    },
  };
  api.setFold(0);
  return api;
}

// ---------------------------------------------------------------------------
// Numbers used by the film, the checks and the report
// ---------------------------------------------------------------------------

export const SHEET = {
  T,
  foldY: P.foldY,
  foldWidth: W_FOLD,
  zMid: Z_MID,
  yTabTop,
  hole: HOLE,
  tab: TAB,
  ring: RING,
  origin: ORIGIN,
  toSheetY,
};

// Inside surface of the open sheet as one height field over sheet coordinates
export function sheetInside(X, Y) {
  if (Y < -W_FOLD / 2) return baseInside(X, Y + P.foldY);
  if (Y > W_FOLD / 2) return lidInside(X, P.foldY - Y);
  return -P.fold.drop;
}
// is (X, Y) part of the trimmed sheet?
export function onSheet(X, Y) {
  if (Math.abs(Y) <= W_FOLD / 2) return Math.abs(X) <= HD.topWidth / 2;
  const y = Y < 0 ? Y + P.foldY : P.foldY - Y;
  return trimSDF(X, y) <= 0 && holeSDF(X, y) >= 0;
}
