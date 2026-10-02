// Emoji for the node toolbar. An emoji lives at the front of a node's text, so
// it survives the outline, Markdown and every export without a model change.

export const EMOJIS = [
  '⭐', '❤️', '✅', '❌', '❓', '❗', '💡', '🔥',
  '📌', '🎯', '🚀', '⚠️', '👍', '👎', '😀', '😢',
  '🙏', '📖', '✝️', '🕊️', '📅', '⏰', '💰', '🏠',
  '👥', '💬', '📝', '🔑', '🌱', '🎉', '✨',
];

// One leading emoji (with any variation selector, skin tone or ZWJ sequence)
// and the space that separates it from the text.
const LEADING = /^\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*️?\s*/u;

/** The emoji a text starts with, or null. */
export function leadingEmoji(text) {
  const match = LEADING.exec(text ?? '');
  return match ? match[0].trim() : null;
}

/**
 * Puts `emoji` at the front of `text`, replacing any emoji already there.
 * Picking the emoji the text already has, or null, removes it.
 */
export function withEmoji(text, emoji) {
  const current = leadingEmoji(text);
  const rest = current ? (text ?? '').replace(LEADING, '') : (text ?? '');
  if (!emoji || emoji === current) return rest;
  return rest ? `${emoji} ${rest}` : emoji;
}
