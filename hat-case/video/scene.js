// Product video scene: the openable case rendered over the photographed room.
// Frames are driven by setTime(t) so the render script can step them exactly.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { CASE_PARAMS, DESIGN } from '../src/caseParams.js';
import { runFitChecks } from '../src/fitChecks.js';
import { HAT_PARAMS, OPEN_CASE_PARAMS } from '../src/openCaseParams.js';
import { buildOpenCase } from '../src/openCaseModel.js';
import { CAMERA, CASE_PLACEMENT, LIGHTING } from './camera.js';
import { TIMELINE, VIDEO, hatPose, lidAngle } from './timeline.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w')) || VIDEO.width;
const H = Number(q.get('h')) || VIDEO.height;
const plateUrl = q.get('plate') === 'photo' ? '../assets/reference-open-empty.png' : 'assets/backdrop.png';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LIGHTING.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
document.body.appendChild(renderer.domElement);

const loader = new THREE.TextureLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
const [plate, envSource, logo, label] = await Promise.all([
  load(plateUrl),
  load('assets/backdrop.png'),
  load('../' + CASE_PARAMS.logoTexture),
  load('../' + OPEN_CASE_PARAMS.label.texture),
]);
plate.colorSpace = THREE.SRGBColorSpace;
envSource.colorSpace = THREE.SRGBColorSpace;
envSource.mapping = THREE.EquirectangularReflectionMapping;

const scene = new THREE.Scene();
scene.background = plate;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(envSource).texture;
scene.environmentIntensity = LIGHTING.environmentIntensity;

const addLight = (cfg, shadow) => {
  const l = new THREE.DirectionalLight(cfg.color, cfg.intensity);
  l.position.set(...cfg.position);
  if (shadow) {
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    Object.assign(l.shadow.camera, { left: -0.7, right: 0.7, top: 0.7, bottom: -0.7, near: 0.5, far: 6 });
    l.shadow.radius = 5;
    l.shadow.blurSamples = 16;
    l.shadow.bias = -0.0005;
  }
  scene.add(l);
  return l;
};
const lights = [
  addLight(LIGHTING.key, true),
  addLight(LIGHTING.front, false),
  addLight(LIGHTING.window, false),
  addLight(LIGHTING.fill, false),
];

// Table top that only receives the shadow (the wood itself is in the photo)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: LIGHTING.shadowOpacity }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// The case, lying on its back: case +z (front) -> world up, case top (hinge) -> world -z
const box = buildOpenCase(CASE_PARAMS, OPEN_CASE_PARAMS, HAT_PARAMS, { logoTexture: logo, labelTexture: label });
const placement = new THREE.Group();
placement.name = 'CasePlacement';
const lying = box.root;
lying.rotation.x = -Math.PI / 2;
const lowest = box.info.zRest; // the case rests on the back plate at the bottom of the bowl
lying.position.set(0, -lowest, CASE_PARAMS.body.height / 2);
placement.add(lying);
placement.position.set(CASE_PLACEMENT.x, 0, CASE_PLACEMENT.z);
placement.rotation.y = THREE.MathUtils.degToRad(CASE_PLACEMENT.yaw);
scene.add(placement);

// Soft contact shadow: the case footprint, blurred, just above the table
{
  const L = box.info.layout;
  const size = 0.8;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const ctx = cv.getContext('2d');
  ctx.filter = 'blur(18px)';
  ctx.fillStyle = '#000';
  // the case touches the table with the flat bottom of the bowl
  const bc = L.bowlCenter;
  const rad = CASE_PARAMS.base.bowlFlatRadius;
  const toPx = (v) => (v / size + 0.5) * 512;
  ctx.beginPath();
  ctx.ellipse(toPx(bc.x), toPx(-bc.y + CASE_PARAMS.body.height / 2), (rad / size) * 512, ((rad * CASE_PARAMS.base.bowlOval) / size) * 512, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex, transparent: true, opacity: LIGHTING.contactShadow, depthWrite: false }),
  );
  contact.name = 'ContactShadow';
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.0005;
  placement.add(contact);
}
const hat = box.hatHolder.getObjectByName('Hat');

