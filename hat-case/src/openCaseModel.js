// Openable hat case: base and lid as separate parts on a hinge, a velvet
// support with a crown cavity, and the hat. Used by the product video.
// Shares the outline, relief, handle and brand plate with caseModel.js.

import * as THREE from 'three';
import { CROWN_BASE } from './openCaseParams.js';
import {
  buildHandle,
  buildPlate,
  computeLayout,
  createMaterials,
  setLogoTexture,
  smoothstep,
  sweep,
} from './caseModel.js';

// ---------------------------------------------------------------------------
// Ring-strip surfaces
// ---------------------------------------------------------------------------

// rings: array of Float32Array(N * 3); optional single vertices closing the
// strip at its start and end.
function ringGeometry(rings, N, startCenter = null, endCenter = null) {
  const R = rings.length;
  const first = startCenter ? 1 : 0;
  const count = first + R * N + (endCenter ? 1 : 0);
  const pos = new Float32Array(count * 3);
  if (startCenter) pos.set(startCenter, 0);
  rings.forEach((ring, i) => pos.set(ring, (first + i * N) * 3));
  const endIndex = first + R * N;
  if (endCenter) pos.set(endCenter, endIndex * 3);
  const at = (r, k) => first + r * N + (k % N);
  const idx = [];
  if (startCenter) for (let k = 0; k < N; k++) idx.push(0, at(0, k), at(0, k + 1));
  for (let r = 0; r < R - 1; r++) {
    for (let k = 0; k < N; k++) {
      const a = at(r, k);
      const b = at(r, k + 1);
      const c = at(r + 1, k);
      const d = at(r + 1, k + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  if (endCenter) for (let k = 0; k < N; k++) idx.push(at(R - 1, k), endIndex, at(R - 1, k + 1));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Flip triangle winding so that `score(point, faceNormal)` is positive overall.
function orient(geo, score) {
  const p = geo.attributes.position;
  const idx = geo.index.array;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]);
    b.fromBufferAttribute(p, idx[i + 1]);
    c.fromBufferAttribute(p, idx[i + 2]);
    n.subVectors(c, b).cross(a.clone().sub(b)); // (c-b) x (a-b), area weighted
    total += score(a.add(b).add(c).multiplyScalar(1 / 3), n);
  }
  if (total < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    geo.index.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

// Copy of a surface moved inward along its normals (wall thickness).
function offsetGeometry(geo, t) {
  const out = geo.clone();
  const p = out.attributes.position;
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) - n.getX(i) * t, p.getY(i) - n.getY(i) * t, p.getZ(i) - n.getZ(i) * t);
  }
  out.computeVertexNormals();
  return out;
}

const ringFrom = (N, fn) => {
  const r = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) r.set(fn(k), k * 3);
  return r;
};

// ---------------------------------------------------------------------------
// Case parts
// ---------------------------------------------------------------------------

