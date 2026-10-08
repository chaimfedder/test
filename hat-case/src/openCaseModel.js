// Openable hat case: base and lid as separate parts on a hinge, a velvet
// support with a crown cavity, and the hat. Used by the product video.
// Shares the outline, relief, handle and brand plate with caseModel.js.

import * as THREE from 'three';
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
  const rb = b.backEdgeRadius;
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

  // Base: rim -> side wall -> rounded back edge -> back face -> back center
  const baseRings = () => {
    const rings = [];
    const sideSteps = 36;
    for (let r = 0; r <= sideSteps; r++) {
      const z = seamBottom + (layout.sideBottom - seamBottom) * (r / sideSteps);
      rings.push(ringFrom(N, (k) => [...inset(k, 0), z]));
    }
    for (let r = 1; r <= m.backEdgeRings; r++) {
      const ph = (r / m.backEdgeRings) * (Math.PI / 2);
      rings.push(ringFrom(N, (k) => [...inset(k, rb * (1 - Math.cos(ph))), layout.zBackPlane + rb - rb * Math.sin(ph)]));
    }
    const bp = params.back;
    for (let r = m.backRings - 1; r >= 1; r--) {
      const s = r / m.backRings;
      rings.push(ringFrom(N, (k) => {
        const [qx, qy] = inset(k, rb);
        const rad = Math.hypot(qx - c.x, qy - c.y);
        const dist = (s - bp.panelLine) * rad;
        const panel = bp.panelDepth * Math.exp(-((dist / (bp.panelWidth * 0.5)) ** 2));
        return [c.x + (qx - c.x) * s, c.y + (qy - c.y) * s, layout.zBackPlane - b.backDome * (1 - s * s) + panel];
      }));
    }
    return { rings, center: [c.x, c.y, layout.zBackPlane - b.backDome] };
  };

  const inside = new THREE.Vector3(c.x, c.y, (layout.sideTop + layout.sideBottom) / 2);
  const outward = (p, n) => n.dot(p.clone().sub(inside));
  const inward = (p, n) => -outward(p, n);

  const lidReal = lidRings(true);
  const lidSmooth = lidRings(false);
  const lidOuter = orient(ringGeometry(lidReal.rings, N, lidReal.center), outward);
  const lidSmoothGeo = orient(ringGeometry(lidSmooth.rings, N, lidSmooth.center), outward);
  const lidInner = orient(offsetGeometry(lidSmoothGeo, op.wall), inward);
  const lidRim = orient(
    ringGeometry([lidReal.rings[lidReal.rings.length - 1], ringFrom(N, (k) => [...inset(k, op.wall), seamTop])], N),
    (p, n) => -n.z,
  );

  const base = baseRings();
  const baseOuter = orient(ringGeometry(base.rings, N, null, base.center), outward);
  const baseInner = orient(offsetGeometry(baseOuter, op.wall), inward);
  const baseRim = orient(
    ringGeometry([ringFrom(N, (k) => [...inset(k, op.wall), seamBottom]), base.rings[0]], N),
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

// Largest circle inside the inner outline, center on the symmetry axis.
function fitCircle(layout, wall) {
  const pts = layout.outline.map(({ p, n }) => new THREE.Vector2(p.x - n.x * wall, p.y - n.y * wall));
  let best = { y: 0, r: 0 };
  const ys = pts.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  for (let i = 0; i <= 400; i++) {
    const y = lo + ((hi - lo) * i) / 400;
    let r = Infinity;
    for (let k = 0; k < pts.length; k++) {
      const q = pts[k];
      const w = pts[(k + 1) % pts.length];
      const ex = w.x - q.x;
      const ey = w.y - q.y;
      const t = Math.min(Math.max(((0 - q.x) * ex + (y - q.y) * ey) / (ex * ex + ey * ey), 0), 1);
      r = Math.min(r, Math.hypot(q.x + ex * t, q.y + ey * t - y));
    }
    if (r > best.r) best = { y, r };
  }
  return { center: new THREE.Vector2(0, best.y), radius: best.r };
}

function buildInsert(params, op, layout, hole, zs, zc, material) {
  const ip = op.insert;
  const N = params.mesh.perimeter;
  const edge = op.wall - ip.overlap;
  const outlinePts = layout.outline.map(({ p, n }) => new THREE.Vector2(p.x - n.x * edge, p.y - n.y * edge));
  const shape = new THREE.Shape(outlinePts);
  const holePath = new THREE.Path();
  holePath.absarc(hole.x, hole.y, ip.holeRadius + ip.rollRadius, 0, Math.PI * 2, true);
  shape.holes.push(holePath);
  const top = new THREE.ShapeGeometry(shape, 96);
  top.translate(0, 0, zs);

  // Cavity: rolled edge, wall, filleted floor (lathe around the cavity axis)
  const prof = [];
  const R = ip.holeRadius;
  const rr = ip.rollRadius;
  const rf = ip.floorFillet;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI / 2 - (i / 10) * (Math.PI / 2); // from top of the roll to its inner side
    prof.push(new THREE.Vector2(R + rr - rr * Math.cos(a), zs - rr + rr * Math.sin(a)));
  }
  prof.push(new THREE.Vector2(R, zc + rf));
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    prof.push(new THREE.Vector2(R - rf + rf * Math.cos(a), zc + rf - rf * Math.sin(a)));
  }
  prof.push(new THREE.Vector2(0.0001, zc));
  const cavity = new THREE.LatheGeometry(prof, N / 2);
  cavity.rotateX(Math.PI / 2);
  cavity.translate(hole.x, hole.y, 0);

  const g = new THREE.Group();
  g.name = 'Insert';
  const m1 = new THREE.Mesh(top, material);
  m1.name = 'InsertSurface';
  const m2 = new THREE.Mesh(cavity, material);
  m2.name = 'InsertCavity';
  g.add(m1, m2);
  return g;
}

