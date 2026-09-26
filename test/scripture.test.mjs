import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JW_APP_TEMPLATE, JW_WEB_TEMPLATE, bibleNumber, collectReferences, findReferences, hasReference,
  jwUrl, segmentLine,
} from '../src/scripture.js';
import { parseOutline } from '../src/parser.js';
import { readFileSync } from 'node:fs';

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

test('builds a JW Library address that leaves the language to the app', () => {
  const [reference] = findReferences('시편 34:18');
  assert.equal(
    jwUrl(reference, { template: JW_APP_TEMPLATE, locale: 'KO' }),
    'jwlibrary:///finder?bible=19034018&pub=nwtsty',
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

test('reads the Korean chapter and verse markers', () => {
  assert.deepEqual(canonicals('요한복음 17장 3절'), ['John 17:3']);
  assert.deepEqual(canonicals('시편 83편 18절'), ['Psalms 83:18']);
  assert.deepEqual(canonicals('잠언 3장 5, 6절'), ['Proverbs 3:5,6']);
  assert.deepEqual(canonicals('전도서 3장 1~8절'), ['Ecclesiastes 3:1-8'], 'the wave dash is a range');
  assert.deepEqual(canonicals('시편 23편'), ['Psalms 23'], 'the chapter marker alone is a chapter');
});

test('accepts the short and spaced Korean book names', () => {
  assert.deepEqual(canonicals('마태 24:14'), ['Matthew 24:14']);
  assert.deepEqual(canonicals('요한 17:3'), ['John 17:3']);
  assert.deepEqual(canonicals('로마 12:2'), ['Romans 12:2']);
  assert.deepEqual(canonicals('고린도 전서 13:4-8'), ['1 Corinthians 13:4-8']);
  assert.deepEqual(canonicals('요한 1서 5:3'), ['1 John 5:3'], 'the numbered book still wins over John');
  assert.deepEqual(canonicals('베드로 전서 5:7'), ['1 Peter 5:7']);
  assert.deepEqual(canonicals('계시록 21:3, 4'), ['Revelation 21:3,4']);
  assert.deepEqual(canonicals('다니엘서 2:44'), ['Daniel 2:44'], 'a trailing 서 is fine');
  assert.deepEqual(canonicals('이사야서 40:26'), ['Isaiah 40:26']);
});

test('a bare number after a one-chapter book is the verse', () => {
  const [jude] = findReferences('유다 20, 21');
  assert.equal(jude.canonical, 'Jude 1:20,21');
  assert.equal(jude.text, '유다 20, 21', 'the whole list belongs to the reference');
  assert.equal(bibleNumber(jude), '65001020-65001021');
  assert.deepEqual(canonicals('Philemon 4, 5'), ['Philemon 1:4,5']);
  assert.deepEqual(canonicals('요한이서 6'), ['2 John 1:6']);
  assert.deepEqual(canonicals('유다서 20절'), ['Jude 1:20']);
  assert.deepEqual(canonicals('John 20'), ['John 20'], 'a book with many chapters is unaffected');
});

test('a reference claims no more of the line than it owns', () => {
  assert.deepEqual(segmentLine('시편 23편 을 보라').map((run) => run.text), ['시편 23편', ' 을 보라']);
  assert.deepEqual(segmentLine('요한복음 3장 16 참조').map((run) => run.text), ['요한복음 3장 16', ' 참조']);
});

test('the pattern needs no lookbehind, which older Safari cannot compile', () => {
  const source = readFileSync(new URL('../src/scripture.js', import.meta.url), 'utf8');
  assert.equal(/\(\?<[=!]/.test(source), false, 'a regex that will not compile takes the page down');
  assert.deepEqual(canonicals('창세기 1:1'), ['Genesis 1:1'], 'word boundaries still hold');
  assert.deepEqual(canonicals('Xjohn 3:16'), [], 'a reference must start a word');
});

test('a reference written on the line into a node counts as that node\'s', () => {
  const root = parseOutline('# 예수\n- 나사로 죽음\n  - 많은 사람 슬픔');
  const lazarus = root.children[0];
  lazarus.edgeLabel = '요한 11장';
  const found = collectReferences(root);
  assert.deepEqual(found.map((item) => item.reference.canonical), ['John 11']);
  assert.equal(found[0].node, lazarus, 'it belongs to the node the line runs into');
  assert.equal(found[0].onLabel, true);
});
