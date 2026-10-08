// Camera and lights matched to the reference photo (the 3D case is drawn on
// top of the photographed room). World: y up, table top at y = 0, the case
// lies on its back with the hinge toward -z.

// Solved from 10 matching points between the model and the open-case photo
// (cavity edge, base rim, lid top, hinges); reprojection error about 20 px.
export const CAMERA = {
  position: [-0.0157, 0.4669, 0.7119],
  target: [-0.2775, 0.2149, -0.2198],
  fov: 53.48, // vertical, degrees
  roll: 3.01, // degrees
};

// Where the case sits on the table (meters) and its turn around the vertical axis
// (degrees). Set a little further back than the photographed case so the
// deeper 3D base stays inside the frame.
export const CASE_PLACEMENT = { x: -0.015, z: -0.09, yaw: 0 };

export const LIGHTING = {
  exposure: 1.3,
  environmentIntensity: 1.0,
  key: { color: '#fff3e6', intensity: 2.2, position: [0.25, 2.6, 0.7] }, // soft overhead, casts the shadow
  front: { color: '#fff0e0', intensity: 1.1, position: [-0.7, 1.1, 1.9] }, // lifts the front walls
  window: { color: '#f4f6ff', intensity: 1.4, position: [2.2, 1.3, -1.2] }, // bright window on the right
  fill: { color: '#ffe8d2', intensity: 0.35, position: [-1.6, 0.6, 0.4] },
  shadowOpacity: 0.45,
  contactShadow: 0.5,
  reflection: 0.22, // strength of the case's reflection in the polished table
};
