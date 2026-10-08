// Geometry and materials of the closed hat case.
// Pure model code: no renderer, camera or DOM. The viewer and the export
// tools import `buildHatCase` and add the returned group to their scene.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shield outline
// ---------------------------------------------------------------------------
// Closed convex outline built from tangent-continuous pieces:
// top arc -> rounded top corners -> straight sides -> side arcs -> round tip.
// Coordinates: x in [-width/2, width/2], y in [0, height], tip at (0, 0).

function shieldPieces(p) {
  const W2 = p.width / 2;
  const H = p.height;
  const sb = Math.max(p.topBulge, 1e-5);
  const Rc = p.topCornerRadius;
  const Ra = p.sideArcRadius;
  const Rt = p.tipRadius;

  const Rtop = (W2 * W2 + sb * sb) / (2 * sb);
  const ctop = new THREE.Vector2(0, H - Rtop);
  const qc = (Rtop - Rc) ** 2 - (W2 - Rc) ** 2;
  const qa = (Ra - Rt) ** 2 - (W2 - Ra) ** 2;
  if (qc <= 0 || qa <= 0) throw new Error('shield outline: radii do not fit the width');
  const ccorner = new THREE.Vector2(W2 - Rc, H - Rtop + Math.sqrt(qc));
  const ys = Rt + Math.sqrt(qa); // where the straight side ends
  const cside = new THREE.Vector2(W2 - Ra, ys);
  const ctip = new THREE.Vector2(0, Rt);
  if (ys > ccorner.y) throw new Error('shield outline: height too small for these radii');

  const a1 = Math.atan2(ccorner.y - ctop.y, ccorner.x - ctop.x);
  const a2 = Math.atan2(ctip.y - cside.y, ctip.x - cside.x);
  if (a2 < -Math.PI / 2 - 1e-9) throw new Error('shield outline: sideArcRadius too small');

  const arc = (c, r, from, to) => ({
    length: Math.abs(to - from) * r,
    at(u) {
      const a = from + (to - from) * u;
      const n = new THREE.Vector2(Math.cos(a), Math.sin(a));
      return { p: c.clone().addScaledVector(n, r), n };
    },
  });
  const line = (a, b, n) => ({
    length: a.distanceTo(b),
    at(u) {
      return { p: a.clone().lerp(b, u), n: n.clone() };
    },
  });

  // Right half, from the top center going clockwise down to the tip.
  return [
    arc(ctop, Rtop, Math.PI / 2, a1),
    arc(ccorner, Rc, a1, 0),
    line(new THREE.Vector2(W2, ccorner.y), new THREE.Vector2(W2, ys), new THREE.Vector2(1, 0)),
    arc(cside, Ra, 0, a2),
    arc(ctip, Rt, a2, -Math.PI / 2),
  ];
}

// Returns `count` points spaced evenly by arc length, counter-clockwise,
// starting at the bottom tip, each with its outward unit normal.
export function shieldOutline(p, count) {
  const right = shieldPieces(p);
  const half = right.reduce((s, piece) => s + piece.length, 0);
  const total = half * 2;
  const pts = [];
  for (let i = 0; i < count; i++) {
    // distance along the outline measured from the tip, counter-clockwise
    let d = (i / count) * total;
    let mirror = false;
    if (d <= half) {
      d = half - d; // on the right half, measured from the top center
    } else {
      d = d - half;
      mirror = true;
    }
    let k = 0;
    while (k < right.length - 1 && d > right[k].length) {
      d -= right[k].length;
      k++;
    }
    const { p: pt, n } = right[k].at(Math.min(d / right[k].length, 1));
    if (mirror) {
      pt.x = -pt.x;
      n.x = -n.x;
    }
    pts.push({ p: pt, n });
  }
  return pts;
}

// Parameters of the outline offset outward by `f` (exact for arc outlines).
export function offsetShield(p, f) {
  const W2 = p.width / 2;
  const sb = Math.max(p.topBulge, 1e-5);
  const Rtop = (W2 * W2 + sb * sb) / (2 * sb) + f;
  const W2o = W2 + f;
  return {
    width: p.width + 2 * f,
    height: p.height + 2 * f,
    topBulge: Rtop - Math.sqrt(Rtop * Rtop - W2o * W2o),
    topCornerRadius: p.topCornerRadius + f,
    sideArcRadius: p.sideArcRadius + f,
    tipRadius: p.tipRadius + f,
  };
}

