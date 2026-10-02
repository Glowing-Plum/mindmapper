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
