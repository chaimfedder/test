// Edit sheet of the short forming-and-trimming film (option 2, dome back):
// shot lengths, narration cues and subtitles. All Hebrew text is vocalized.

export const FILM = {
  fps: 30,
  width: 1920,
  height: 1080,
  dissolve: 0.6,
  fadeOut: 0.9,
};

// Narration (Hebrew, ElevenLabs "Tomer", eleven_v3); files in audio/narration
export const NARRATION = {
  M1: 'הַיְּרִיעָה מְחֻמֶּמֶת, וּמֻנַּחַת מֵעַל כְּלִי עִצּוּב אֶחָד לִשְׁנֵי חֲצָאֵי הָאֲרִיזָה.',
  M2: 'בְּוָאקוּם אוֹ בְּלַחַץ, הַיְּרִיעָה נִצְמֶדֶת לַכְּלִי וּמְקַבֶּלֶת אֶת צוּרַת הַכִּפָּה, הַטַּבַּעַת וְהַמִּכְסֶה.',
  M3: 'לְאַחַר הַקֵּרוּר נֶחְתָּכִים הַהֶקֵּף וּפֶתַח הַיָּדִית, וְהַשְּׁאֵרִית מוּסֶרֶת.',
  M4: 'הַקֻּפְסָה מִתְקַפֶּלֶת לְאֹרֶךְ אֵזוֹר הַקִּפּוּל, וְנִסְגֶּרֶת.',
};

// Spoken length of each line (seconds; M4 ends in a pause, the voice stops at 4.7 s)
export const NARRATION_LENGTH = { M1: 6.35, M2: 7.24, M3: 5.49, M4: 4.7 };

export const SUBTITLES = {
  M1: ['הַיְּרִיעָה מְחֻמֶּמֶת, וּמֻנַּחַת מֵעַל כְּלִי עִצּוּב אֶחָד', 'לִשְׁנֵי חֲצָאֵי הָאֲרִיזָה.'],
  M2: ['בְּוָאקוּם אוֹ בְּלַחַץ, הַיְּרִיעָה נִצְמֶדֶת לַכְּלִי', 'וּמְקַבֶּלֶת אֶת צוּרַת הַכִּפָּה, הַטַּבַּעַת וְהַמִּכְסֶה.'],
  M3: ['לְאַחַר הַקֵּרוּר נֶחְתָּכִים הַהֶקֵּף וּפֶתַח הַיָּדִית,', 'וְהַשְּׁאֵרִית מוּסֶרֶת.'],
  M4: ['הַקֻּפְסָה מִתְקַפֶּלֶת לְאֹרֶךְ אֵזוֹר הַקִּפּוּל, וְנִסְגֶּרֶת.'],
};

// Times inside the forming shot (seconds)
export const STEPS = {
  heat: [0, 7.4], // heated sheet over the tool
  form: [7.4, 12.0], // the sheet is drawn onto the tool
  cool: [12.0, 14.8], // cooling and release
  trim: [14.8, 21.0], // cut lines, product appears, scrap lifts away
  fold: [21.0, 26.4], // fold and close
};

export const SHOTS = [
  { id: 'make', duration: 27.0, voice: [['M1', 0.8], ['M2', 7.6], ['M3', 15.2], ['M4', 21.4]] },
  { id: 'closed', duration: 5.4 },
];

export function shotStarts() {
  const starts = [];
  let t = 0;
  for (const s of SHOTS) {
    starts.push(t);
    t += s.duration - FILM.dissolve;
  }
  return { starts, total: t + FILM.dissolve };
}

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
