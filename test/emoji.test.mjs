import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOJIS, leadingEmoji, withEmoji } from '../src/emoji.js';

test('finds the emoji a text starts with', () => {
  assert.equal(leadingEmoji('⭐ Goals'), '⭐');
  assert.equal(leadingEmoji('⚠️ Risk'), '⚠️');
  assert.equal(leadingEmoji('👍🏽 Yes'), '👍🏽');
  assert.equal(leadingEmoji('Goals ⭐'), null);
  assert.equal(leadingEmoji('"하나님의 거룩한 사람"'), null);
  assert.equal(leadingEmoji(''), null);
});

test('adds, replaces and toggles off a leading emoji', () => {
  assert.equal(withEmoji('Goals', '⭐'), '⭐ Goals');
  assert.equal(withEmoji('⭐ Goals', '🔥'), '🔥 Goals');
  assert.equal(withEmoji('⭐ Goals', '⭐'), 'Goals');
  assert.equal(withEmoji('⚠️ Risk', null), 'Risk');
  assert.equal(withEmoji('', '💡'), '💡');
  assert.equal(withEmoji('Plain', null), 'Plain');
});

test('every picker emoji is recognised as one emoji', () => {
  for (const emoji of EMOJIS) {
    assert.equal(leadingEmoji(`${emoji} x`), emoji, emoji);
    assert.equal(withEmoji(`${emoji} x`, emoji), 'x', emoji);
  }
});
