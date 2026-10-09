// Checks of the plastic case, computed from the model itself:
// dimensions, hat fit, closing rim fit, and the nesting pitch of identical
// open sheets (inside up and upside down). Runs in Node and in the browser.

import * as THREE from 'three';
import { DESIGN } from '../caseParams.js';
import { HAT_PARAMS, CROWN_BASE } from '../openCaseParams.js';
import { buildHat } from '../openCaseModel.js';
import { PLASTIC as P } from './plasticParams.js';
import { baseInside, lidInside, onSheet, ovalOffset, RING, rimDistance, ringZ, sheetGeometries, sheetInside, SHEET } from './sheetModel.js';

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
  const H = P.inner.height;
  const yc = P.hatCenterY;
  // inside length / width at the rim plane: where the side wall's inside
  // surface (extended without its top rounding) meets z = 0, i.e. the rim outline
  const length = (() => {
    let lo = 0;
    let hi = 0;
    // rim outline along the axis
    lo = crossing((y) => rimDistance(0, y), 0, 0.05, -0.02);
    hi = crossing((y) => rimDistance(0, y), 0, 0.3, 0.4);
    return hi - lo;
  })();
  let width = 0;
  for (let y = 0.05; y < H; y += 0.0005) {
    const x = crossing((x) => rimDistance(x, y), 0, 0, 0.2);
    if (x * 2 > width) width = x * 2;
  }
  // the same, 1 cm below the rim (the side wall has a draft)
  const zBelow = -0.01;
  const lengthBelow = crossing((y) => baseInside(0, y), zBelow, H - 0.02, H + 0.01) - crossing((y) => baseInside(0, y), zBelow, 0.02, -0.01);
  // depths
  const cavity = -baseInside(0, yc); // crown floor below the rim plane
  const edge = -baseInside(0, 0.03); // shallow part near the tip, under the brim edge
  // ring: rounded top and the root on the outer side, measured on the surface
  const ringTop = ringZ(RING.mid);
  const ringHeight = ringTop - RING.zRoot;
  // the real surface: lowest point between the ring and the side wall, across the case
  let rootSurface = 0;
  for (let x = CROWN_BASE.x + RING.root - 0.005; x < CROWN_BASE.x + RING.root + 0.01; x += 0.0001) rootSurface = Math.min(rootSurface, baseInside(x, yc));
  const ovalSize = (d) => ({ length: cm(2 * (CROWN_BASE.z + d)), width: cm(2 * (CROWN_BASE.x + d)) });
  return {
    insideLength_cm: { model: cm(length), design: cm(DESIGN.innerLength), where: 'rim plane' },
    insideWidth_cm: { model: cm(width), design: cm(DESIGN.innerWidth), where: 'rim plane' },
    insideLength_1cmBelowRim_cm: cm(lengthBelow),
    centerDepth_cm: { model: cm(cavity), design: cm(DESIGN.centerInnerDepth), what: 'crown floor below the rim plane (= brim support plane)' },
    edgeDepth_cm: { model: cm(edge), design: cm(DESIGN.edgeInnerDepth), what: 'brim area near the tip' },
    ringHeight_cm: { model: cm(ringHeight), design: 10, what: 'root (outer side) to the top' },
    ringRootSurface_cm: cm(-rootSurface),
    ringInnerFaceHeight_cm: cm(ringTop - RING.zFloor),
    ringTopWidth_cm: cm(RING.outerTop - RING.innerTop),
    ringTopOval_outside_cm: ovalSize(RING.outerTop),
    ringTopOval_inside_cm: ovalSize(RING.innerTop),
    ringRootOval_cm: ovalSize(RING.root),
    cavityFloorOval_cm: ovalSize(RING.innerBottom),
    ringFaceDraft_deg: { inner: (P.base.ringInnerDraft * 180) / Math.PI, outer: (P.base.ringOuterDraft * 180) / Math.PI },
    groove: { depth_cm: cm(ringTop - P.thickness - (RING.zRoot - P.thickness)), mouthWidthAtRoot_cm: cm(RING.root - RING.innerBottom - 2 * P.thickness) },
    sheetThickness_mm: mm(P.thickness),
  };
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
      // inner face of the ring at this height: d where ringZ(d) = z on the inner side
      let lo = RING.innerBottom - 0.02;
      let hi = RING.mid;
      for (let k = 0; k < 50; k++) {
        const m = (lo + hi) / 2;
        if (ringZ(m) < z) lo = m;
        else hi = m;
      }
      crownToRing = Math.min(crownToRing, lo - d);
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
