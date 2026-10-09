// Edit sheet of the plastic-case technical film: shot lengths, narration
// cues, subtitles and on-screen texts. Times are seconds from the start of
// each shot; shots are joined with a short dissolve (FILM.dissolve).

export const FILM = {
  fps: 30,
  width: 1920,
  height: 1080,
  dissolve: 0.6,
  fadeOut: 0.9,
};

// Narration (Hebrew, ElevenLabs "Tomer", eleven_v3); files in audio/narration
export const NARRATION = {
  N01: 'זוהי הדמיה של קופסת כובע, המתוכננת להיווצר מיריעת פלסטיק דקה אחת.',
  N02: 'בגב הקופסה נראית תעלה מעוצבת סביב משטח מרכזי, ועליו הלוגו בהטבעה רדודה.',
  N03: 'חומר ההדמיה הוא יריעת פוליפרופילן שחורה, בעובי של שש עשיריות המילימטר, כהנחת עבודה.',
  N04: 'המרכז עמוק כדי להכיל את כתר הכובע, וההיקף רדוד יותר באזור השוליים.',
  N05: 'אורך פנימי: שלושים ושבעה נקודה ארבעים ואחד סנטימטרים. רוחב מרבי: עשרים ותשעה נקודה ארבעים ואחד סנטימטרים.',
  N06: 'התעלה מבחוץ והטבעת מבפנים נוצרות מאותה דופן מעוצבת.',
  N07: 'בחתך רואים את היריעה עולה וחוזרת, ויוצרת מבנה טבעתי בגובה של כעשרה סנטימטרים.',
  N08: 'המרווח הפנימי באזור הכתר מתוכנן להיות אחד עשר וחצי סנטימטרים: כתר בגובה עשרה סנטימטרים, ומרווח נוסף של סנטימטר וחצי.',
  N09: 'הדמיית הייצור מציגה את העיקרון: שני חצאי האריזה מתעצבים יחד מיריעה אחת, בכלי עיצוב משותף.',
  N10: 'לאחר הקירור נחתכים ההיקף ופתח הידית. התעלה העמוקה דורשת בדיקת יצרן, של מתיחת החומר ועובי הדופן.',
  N11: 'הבסיס והמכסה מחוברים באמצעות אזור קיפול באותה יריעה. שפות הסגירה משתלבות בלחיצה.',
  N12: 'הכובע יושב הפוך: הכתר בתוך החלל המרכזי, והשוליים נשענים על הטבעת.',
  N13: 'כאשר האריזות פתוחות והפנים כלפי מעלה, הטבעת של היחידה התחתונה נכנסת לתעלה של היחידה שמעליה.',
  N14: 'כאשר האריזות הפוכות, הטבעת של היחידה העליונה נכנסת לתעלה של היחידה שמתחתיה.',
  N15: 'בשני המצבים מוצגת ערימה של עשר קופסאות זהות. ההתאמה תלויה בצורת הדפנות, בעובי ובמרווחי הקינון.',
  N16: 'זוהי בדיקת התאמה במודל. האימות הסופי ייעשה על מוצרים שיוצרו בפועל.',
};

// Length of each narration file (seconds), measured with ffprobe
export const NARRATION_LENGTH = {
  N01: 5.41, N02: 7.0, N03: 7.08, N04: 5.49, N05: 9.56, N06: 4.99, N07: 7.39, N08: 10.61,
  N09: 8.67, N10: 9.64, N11: 7.16, N12: 6.11, N13: 7.47, N14: 6.61, N15: 8.44, N16: 5.72,
};

