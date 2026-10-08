// Parameters of the openable case (lid on a hinge, padding with a raised
// ring) and of the hat that goes into it.
// Units: meters. Case coordinates are the same as in caseParams.js:
// x = width, y = height (tip at 0, handle side up), z = depth (+z front, 0 = seam).

import { DESIGN } from './caseParams.js';

export const OPEN_CASE_PARAMS = {
  seamGap: 0.0003, // tiny gap between lid rim and base rim when closed
  hinge: {
    offset: 0.006, // hinge axis sits this far outside the top of the outline (lid clears the handle)
    openAngle: 102, // degrees, matches the open reference photo
    knuckles: [-0.08, 0.08], // x positions of the two hinges
    knuckleRadius: 0.005,
    knuckleLength: 0.026,
  },
  insert: {
    padThickness: 0.002, // velvet padding over the shallow part of the base
    // Raised ring, measured outward from the crown's outside wall (it follows
    // the crown's oval). The hat rests on its top; the top is set so the
    // crown's base lands exactly on the seam plane (z = 0).
    ringInner: 0.004, // clearance to the crown and its ribbon, no pressure
    ringOuter: 0.024,
    ringRound: 0.008, // soft rounded top of the ring
    overlap: 0.0015, // padding tucks into the side wall
  },
  label: {
    // small brand plate inside the lid
    y: 0.2,
    width: 0.048,
    height: 0.038,
    thickness: 0.0012,
    texture: 'assets/lid-label.png',
  },
  materials: {
    velvet: { color: '#141416', roughness: 0.95, sheen: 1, sheenColor: '#5c5c64', sheenRoughness: 0.5 },
    hinge: { color: '#2b2b2e', roughness: 0.35, metalness: 0.8 },
    label: { color: '#ffffff', roughness: 0.38, metalness: 0.55 },
  },
};

const FELT = 0.003;

export const HAT_PARAMS = {
  // Inner opening (head size) and crown, from the design data
  openingLength: DESIGN.openingLength, // along the case length
  openingWidth: DESIGN.openingWidth,
  felt: FELT,
  crownHeight: DESIGN.crownHeight, // from the brim plane to the top of the crown
  crownTaper: 0.016, // crown narrows by this much toward its top (all around)
  crownTopRound: 0.022,
  crownDent: 0.014,
  brimWidth: DESIGN.brimWidth, // from the crown's outside wall
  brimThickness: 0.004,
  brimCurl: 0.016, // brim edge curls down this much (the hat lies upside down)
  sweatbandDepth: 0.035,
  bandHeight: 0.03, // ribbon around the crown
  bandThickness: 0.0016,
  segments: 192,
  materials: {
    felt: { color: '#0b0b0c', roughness: 0.8, sheen: 0.8, sheenColor: '#3a3a40', sheenRoughness: 0.35 },
    band: { color: '#0b0b0c', roughness: 0.6, sheen: 0.6, sheenColor: '#303034', sheenRoughness: 0.4 },
    sweatband: { color: '#1c1917', roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5 },
    lining: { color: '#18181c', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 0.5, sheenColor: '#6a6a72' },
  },
};

// Crown outside at its base (semi-axes): the opening plus the felt
export const CROWN_BASE = {
  x: HAT_PARAMS.openingWidth / 2 + FELT,
  z: HAT_PARAMS.openingLength / 2 + FELT,
};
