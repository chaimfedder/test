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

// Narration lines (Hebrew, ElevenLabs "Tomer", eleven_v3); files in audio/narration
export const NARRATION = {
  L01: 'פרסטר. קופסה שתוכננה סביב הכובע.',
  L02: 'עיצוב מוקפד, עם עומק במרכז וקימור אלגנטי שמצטמצם לכיוון השוליים.',
  L03: 'אורך מחושב, שמתחשב בכובע ובצורת הקופסה.',
  L04: 'ורוחב שמשאיר מקום סביב השוליים.',
  L05: 'אחד עשר וחצי סנטימטרים במרכז. שלושה באזור השוליים. מקום היכן שהכובע צריך אותו.',
  L06: 'תושבת פנימית רחבה, עם חלל מרכזי המותאם לכיפת הכובע.',
  L07: 'הכובע האובלי ממוקם לאורך הקופסה, עם משטח תמיכה לשוליים סביבו.',
  L08: 'הכיפה נכנסת לחלל. השוליים נשענים על התושבת. והכובע יושב במקומו.',
  L09: 'כיפה בגובה עשרה סנטימטרים, עם סנטימטר וחצי נוסף של מרווח מתוכנן.',
  L10: 'פרסטר. עיצוב מוקפד, ומקום מחושב לכובע שלך.',
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
  crown: 'גובה כיפה: 10 ס״מ',
  clearance: 'מרווח אנכי נוסף: 1.5 ס״מ',
};

// Shots in order. `voice`: narration cues [line, start]. `sfx`: [name, start].
export const SHOTS = [
  { id: 'hero', duration: 13.4, voice: [['L01', 0.7], ['L02', 5.4]], sfx: [['reveal', 0.0]] },
  { id: 'length', duration: 6.2, voice: [['L03', 2.0]] },
  { id: 'width', duration: 5.6, voice: [['L04', 1.6]] },
  { id: 'depth', duration: 10.0, voice: [['L05', 1.1]] },
  { id: 'open', duration: 9.6, voice: [['L06', 4.6]], sfx: [['lidOpen', 0.5]] },
  { id: 'hat', duration: 19.6, voice: [['L07', 2.2], ['L08', 12.8]], sfx: [['place', 15.9]] },
  { id: 'clearance', duration: 8.2, voice: [['L09', 1.8]] },
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
