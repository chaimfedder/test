// Measurements and fit checks on the built model (case coordinates, meters).
// Used by the video scenes and the film to confirm that the geometry matches
// the design data and that no parts pass through each other.

import * as THREE from 'three';

// Offset d of a point from the crown oval (semi-axes ax, az), by bisection
function ovalOffset(x, y, ax, az) {
  let lo = -Math.min(ax, az) + 1e-6;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const d = (lo + hi) / 2;
    const v = (x / (ax + d)) ** 2 + (y / (az + d)) ** 2;
    if (v > 1) lo = d;
    else hi = d;
  }
  return (lo + hi) / 2;
}

function pointsOf(root, frame) {
  root.updateWorldMatrix(true, true);
  const out = [];
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) out.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
  });
  return out;
}

export function runFitChecks(box, params, op, hp, design) {
  const info = box.info;
  const L = info.layout;
  const ip = op.insert;
  const frame = box.root;
  const wall = params.body.wall;
  const inner = L.outline.map(({ p, n }) => [p.x - n.x * wall, p.y - n.y * wall]);
  const distToWall = (x, y) => {
    let best = Infinity;
    let inside = false;
    for (let i = 0, j = inner.length - 1; i < inner.length; j = i++) {
      const [ax, ay] = inner[j];
      const [bx, by] = inner[i];
      const ex = bx - ax;
      const ey = by - ay;
      const t = Math.min(Math.max(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey), 0), 1);
      best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside ? best : -best;
  };
  const liningZ = (x, y) => L.backZ(x, y, 0.5) + wall; // inside of the base under (x, y)
  const { x: cax, z: caz } = info.crown;

  // --- dimensions measured on the model ---
  const ys = inner.map((p) => p[1]);
  const xs = inner.map((p) => p[0]);
  const innerTop = Math.max(...ys);
  const hatPts = pointsOf(box.hatHolder, frame);
  let hatMinZ = Infinity;
  for (const p of hatPts) hatMinZ = Math.min(hatMinZ, p.z);
  const opening = { length: 2 * (caz - hp.felt), width: 2 * (cax - hp.felt) };
  const a = opening.length / 2;
  const b = opening.width / 2;
  let perim = 0;
  for (let i = 0; i < 4000; i++) {
    const t0 = (i / 4000) * Math.PI * 2;
    const t1 = ((i + 1) / 4000) * Math.PI * 2;
    perim += Math.hypot(a * (Math.cos(t1) - Math.cos(t0)), b * (Math.sin(t1) - Math.sin(t0)));
  }
  const measured = {
    innerLength: innerTop - Math.min(...ys),
    innerWidth: Math.max(...xs) - Math.min(...xs),
    centerInnerDepth: info.seamZ - liningZ(info.hole.x, info.hole.y),
    edgeInnerDepth: info.seamZ - (L.zBaseBack + wall),
    crownHeight: info.zs - hatMinZ,
    crownClearance: hatMinZ - liningZ(info.hole.x, info.hole.y),
    openingLength: opening.length,
    openingWidth: opening.width,
    openingCircumference: perim,
    brimWidth: hp.brimWidth,
    hatCenterFromTop: innerTop - info.hole.y,
    ringLipHeight: info.ringTop - info.pad,
  };

  // --- clearances ---
  let crownToLining = Infinity;
  let crownToRing = Infinity;
  let hatOnRing = Infinity;
  let brimAbovePad = Infinity;
  let hatToWall = Infinity;
  let hatTop = -Infinity;
  const rr = ip.ringRound;
  for (const p of hatPts) {
    const d = ovalOffset(p.x - info.hole.x, p.y - info.hole.y, cax, caz);
    hatToWall = Math.min(hatToWall, distToWall(p.x, p.y));
    hatTop = Math.max(hatTop, p.z);
    crownToLining = Math.min(crownToLining, p.z - liningZ(p.x, p.y));
    if (p.z < info.ringTop - rr && d < ip.ringOuter) crownToRing = Math.min(crownToRing, ip.ringInner - d);
    if (d >= ip.ringInner && d <= ip.ringOuter) {
      const { ringInner: Ri, ringOuter: Ro } = ip;
      let top = 0;
      if (d < Ri + rr) top = -rr + Math.sqrt(Math.max(rr * rr - (Ri + rr - d) ** 2, 0));
      else if (d > Ro - rr) top = -rr + Math.sqrt(Math.max(rr * rr - (d - (Ro - rr)) ** 2, 0));
      hatOnRing = Math.min(hatOnRing, p.z - (info.ringTop + top));
    }
    if (d > ip.ringOuter) brimAbovePad = Math.min(brimAbovePad, p.z - info.pad);
  }

  // ring's inside wall must end between the lining and the outer shell
  let ringBottomInShell = Infinity;
  for (const p of pointsOf(box.root.getObjectByName('InsertRing'), frame)) {
    const outer = L.backZ(p.x, p.y, 0.5);
    if (p.z < info.pad) ringBottomInShell = Math.min(ringBottomInShell, p.z - outer);
  }

  // lid swinging: over the hat, and over the handle
  const savedLid = box.lidPivot.rotation.x;
  const handlePts = pointsOf(box.root.getObjectByName('Handle'), frame);
  let lidToHat = Infinity;
  let lidToHandle = Infinity;
  const cell = (p) => `${Math.round(p.x / 0.004)},${Math.round(p.y / 0.004)}`;
  // highest point of the hat in each 4 mm cell (and its neighbours)
  const hatHigh = new Map();
  for (const p of hatPts) {
    const cx = Math.round(p.x / 0.004);
    const cy = Math.round(p.y / 0.004);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const k = `${cx + i},${cy + j}`;
        hatHigh.set(k, Math.max(hatHigh.get(k) ?? -Infinity, p.z));
      }
    }
  }
  for (let deg = 0; deg <= op.hinge.openAngle; deg += 3) {
    box.setLid(deg);
    const lidPts = pointsOf(box.lidPivot, frame);
    const lowest = new Map();
    for (const p of lidPts) {
      if (p.y > params.body.height) lowest.set(cell(p), Math.min(lowest.get(cell(p)) ?? Infinity, p.z));
      const h = hatHigh.get(cell(p));
      if (h !== undefined) lidToHat = Math.min(lidToHat, p.z - h);
    }
    for (const h of handlePts) {
      const z = lowest.get(cell(h));
      if (z !== undefined) lidToHandle = Math.min(lidToHandle, z - h.z);
    }
  }
  box.lidPivot.rotation.x = savedLid;

  const cm = (x) => Math.round(x * 10000) / 100;
  const mm = (x) => Math.round(x * 10000) / 10;
  const dims = {};
  for (const k of Object.keys(measured)) dims[k] = { model_cm: cm(measured[k]), design_cm: design[k] !== undefined ? cm(design[k]) : null };
  return {
    dimensions: dims,
    clearances_mm: {
      crownToBowlLining: mm(crownToLining),
      crownToRingInside: mm(crownToRing),
      hatOnRing: mm(hatOnRing),
      brimAbovePadding: mm(brimAbovePad),
      hatToSideWall: mm(hatToWall),
      hatTopBelowSeam: mm(info.seamZ - hatTop),
      ringWallInsideShell: mm(ringBottomInShell),
      lidOverHat: mm(lidToHat),
      lidOverHandle: mm(lidToHandle),
    },
  };
}

