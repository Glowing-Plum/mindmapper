import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseName, ensureExtension, parseFileContents, serialiseDoc, serialiseOutline } from '../src/files.js';
import { MindMapDoc } from '../src/model.js';
import { parseOutline } from '../src/parser.js';

test('a .json file keeps everything the outline cannot carry', () => {
  const doc = new MindMapDoc(parseOutline('Root\n  - A\n    - A1'));
  const a = doc.root.children[0];
  doc.toggleFormat(a.id, 'bold');
  doc.setHighlight(a.id, 'yellow');
  doc.setEdgeLabel(a.id, 'because');
  doc.setColor(a.id, 3);

  const text = serialiseDoc(doc.toJSON());
  const { kind, data } = parseFileContents('my map.json', text);
  assert.equal(kind, 'json');

  const reopened = MindMapDoc.fromJSON(data).root.children[0];
  assert.deepEqual(
    [reopened.text, reopened.bold, reopened.highlight, reopened.edgeLabel, reopened.colorIndex],
    ['A', true, 'yellow', 'because', 3],
  );
});

test('a markdown file is read as an outline', () => {
  const { kind, data } = parseFileContents('notes.md', '# Plan\n- One\n  - Deeper\n- Two');
  assert.equal(kind, 'outline');
  assert.equal(data.text, 'Plan');
  assert.deepEqual(data.children.map((c) => c.text), ['One', 'Two']);
});

test('a plain text outline without a heading uses the file name as the title', () => {
  const { data } = parseFileContents('Sermon notes.txt', '- One\n- Two');
  assert.equal(data.text, 'Sermon notes');
});

test('json is detected by content even when the name lies', () => {
  const text = serialiseDoc(new MindMapDoc(parseOutline('Root\n  - A')).toJSON());
  assert.equal(parseFileContents('map.txt', text).kind, 'json');
});

test('a broken .json file fails with a message naming the file', () => {
  assert.throws(() => parseFileContents('broken.json', '{ not json '), /broken\.json is not valid JSON/);
});

test('valid json that is not a mind map is rejected', () => {
  assert.throws(() => parseFileContents('other.json', '{"hello":"world"}'), /does not look like a mind map/);
});

test('a bare root node is accepted as well as a full document', () => {
  const { data } = parseFileContents('bare.json', '{"text":"Root","children":[{"text":"A","children":[]}]}');
  assert.equal(MindMapDoc.fromJSON(data).root.text, 'Root');
});

test('an outline file round-trips through save and open', () => {
  const root = parseOutline('# Plan\n- One\n  - Deeper');
  const { data } = parseFileContents('plan.md', serialiseOutline(root));
  assert.equal(data.text, 'Plan');
  assert.deepEqual(data.children[0].children.map((c) => c.text), ['Deeper']);
});

test('file name helpers', () => {
  assert.equal(baseName('Weekly review.json'), 'Weekly review');
  assert.equal(baseName('no-extension'), 'no-extension');
  assert.equal(ensureExtension('plan'), 'plan.json');
  assert.equal(ensureExtension('plan.md'), 'plan.md');
});
