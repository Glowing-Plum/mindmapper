// A short, hand-picked set of emoji for marking cards, grouped the way a talk
// tends to use them. A card wears at most one, at the start of its text, so
// picking another replaces it and picking the same one again takes it off.

export const EMOJI_GROUPS = [
  { name: 'Marks', emoji: ['⭐', '✅', '❗', '❓', '💡', '📌', '🔑', '🎯', '⚠️', '🔥'] },
  { name: 'Topics', emoji: ['📖', '🙏', '❤️', '🕊️', '🌍', '🏠', '👨‍👩‍👧', '🤝', '😊', '😢'] },
  { name: 'Talk', emoji: ['🗣️', '👂', '⏱️', '📝', '👉', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'] },
];

const SKIN = '[\\u{1F3FB}-\\u{1F3FF}]';
const PICTO = `\\p{Extended_Pictographic}(?:\\uFE0F|${SKIN})?`;
const LEADING = new RegExp(
  `^(?:[#*0-9]\\uFE0F?\\u20E3|\\p{Regional_Indicator}{2}|${PICTO}(?:\\u200D${PICTO})*)`,
  'u',
);

/** Splits a card's text into its leading emoji (or null) and the rest. */
export function splitEmoji(text = '') {
  const match = LEADING.exec(text);
  if (!match) return { emoji: null, rest: text };
  return { emoji: match[0], rest: text.slice(match[0].length).replace(/^[ \t]+/, '') };
}

/**
 * The text with `emoji` at the front in place of any emoji already there.
 * Choosing the emoji the card already has, or null, takes it off -- unless the
 * emoji is all the card says, which would leave it blank.
 */
export function withEmoji(text = '', emoji) {
  const { emoji: current, rest } = splitEmoji(text);
  if (!emoji || emoji === current) return current && rest ? rest : text;
  return rest ? `${emoji} ${rest}` : emoji;
}

// ------------------------------------------------------------------ search

let indexPromise = null;

/** The whole emoji set with its English and Korean names, loaded on first use. */
export function loadEmojiIndex() {
  indexPromise ??= import('./emoji-data.js').then(({ EMOJI_DATA }) => parseEmojiData(EMOJI_DATA));
  return indexPromise;
}

// Words Unicode doesn't give these, but a talk on the Bible reaches for.
const EXTRA_KEYWORDS = {
  '📖': 'bible scripture verse 성경 성구 말씀',
  '📜': 'scroll scripture 성경 두루마리',
  '🙏': 'prayer 기도',
  '🕊️': 'peace spirit holy 평화 성령',
  '❤️': 'love 사랑',
  '🌍': 'earth paradise 땅 낙원',
  '🌳': 'paradise 낙원',
  '👑': 'kingdom king 왕국 왕',
  '🗣️': 'preach speak talk 전파 연설 말하기',
  '🤝': 'friend 친구 벗',
  '💡': 'idea point 요점 생각',
  '⏱️': 'time timer 시간',
};

export function parseEmojiData(data) {
  return data.split('\n').map((line) => {
    const [emoji, name, enKeywords, koName, koKeywords] = line.split('\t');
    const keywords = `${enKeywords} ${EXTRA_KEYWORDS[emoji] ?? ''}`;
    return {
      emoji,
      name,
      koName,
      names: [name.toLowerCase(), koName],
      haystack: [name, keywords, koName, koKeywords].join(' ').toLowerCase(),
      keywords: new Set(`${keywords} ${koKeywords}`.toLowerCase().split(' ')),
      extra: (EXTRA_KEYWORDS[emoji] ?? '').split(' '),
    };
  });
}

/**
 * The emoji that match what was typed, best first: every word has to appear
 * somewhere in the English or Korean names and keywords. An emoji typed or
 * pasted in, say from the iPad's emoji keyboard, comes back as itself.
 */
export function searchEmoji(index, query, limit = 60) {
  const typed = query.trim();
  const own = splitEmoji(typed).emoji;
  if (own) {
    const known = index.find((entry) => entry.emoji === own || entry.emoji.replace(/\uFE0F/g, '') === own);
    return [known ?? { emoji: own, name: own, koName: '' }];
  }
  const q = typed.toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const rank = (entry) => {
    if (entry.names.includes(q)) return 0;
    if (entry.extra.includes(q) || entry.names.some((name) => name.startsWith(q) || name.endsWith(` ${q}`))) return 1;
    if (entry.names.some((name) => name.includes(` ${q}`))) return 2;
    if (words.every((word) => entry.keywords.has(word))) return 3;
    if (entry.names.some((name) => name.includes(q))) return 4;
    return 5;
  };
  return index
    .filter((entry) => words.every((word) => entry.haystack.includes(word)))
    .map((entry, order) => ({ entry, order, score: rank(entry) }))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
