import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutline, toOutline, toPlainOutline } from '../src/parser.js';

const texts = (node) => node.children.map((child) => child.text);

test('single top-level item becomes the root', () => {
  const root = parseOutline('Roadmap\n  - Q1\n  - Q2');
  assert.equal(root.text, 'Roadmap');
  assert.deepEqual(texts(root), ['Q1', 'Q2']);
});

test('markdown headings nest the bullets that follow them', () => {
  const root = parseOutline(['# Launch plan', '## Marketing', '- Blog post', '- Webinar', '## Sales', '- Enablement'].join('\n'));
  assert.equal(root.text, 'Launch plan');
  assert.deepEqual(texts(root), ['Marketing', 'Sales']);
  assert.deepEqual(texts(root.children[0]), ['Blog post', 'Webinar']);
  assert.deepEqual(texts(root.children[1]), ['Enablement']);
});

test('infers the indent unit (2-space, 4-space and tabs all work)', () => {
  const two = parseOutline('Root\n  - A\n    - A1\n  - B');
  const four = parseOutline('Root\n    - A\n        - A1\n    - B');
  const tabs = parseOutline('Root\n\t- A\n\t\t- A1\n\t- B');
  for (const root of [two, four, tabs]) {
    assert.deepEqual(texts(root), ['A', 'B']);
    assert.deepEqual(texts(root.children[0]), ['A1']);
  }
});

test('several top-level items get a synthetic root', () => {
  const root = parseOutline('- Alpha\n- Beta', { title: 'Ideas' });
  assert.equal(root.text, 'Ideas');
  assert.deepEqual(texts(root), ['Alpha', 'Beta']);
});

test('numbered lists and mixed bullet characters are accepted', () => {
  const root = parseOutline('Plan\n  1. First\n  2) Second\n  * Third\n  + Fourth\n  • Fifth');
  assert.deepEqual(texts(root), ['First', 'Second', 'Third', 'Fourth', 'Fifth']);
});

test('a deep indent jump attaches to the previous node instead of orphaning', () => {
  const root = parseOutline('Root\n  - A\n          - Way too deep');
  assert.deepEqual(texts(root.children[0]), ['Way too deep']);
});

test('blank lines and trailing whitespace are ignored', () => {
  const root = parseOutline('\n\nRoot   \n\n  - A  \n\n  - B\n\n');
  assert.deepEqual(texts(root), ['A', 'B']);
});

test('empty input yields a placeholder root', () => {
  assert.equal(parseOutline('   ').text, 'Central idea');
  assert.equal(parseOutline('', { title: 'Untitled map' }).text, 'Untitled map');
});

test('outline round-trips through the parser', () => {
  const source = ['# Product', '- Discovery', '  - Interviews', '    - Recruiting', '  - Surveys', '- Delivery', '  - Sprint one'].join('\n');
  const root = parseOutline(source);
  assert.equal(toOutline(root), source);
  assert.equal(toOutline(parseOutline(toOutline(root))), source);
});

test('plain outline keeps the root and indents descendants', () => {
  const root = parseOutline('# Root\n- A\n  - A1');
  assert.equal(toPlainOutline(root, { indent: '  ' }), 'Root\n  A\n    A1');
});

test('newlines inside a node do not break the outline', () => {
  const root = parseOutline('# Root\n- A');
  root.children[0].text = 'multi\nline';
  assert.equal(toOutline(root), '# Root\n- multi line');
});
