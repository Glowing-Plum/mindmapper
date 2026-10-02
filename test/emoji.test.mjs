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