// Subtitle text per line (numbers as digits); long lines are split into
// cards, timed in proportion to their length
export const SUBTITLES = {
  N01: ['זוהי הדמיה של קופסת כובע, המתוכננת להיווצר מיריעת פלסטיק דקה אחת.'],
  N02: ['בגב הקופסה נראית תעלה מעוצבת סביב משטח מרכזי, ועליו הלוגו בהטבעה רדודה.'],
  N03: ['חומר ההדמיה: יריעת פוליפרופילן (PP) שחורה, בעובי 0.6 מ״מ, כהנחת עבודה.'],
  N04: ['המרכז עמוק כדי להכיל את כתר הכובע, וההיקף רדוד יותר באזור השוליים.'],
  N05: ['אורך פנימי: 37.41 ס״מ.', 'רוחב מרבי: 29.41 ס״מ.'],
  N06: ['התעלה מבחוץ והטבעת מבפנים נוצרות מאותה דופן מעוצבת.'],
  N07: ['בחתך רואים את היריעה עולה וחוזרת, ויוצרת מבנה טבעתי בגובה של כ־10 ס״מ.'],
  N08: ['המרווח הפנימי באזור הכתר מתוכנן להיות 11.5 ס״מ:', 'כתר בגובה 10 ס״מ, ומרווח נוסף של 1.5 ס״מ.'],
  N09: ['הדמיית הייצור מציגה את העיקרון: שני חצאי האריזה', 'מתעצבים יחד מיריעה אחת, בכלי עיצוב משותף.'],
  N10: ['לאחר הקירור נחתכים ההיקף ופתח הידית.', 'התעלה העמוקה דורשת בדיקת יצרן, של מתיחת החומר ועובי הדופן.'],
  N11: ['הבסיס והמכסה מחוברים באמצעות אזור קיפול באותה יריעה.', 'שפות הסגירה משתלבות בלחיצה.'],
  N12: ['הכובע יושב הפוך: הכתר בתוך החלל המרכזי, והשוליים נשענים על הטבעת.'],
  N13: ['כאשר האריזות פתוחות והפנים כלפי מעלה,', 'הטבעת של היחידה התחתונה נכנסת לתעלה של היחידה שמעליה.'],
  N14: ['כאשר האריזות הפוכות,', 'הטבעת של היחידה העליונה נכנסת לתעלה של היחידה שמתחתיה.'],
  N15: ['בשני המצבים מוצגת ערימה של עשר קופסאות זהות.', 'ההתאמה תלויה בצורת הדפנות, בעובי ובמרווחי הקינון.'],
  N16: ['זוהי בדיקת התאמה במודל.', 'האימות הסופי ייעשה על מוצרים שיוצרו בפועל.'],
};

// Shots in order. `voice`: narration cues [line, start].
export const SHOTS = [
  { id: 'turn', duration: 20.8, voice: [['N01', 0.4], ['N02', 5.9], ['N03', 13.4]] },
  { id: 'open', duration: 22.0, voice: [['N04', 3.4], ['N05', 9.3]] },
  { id: 'grooveOut', duration: 4.5 },
  { id: 'ringIn', duration: 9.5, voice: [['N06', 3.2]] },
  { id: 'section', duration: 20.0, voice: [['N07', 0.6], ['N08', 9.0]] },
  { id: 'make', duration: 23.5, voice: [['N09', 0.4], ['N10', 9.5], ['N11', 19.9]] },
  { id: 'snap', duration: 4.7 },
  { id: 'hat', duration: 8.8, voice: [['N12', 0.5]] },
  { id: 'nestUp', duration: 15.5, voice: [['N13', 0.5]] },
  { id: 'nestDown', duration: 14.0, voice: [['N14', 0.5]] },
  { id: 'compare', duration: 15.4, voice: [['N15', 0.4], ['N16', 9.3]] },
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

// Subtitle cards on the film timeline: [{ start, end, text, line }]
export function subtitleCards() {
  const { starts } = shotStarts();
  const cards = [];
  SHOTS.forEach((s, i) => {
    for (const [line, at] of s.voice || []) {
      const t0 = starts[i] + at;
      const len = NARRATION_LENGTH[line];
      const parts = SUBTITLES[line];
      const total = parts.reduce((a, p) => a + p.length, 0);
      let t = t0;
      parts.forEach((p, k) => {
        const d = (len * p.length) / total;
        cards.push({ start: t, end: k === parts.length - 1 ? t0 + len + 0.25 : t + d, text: p, line, shot: i });
        t += d;
      });
    }
  });
  return cards;
}
