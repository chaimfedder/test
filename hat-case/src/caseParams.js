// All dimensions of the closed hat case, in one place.
// Units: meters (glTF convention). Axes: x = width (right), y = height (up,
// y = 0 is the lowest point of the body), z = depth (+z is the front face).
//
// Values marked "estimate" are not visible in the reference photo and were
// guessed from the design language; refine them when real measurements exist.

export const CASE_PARAMS = {
  body: {
    width: 0.38, // overall body width (estimate of real size; proportions from photo)
    height: 0.49, // body height without the handle (photo ratio height/width = 1.29)

    // Silhouette (shield outline seen from the front)
    topBulge: 0.018, // how much the top edge arches up in the middle
    topCornerRadius: 0.1, // rounding of the two upper corners
    sideArcRadius: 0.42, // radius of the arcs that converge toward the bottom
    tipRadius: 0.085, // rounding of the bottom tip

    // Lid (front shell). Depths are measured from the seam (z = 0).
    frontEdgeRadius: 0.03, // rounding between the front face and the side wall
    frontDome: 0.018, // how much the front face bulges outward
    lidSideHeight: 0.007, // straight side wall of the lid above the seam
    wall: 0.004, // shell thickness (lining included)
  },

  // Base (back shell): shallow under the brim, a deep bowl under the crown
  base: {
    edgeInnerDepth: 0.03, // inside depth near the walls (brim area)
    centerInnerDepth: 0.115, // inside depth at the center (crown area)
    edgeRadius: 0.01, // rounding between the side wall and the back
    bowlFlatRadius: 0.1, // flat bottom of the bowl (the case rests on it)
    bowlRadius: 0.2, // where the bowl has risen back to the shallow back
    bowlOval: 1.08, // bowl follows the oval of the crown (longer along the height)
    backDome: 0.004, // gentle bulge of the shallow part of the back
  },

  // Perimeter split line between lid and base
  seam: {
    pipingRadius: 0.0016, // thin warm-metal trim on each rim
    pipingProtrusion: 0.0003, // how far the trim stands out of the side wall
  },

  handle: {
    outerWidth: 0.185, // outside-to-outside width of the bar at the top
    height: 0.068, // top of the handle above the top of the body
    thickness: 0.021, // in the plane of the front face
    depth: 0.024, // front-to-back thickness of the bar (estimate; fits the shallow base wall)
    cornerRadius: 0.042,
    legSpread: 0.022, // legs lean outward toward the base
    zOffset: -0.003, // position along the depth (0 = middle of the base side wall)
    baseFlare: 1.2, // legs widen where they enter the body
    flareLength: 0.022,
    embed: 0.012, // how deep the legs go into the body
  },

  plate: {
    top: 0.157, // distance from the top of the body to the top of the silver face
    inner: {
      // silver face with the logo artwork
      width: 0.122,
      height: 0.153,
      topBulge: 0.0015,
      topCornerRadius: 0.007,
      sideArcRadius: 0.1027,
      tipRadius: 0.012,
    },
    frameWidth: 0.008, // dark frame around the silver face
    frameThickness: 0.0025, // body of the frame (plus bevels)
    frameBevel: 0.0011,
    lip: 0.0007, // frame overlaps the silver face by this much
    faceRecess: 0.0009, // silver face sits this far behind the frame's front
    faceThickness: 0.0015,
    embed: 0.001, // frame back sinks into the shell to avoid gaps
    seatMargin: 0.003, // flat pad around the frame on the shell
    seatBlend: 0.007,
  },

  // Relief lines on the front face. Points are normalized:
  // X = -0.5 .. 0.5 across the width, Y = 0 (top) .. 1 (bottom tip).
  // `raised` is a direction (normalized coords) pointing to the side of the
  // line that stands slightly higher. `mirror` adds the left-hand copy.
  // `taper` = fraction of the line length used to fade in / out at each end.
  frontRelief: {
    grooveDepth: 0.0014,
    grooveSigma: 0.0022,
    stepHeight: 0.0016,
    stepWidth: 0.004,
    stepReach: 0.014,
    edgeFadeStart: 0.93, // relief fades out toward the front edge
    lines: [
      {
        name: 'topArch',
        points: [[-0.53, 0.125], [-0.36, 0.075], [-0.24, 0.068], [-0.12, 0.135], [0, 0.156],
          [0.12, 0.135], [0.24, 0.068], [0.36, 0.075], [0.53, 0.125]],
        raised: [0, -1],
        mirror: false,
        taper: [0, 0],
      },
      {
        name: 'shoulderV',
        points: [[0.18, 0.302], [0.33, 0.255], [0.53, 0.205]],
        raised: [0, -1],
        mirror: true,
        taper: [0.08, 0],
      },
      {
        name: 'sweepInner',
        points: [[0.53, 0.235], [0.43, 0.27], [0.335, 0.327], [0.275, 0.424], [0.23, 0.543],
          [0.18, 0.662], [0.12, 0.8], [0.065, 0.9]],
        raised: [-1, 0],
        mirror: true,
        taper: [0, 0.22],
      },
      {
        name: 'sweepMiddle',
        points: [[0.53, 0.37], [0.435, 0.395], [0.37, 0.49], [0.31, 0.6], [0.24, 0.71],
          [0.18, 0.8], [0.13, 0.87]],
        raised: [-1, 0],
        mirror: true,
        taper: [0, 0.25],
      },
      {
        name: 'sweepOuter',
        points: [[0.53, 0.53], [0.44, 0.555], [0.39, 0.66], [0.33, 0.74], [0.29, 0.8]],
        raised: [-1, 0],
        mirror: true,
        taper: [0, 0.3],
      },
    ],
  },

  materials: {
    shell: { color: '#232426', roughness: 0.58, metalness: 0.08, clearcoat: 0.18, clearcoatRoughness: 0.55 },
    handle: { color: '#202123', roughness: 0.5, metalness: 0.08 },
    trim: { color: '#d2b48f', roughness: 0.3, metalness: 1.0 },
    plateFrame: { color: '#1b1b1d', roughness: 0.32, metalness: 0.55 },
    plateFace: { color: '#ffffff', roughness: 0.38, metalness: 0.5 },
  },

  // Texture on the silver face. It covers the bounding box of the face
  // (left/right/top/bottom of the shield). Replace with a high-quality file
  // of the same proportions (width:height = 0.122:0.153 ≈ 4:5).
  logoTexture: 'assets/logo-plate.png',

  // Tessellation
  mesh: {
    perimeter: 512, // samples around the outline
    frontRings: 140,
    frontEdgeRings: 14,
    backEdgeRings: 10,
    backRings: 80,
    handlePath: 160,
    handleSection: 32,
    pipingSection: 12,
  },
};
