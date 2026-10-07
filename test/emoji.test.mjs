import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOJI_GROUPS, splitEmoji, withEmoji } from '../src/emoji.js';

test('finds the emoji a card starts with', () => {
  assert.deepEqual(splitEmoji('⭐ Main point'), { emoji: '⭐', rest: 'Main point' });
  assert.deepEqual(splitEmoji('Main point ⭐'), { emoji: null, rest: 'Main point ⭐' });
  assert.deepEqual(splitEmoji('2 Timothy 3:16'), { emoji: null, rest: '2 Timothy 3:16' });
  assert.deepEqual(splitEmoji('하나님의 사랑'), { emoji: null, rest: '하나님의 사랑' });
});

test('reads every emoji in the picker as a single emoji', () => {
  for (const group of EMOJI_GROUPS) {
    for (const emoji of group.emoji) {
      assert.deepEqual(splitEmoji(`${emoji} Point`), { emoji, rest: 'Point' }, emoji);
    }
  }
});

test('adds, replaces and toggles off the leading emoji', () => {
  assert.equal(withEmoji('Main point', '⭐'), '⭐ Main point');
  assert.equal(withEmoji('⭐ Main point', '📖'), '📖 Main point');
  assert.equal(withEmoji('⭐ Main point', '⭐'), 'Main point');
  assert.equal(withEmoji('👨‍👩‍👧 Family', null), 'Family');
  assert.equal(withEmoji('Main point', null), 'Main point');
});

test('never leaves a card blank', () => {
  assert.equal(withEmoji('⭐', '⭐'), '⭐');
  assert.equal(withEmoji('⭐', null), '⭐');
  assert.equal(withEmoji('⭐', '📖'), '📖');
  assert.equal(withEmoji('', '📖'), '📖');
});

test('searches every emoji by English or Korean name and keyword', async () => {
  const { loadEmojiIndex, searchEmoji } = await import('../src/emoji.js');
  const index = await loadEmojiIndex();
  assert.ok(index.length > 1800, `only ${index.length} emoji`);
  const first = (query) => searchEmoji(index, query)[0]?.emoji;
  assert.equal(first('red heart'), '❤️');
  assert.equal(first('thumbs up'), '👍');
  assert.equal(first('dove'), '🕊️');
  assert.equal(first('사과'), '🍎');
  assert.ok(searchEmoji(index, '하트').some((entry) => entry.emoji === '❤️'));
  assert.equal(first('성경'), '📖');
  assert.ok(searchEmoji(index, 'book').some((entry) => entry.emoji === '📖'));
  assert.ok(searchEmoji(index, 'korea').some((entry) => entry.emoji === '🇰🇷'));
  assert.deepEqual(searchEmoji(index, 'zzzqqq'), []);
  assert.deepEqual(searchEmoji(index, '  '), []);
});

test('an emoji typed into the search comes back as itself', async () => {
  const { loadEmojiIndex, searchEmoji } = await import('../src/emoji.js');
  const index = await loadEmojiIndex();
  assert.equal(searchEmoji(index, '🦒')[0].emoji, '🦒');
  assert.equal(searchEmoji(index, '❤')[0].emoji, '❤️');
  assert.equal(searchEmoji(index, ' 🫶 ')[0].emoji, '🫶');
});