export function shapeFromOutline(outline, dx = 0, dy = 0) {
  return new THREE.Shape(outline.map(({ p }) => new THREE.Vector2(p.x + dx, p.y + dy)));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

function catmullRom(points, samplesPerSpan) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    false,
    'centripetal',
  );
  return curve.getSpacedPoints((points.length - 1) * samplesPerSpan).map((v) => new THREE.Vector2(v.x, v.y));
}

// Signed distance from a point to a closed polygon (negative inside).
function polygonSignedDistance(poly, x, y) {
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const t = Math.min(Math.max(((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey), 0), 1);
    const dx = x - (a.x + ex * t);
    const dy = y - (a.y + ey * t);
    best = Math.min(best, dx * dx + dy * dy);
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? -Math.sqrt(best) : Math.sqrt(best);
}

// ---------------------------------------------------------------------------
// Front relief (sculpted lines) as a height field over the front face
// ---------------------------------------------------------------------------

function buildReliefLines(params) {
  const { width: W, height: H } = params.body;
  const toModel = ([X, Y]) => [X * W, H * (1 - Y)];
  const lines = [];
  for (const def of params.frontRelief.lines) {
    const variants = [{ pts: def.points, hint: def.raised }];
    if (def.mirror) {
      variants.push({ pts: def.points.map(([X, Y]) => [-X, Y]), hint: [-def.raised[0], def.raised[1]] });
    }
    for (const v of variants) {
      const poly = catmullRom(v.pts.map(toModel), 24);
      const cum = [0];
      for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + poly[i].distanceTo(poly[i - 1]));
      const len = cum[cum.length - 1];
      // decide which side (left/right of the travel direction) is raised
      const mid = Math.floor(poly.length / 2);
      const dir = poly[mid + 1].clone().sub(poly[mid]).normalize();
      const left = new THREE.Vector2(-dir.y, dir.x);
      const hint = new THREE.Vector2(v.hint[0], -v.hint[1]); // Y is down in normalized coords
      const sigma = left.dot(hint) >= 0 ? 1 : -1;
      const box = new THREE.Box2().setFromPoints(poly);
      lines.push({ poly, cum, len, sigma, box, taper: def.taper });
    }
  }
  return lines;
}

function reliefHeight(lines, rp, x, y) {
  const reach = Math.max(rp.stepReach * 2.5, rp.grooveSigma * 4);
  let h = 0;
  for (const L of lines) {
    if (x < L.box.min.x - reach || x > L.box.max.x + reach || y < L.box.min.y - reach || y > L.box.max.y + reach) {
      continue;
    }
    let bestD2 = Infinity;
    let bestSigned = 0;
    let bestU = 0;
    const poly = L.poly;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const l2 = ex * ex + ey * ey;
      const t = Math.min(Math.max(((x - a.x) * ex + (y - a.y) * ey) / l2, 0), 1);
      const dx = x - (a.x + ex * t);
      const dy = y - (a.y + ey * t);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        const cross = ex * dy - ey * dx; // > 0 when the point is left of the segment
        bestSigned = Math.sign(cross) * Math.sqrt(d2);
        bestU = (L.cum[i] + t * Math.sqrt(l2)) / L.len;
      }
    }
    if (bestD2 > reach * reach) continue;
    const q = bestSigned * L.sigma; // > 0 on the raised side
    const groove = -rp.grooveDepth * Math.exp(-((q / rp.grooveSigma) ** 2));
    const step = rp.stepHeight * smoothstep(0, rp.stepWidth, q) * Math.exp(-((Math.max(q, 0) / rp.stepReach) ** 2));
    const [ta, tb] = L.taper;
    const fade = (ta > 0 ? smoothstep(0, ta, bestU) : 1) * (tb > 0 ? smoothstep(0, tb, 1 - bestU) : 1);
    h += (groove + step) * fade;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Shell (one closed surface: front face, rounded edges, side wall, back)
// ---------------------------------------------------------------------------

