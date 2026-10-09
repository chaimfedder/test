// Checks of a design variant (see params.js), computed from the model itself.
// Copy of src/plastic/plasticChecks.js.
//
// Checks of the plastic case, computed from the model itself:
// dimensions, hat fit, closing rim fit, and the nesting pitch of identical
// open sheets (inside up and upside down). Runs in Node and in the browser.

import * as THREE from 'three';
import { DESIGN } from '../caseParams.js';
import { HAT_PARAMS, CROWN_BASE } from '../openCaseParams.js';
import { buildHat } from '../openCaseModel.js';
const Q = new URL(import.meta.url).search;
const { PLASTIC: P } = await import('./params.js' + Q);
const { baseInside, lidInside, onSheet, ovalOffset, RING, rimDistance, supportZ, sheetGeometries, sheetInside, SHEET, VARIANT } = await import('./model.js' + Q);
const ringZ = supportZ;

const cm = (m) => Math.round(m * 10000) / 100; // meters -> cm, 2 decimals
const mm = (m) => Math.round(m * 100000) / 100; // meters -> mm, 2 decimals

// first x (or y) where the inside surface comes up to the level z, walking outward
function crossing(fn, z, from, to, steps = 20000) {
  let prev = fn(from);
  for (let i = 1; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    const v = fn(t);
    if ((prev - z) * (v - z) <= 0) return t;
    prev = v;
  }
  return NaN;
}

export function dimensionChecks() {
  const yc = P.hatCenterY;
  // depth across the case at the hat center and near the tip (3 cm from the rim)
  const nearWall = (x) => -baseInside(x, yc);
  const out = {
    variant: VARIANT,
    centerDepth_cm: cm(-baseInside(0, yc)),
    depth3cmFromSideWall_cm: cm(nearWall(P.inner.width / 2 - 0.03)),
    depth3cmFromTip_cm: cm(-baseInside(0, 0.03)),
    sheetThickness_mm: mm(P.thickness),
  };
  if (VARIANT !== 'cradle') {
    const B = P.base;
    out.ringHeight_cm = cm(B.ringHeight);
    out.ringTopWidth_cm = cm(B.ringOuterAtTop - B.ringInnerAtTop);
    out.ringDraft_deg = (B.ringOuterDraft * 180) / Math.PI;
    // channel mouth: distance between the two faces at the floor (outside), at the center floor level
    const zf = -B.cavityDepth;
    const dIn = B.ringInnerAtTop + zf * Math.tan(B.ringInnerDraft);
    const dOut = B.ringOuterAtTop - zf * Math.tan(B.ringOuterDraft);
    out.grooveMouth_cm = cm(dOut - dIn - 2 * P.thickness);
    out.grooveDepth_cm = cm(B.cavityDepth);
  }
  return out;
}

// Hat in case coordinates, resting on the ring (same placement as the film)
export function hatPoints() {
  const hat = buildHat(HAT_PARAMS);
  let lift = -Infinity;
  for (let i = 0; i <= 1200; i++) {
    const d = (0.06 * i) / 1200;
    lift = Math.max(lift, ringZ(d) - hat.userData.brimUnderside(d));
  }
  const pts = [];
  hat.updateMatrixWorld(true);
  hat.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      // hat local (x, y, z) -> case (x, yc + z, lift + y)
      pts.push([p.getX(i), P.hatCenterY + p.getZ(i), lift + p.getY(i)]);
    }
  });
  return { pts, lift };
}

export function hatFitChecks() {
  const { pts, lift } = hatPoints();
  let gapBase = Infinity; // vertical gap above the base's inside surface
  let gapLid = Infinity; // vertical gap below the closed lid's inside surface
  let crownToFloor = Infinity;
  let crownToRing = Infinity; // horizontal, crown wall to the ring's inner face
  let brimToWall = Infinity; // horizontal, brim edge to the side wall
  let hatTop = -Infinity;
  for (const [x, y, z] of pts) {
    gapBase = Math.min(gapBase, z - baseInside(x, y));
    gapLid = Math.min(gapLid, -lidInside(x, y) - z);
    hatTop = Math.max(hatTop, z);
    const d = ovalOffset(x, y);
    if (d < 0 && z < -0.02) {
      crownToFloor = Math.min(crownToFloor, z - baseInside(x, y));
      // horizontal gap to the wall around the crown at this height: walk outward along the oval offset
      let k = d;
      const ang = Math.atan2(y - P.hatCenterY, x);
      const r0 = Math.hypot(x, y - P.hatCenterY);
      let gap = Infinity;
      for (let step = 0; step < 400; step++) {
        const rr = r0 + step * 0.0002;
        const xx = Math.cos(ang) * rr;
        const yy = P.hatCenterY + Math.sin(ang) * rr;
        if (baseInside(xx, yy) > z) {
          gap = step * 0.0002;
          break;
        }
      }
      void k;
      crownToRing = Math.min(crownToRing, gap);
    }
    const e = rimDistance(x, y);
    if (e < 0.02) brimToWall = Math.min(brimToWall, e - Math.max(0, -z) * Math.tan(P.base.wallDraft));
  }
  return {
    hatLift_mm: mm(lift),
    minGapToBaseInside_mm: mm(gapBase),
    minGapToLidInside_mm: mm(gapLid),
    crownTopToFloor_mm: mm(crownToFloor),
    crownToRingInnerFace_mm: mm(crownToRing),
    brimEdgeToSideWall_mm: mm(brimToWall),
    hatHighestPoint_mm: mm(hatTop),
  };
}

