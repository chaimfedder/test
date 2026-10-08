// Parameters of the openable version of the case (lid on a hinge, inner
// support with a crown cavity) and of the hat that goes into it.
// Units: meters. Case coordinates are the same as in caseParams.js:
// x = width, y = height (tip at 0, top/handle side up), z = depth (+z front).

export const OPEN_CASE_PARAMS = {
  seamGap: 0.0003, // tiny gap between lid rim and base rim when closed
  hinge: {
    offset: 0.006, // hinge axis sits this far outside the top of the outline (lid clears the handle)
    openAngle: 102, // degrees, matches the open reference photo
    knuckles: [-0.1, 0.1], // x positions of the two hinges (as in the open photo)
    knuckleRadius: 0.0055,
    knuckleLength: 0.03,
  },
  insert: {
    padThickness: 0.002, // velvet padding over the shallow part of the base
    ringTop: -0.008, // top of the raised ring (below the seam)
    ringInner: 0.095, // the crown passes through the ring (oval like the bowl)
    ringOuter: 0.117,
    ringRound: 0.008, // soft rounded top of the ring
    floorFillet: 0.012,
    crownClearance: 0.003, // gap under the crown when the hat is in place
    overlap: 0.0015, // padding tucks into the side wall
  },
  label: {
    // small brand plate inside the lid
    y: 0.27,
    width: 0.06,
    height: 0.05,
    thickness: 0.0012,
    texture: 'assets/lid-label.png',
  },
  materials: {
    velvet: { color: '#141416', roughness: 0.95, sheen: 1, sheenColor: '#5c5c64', sheenRoughness: 0.5 },
    hinge: { color: '#2b2b2e', roughness: 0.35, metalness: 0.8 },
    label: { color: '#ffffff', roughness: 0.38, metalness: 0.55 },
  },
};

export const HAT_PARAMS = {
  brimRadius: 0.15, // reduced automatically if it does not fit the case
  brimThickness: 0.004,
  brimCurl: 0.016, // brim edge curls down this much (the hat lies upside down)
  crownBaseRadius: 0.09, // outside of the crown where it meets the brim
  crownTopRadius: 0.068,
  crownHeight: 0.102,
  crownTopRound: 0.028,
  crownDent: 0.014,
  oval: 1.08, // head shape: front-to-back is longer than side-to-side (same as base.bowlOval)
  felt: 0.003,
  sweatbandDepth: 0.035,
  bandHeight: 0.03, // ribbon around the crown
  segments: 160,
  materials: {
    felt: { color: '#0b0b0c', roughness: 0.8, sheen: 0.8, sheenColor: '#3a3a40', sheenRoughness: 0.35 },
    band: { color: '#0b0b0c', roughness: 0.6, sheen: 0.6, sheenColor: '#303034', sheenRoughness: 0.4 },
    sweatband: { color: '#1c1917', roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5 },
    lining: { color: '#18181c', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 0.5, sheenColor: '#6a6a72' },
  },
};
