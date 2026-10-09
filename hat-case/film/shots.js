// Edit sheet of the product film: shot lengths, narration cues, caption
// timing and texts. All times are seconds from the start of each shot.
// Shots are joined with a short dissolve (FILM.dissolve), which overlaps them.

export const FILM = {
  fps: 30,
  width: 1920,
  height: 1080,
  dissolve: 0.6,
  fadeOut: 0.9, // fade to black at the very end
};

// Narration lines (Hebrew, ElevenLabs "Tomer", eleven_v3, technical tone); files in
// audio/narration (the earlier promotional version is kept in audio/narration/v1-promo)
export const NARRATION = {
  L01: 'קופסת הכובע של Ferster. מבנה, מידות, והתאמה מדויקת לכובע.',
  L02: 'מעטפת קשיחה. התחתית עמוקה במרכז, ומצטמצמת בקימור הדרגתי לכיוון השוליים.',
  L03: 'אורך פנימי: שלושים ושבעה נקודה ארבעים ואחד סנטימטרים.',
  L04: 'רוחב פנימי מרבי: עשרים ותשעה נקודה ארבעים ואחד סנטימטרים.',
  L05: 'עומק פנימי במרכז: אחד עשר וחצי סנטימטרים. באזור השוליים: שלושה סנטימטרים.',
  L06: 'בפנים: משטח תמיכה רחב לשוליים, וטבעת מוגבהת סביב חלל מרכזי לכתר.',
  L07: 'פתח הכובע: עשרים נקודה ארבעים ואחד, על שש עשרה נקודה ארבעים ואחד סנטימטרים. מידה חמישים ושמונה. שוליים ברוחב שישה סנטימטרים.',
  L08: 'הכתר נכנס לחלל המרכזי, והשוליים נשענים על הטבעת.',
  L09: 'גובה הכתר: עשרה סנטימטרים. מתחתיו, מרווח אנכי נוסף של סנטימטר וחצי.',
  L10: 'Ferster. מידות מדויקות, ושמירה על צורת הכובע.',
};

// Caption texts (numbers are checked against the model when the film loads)
export const CAPTIONS = {
  length: 'אורך פנימי: 37.41 ס״מ',
  width: 'רוחב פנימי מרבי: 29.41 ס״מ',
  depthCenter: 'עומק פנימי במרכז: 11.5 ס״מ',
  depthEdge: 'עומק פנימי באזור השוליים: 3 ס״מ',
  ringLip: 'גובה שפת הטבעת: {ring} ס״מ', // from the model (insert parameters)
  openingLength: 'אורך הפתח: 20.41 ס״מ',
  openingWidth: 'רוחב הפתח: 16.41 ס״מ',
  circumference: 'מידת הכובע: היקף פנימי 58 ס״מ',
  brim: 'רוחב שוליים: 6 ס״מ',
  crown: 'גובה כתר: 10 ס״מ',
  clearance: 'מרווח אנכי נוסף: 1.5 ס״מ',
};

// Shots in order. `voice`: narration cues [line, start]. `sfx`: [name, start].
export const SHOTS = [
  { id: 'hero', duration: 14.0, voice: [['L01', 0.6], ['L02', 6.4]], sfx: [['reveal', 0.0]] },
  { id: 'length', duration: 6.6, voice: [['L03', 1.6]] },
  { id: 'width', duration: 6.0, voice: [['L04', 1.2]] },
  { id: 'depth', duration: 10.0, voice: [['L05', 1.1]] },
  { id: 'open', duration: 11.0, voice: [['L06', 4.4]], sfx: [['lidOpen', 0.5]] },
  { id: 'hat', duration: 20.4, voice: [['L07', 1.8], ['L08', 14.0]], sfx: [['place', 17.6]] },
  { id: 'clearance', duration: 8.6, voice: [['L09', 1.2]] },
  { id: 'close', duration: 4.6, sfx: [['lidClose', 3.55]] },
  { id: 'end', duration: 6.6, voice: [['L10', 0.9]] },
];

// Start time of each shot on the film timeline (shots overlap by the dissolve)
export function shotStarts() {
  const starts = [];
  let t = 0;
  for (const s of SHOTS) {
    starts.push(t);
    t += s.duration - FILM.dissolve;
  }
  return { starts, total: t + FILM.dissolve };
}
