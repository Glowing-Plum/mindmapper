import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectReferences, findReferences, hasReference, referenceUrl, segmentLine,
} from '../src/scripture.js';
import { parseOutline } from '../src/parser.js';

const canonicals = (text) => findReferences(text).map((reference) => reference.canonical);

test('finds plain English references', () => {
  assert.deepEqual(canonicals('John 3:16'), ['John 3:16']);
  assert.deepEqual(canonicals('See Psalm 34:18 tonight'), ['Psalms 34:18']);
  assert.deepEqual(canonicals('Romans 8'), ['Romans 8'], 'a chapter without verses still counts');
});

test('handles numbered books and abbreviations', () => {
  assert.deepEqual(canonicals('1 Cor 13:4-7'), ['1 Corinthians 13:4-7']);
  assert.deepEqual(canonicals('2Tim 3:16'), ['2 Timothy 3:16']);
  assert.deepEqual(canonicals('1 John 4:8'), ['1 John 4:8'], 'the numbered book wins over John');
  assert.deepEqual(canonicals('Gen. 1:1'), ['Genesis 1:1'], 'a full stop after the book is fine');
});

test('handles Korean book names, with or without a space', () => {
  assert.deepEqual(canonicals('시편 34:18'), ['Psalms 34:18']);
  assert.deepEqual(canonicals('요한복음3:16'), ['John 3:16']);
  assert.deepEqual(canonicals('[시편 147:3] 고쳐 주신다'), ['Psalms 147:3']);
  assert.deepEqual(canonicals('고린도전서 13:4-7'), ['1 Corinthians 13:4-7']);
});

test('reads verse ranges and lists', () => {
  const [reference] = findReferences('Psalm 34:18-19');
  assert.equal(reference.verses, '18-19');
  assert.equal(findReferences('Acts 2:1,4')[0].verses, '1,4');
  assert.equal(findReferences('Ps 34 : 18')[0].verses, '18', 'spaces around the colon are fine');
});

test('finds several references in one line', () => {
  assert.deepEqual(
    canonicals('Compare John 3:16 with 시편 34:18 and Rom 8:28'),
    ['John 3:16', 'Psalms 34:18', 'Romans 8:28'],
  );
});

test('does not invent references', () => {
  assert.deepEqual(canonicals('Johnson said 5 things'), [], 'a name that starts with a book name');
  assert.deepEqual(canonicals('Meeting at 10:30'), []);
  assert.deepEqual(canonicals('Budget 42:1 ratio'), []);
  assert.deepEqual(canonicals(''), []);
  assert.deepEqual(canonicals(null), []);
  assert.equal(hasReference('no scripture here'), false);
  assert.equal(hasReference('Mark 1:1'), true);
});

test('segments a line into plain and reference runs', () => {
  const segments = segmentLine('Read 시편 34:18 slowly');
  assert.deepEqual(segments.map((segment) => segment.text), ['Read ', '시편 34:18', ' slowly']);
  assert.deepEqual(segments.map((segment) => Boolean(segment.reference)), [false, true, false]);
  assert.equal(segments.join && segments.map((s) => s.text).join(''), 'Read 시편 34:18 slowly', 'nothing is lost');
});

test('a line without references is a single run', () => {
  assert.deepEqual(segmentLine('plain text'), [{ text: 'plain text', reference: null }]);
});

test('builds links from a template, url-encoded', () => {
  const [reference] = findReferences('1 Cor 13:4-7');
  assert.equal(
    referenceUrl(reference, 'https://example.org/?q={ref}'),
    'https://example.org/?q=1%20Corinthians%2013%3A4-7',
  );
  assert.equal(
    referenceUrl(reference, 'https://example.org/{book}/{chapter}/{verse}'),
    'https://example.org/1%20Corinthians/13/4-7',
  );
  assert.equal(referenceUrl(reference, null), null, 'no template means no link');
  assert.equal(referenceUrl(null, 'https://example.org/{ref}'), null);
});

test('collects every reference in a tree, in reading order', () => {
  const root = parseOutline([
    '# Comfort',
    '- Jehovah cares',
    '  - 시편 34:18',
    '  - 시편 147:3',
    '- Jesus wept',
    '  - John 11:35',
  ].join('\n'));
  const found = collectReferences(root);
  assert.deepEqual(found.map((entry) => entry.reference.canonical), ['Psalms 34:18', 'Psalms 147:3', 'John 11:35']);
  assert.equal(found[0].node.text, '시편 34:18', 'each reference knows its node');
});
