// Design variants of the thin-sheet plastic case, for the comparison film.
// Same sheet, flange, lid, handle and fold as src/plastic (unchanged); only
// the base differs. The variant is chosen by the query of this module's URL:
//   ./params.js?d=flat    back flat at full depth up to the side walls, narrow groove
//   ./params.js?d=dome    back shaped as one dome, narrow groove
//   ./params.js?d=cradle  no ring and no groove: a crown pocket and a cradle shaped like the brim
// (each query loads its own copy of the modules, so the variants can live side by side)
//
// Parameters of the thin-sheet plastic version of the hat case.
// The whole case (base, lid, fold zone, handle, closing rims and the ring)
// is one continuous formed sheet. Units: meters.
//
// The approved design data (inside length and width, the depths, the hat)
// come from src/caseParams.js and src/openCaseParams.js; nothing here
// changes them. What is new is the sheet itself: material, thickness, draft
// angles, the ring formed in the base, the closing rims and the fold zone.
//
// Coordinates
//   Outline coordinates (x, y): the inside outline of the shield at the rim,
//   tip at y = 0, top (handle side) at y = innerLength. Used for both halves.
//   Sheet coordinates (X, Y, Z): the case as formed, open flat (180 deg),
//   inside facing up (+Z). The fold line is the X axis (Y = 0). The base lies
//   at Y < 0 (Y = y - foldY), the lid is its mirror at Y > 0 (Y = foldY - y).
//   Z = 0 is the rim plane: the flat closing flange, inside surface.
//   Closed case: the lid turns 180 deg about the fold line and lands on the
//   base; case z = Z for the base, z = -Z for the lid (z = 0 is the seam).

import { CASE_PARAMS, DESIGN } from '../caseParams.js';
import { CROWN_BASE } from '../openCaseParams.js';

const deg = Math.PI / 180;
export const VARIANT = new URL(import.meta.url).searchParams.get('d') || 'flat';

// Simulation assumptions (to be confirmed with the manufacturer)
export const MATERIAL = {
  name: 'PP (polypropylene) sheet, black',
  process: 'thermoforming (vacuum / pressure) in one shared forming tool',
  // Uniform nominal wall used for the model. A real formed part thins where
  // the sheet stretches (deep ring, corners), so this is an approximation.
  thickness: 0.0006,
};

const T = MATERIAL.thickness;
const INNER = CASE_PARAMS.body.inner; // inside outline of the shield (arcs)
const HI = DESIGN.innerLength;

export const PLASTIC = {
  thickness: T,
  inner: INNER, // the rim outline: inside length 37.41 x inside width 29.41
  hatCenterY: HI - DESIGN.hatCenterFromTop, // hat center, outline coordinates
  crown: CROWN_BASE, // crown outside at its base (semi-axes), from the hat model

  base: {
    // Ring: one formed wall that rises out of the floor and comes back down.
    // From outside it is the oval channel in the back. Offsets are measured
    // outward from the crown's outside oval (same family of ovals as the
    // hat, so the clearance to the crown is the same all around).
    ringTop: 0, // the rounded top (brim support) is level with the rim plane
    ringInnerAtTop: 0.004, // inner face, at the top (clearance to the crown)
    ringOuterAtTop: 0.009, // outer face, at the top (top is 5 mm wide): the narrowest groove
    ringTopRadius: 0.0022, // rounding of the top on both sides
    ringInnerDraft: 1 * deg, // faces almost upright: groove 8 mm wide at its mouth
    ringOuterDraft: 1 * deg,
    ringHeight: 0.115, // root on both sides level with the crown floor
    rootRadius: 0.004, // rounding where the ring meets the floor
    domeFlat: 0.42, // dome: flat part (fraction of the way to the side wall)
    // cradle: pocket for the crown and a surface following the brim's underside
    pocketDraft: 6 * deg,
    pocketEdgeBlend: 0.004,
    cradleGap: 0.0015, // under the brim
    cradleEdgeDepth: 0.035, // beyond the brim's edge, toward the side wall
    cavityDepth: DESIGN.centerInnerDepth, // floor inside the ring, below the rim plane
    cavityFloorRadius: 0.006,
    rootBlend: 0.004,
    edgeDepth: DESIGN.edgeInnerDepth, // shallow part, under the brim edge
    wallDraft: 5 * deg, // side wall of the shell
    wallBottomBlend: 0.01,
    rimBlend: 0.003, // rounding between the side wall and the flange
  },

  lid: {
    edgeDepth: 0.024, // lid depth (inside) near the side wall
    dome: 0.012, // extra depth toward the middle
    domeReach: 0.13,
    wallDraft: 6 * deg,
    wallBottomBlend: 0.012,
    rimBlend: 0.003,
    reliefScale: 0.8, // the front relief lines of the approved design, formed in the sheet
    reliefFade: [0.012, 0.03], // fades out toward the side wall
  },

  // Closing flange: flat rim around both halves, with a press-fit rib on
  // the base (male) and a matching channel on the lid (female).
  flange: {
    width: 0.01, // from the rim edge of the inside outline to the trimmed edge
    ribCenter: -0.0055, // e (inward distance, < 0 = outside the rim outline)
    ribHalfWidth: 0.002, // at the foot
    ribTopHalf: 0.0006, // flat top
    ribHeight: 0.0022,
    channelHalfWidth: 0.0021, // lid channel, at its mouth
    channelTopHalf: 0.0007,
    channelDepth: 0.0024,
  },

  // Handle: a flat tab of the flange above the top edge, on both halves.
  // Closed, the two tabs lie on each other; the fold zone runs along the
  // top edge of the tab, so the handle's top is the fold itself.
  handle: {
    bottomWidth: 0.15, // at the rim top (joins the flange with a rounded blend)
    topWidth: 0.11, // = length of the fold zone
    height: 0.06, // fold line above the rim top (y = innerLength)
    joinBlend: 0.01,
    hole: { centerAbove: 0.034, halfLength: 0.03, radius: 0.0125 }, // finger hole (cut)
  },

  // Fold zone (living hinge): a strip of the same sheet, slightly lowered
  // so that the two flanges meet flat when it is folded 180 deg.
  fold: {
    drop: 0.0015, // inside surface of the strip below the rim plane (= inner bend radius)
    stepFrom: 0.0065, // the drop starts this far from the fold line
    stepTo: 0.0025,
  },

  logo: {
    image: 'assets/logo-emboss.png', // from the approved logo artwork
    depth: 0.0004, // shallow emboss
    back: { width: 0.07, frame: true }, // outside of the base, on the crown floor, reads from outside
    lid: { width: 0.072, centerFromTop: 0.15 }, // inside of the lid, reads with the lid open
  },

  nesting: {
    // free gap between nested sheets, measured square to the surface (so the
    // stack does not wedge on the steep walls); the pitch follows from it
    normalGap: 0.00025,
  },

  materials: {
    sheet: { color: '#141416', roughness: 0.5, metalness: 0.0 },
    tool: { color: '#9a9ea3', roughness: 0.32, metalness: 1.0 },
  },
};

// Fold line position in outline coordinates (top edge of the handle tab)
PLASTIC.foldWidth = Math.PI * (PLASTIC.fold.drop + T / 2); // strip length (mid-surface), bends to a half circle
PLASTIC.foldY = HI + PLASTIC.handle.height + PLASTIC.foldWidth / 2;