export function rimChecks() {
  const F = P.flange;
  let minGap = Infinity;
  for (let e = F.ribCenter - 0.004; e <= F.ribCenter + 0.004; e += 0.00001) {
    const a = Math.abs(e - F.ribCenter);
    const sm = (lo, hi, x) => {
      const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1);
      return t * t * (3 - 2 * t);
    };
    const rib = F.ribHeight * (1 - sm(F.ribTopHalf, F.ribHalfWidth, a));
    const channel = F.channelDepth * (1 - sm(F.channelTopHalf, F.channelHalfWidth, a)); // closed lid: channel opens downward
    if (rib > 1e-6) minGap = Math.min(minGap, channel - rib);
  }
  return {
    ribHeight_mm: mm(F.ribHeight),
    channelDepth_mm: mm(F.channelDepth),
    minGapRibToChannel_mm: mm(minGap),
    foldStripLength_mm: mm(P.foldWidth),
    foldInnerRadius_mm: mm(P.fold.drop),
    flangeContactWhenClosed_mm: 0,
  };
}

// Nesting: identical open sheets stacked straight up. Lower sheet's inside
// surface I(x, y); upper sheet's outside surface points q (+ pitch). The
// minimum pitch is the largest I(q.x, q.y) - q.z over the outside surface.
// Upside down the roles swap but the numbers are the same (z -> -z).
export function nestingChecks(lod = 'high') {
  const G = sheetGeometries(lod);
  const parts = [
    ['base', G.base.outside, (y) => y - P.foldY],
    ['lid', G.lid.outside, (y) => P.foldY - y],
  ];
  let worst = -Infinity; // touching pitch
  let need = -Infinity; // pitch with the free gap measured along the surface normal
  let where = null;
  const samples = [];
  const h = 1e-5;
  const slope = (X, Y) => {
    const gx = (sheetInside(X + h, Y) - sheetInside(X - h, Y)) / (2 * h);
    const gy = (sheetInside(X, Y + h) - sheetInside(X, Y - h)) / (2 * h);
    return Math.sqrt(1 + gx * gx + gy * gy);
  };
  for (const [name, geo] of parts) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i);
      const Y = p.getY(i);
      const Z = p.getZ(i);
      if (!onSheet(X, Y)) continue;
      const v = sheetInside(X, Y) - Z;
      const s = slope(X, Y);
      samples.push([X, Y, Z, s]);
      if (v > worst) worst = v;
      const r = v + P.nesting.normalGap * s;
      if (r > need) {
        need = r;
        where = { part: name, X, Y, Z };
      }
    }
  }
  const pitch = Math.ceil(need * 10000) / 10000; // round up to 0.1 mm
  // gaps at rest: vertical, and along the surface normal
  let minVertical = Infinity;
  let minNormal = Infinity;
  for (const [X, Y, Z, s] of samples) {
    const g = Z + pitch - sheetInside(X, Y);
    minVertical = Math.min(minVertical, g);
    minNormal = Math.min(minNormal, g / s);
  }
  // along the way down: the gap only grows with height (straight vertical move)
  const path = [0.06, 0.03, 0.01, 0.003, 0].map((extra) => {
    let m = Infinity;
    for (const [X, Y, Z] of samples) m = Math.min(m, Z + pitch + extra - sheetInside(X, Y));
    return { aboveRest_mm: mm(extra), minVerticalGap_mm: mm(m) };
  });
  return {
    touchingPitch_mm: mm(worst),
    requiredNormalGap_mm: mm(P.nesting.normalGap),
    pitch_mm: mm(pitch),
    pitch,
    limitingPoint: where && { part: where.part, X_cm: cm(where.X), Y_cm: cm(where.Y), Z_cm: cm(where.Z), case_y_cm: cm(where.part === 'base' ? where.Y + P.foldY : P.foldY - where.Y), d_cm: cm(ovalOffset(where.X, where.part === 'base' ? where.Y + P.foldY : P.foldY - where.Y)) },
    atRest: { minVerticalGap_mm: mm(minVertical), minNormalGap_mm: mm(minNormal) },
    descent: path,
    stackOf10_extraHeight_cm: cm(9 * pitch),
    samples: samples.length,
  };
}

export function runPlasticChecks() {
  return {
    dimensions: dimensionChecks(),
    hat: hatFitChecks(),
    rim: rimChecks(),
    nesting: nestingChecks('high'),
    fold: { stripLength_mm: mm(SHEET.foldWidth) },
  };
}

void THREE;
