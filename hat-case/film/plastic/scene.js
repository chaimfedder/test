// Studio scene of the plastic-case film: renderer, lights, floor, the case
// (one formed sheet), the hat, and the transforms between sheet, case and
// world coordinates. Shots (shots.js / film.js) only move things around.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HAT_PARAMS } from '../../src/openCaseParams.js';
import { buildHat } from '../../src/openCaseModel.js';
import { PLASTIC } from '../../src/plastic/plasticParams.js';
import { buildSheet, ringZ, SHEET } from '../../src/plastic/sheetModel.js';
import { createSheetMaterials, plainSheetMaterial } from '../../src/plastic/sheetMaterials.js';

export function createStage(W, H, { antialias = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.background = backdrop();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const lights = [];
  const add = (color, intensity, pos, shadow = false) => {
    const l = new THREE.DirectionalLight(color, intensity);
    l.position.set(...pos);
    if (shadow) {
      l.castShadow = true;
      l.shadow.mapSize.set(2048, 2048);
      Object.assign(l.shadow.camera, { left: -0.75, right: 0.75, top: 0.75, bottom: -0.75, near: 0.3, far: 7 });
      l.shadow.bias = -0.0003;
      l.shadow.normalBias = 0.0015;
    }
    scene.add(l);
    lights.push(l);
    return l;
  };
  const key = add('#fff6ec', 2.4, [-1.0, 2.1, 1.4], true); // soft key, front left, high
  add('#dfe8ff', 1.5, [1.6, 1.0, -1.4]); // cool rim from behind: picks out the walls and the edges
  add('#ffe2c4', 0.9, [-1.6, 0.6, -1.0]); // warm rim, other side
  add('#ffffff', 0.4, [1.2, 0.6, 1.4]); // fill
  add('#ffffff', 0.45, [0, 2.6, 0.2]); // top

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.42 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(30, W / H, 0.01, 30);
  return { renderer, scene, camera, lights, key, floor };
}

// Clean neutral backdrop: soft grey, lighter behind the product
function backdrop() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 288;
  const g = c.getContext('2d');
  const lin = g.createLinearGradient(0, 0, 0, c.height);
  lin.addColorStop(0, '#5a5d62');
  lin.addColorStop(0.6, '#45484c');
  lin.addColorStop(1, '#2f3134');
  g.fillStyle = lin;
  g.fillRect(0, 0, c.width, c.height);
  const rad = g.createRadialGradient(c.width * 0.5, c.height * 0.45, 10, c.width * 0.5, c.height * 0.48, c.width * 0.6);
  rad.addColorStop(0, 'rgba(235,236,240,0.20)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, c.width, c.height);
  const vig = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.35, c.width / 2, c.height / 2, c.width * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = vig;
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// The case: sheet coordinates -> case coordinates -> world
// ---------------------------------------------------------------------------
// Case coordinates (as in the earlier films): x across, y along (tip at 0,
// handle up), z through the depth (+z = lid side, 0 = seam).
// Sheet coordinates: case y = Y + foldY (base), case z = Z.

export const CASE = {
  zBack: PLASTIC.base.ringTop - PLASTIC.base.cavityDepth - PLASTIC.thickness, // outside of the crown floor (lowest point lying on the back)
  lidOutsideApex: PLASTIC.lid.edgeDepth + PLASTIC.lid.dome + PLASTIC.thickness,
};

export async function createCase({ lod = 'high', plain = false, mats: given = null } = {}) {
  const mats = given || (plain ? plainSet() : await createSheetMaterials('../../'));
  const sheet = buildSheet(mats, { lod });
  const holder = new THREE.Group(); // sheet -> case coordinates
  holder.position.y = SHEET.foldY;
  holder.add(sheet.root);
  const orient = new THREE.Group(); // case -> pose (standing / lying)
  orient.add(holder);
  const pivot = new THREE.Group(); // turntable yaw and placement
  pivot.add(orient);
  return { sheet, holder, orient, pivot, mats };
}

let plainCache = null;
export function plainSet() {
  if (!plainCache) {
    const m = plainSheetMaterial();
    plainCache = { baseIn: m, baseOut: m, lidIn: m, lidOut: m, edge: m, fold: m, depth: null };
  }
  return plainCache;
}

// Poses. Standing: tip down on the floor, lid toward the camera (+z).
// Lying: back on the floor (open: inside up).
export function setPose(c, pose, { yaw = 0, x = 0, z = 0, lift = 0 } = {}) {
  const o = c.orient;
  if (pose === 'standing') {
    o.rotation.set(0, 0, 0);
    const zMid = (CASE.lidOutsideApex + CASE.zBack) / 2;
    o.position.set(0, lift, -zMid);
  } else if (pose === 'lying') {
    // case (x, y, z) -> world (x, z, -y); centred along the length
    o.rotation.set(-Math.PI / 2, 0, 0);
    o.position.set(0, -CASE.zBack + lift, PLASTIC.inner.height / 2);
  } else if (pose === 'flipped') {
    // open sheet upside down (inside facing the floor): case (x, y, z) -> world (-x, -z, -y)
    o.rotation.set(-Math.PI / 2, Math.PI, 0);
    o.position.set(0, lift, PLASTIC.inner.height / 2);
  }
  c.pivot.rotation.set(0, THREE.MathUtils.degToRad(yaw), 0);
  c.pivot.position.set(x, 0, z);
}

// ---------------------------------------------------------------------------
// The hat (same model as the earlier films), resting on the ring
// ---------------------------------------------------------------------------

export function createHat() {
  const hat = buildHat(HAT_PARAMS);
  // lowest height of the brim plane at which the brim clears the ring top
  let lift = -Infinity;
  for (let i = 0; i <= 1200; i++) {
    const d = (0.06 * i) / 1200;
    lift = Math.max(lift, ringZ(d) - hat.userData.brimUnderside(d));
  }
  delete hat.userData.brimUnderside;
  const holder = new THREE.Group();
  holder.name = 'HatHolder';
  holder.rotation.x = Math.PI / 2; // hat +y (opening) -> case +z, hat z (length) -> case y
  holder.add(hat);
  const rest = new THREE.Vector3(0, PLASTIC.hatCenterY, lift); // case coordinates
  holder.position.copy(rest);
  return { hat, holder, rest, lift };
}