function buildLidLabel(op, layout, materials, labelTexture) {
  const lp = op.label;
  const zInner = layout.domeZ(layout.sAt(0, lp.y)) - op.wall;
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

function lathe(points, segments, material, name) {
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), segments);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  return mesh;
}

export function buildHat(hp, brimRadius) {
  const m = hp.materials;
  const mats = {
    felt: new THREE.MeshPhysicalMaterial({ ...m.felt, name: 'Hat_Felt' }),
    band: new THREE.MeshPhysicalMaterial({ ...m.band, name: 'Hat_Band' }),
    sweatband: new THREE.MeshPhysicalMaterial({ ...m.sweatband, name: 'Hat_Sweatband', side: THREE.DoubleSide }),
    lining: new THREE.MeshPhysicalMaterial({ ...m.lining, name: 'Hat_Lining', side: THREE.DoubleSide }),
  };
  const Hc = hp.crownHeight;
  const rB = hp.crownBaseRadius;
  const rT = hp.crownTopRadius;
  const tr = hp.crownTopRound;
  const bt = hp.brimThickness;
  const Rb = brimRadius;
  const ft = hp.felt;
  const ro = rB - ft; // head opening
  const crownR = (y) => rB + (rT - rB) * (-y / Hc);
  const S = hp.segments;
  const arc = (cx, cy, r, a0, a1, n) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  };

  // Felt: crown top (dented) -> crown side -> brim underside -> edge -> brim top -> opening
  const felt = [];
  for (let i = 0; i <= 12; i++) {
    const r = ((rT - tr) * i) / 12;
    felt.push([r, -Hc + hp.crownDent * (1 - smoothstep(0, (rT - tr) * 0.9, r))]);
  }
  felt.push(...arc(rT - tr, -Hc + tr, tr, -Math.PI / 2, 0, 10).slice(1));
  for (let i = 1; i <= 16; i++) {
    const y = -Hc + tr + ((-0.006 - (-Hc + tr)) * i) / 16;
    felt.push([crownR(y), y]);
  }
  felt.push(...arc(rB + 0.006, -0.006, 0.006, Math.PI, Math.PI / 2, 6).slice(1));
  for (let i = 1; i <= 12; i++) felt.push([rB + 0.006 + ((Rb - bt / 2 - rB - 0.006) * i) / 12, 0]);
  felt.push(...arc(Rb - bt / 2, bt / 2, bt / 2, -Math.PI / 2, Math.PI / 2, 8).slice(1));
  for (let i = 1; i <= 12; i++) felt.push([Rb - bt / 2 + (ro + 0.004 - (Rb - bt / 2)) * (i / 12), bt]);
  felt.push(...arc(ro + 0.004, bt - 0.004, 0.004, Math.PI / 2, Math.PI, 6).slice(1));

  const sd = hp.sweatbandDepth;
  const sweat = [
    [ro, bt - 0.003],
    [ro - 0.0018, bt - 0.0045],
    [ro - 0.002, bt - sd],
    [ro - 0.0006, bt - sd - 0.0022],
  ];

  const lining = [];
  const y0 = bt - sd - 0.001;
  const yTop = -Hc + ft + tr;
  for (let i = 0; i <= 24; i++) {
    const y = y0 + (yTop - y0) * (i / 24);
    lining.push([crownR(y) - ft, y]);
  }
  lining.push(...arc(rT - tr, -Hc + tr, tr - ft, 0, -Math.PI / 2, 8).slice(1));
  for (let i = 1; i <= 10; i++) {
    const r = (rT - tr) * (1 - i / 10);
    lining.push([r, -Hc + ft + hp.crownDent * (1 - smoothstep(0, (rT - tr) * 0.9, r))]);
  }

  const band = [];
  const yb = -0.004 - hp.bandHeight;
  const yt = -0.004;
  band.push([crownR(yb), yb], [crownR(yb) + 0.0016, yb + 0.0008], [crownR(yt) + 0.0016, yt - 0.0008], [crownR(yt), yt]);

  const hat = new THREE.Group();
  hat.name = 'Hat';
  const feltMesh = lathe(felt, S, mats.felt, 'HatFelt');
  const sweatMesh = lathe(sweat, S, mats.sweatband, 'HatSweatband');
  const liningMesh = lathe(lining, S, mats.lining, 'HatLining');
  const bandMesh = lathe(band, S, mats.band, 'HatBand');

  // Soft folds in the satin lining
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

  for (const mesh of [feltMesh, bandMesh, sweatMesh, liningMesh]) mesh.geometry.scale(1, 1, hp.oval);
  hat.add(feltMesh, bandMesh, sweatMesh, liningMesh);
  hat.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
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

  // Support with the crown cavity
  const fit = fitCircle(layout, op.wall);
  const brimRadius = Math.min(hp.brimRadius, fit.radius - 0.006);
  const hole = fit.center;
  const zs = surf.seamBottom - op.insert.surfaceBelowSeam;
  const zc = zs - (hp.crownHeight + op.insert.crownClearance);
  base.add(buildInsert(params, op, layout, hole, zs, zc, mats.velvet));

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
  const hat = buildHat(hp, brimRadius);
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
    info: { brimRadius, hole, zs, zc, axisY, axisZ, seamZ: layout.seamZ, layout },
    setLid(deg) {
      lidPivot.rotation.x = -THREE.MathUtils.degToRad(deg);
    },
    setHatLift(d) {
      hatHolder.position.set(hatRest.x, hatRest.y, hatRest.z + d);
    },
  };
}