// Reflection in the polished table: the case mirrored under the table top is
// rendered into a texture and laid over the photo before the case itself.
const reflectionTarget = new THREE.WebGLRenderTarget(Math.round(W / 2), Math.round(H / 2), { samples: 4 });
reflectionTarget.texture.colorSpace = THREE.SRGBColorSpace;
const reflectionQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: { map: { value: reflectionTarget.texture }, strength: { value: LIGHTING.reflection } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float strength; varying vec2 vUv;
      void main() { vec4 c = texture2D(map, vUv); gl_FragColor = vec4(c.rgb, c.a * strength); }`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }),
);
reflectionQuad.frustumCulled = false;
reflectionQuad.renderOrder = -10;
reflectionQuad.name = 'TableReflection';
scene.add(reflectionQuad);

function renderReflection() {
  reflectionQuad.visible = false;
  floor.visible = false;
  const contact = placement.getObjectByName('ContactShadow');
  contact.visible = false;
  const bg = scene.background;
  scene.background = null;
  placement.scale.y = -1;
  for (const l of lights) l.position.y *= -1; // the mirrored case is lit from below the table
  renderer.setRenderTarget(reflectionTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  for (const l of lights) l.position.y *= -1;
  placement.scale.y = 1;
  scene.background = bg;
  contact.visible = true;
  floor.visible = true;
  reflectionQuad.visible = true;
}

function renderFrame() {
  renderReflection();
  renderer.render(scene, camera);
}

const camera = new THREE.PerspectiveCamera(CAMERA.fov, W / H, 0.05, 20);
function applyCamera(c) {
  camera.fov = c.fov;
  camera.position.set(...c.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(new THREE.Vector3(...c.target));
  camera.rotateZ(THREE.MathUtils.degToRad(c.roll || 0));
  camera.updateProjectionMatrix();
}
applyCamera(CAMERA);

function setTime(t) {
  box.setLid(lidAngle(t));
  const pose = hatPose(t);
  box.setHatLift(pose.lift);
  hat.rotation.y = THREE.MathUtils.degToRad(pose.yaw);
  box.hatHolder.visible = pose.visible;
}
setTime(Number(q.get('t')) || 0);
renderFrame();

// Hooks for tools (render script, camera matching, checks)
window.video = {
  ready: true,
  scene,
  box,
  setTime,
  render: renderFrame,
  setCamera(c) {
    applyCamera(c);
  },
  setPlacement(p) {
    placement.position.set(p.x, 0, p.z);
    placement.rotation.y = THREE.MathUtils.degToRad(p.yaw);
  },
  frame() {
    renderFrame();
    return renderer.domElement.toDataURL('image/png');
  },
  // World positions of features used to match the camera to the photo
  points(deg = 102) {
    box.setLid(deg);
    scene.updateMatrixWorld(true);
    const info = box.info;
    const L = info.layout;
    const toWorld = (x, y, z) => lying.localToWorld(new THREE.Vector3(x, y, z)).toArray();
    const lid = box.lidPivot.children[0];
    const lidWorld = (x, y, z) => lid.localToWorld(new THREE.Vector3(x, y, z)).toArray();
    const R = info.crown.x + OPEN_CASE_PARAMS.insert.ringOuter;
    const hz = info.zs;
    const widest = L.outline.reduce((m, o) => (o.p.x > m.p.x ? o : m));
    return {
      holeLeft: toWorld(info.hole.x - R, info.hole.y, hz),
      holeRight: toWorld(info.hole.x + R, info.hole.y, hz),
      holeFar: toWorld(info.hole.x, info.hole.y + R, hz),
      holeNear: toWorld(info.hole.x, info.hole.y - R, hz),
      rimTip: toWorld(0, 0, L.seamZ),
      rimLeft: toWorld(-widest.p.x, widest.p.y, L.seamZ),
      rimRight: toWorld(widest.p.x, widest.p.y, L.seamZ),
      lidTip: lidWorld(0, 0, L.seamZ),
      lidLeft: lidWorld(-widest.p.x, widest.p.y, L.seamZ),
      lidRight: lidWorld(widest.p.x, widest.p.y, L.seamZ),
      hingeLeft: toWorld(OPEN_CASE_PARAMS.hinge.knuckles[0], info.axisY, info.axisZ),
      hingeRight: toWorld(OPEN_CASE_PARAMS.hinge.knuckles[1], info.axisY, info.axisZ),
    };
  },
  // Dimensions and fit checks (see src/fitChecks.js)
  checks() {
    setTime(12);
    return runFitChecks(box, CASE_PARAMS, OPEN_CASE_PARAMS, HAT_PARAMS, DESIGN);
  },
  // The case with the whole sequence as a glTF animation (for editing in Blender etc.)
  async exportAnimatedBase64() {
    const times = [];
    const lidQ = [];
    const hatPos = [];
    const hatScale = [];
    const hatQ = [];
    const frames = Math.round(VIDEO.duration * VIDEO.fps);
    for (let i = 0; i <= frames; i++) {
      const t = i / VIDEO.fps;
      setTime(t);
      times.push(t);
      lidQ.push(...box.lidPivot.quaternion.toArray());
      hatPos.push(...box.hatHolder.position.toArray());
      const s = box.hatHolder.visible ? 1 : 0.0001; // hidden before it enters
      hatScale.push(s, s, s);
      hatQ.push(...hat.quaternion.toArray());
    }
    const clip = new THREE.AnimationClip('HatCaseSequence', VIDEO.duration, [
      new THREE.QuaternionKeyframeTrack('LidHinge.quaternion', times, lidQ),
      new THREE.VectorKeyframeTrack('HatHolder.position', times, hatPos),
      new THREE.VectorKeyframeTrack('HatHolder.scale', times, hatScale, THREE.InterpolateDiscrete),
      new THREE.QuaternionKeyframeTrack('Hat.quaternion', times, hatQ),
    ]);
    setTime(0);
    const buf = await new Promise((res, rej) =>
      new GLTFExporter().parse(box.root, res, rej, { binary: true, animations: [clip], maxTextureSize: 2048 }),
    );
    const bytes = new Uint8Array(buf);
    let str = '';
    for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(str), timeline: TIMELINE };
  },
  project(p) {
    const v = new THREE.Vector3(...p).project(camera);
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  },
};