function buildShell(params, layout) {
  const b = params.body;
  const m = params.mesh;
  const N = m.perimeter;
  const outline = layout.outline;
  const { zFrontPlane, zBackPlane } = layout;
  const re = b.frontEdgeRadius;
  const rb = b.backEdgeRadius;
  const c = layout.center;

  const sideTop = zFrontPlane - re;
  const sideBottom = zBackPlane + rb;
  const seamZ = layout.seamZ;
  const sp = params.seam;
  const grooveSigma = sp.grooveWidth * 0.42;

  const inset = (k, d) => {
    const o = outline[k];
    return new THREE.Vector2(o.p.x - o.n.x * d, o.p.y - o.n.y * d);
  };

  const rings = []; // each ring: function(k) -> [x, y, z]

  // Front face (dome + relief + flat seat under the plate)
  for (let r = 1; r <= m.frontRings; r++) {
    const s = r / m.frontRings;
    rings.push((k) => {
      const q = inset(k, re);
      const x = c.x + (q.x - c.x) * s;
      const y = c.y + (q.y - c.y) * s;
      return [x, y, layout.frontHeight(x, y, s)];
    });
  }
  // Front rounded edge
  for (let r = 1; r <= m.frontEdgeRings; r++) {
    const th = (r / m.frontEdgeRings) * (Math.PI / 2);
    rings.push((k) => {
      const q = inset(k, re * (1 - Math.sin(th)));
      return [q.x, q.y, zFrontPlane - re + re * Math.cos(th)];
    });
  }
  // Side wall, denser around the seam groove
  const sideZ = [];
  for (let r = 1; r < m.sideRings; r++) {
    const u = r / m.sideRings;
    sideZ.push(sideTop + (sideBottom - sideTop) * u);
  }
  for (let r = -6; r <= 6; r++) sideZ.push(seamZ + (r / 6) * sp.grooveWidth);
  sideZ.sort((a, b2) => b2 - a);
  const sideZClean = sideZ.filter((z, i) => i === 0 || sideZ[i - 1] - z > 1e-4);
  sideZClean.push(sideBottom);
  for (const z of sideZClean) {
    const g = sp.grooveDepth * Math.exp(-(((z - seamZ) / grooveSigma) ** 2));
    rings.push((k) => {
      const q = inset(k, g);
      return [q.x, q.y, z];
    });
  }
  // Back rounded edge
  for (let r = 1; r <= m.backEdgeRings; r++) {
    const ph = (r / m.backEdgeRings) * (Math.PI / 2);
    rings.push((k) => {
      const q = inset(k, rb * (1 - Math.cos(ph)));
      return [q.x, q.y, zBackPlane + rb - rb * Math.sin(ph)];
    });
  }
  // Back face (gentle dome + one panel line)
  const bp = params.back;
  for (let r = m.backRings - 1; r >= 1; r--) {
    const s = r / m.backRings;
    rings.push((k) => {
      const q = inset(k, rb);
      const x = c.x + (q.x - c.x) * s;
      const y = c.y + (q.y - c.y) * s;
      const rad = Math.hypot(q.x - c.x, q.y - c.y);
      const dist = (s - bp.panelLine) * rad;
      const panel = bp.panelDepth * Math.exp(-((dist / (bp.panelWidth * 0.5)) ** 2));
      return [x, y, zBackPlane - b.backDome * (1 - s * s) + panel];
    });
  }

  const ringCount = rings.length;
  const vertCount = 2 + ringCount * N;
  const pos = new Float32Array(vertCount * 3);
  const frontCenterZ = layout.frontHeight(c.x, c.y, 0);
  pos.set([c.x, c.y, frontCenterZ], 0);
  for (let r = 0; r < ringCount; r++) {
    for (let k = 0; k < N; k++) {
      pos.set(rings[r](k), (1 + r * N + k) * 3);
    }
  }
  const backCenter = vertCount - 1;
  pos.set([c.x, c.y, zBackPlane - b.backDome], backCenter * 3);

  const idx = [];
  const at = (r, k) => 1 + r * N + (k % N);
  for (let k = 0; k < N; k++) idx.push(0, at(0, k), at(0, k + 1));
  for (let r = 0; r < ringCount - 1; r++) {
    for (let k = 0; k < N; k++) {
      const a = at(r, k);
      const bq = at(r, k + 1);
      const cq = at(r + 1, k);
      const d = at(r + 1, k + 1);
      idx.push(a, cq, bq, bq, cq, d);
    }
  }
  const last = ringCount - 1;
  for (let k = 0; k < N; k++) idx.push(at(last, k), backCenter, at(last, k + 1));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Swept tubes (handle and seam trim)
// ---------------------------------------------------------------------------

// path: array of {p: Vector3, side: Vector3 (unit, in-plane), up: Vector3 (unit)}
// section(j) -> [a, b] offsets along side/up; scale(i) multiplies the section.
export function sweep(path, sectionCount, section, scale, closed) {
  const n = path.length;
  const pos = new Float32Array(n * sectionCount * 3);
  for (let i = 0; i < n; i++) {
    const { p, side, up } = path[i];
    const s = scale(i);
    for (let j = 0; j < sectionCount; j++) {
      const [a, b] = section(j);
      const o = (i * sectionCount + j) * 3;
      pos[o] = p.x + side.x * a * s + up.x * b * s;
      pos[o + 1] = p.y + side.y * a * s + up.y * b * s;
      pos[o + 2] = p.z + side.z * a * s + up.z * b * s;
    }
  }
  const idx = [];
  const rowsEnd = closed ? n : n - 1;
  for (let i = 0; i < rowsEnd; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < sectionCount; j++) {
      const j2 = (j + 1) % sectionCount;
      const a = i * sectionCount + j;
      const b = i * sectionCount + j2;
      const c = i2 * sectionCount + j;
      const d = i2 * sectionCount + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildHandle(params, layout) {
  const h = params.handle;
  const H = params.body.height;
  const half = h.outerWidth / 2 - h.thickness / 2; // path x of the legs at the top
  const baseX = half + h.legSpread;
  const yBar = H + h.height - h.thickness / 2;
  const rc = h.cornerRadius;
  const yBase = (x) => layout.topY(x) - h.embed;

  // Path in the x/y plane: left base -> up -> rounded corner -> bar -> corner -> right base
  const cubic = (p0, p1, p2, p3) => new THREE.CubicBezierCurve(p0, p1, p2, p3);
  const V = (x, y) => new THREE.Vector2(x, y);
  const curve = new THREE.CurvePath();
  curve.add(new THREE.LineCurve(V(-baseX, yBase(-baseX)), V(-half, yBar - rc)));
  curve.add(cubic(V(-half, yBar - rc), V(-half, yBar - rc * 0.45), V(-half + rc * 0.45, yBar), V(-half + rc, yBar)));
  curve.add(new THREE.LineCurve(V(-half + rc, yBar), V(half - rc, yBar)));
  curve.add(cubic(V(half - rc, yBar), V(half - rc * 0.45, yBar), V(half, yBar - rc * 0.45), V(half, yBar - rc)));
  curve.add(new THREE.LineCurve(V(half, yBar - rc), V(baseX, yBase(baseX))));

  const n = params.mesh.handlePath;
  const pts2 = curve.getSpacedPoints(n - 1);
  const total = curve.getLength();
  const z = layout.zCenter + h.zOffset;
  const path = pts2.map((p, i) => {
    const a = pts2[Math.max(i - 1, 0)];
    const b = pts2[Math.min(i + 1, n - 1)];
    const t = b.clone().sub(a).normalize();
    return {
      p: new THREE.Vector3(p.x, p.y, z),
      side: new THREE.Vector3(t.y, -t.x, 0), // outward from the arch
      up: new THREE.Vector3(0, 0, 1),
    };
  });

  const M = params.mesh.handleSection;
  const ex = 2 / 3.2; // superellipse exponent -> softly squared section
  const section = (j) => {
    const a = (j / M) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
      (h.thickness / 2) * Math.sign(c) * Math.abs(c) ** ex,
      (h.depth / 2) * Math.sign(s) * Math.abs(s) ** ex,
    ];
  };
  const scale = (i) => {
    const d = Math.min(i, n - 1 - i) * (total / (n - 1));
    return 1 + (h.baseFlare - 1) * (1 - smoothstep(0, h.flareLength + h.embed, d));
  };
  return sweep(path, M, section, scale, false);
}

function buildPiping(params, layout) {
  const sp = params.seam;
  const N = params.mesh.perimeter;
  const off = sp.pipingRadius - sp.pipingProtrusion; // center inside the side wall
  const path = layout.outline.slice(0, N).map(({ p, n }) => ({
    p: new THREE.Vector3(p.x - n.x * off, p.y - n.y * off, layout.seamZ),
    side: new THREE.Vector3(n.x, n.y, 0),
    up: new THREE.Vector3(0, 0, 1),
  }));
  const M = params.mesh.pipingSection;
  const section = (j) => {
    const a = (j / M) * Math.PI * 2;
    return [Math.cos(a) * sp.pipingRadius, Math.sin(a) * sp.pipingRadius];
  };
  return sweep(path, M, section, () => 1, true);
}

// ---------------------------------------------------------------------------
// Brand plate
// ---------------------------------------------------------------------------

export function buildPlate(params, layout, materials) {
  const pl = params.plate;
  const inner = pl.inner;
  const outer = offsetShield(inner, pl.frameWidth);
  const holeP = offsetShield(inner, -pl.lip);
  const count = 220;

  // Plate-local coordinates: (0, 0) is the tip of the silver face.
  const f = pl.frameWidth;
  const outerShape = shapeFromOutline(shieldOutline(outer, count), 0, -f);
  const hole = shapeFromOutline(shieldOutline(holeP, count), 0, pl.lip);
  outerShape.holes.push(new THREE.Path(hole.getPoints()));

  const bevel = pl.frameBevel;
  const frameGeo = new THREE.ExtrudeGeometry(outerShape, {
    depth: pl.frameThickness,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 4,
    curveSegments: 1,
  });
  // ExtrudeGeometry spans z = -bevel .. depth + bevel; put its back at z = -embed
  frameGeo.translate(0, 0, -pl.embed + bevel);
  const frameFront = -pl.embed + bevel + pl.frameThickness + bevel;

  // Silver face: UVs span the bounding box of the face (texture = that box)
  const faceShape = shapeFromOutline(shieldOutline(inner, count));
  const W = inner.width;
  const Hh = inner.height;
  const uvGen = {
    generateTopUV(geometry, v, a, b, c) {
      const uv = (i) => new THREE.Vector2((v[i * 3] + W / 2) / W, v[i * 3 + 1] / Hh);
      return [uv(a), uv(b), uv(c)];
    },
    generateSideWallUV(geometry, v, a, b, c, d) {
      const uv = (i) => new THREE.Vector2((v[i * 3] + W / 2) / W, v[i * 3 + 1] / Hh);
      return [uv(a), uv(b), uv(c), uv(d)];
    },
  };
  const faceGeo = new THREE.ExtrudeGeometry(faceShape, {
    depth: pl.faceThickness,
    bevelEnabled: false,
    curveSegments: 1,
    UVGenerator: uvGen,
  });
  faceGeo.translate(0, 0, frameFront - pl.faceRecess - pl.faceThickness);

  const frame = new THREE.Mesh(frameGeo, materials.plateFrame);
  frame.name = 'PlateFrame';
  const face = new THREE.Mesh(faceGeo, materials.plateFace);
  face.name = 'PlateFace';
  const group = new THREE.Group();
  group.name = 'BrandPlate';
  group.add(frame, face);
  group.position.set(0, layout.plateTipY, layout.plateSeatZ);
  return group;
}

// ---------------------------------------------------------------------------
// Layout shared by all parts
// ---------------------------------------------------------------------------

export function computeLayout(params) {
  const b = params.body;
  const N = params.mesh.perimeter;
  const outline = shieldOutline(b, N);

  const zFront = b.depth / 2;
  const zFrontPlane = zFront - b.frontDome;
  const zBackPlane = -b.depth / 2 + b.backDome;
  const sideTop = zFrontPlane - b.frontEdgeRadius;
  const sideBottom = zBackPlane + b.backEdgeRadius;
  if (sideTop <= sideBottom) throw new Error('depth too small for the edge radii and domes');
  const seamZ = sideTop + (sideBottom - sideTop) * params.seam.position;

  // Area centroid of the outline: center of the dome and of the face rings
  let A = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < N; i++) {
    const p = outline[i].p;
    const q = outline[(i + 1) % N].p;
    const cr = p.x * q.y - q.x * p.y;
    A += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  const center = new THREE.Vector2(cx / (3 * A), cy / (3 * A));

  // Polar table of the inset outline (for the dome height at any x, y)
  const re = b.frontEdgeRadius;
  const polar = outline
    .map(({ p, n }) => {
      const x = p.x - n.x * re - center.x;
      const y = p.y - n.y * re - center.y;
      return { a: Math.atan2(y, x), r: Math.hypot(x, y) };
    })
    .sort((u, v) => u.a - v.a);
  const radiusAt = (ang) => {
    let lo = 0;
    let hi = polar.length - 1;
    if (ang <= polar[0].a || ang >= polar[hi].a) {
      const p0 = polar[hi];
      const p1 = polar[0];
      const span = p1.a + 2 * Math.PI - p0.a;
      const t = ((ang < p1.a ? ang + 2 * Math.PI : ang) - p0.a) / span;
      return p0.r + (p1.r - p0.r) * t;
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (polar[mid].a <= ang) lo = mid;
      else hi = mid;
    }
    const t = (ang - polar[lo].a) / (polar[hi].a - polar[lo].a);
    return polar[lo].r + (polar[hi].r - polar[lo].r) * t;
  };
  const sAt = (x, y) => Math.hypot(x - center.x, y - center.y) / radiusAt(Math.atan2(y - center.y, x - center.x));
  const domeZ = (s) => zFrontPlane + b.frontDome * (1 - s * s);

  // Plate placement and the flat seat under it
  const pl = params.plate;
  const plateTipY = b.height - pl.top - pl.inner.height;
  const outerParams = offsetShield(pl.inner, pl.frameWidth);
  const plateOuter = shieldOutline(outerParams, 160).map(({ p }) => new THREE.Vector2(p.x, p.y + plateTipY - pl.frameWidth));
  let seatZ = Infinity;
  for (const p of plateOuter) seatZ = Math.min(seatZ, domeZ(sAt(p.x, p.y)));
  const plateBox = new THREE.Box2().setFromPoints(plateOuter);
  const seatReach = pl.seatMargin + pl.seatBlend;

  const lines = buildReliefLines(params);
  const rp = params.frontRelief;
  const frontHeight = (x, y, s) => {
    let z = domeZ(s);
    z += reliefHeight(lines, rp, x, y) * (1 - smoothstep(rp.edgeFadeStart, 1, s));
    if (
      x > plateBox.min.x - seatReach && x < plateBox.max.x + seatReach &&
      y > plateBox.min.y - seatReach && y < plateBox.max.y + seatReach
    ) {
      const d = polygonSignedDistance(plateOuter, x, y);
      const w = 1 - smoothstep(pl.seatMargin, seatReach, d);
      z = z + (seatZ - z) * w;
    }
    return z;
  };

  // Height of the top edge of the outline at a given x (for the handle legs)
  const topY = (x) => {
    let best = -Infinity;
    for (let i = 0; i < N; i++) {
      const p = outline[i].p;
      const q = outline[(i + 1) % N].p;
      if ((p.x - x) * (q.x - x) <= 0 && p.x !== q.x) {
        const t = (x - p.x) / (q.x - p.x);
        best = Math.max(best, p.y + (q.y - p.y) * t);
      }
    }
    return best;
  };

  return {
    outline,
    center,
    zFrontPlane,
    zBackPlane,
    zCenter: (sideTop + sideBottom) / 2,
    sideTop,
    sideBottom,
    domeZ,
    sAt,
    seamZ,
    frontHeight,
    plateTipY,
    plateSeatZ: seatZ,
    topY,
  };
}

// ---------------------------------------------------------------------------
// Materials and assembly
// ---------------------------------------------------------------------------

export function createMaterials(params, logoTexture = null) {
  const m = params.materials;
  const shell = new THREE.MeshPhysicalMaterial({ ...m.shell, name: 'Shell_Graphite' });
  const handle = new THREE.MeshStandardMaterial({ ...m.handle, name: 'Handle_Graphite' });
  const trim = new THREE.MeshStandardMaterial({ ...m.trim, name: 'Trim_WarmMetal' });
  const plateFrame = new THREE.MeshStandardMaterial({ ...m.plateFrame, name: 'Plate_Frame' });
  const plateFace = new THREE.MeshStandardMaterial({ ...m.plateFace, name: 'Plate_Face_Logo' });
  if (logoTexture) setLogoTexture(plateFace, logoTexture);
  return { shell, handle, trim, plateFrame, plateFace };
}

export function setLogoTexture(material, texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.name = 'LogoPlate';
  material.map = texture;
  material.needsUpdate = true;
}

export function buildHatCase(params, { logoTexture = null } = {}) {
  const layout = computeLayout(params);
  const materials = createMaterials(params, logoTexture);

  const group = new THREE.Group();
  group.name = 'HatCase';

  const shell = new THREE.Mesh(buildShell(params, layout), materials.shell);
  shell.name = 'Shell';
  const piping = new THREE.Mesh(buildPiping(params, layout), materials.trim);
  piping.name = 'SeamTrim';
  const handle = new THREE.Mesh(buildHandle(params, layout), materials.handle);
  handle.name = 'Handle';
  const plate = buildPlate(params, layout, materials);

  group.add(shell, piping, handle, plate);
  // stand the case on y = 0 (the trim sticks out a hair below the shell)
  group.position.y = -new THREE.Box3().setFromObject(group).min.y;
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}
