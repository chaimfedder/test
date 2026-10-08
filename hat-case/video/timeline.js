// Timing of the product video (seconds). Every value the animation uses is
// here, so the sequence can be retimed in one place.

export const VIDEO = {
  fps: 30,
  duration: 18,
  width: 1920, // the frame keeps the reference photo's aspect ratio (1372 x 1147)
  height: 1606,
};

export const TIMELINE = {
  lidOpen: { start: 2, end: 5 }, // lid swings open around the rear hinge
  hatIn: { start: 7, end: 11 }, // hat comes down into the cavity
  lidClose: { start: 13, end: 16 }, // lid swings shut over the hat
  openAngle: 102, // degrees (the open reference photo)
  hatStartLift: 0.58, // meters above its resting place when it enters (just above the frame)
  hatStartYaw: 22, // degrees of turn while coming down, settles to 0
};

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const easeInOutSine = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const easeOutCubic = (u) => 1 - (1 - u) ** 3;
const span = (t, { start, end }) => clamp01((t - start) / (end - start));

// Lid angle in degrees at time t.
export function lidAngle(t) {
  const T = TIMELINE;
  if (t < T.lidClose.start) return T.openAngle * easeInOutSine(span(t, T.lidOpen));
  return T.openAngle * (1 - easeInOutSine(span(t, T.lidClose)));
}

// Hat lift above its resting place (meters) and turn (degrees) at time t.
export function hatPose(t) {
  const T = TIMELINE;
  const u = span(t, T.hatIn);
  // continuous, slow lowering that eases in from above the frame and lands softly
  const k = 0.8 * easeInOutSine(u) + 0.2 * easeOutCubic(u);
  return { lift: T.hatStartLift * (1 - k), yaw: T.hatStartYaw * (1 - easeInOutSine(u)), visible: t >= T.hatIn.start - 0.01 };
}
