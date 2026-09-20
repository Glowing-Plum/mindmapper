import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JW_APP_TEMPLATE, JW_WEB_TEMPLATE, bibleNumber, collectReferences, findReferences, hasReference,
  jwUrl, segmentLine,
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

test('numbers a verse the way jw.org and JW Library do', () => {
  // Two digits of book, three of chapter, three of verse.
  const number = (text) => bibleNumber(findReferences(text)[0]);
  assert.equal(number('Genesis 1:1'), '01001001');
  assert.equal(number('시편 34:18'), '19034018', 'Psalms is book 19');
  assert.equal(number('Romans 8:28'), '45008028');
  assert.equal(number('1 John 4:8'), '62004008');
  assert.equal(number('Revelation 22:21'), '66022021', 'the last book is 66');
});

test('a range or a list of verses becomes a range', () => {
  const number = (text) => bibleNumber(findReferences(text)[0]);
  assert.equal(number('Psalm 34:18-19'), '19034018-19034019');
  assert.equal(number('창세기 37:34, 35'), '01037034-01037035', 'first to last');
  assert.equal(number('Acts 2:1,4'), '44002001-44002004');
});

test('a whole chapter has no verse', () => {
  assert.equal(bibleNumber(findReferences('Romans 8')[0]), '45008000');
});

test('builds a JW Library address for a reference', () => {
  const [reference] = findReferences('시편 34:18');
  assert.equal(
    jwUrl(reference, { template: JW_APP_TEMPLATE, locale: 'KO' }),
    'jwlibrary:///finder?bible=19034018&wtlocale=KO&pub=nwtsty',
  );
  assert.equal(
    jwUrl(reference, { template: JW_WEB_TEMPLATE, locale: 'E' }),
    'https://www.jw.org/finder?bible=19034018&wtlocale=E&pub=nwtsty',
  );
});

test('a custom template can use the reference itself', () => {
  const [reference] = findReferences('1 Cor 13:4-7');
  assert.equal(
    jwUrl(reference, { template: 'https://example.org/?q={ref}' }),
    'https://example.org/?q=1%20Corinthians%2013%3A4-7',
  );
});

test('no template and no reference give no address', () => {
  const [reference] = findReferences('John 3:16');
  assert.equal(jwUrl(reference, { template: null }), null);
  assert.equal(jwUrl(null, { template: JW_APP_TEMPLATE }), null);
  assert.equal(bibleNumber(null), null);
  assert.equal(bibleNumber({ book: 'Book of Mormon', chapter: 1, verses: '1' }), null,
    'a book we do not know has no number');
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
