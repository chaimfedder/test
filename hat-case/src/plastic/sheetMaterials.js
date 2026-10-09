// Materials of the plastic case: black PP sheet, semi-matte with a soft
// sheen, the shallow logo emboss (bump map on both faces of the sheet), the
// finger-hole cut, section colour where a clipping plane cuts the sheet, a
// temporary highlight of the ring wall, and the warm glow of the heated sheet.

import * as THREE from 'three';
import { CASE_PARAMS } from '../caseParams.js';
import { shieldOutline } from '../caseModel.js';
import { PLASTIC } from './plasticParams.js';
import { LOGO, SHEET } from './sheetModel.js';

// Shared uniforms (one value for every sheet material)
export const SHEET_UNIFORMS = {
  uHole: { value: new THREE.Vector3(SHEET.hole.y, SHEET.hole.l, SHEET.hole.r) },
  uSectionOn: { value: 0 },
  uSectionColor: { value: new THREE.Color('#e9b872') },
  uHighlight: { value: 0 },
  uHighlightColor: { value: new THREE.Color('#d9822b') },
  uFlex: { value: 0 },
  uHeat: { value: 0 },
  uHeatColor: { value: new THREE.Color('#ff6a1a') },
};

function patch(material, { flex = false, hole = true } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SHEET_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 rest;
        attribute float zone;
        attribute float flexW;
        uniform float uFlex;
        varying vec2 vRest;
        varying float vZone;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRest = rest;
        vZone = zone;
        ${flex ? 'transformed.z -= uFlex * flexW;' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uHole;
        uniform float uSectionOn;
        uniform vec3 uSectionColor;
        uniform float uHighlight;
        uniform vec3 uHighlightColor;
        uniform float uHeat;
        uniform vec3 uHeatColor;
        varying vec2 vRest;
        varying float vZone;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        ${hole ? `{
          float qx = max(abs(vRest.x) - uHole.y, 0.0);
          if (length(vec2(qx, vRest.y - uHole.x)) < uHole.z) discard;
        }` : ''}
        if (uSectionOn > 0.5 && !gl_FrontFacing) {
          gl_FragColor = linearToOutputTexel(vec4(uSectionColor, 1.0));
          return;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uHighlightColor * (uHighlight * vZone) + uHeatColor * uHeat;`,
      );
  };
  material.customProgramCacheKey = () => `sheet-${flex}-${hole}`;
  return material;
}

// Depth material for shadows that keeps the finger hole open
function holeDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHole = SHEET_UNIFORMS.uHole;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 rest;\nvarying vec2 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = rest;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHole;\nvarying vec2 vRest;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        { float qx = max(abs(vRest.x) - uHole.y, 0.0); if (length(vec2(qx, vRest.y - uHole.x)) < uHole.z) discard; }`,
      );
  };
  m.customProgramCacheKey = () => 'sheet-depth';
  return m;
}
export const SHEET_DEPTH = holeDepthMaterial();

// Height maps of the emboss (white = raised), drawn on canvases
function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

async function embossTextures(rootUrl) {
  const logo = await loadImage(rootUrl + PLASTIC.logo.image);
  // lid: the logo alone
  const lidCanvas = document.createElement('canvas');
  lidCanvas.width = logo.width * 2;
  lidCanvas.height = logo.height * 2;
  const lg = lidCanvas.getContext('2d');
  lg.fillStyle = '#000';
  lg.fillRect(0, 0, lidCanvas.width, lidCanvas.height);
  lg.drawImage(logo, 0, 0, lidCanvas.width, lidCanvas.height);

  // back: the logo inside a shield-shaped frame (as in the approved photo)
  const L = LOGO.base;
  const px = 2400 / L.w; // px per meter
  const c = document.createElement('canvas');
  c.width = Math.round(L.w * px);
  c.height = Math.round(L.w * L.aspect * px);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const inner = CASE_PARAMS.plate.inner;
  const k = 0.088 / inner.width;
  const pts = shieldOutline({ ...inner, width: inner.width * k, height: inner.height * k, topBulge: inner.topBulge * k, topCornerRadius: inner.topCornerRadius * k, sideArcRadius: inner.sideArcRadius * k, tipRadius: inner.tipRadius * k }, 400);
  const sh = inner.height * k;
  const toPx = (x, y) => [c.width / 2 + x * px, c.height / 2 - (y - sh / 2) * px];
  g.filter = 'blur(2px)';
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';
  g.lineWidth = 0.0018 * px;
  g.beginPath();
  pts.forEach(({ p }, i) => (i ? g.lineTo(...toPx(p.x, p.y)) : g.moveTo(...toPx(p.x, p.y))));
  g.closePath();
  g.stroke();
  g.filter = 'none';
  const lw = PLASTIC.logo.back.width * px;
  const lh = lw * (logo.height / logo.width);
  g.drawImage(logo, c.width / 2 - lw / 2, c.height / 2 - lh / 2 - 0.004 * px, lw, lh);

  const tex = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { base: tex(c), lid: tex(lidCanvas) };
}

// Bump strength (three.js units) for a raised emboss of PLASTIC.logo.depth
const BUMP = 1.2;

export async function createSheetMaterials(rootUrl = '../../') {
  const em = await embossTextures(rootUrl);
  const p = PLASTIC.materials.sheet;
  const make = (name, bumpMap = null, bumpScale = 0, flex = false) => {
    const m = new THREE.MeshStandardMaterial({ ...p, name });
    if (bumpMap) {
      m.bumpMap = bumpMap;
      m.bumpScale = bumpScale;
    }
    return patch(m, { flex });
  };
  return {
    // back of the base: raised outward; seen from inside the crown cavity it is a recess
    baseIn: make('PP_Base_Inside', em.base, -BUMP),
    baseOut: make('PP_Base_Outside', em.base, BUMP),
    // lid: raised toward the inside (photo); recessed on the outside
    lidIn: make('PP_Lid_Inside', em.lid, BUMP, true),
    lidOut: make('PP_Lid_Outside', em.lid, -BUMP, true),
    edge: make('PP_Cut_Edge'),
    fold: make('PP_Fold'),
    depth: SHEET_DEPTH,
  };
}

// Same look, no emboss (low-detail copies for the nesting stacks)
export function plainSheetMaterial(name = 'PP_Sheet', { hole = true } = {}) {
  return patch(new THREE.MeshStandardMaterial({ ...PLASTIC.materials.sheet, name }), { hole });
}

export function setSection(materials, planes) {
  const on = planes && planes.length > 0;
  SHEET_UNIFORMS.uSectionOn.value = on ? 1 : 0;
  for (const m of materials) {
    m.clippingPlanes = on ? planes : null;
    m.clipShadows = on;
    const side = on ? THREE.DoubleSide : THREE.FrontSide;
    if (m.side !== side) {
      m.side = side;
      m.needsUpdate = true;
    }
  }
}