function caseSurfaces(params, op, layout) {
  const b = params.body;
  const m = params.mesh;
  const N = m.perimeter;
  const O = layout.outline;
  const c = layout.center;
  const re = b.frontEdgeRadius;
  const rb = params.base.edgeRadius;
  const wall = b.wall;
  const seamTop = layout.seamZ + op.seamGap / 2;
  const seamBottom = layout.seamZ - op.seamGap / 2;
  const inset = (k, d) => [O[k].p.x - O[k].n.x * d, O[k].p.y - O[k].n.y * d];

  // Lid: front center -> front face -> rounded edge -> short side wall -> rim
  const lidRings = (real) => {
    const rings = [];
    for (let r = 1; r <= m.frontRings; r++) {
      const s = r / m.frontRings;
      rings.push(ringFrom(N, (k) => {
        const [qx, qy] = inset(k, re);
        const x = c.x + (qx - c.x) * s;
        const y = c.y + (qy - c.y) * s;
        return [x, y, real ? layout.frontHeight(x, y, s) : layout.domeZ(s)];
      }));
    }
    for (let r = 1; r <= m.frontEdgeRings; r++) {
      const th = (r / m.frontEdgeRings) * (Math.PI / 2);
      rings.push(ringFrom(N, (k) => [...inset(k, re * (1 - Math.sin(th))), layout.sideTop + re * Math.cos(th)]));
    }
    const steps = 6;
    for (let r = 1; r <= steps; r++) {
      const z = layout.sideTop + (seamTop - layout.sideTop) * (r / steps);
      rings.push(ringFrom(N, (k) => [...inset(k, 0), z]));
    }
    const center = [c.x, c.y, real ? layout.frontHeight(c.x, c.y, 0) : layout.domeZ(0)];
    return { rings, center };
  };

  // Base: rim -> short side wall -> rounded edge -> back (shallow, bowl under the crown) -> center
  const baseRings = () => {
    const rings = [];
    const sideSteps = 8;
    for (let r = 0; r <= sideSteps; r++) {
      const z = seamBottom + (layout.baseSideBottom - seamBottom) * (r / sideSteps);
      rings.push(ringFrom(N, (k) => [...inset(k, 0), z]));
    }
    for (let r = 1; r <= m.backEdgeRings; r++) {
      const ph = (r / m.backEdgeRings) * (Math.PI / 2);
      rings.push(ringFrom(N, (k) => [...inset(k, rb * (1 - Math.cos(ph))), layout.zBaseBack + rb - rb * Math.sin(ph)]));
    }
    for (let r = m.backRings - 1; r >= 1; r--) {
      const s = r / m.backRings;
      rings.push(ringFrom(N, (k) => {
        const [qx, qy] = inset(k, rb);
        const x = c.x + (qx - c.x) * s;
        const y = c.y + (qy - c.y) * s;
        return [x, y, layout.backZ(x, y, s)];
      }));
    }
    return { rings, center: [c.x, c.y, layout.backZ(c.x, c.y, 0)] };
  };

  const inside = new THREE.Vector3(c.x, c.y, (layout.sideTop + layout.zBaseBack) / 2);
  const outward = (p, n) => n.dot(p.clone().sub(inside));
  const inward = (p, n) => -outward(p, n);

  const lidReal = lidRings(true);
  const lidSmooth = lidRings(false);
  const lidOuter = orient(ringGeometry(lidReal.rings, N, lidReal.center), outward);
  const lidSmoothGeo = orient(ringGeometry(lidSmooth.rings, N, lidSmooth.center), outward);
  const lidInner = orient(offsetGeometry(lidSmoothGeo, wall), inward);
  const lidRim = orient(
    ringGeometry([lidReal.rings[lidReal.rings.length - 1], ringFrom(N, (k) => [...inset(k, wall), seamTop])], N),
    (p, n) => -n.z,
  );

  const base = baseRings();
  const baseOuter = orient(ringGeometry(base.rings, N, null, base.center), outward);
  const baseInner = orient(offsetGeometry(baseOuter, wall), inward);
  const baseRim = orient(
    ringGeometry([ringFrom(N, (k) => [...inset(k, wall), seamBottom]), base.rings[0]], N),
    (p, n) => n.z,
  );

  return { lidOuter, lidInner, lidRim, baseOuter, baseInner, baseRim, seamTop, seamBottom };
}

function piping(params, layout, z) {
  const sp = params.seam;
  const N = params.mesh.perimeter;
  const off = sp.pipingRadius - sp.pipingProtrusion;
  const path = layout.outline.map(({ p, n }) => ({
    p: new THREE.Vector3(p.x - n.x * off, p.y - n.y * off, z),
    side: new THREE.Vector3(n.x, n.y, 0),
    up: new THREE.Vector3(0, 0, 1),
  }));
  const M = params.mesh.pipingSection;
  const section = (j) => {
    const a = (j / M) * Math.PI * 2;
    return [Math.cos(a) * sp.pipingRadius, Math.sin(a) * sp.pipingRadius];
  };
  return sweep(path.slice(0, N), M, section, () => 1, true);
}

// Surface swept around an oval. Each profile point is [d, h, k]: the oval
// (semi-axes ax, az) is moved outward by d, scaled toward its center by k
// (1 when omitted) and placed at height h. Used for the hat and the ring,
// so both follow the crown's oval exactly.
function ovalSweep(profile, ax, az, segments) {
  const n = profile.length;
  const pos = new Float32Array(n * segments * 3);
  for (let i = 0; i < n; i++) {
    const [d, h, k = 1] = profile[i];
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const o = (i * segments + j) * 3;
      pos[o] = k * (ax + d) * Math.cos(a);
      pos[o + 1] = h;
      pos[o + 2] = k * (az + d) * Math.sin(a);
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const j2 = (j + 1) % segments;
      const a = i * segments + j;
      const b = i * segments + j2;
      const c = (i + 1) * segments + j;
      const e = (i + 1) * segments + j2;
      idx.push(a, c, b, b, c, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const arcPoints = (cx, cy, r, a0, a1, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
};

// Top of the ring, relative to its highest point, at offset d from the crown wall
function ringTopProfile(ip, d) {
  const { ringInner: Ri, ringOuter: Ro, ringRound: rr } = ip;
  if (d < Ri || d > Ro) return -Infinity;
  if (d < Ri + rr) return -rr + Math.sqrt(Math.max(rr * rr - (Ri + rr - d) ** 2, 0));
  if (d > Ro - rr) return -rr + Math.sqrt(Math.max(rr * rr - (d - (Ro - rr)) ** 2, 0));
  return 0;
}

// Velvet padding over the shallow part of the base, with a raised ring that
// follows the crown's oval. The hat rests on the ring; its crown hangs into
// the deep bowl inside the ring.
function buildInsert(params, op, layout, center, levels, material) {
  const ip = op.insert;
  const N = params.mesh.perimeter;
  const { x: ax, z: az } = CROWN_BASE;
  const edge = params.body.wall - ip.overlap;
  const outlinePts = layout.outline.map(({ p, n }) => new THREE.Vector2(p.x - n.x * edge, p.y - n.y * edge));
  const shape = new THREE.Shape(outlinePts);
  const holePts = [];
  for (let j = 0; j < 192; j++) {
    const a = (j / 192) * Math.PI * 2;
    holePts.push(new THREE.Vector2(center.x + (ax + ip.ringOuter) * Math.cos(a), center.y - (az + ip.ringOuter) * Math.sin(a)));
  }
  shape.holes.push(new THREE.Path(holePts));
  const pad = new THREE.ShapeGeometry(shape, 1);
  pad.translate(0, 0, levels.pad);

  // Ring: outside wall -> rounded top -> inside wall down into the bowl
  const { ringInner: Ri, ringOuter: Ro, ringRound: rr } = ip;
  const top = levels.ringTop;
  const prof = [[Ro, levels.pad - 0.002], [Ro, top - rr]];
  prof.push(...arcPoints(Ro - rr, top - rr, rr, 0, Math.PI / 2, 10).slice(1));
  prof.push(...arcPoints(Ri + rr, top - rr, rr, Math.PI / 2, Math.PI, 10));
  prof.push([Ri, top - 0.03], [Ri, top - 0.06], [Ri, top - 0.09]); // bottom set below
  const ring = ovalSweep(prof, ax, az, N / 2);
  ring.rotateX(Math.PI / 2); // local height -> case z, local z -> case -y
  ring.translate(center.x, center.y, 0);
  // the inside wall ends just under the bowl's lining (hidden between lining and shell)
  const pos = ring.attributes.position;
  const seg = N / 2;
  const last = prof.length - 1;
  for (let j = 0; j < seg; j++) {
    const i = last * seg + j;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const zFloor = layout.backZ(x, y, 0.5) + params.body.wall;
    pos.setZ(i, zFloor - 0.002);
    for (const [row, t] of [[last - 1, 2 / 3], [last - 2, 1 / 3]]) {
      const k = row * seg + j;
      pos.setZ(k, top - rr + (zFloor - 0.002 - (top - rr)) * t);
    }
  }
  ring.computeVertexNormals();

  const g = new THREE.Group();
  g.name = 'Insert';
  const m1 = new THREE.Mesh(pad, material);
  m1.name = 'InsertPad';
  const m2 = new THREE.Mesh(ring, material);
  m2.name = 'InsertRing';
  g.add(m1, m2);
  return g;
}


function buildLidLabel(op, layout, materials, labelTexture) {
  const lp = op.label;
  const zInner = layout.domeZ(layout.sAt(0, lp.y)) - layout.wall;
  const face = materials.label.clone();
  face.name = 'Lid_Label';
  if (labelTexture) setLogoTexture(face, labelTexture);
  const box = new THREE.BoxGeometry(lp.width, lp.height, lp.thickness);
  const mats = [materials.label, materials.label, materials.label, materials.label, materials.label, face];
  const label = new THREE.Mesh(box, mats);
  label.name = 'LidLabel';
  label.rotation.z = Math.PI; // reads upright when the lid stands open
  label.position.set(0, lp.y, zInner - lp.thickness / 2 + 0.0004);
  const g = new THREE.Group();
  g.name = 'LidLabelGroup';
  g.add(label);
  const rivet = new THREE.SphereGeometry(0.0016, 16, 8);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const r = new THREE.Mesh(rivet, materials.hinge);
      r.name = 'LidLabelRivet';
      r.scale.z = 0.5;
      r.position.set(sx * (lp.width / 2 - 0.005), lp.y + sy * (lp.height / 2 - 0.005), zInner - lp.thickness + 0.0002);
      g.add(r);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Hat (built upside down: brim resting surface at y = 0, crown hanging down)
// ---------------------------------------------------------------------------

// The hat, built upside down: the brim plane (crown base) at y = 0, the crown
// hanging down to y = -crownHeight, the head opening facing +y. Every part is
// swept around the crown's oval (x = width, z = length), so the opening is
// exactly openingWidth x openingLength and the brim is brimWidth wide all round.
export function buildHat(hp) {
  const m = hp.materials;
  const mats = {
    felt: new THREE.MeshPhysicalMaterial({ ...m.felt, name: 'Hat_Felt', side: THREE.DoubleSide }),
    band: new THREE.MeshPhysicalMaterial({ ...m.band, name: 'Hat_Band', side: THREE.DoubleSide }),
    sweatband: new THREE.MeshPhysicalMaterial({ ...m.sweatband, name: 'Hat_Sweatband', side: THREE.DoubleSide }),
    lining: new THREE.MeshPhysicalMaterial({ ...m.lining, name: 'Hat_Lining', side: THREE.DoubleSide }),
  };
  const { x: ax, z: az } = CROWN_BASE;
  const Hc = hp.crownHeight;
  const T = hp.crownTaper;
  const tr = hp.crownTopRound;
  const bt = hp.brimThickness;
  const ft = hp.felt;
  const Wb = hp.brimWidth;
  const S = hp.segments;
  const fillet = 0.006;
  const yWallTop = -fillet;
  const yWallBottom = -Hc + tr;
  // crown wall offset: 0 at the base, -T where the top rounding starts
  const wallD = (y) => -T * Math.min(Math.max((y - yWallTop) / (yWallBottom - yWallTop), 0), 1);
  const dTop = -T - tr;
  const edgeD = Wb - bt / 2;
  const curl = (d) => -hp.brimCurl * (Math.max(d - fillet, 0) / (edgeD - fillet)) ** 2;
  const dent = (k) => hp.crownDent * (1 - smoothstep(0, 0.9, k));

  const felt = [];
  for (let i = 0; i <= 12; i++) {
    const k = Math.max(i / 12, 0.002);
    felt.push([dTop, -Hc + dent(k), k]);
  }
  felt.push(...arcPoints(dTop, -Hc + tr, tr, -Math.PI / 2, 0, 10).slice(1));
  for (let i = 1; i <= 16; i++) {
    const y = yWallBottom + ((yWallTop - yWallBottom) * i) / 16;
    felt.push([wallD(y), y]);
  }
  felt.push(...arcPoints(fillet, -fillet, fillet, Math.PI, Math.PI / 2, 6).slice(1));
  for (let i = 1; i <= 24; i++) {
    const d = fillet + ((edgeD - fillet) * i) / 24;
    felt.push([d, curl(d)]);
  }
  felt.push(...arcPoints(edgeD, curl(edgeD) + bt / 2, bt / 2, -Math.PI / 2, Math.PI / 2, 8).slice(1));
  for (let i = 1; i <= 24; i++) {
    const d = edgeD + (-ft + 0.004 - edgeD) * (i / 24);
    felt.push([d, curl(d) + bt]);
  }
  felt.push(...arcPoints(-ft + 0.004, bt - 0.004, 0.004, Math.PI / 2, Math.PI, 6).slice(1));

  const sd = hp.sweatbandDepth;
  const sweat = [
    [-ft, bt - 0.003],
    [-ft - 0.0018, bt - 0.0045],
    [-ft - 0.002, bt - sd],
    [-ft - 0.0006, bt - sd - 0.0022],
  ];

  const lining = [];
  const y0 = bt - sd - 0.001;
  for (let i = 0; i <= 24; i++) {
    const y = y0 + (yWallBottom - y0) * (i / 24);
    lining.push([wallD(y) - ft, y]);
  }
  lining.push(...arcPoints(dTop, -Hc + tr, tr - ft, 0, -Math.PI / 2, 8).slice(1));
  for (let i = 11; i >= 0; i--) {
    const k = Math.max(i / 12, 0.002);
    lining.push([dTop, -Hc + ft + dent(k), k]);
  }

  const bh = hp.bandHeight;
  const yb = -0.004 - bh;
  const yt = -0.004;
  const band = [
    [wallD(yb), yb],
    [wallD(yb) + hp.bandThickness, yb + 0.0008],
    [wallD(yt) + hp.bandThickness, yt - 0.0008],
    [wallD(yt), yt],
  ];

  const make = (profile, mat, name) => {
    const mesh = new THREE.Mesh(ovalSweep(profile, ax, az, S), mat);
    mesh.name = name;
    return mesh;
  };
  const hat = new THREE.Group();
  hat.name = 'Hat';
  const liningMesh = make(lining, mats.lining, 'HatLining');

  // Soft folds in the satin lining (moved inward/outward around the oval)
  const lp = liningMesh.geometry.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i);
    const y = lp.getY(i);
    const z = lp.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const a = Math.atan2(z, x);
    const depth = smoothstep(y0, y0 - 0.02, y); // no folds at the sweatband edge
    const fold = 0.0022 * Math.sin(7 * a + y * 35) + 0.0012 * Math.sin(12 * a - y * 80 + 1.3);
    const k = Math.max(r - fold * depth * Math.min(1, r / 0.03), 1e-5) / r;
    lp.setXYZ(i, x * k, y + 0.001 * depth * Math.sin(9 * a), z * k);
  }
  liningMesh.geometry.computeVertexNormals();

  hat.add(make(felt, mats.felt, 'HatFelt'), make(band, mats.band, 'HatBand'), make(sweat, mats.sweatband, 'HatSweatband'), liningMesh);
  hat.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  // brim underside height at offset d (for resting it on the ring)
  hat.userData.brimUnderside = (d) => (d < fillet ? -fillet + Math.sqrt(Math.max(fillet * fillet - (d - fillet) ** 2, 0)) : curl(d));
  return hat;
}

// Crushed-velvet look: soft multi-scale brightness variation (no DOM needed)
function velvetTexture(size = 256, seed = 11) {
  let st = seed;
  const rand = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
  const layer = (cells) => {
    const g = Array.from({ length: (cells + 1) * (cells + 1) }, rand);
    return (x, y) => {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[(j % cells) * (cells + 1) + (i % cells)];
      const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
      const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const layers = [layer(4), layer(9), layer(23), layer(61)];
  const weights = [0.35, 0.3, 0.2, 0.15];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      layers.forEach((f, i) => (v += f(x, y) * weights[i]));
      const c = Math.round(255 * Math.min(1, 0.62 + (v - 0.5) * 0.9));
      const o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = c;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.name = 'VelvetVariation';
  tex.needsUpdate = true;
  return tex;
}

// Planar UVs (case x/y) so the velvet variation can be mapped
function planarUV(geo, scale = 6) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * scale + p.getZ(i) * scale * 0.5;
    uv[i * 2 + 1] = p.getY(i) * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildOpenCase(params, op, hp, { logoTexture = null, labelTexture = null } = {}) {
  const layout = computeLayout(params);
  const mats = createMaterials(params, logoTexture);
  mats.velvet = new THREE.MeshPhysicalMaterial({ ...op.materials.velvet, name: 'Velvet', side: THREE.DoubleSide, map: velvetTexture() });
  mats.hinge = new THREE.MeshStandardMaterial({ ...op.materials.hinge, name: 'Hinge_Metal' });
  mats.label = new THREE.MeshStandardMaterial({ ...op.materials.label, name: 'Lid_Label_Metal' });

  const surf = caseSurfaces(params, op, layout);
  const mesh = (geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    return m;
  };

  // Base (stays on the table)
  const base = new THREE.Group();
  base.name = 'Base';
  base.add(
    mesh(surf.baseOuter, mats.shell, 'BaseShell'),
    mesh(surf.baseRim, mats.shell, 'BaseRim'),
    mesh(surf.baseInner, mats.velvet, 'BaseLining'),
    mesh(piping(params, layout, surf.seamBottom - params.seam.pipingRadius), mats.trim, 'BaseTrim'),
    mesh(buildHandle(params, layout), mats.handle, 'Handle'),
  );

  // Brand plate on the back: same plate as the front, turned to face outward
  // from the flat bottom of the bowl
  const bp = { ...params.plate, ...params.backPlate };
  const backPlate = buildPlate({ ...params, plate: bp }, layout, mats);
  backPlate.name = 'BackPlate';
  backPlate.rotation.y = Math.PI;
  backPlate.position.z = layout.zBottom;
  base.add(backPlate);
  // lowest point when the case lies on its back (the plate's frame)
  const zRest = layout.zBottom - (bp.frameThickness + 2 * bp.frameBevel - bp.embed);

  // Hat, and the ring height that lands the crown's base exactly on the seam plane
  const ip = op.insert;
  const hat = buildHat(hp);
  let lift = -Infinity;
  for (let i = 0; i <= 600; i++) {
    const d = ip.ringInner + ((ip.ringOuter - ip.ringInner) * i) / 600;
    lift = Math.max(lift, ringTopProfile(ip, d) - hat.userData.brimUnderside(d));
  }
  delete hat.userData.brimUnderside; // not exported
  const hole = layout.bowlCenter;
  const levels = {
    pad: layout.zBaseBack + params.body.wall + ip.padThickness,
    ringTop: -lift,
    cavityFloor: layout.zBottom + params.body.wall,
  };
  base.add(buildInsert(params, op, layout, hole, levels, mats.velvet));
  const zs = 0; // crown base / brim plane of the resting hat
  const zc = levels.cavityFloor;

  // Hinge axis: along x, just outside the top of the outline, at the seam
  const hg = op.hinge;
  const axisY = params.body.height + hg.offset;
  const axisZ = layout.seamZ;
  const knuckle = (x0, x1, name) => {
    const g = new THREE.CylinderGeometry(hg.knuckleRadius, hg.knuckleRadius, x1 - x0, 24);
    g.rotateZ(Math.PI / 2);
    const k = mesh(g, mats.hinge, name);
    k.position.set((x0 + x1) / 2, axisY, axisZ);
    return k;
  };
  const third = hg.knuckleLength / 3;

  // Lid on its pivot
  const lid = new THREE.Group();
  lid.name = 'Lid';
  lid.add(
    mesh(surf.lidOuter, mats.shell, 'LidShell'),
    mesh(surf.lidRim, mats.shell, 'LidRim'),
    mesh(surf.lidInner, mats.velvet, 'LidLining'),
    mesh(piping(params, layout, surf.seamTop + params.seam.pipingRadius), mats.trim, 'LidTrim'),
    buildPlate(params, layout, mats),
    buildLidLabel(op, layout, mats, labelTexture),
  );
  for (const x of hg.knuckles) {
    base.add(knuckle(x - 1.5 * third, x - 0.5 * third - 0.0005, 'HingeBase'));
    base.add(knuckle(x + 0.5 * third + 0.0005, x + 1.5 * third, 'HingeBase'));
    lid.add(knuckle(x - 0.5 * third, x + 0.5 * third, 'HingeLid'));
  }
  const lidPivot = new THREE.Group();
  lidPivot.name = 'LidHinge';
  lidPivot.position.set(0, axisY, axisZ);
  lid.position.set(0, -axisY, -axisZ);
  lidPivot.add(lid);

  // Hat: local +y (head opening) points along the case's +z (up when lying)
  const hatRest = new THREE.Vector3(hole.x, hole.y, zs);
  const hatHolder = new THREE.Group();
  hatHolder.name = 'HatHolder';
  hatHolder.rotation.x = Math.PI / 2;
  hatHolder.position.copy(hatRest);
  hatHolder.add(hat);

  const root = new THREE.Group();
  root.name = 'OpenHatCase';
  root.add(base, lidPivot, hatHolder);
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
    if (o.isMesh && o.material === mats.velvet) planarUV(o.geometry);
  });

  return {
    root,
    lidPivot,
    hatHolder,
    hatRest,
    materials: mats,
    info: { zRest, hole, zs, zc, pad: levels.pad, ringTop: levels.ringTop, crown: CROWN_BASE, axisY, axisZ, seamZ: layout.seamZ, layout },
    setLid(deg) {
      lidPivot.rotation.x = -THREE.MathUtils.degToRad(deg);
    },
    setHatLift(d) {
      hatHolder.position.set(hatRest.x, hatRest.y, hatRest.z + d);
    },
  };
}

// Closed case for the viewer: the same parts with the lid shut and no hat.
export function buildHatCase(params, op, hp, textures = {}) {
  const c = buildOpenCase(params, op, hp, textures);
  c.root.remove(c.hatHolder);
  c.root.name = 'HatCase';
  c.root.position.y = -new THREE.Box3().setFromObject(c.root).min.y;
  return c.root;
}
