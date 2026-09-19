import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MindMapDoc, countDescendants, walk } from '../src/model.js';
import { parseOutline } from '../src/parser.js';

const docFrom = (outline) => new MindMapDoc(parseOutline(outline));
const texts = (node) => node.children.map((child) => child.text);

test('indexes nodes, parents and depths', () => {
  const doc = docFrom('Root\n  - A\n    - A1\n  - B');
  const a1 = [...walk(doc.root)].find((entry) => entry.node.text === 'A1').node;
  assert.equal(doc.get(a1.id), a1);
  assert.equal(doc.parentOf(a1.id).text, 'A');
  assert.equal(doc.depthOf(a1.id), 2);
  assert.equal(doc.indexOf(a1.id), 0);
  assert.equal(countDescendants(doc.root), 3);
});

test('adds children and siblings in the right place', () => {
  const doc = docFrom('Root\n  - A\n  - C');
  const a = doc.root.children[0];
  doc.addSibling(a.id, 'B');
  assert.deepEqual(texts(doc.root), ['A', 'B', 'C']);
  doc.addChild(a.id, 'A1');
  assert.deepEqual(texts(a), ['A1']);
});

test('a sibling of the root becomes a child of the root', () => {
  const doc = docFrom('Root');
  doc.addSibling(doc.root.id, 'A');
  assert.deepEqual(texts(doc.root), ['A']);
});

test('remove returns a sensible next selection and never removes the root', () => {
  const doc = docFrom('Root\n  - A\n  - B');
  const b = doc.root.children[1];
  assert.equal(doc.remove(b.id).text, 'A');
  assert.deepEqual(texts(doc.root), ['A']);
  assert.equal(doc.remove(doc.root.id), null);
  assert.equal(doc.remove(doc.root.children[0].id).text, 'Root');
});

test('move re-parents but refuses to create a cycle', () => {
  const doc = docFrom('Root\n  - A\n    - A1\n  - B');
  const a = doc.root.children[0];
  const a1 = a.children[0];
  assert.equal(doc.move(a.id, a1.id), null, 'cannot move a node into its own subtree');
  assert.deepEqual(texts(a), ['A1']);
  doc.move(a1.id, doc.root.children[1].id);
  assert.deepEqual(texts(a), []);
  assert.deepEqual(texts(doc.root.children[1]), ['A1']);
});

test('move within the same parent adjusts for the removed slot', () => {
  const doc = docFrom('Root\n  - A\n  - B\n  - C');
  doc.move(doc.root.children[0].id, doc.root.id, 2);
  assert.deepEqual(texts(doc.root), ['B', 'A', 'C']);
});

test('reorder, indent and outdent restructure the tree', () => {
  const doc = docFrom('Root\n  - A\n  - B\n  - C');
  doc.reorder(doc.root.children[2].id, -1);
  assert.deepEqual(texts(doc.root), ['A', 'C', 'B']);
  assert.equal(doc.reorder(doc.root.children[0].id, -1), null, 'cannot move past the first slot');

  doc.indent(doc.root.children[1].id);
  assert.deepEqual(texts(doc.root), ['A', 'B']);
  assert.deepEqual(texts(doc.root.children[0]), ['C']);

  doc.outdent(doc.root.children[0].children[0].id);
  assert.deepEqual(texts(doc.root), ['A', 'C', 'B']);
  assert.equal(doc.outdent(doc.root.children[0].id), null, 'top-level nodes cannot outdent');
});

test('collapse toggles only where there are children', () => {
  const doc = docFrom('Root\n  - A\n    - A1\n  - B');
  const a = doc.root.children[0];
  doc.toggleCollapse(a.id);
  assert.equal(a.collapsed, true);
  assert.equal(doc.toggleCollapse(doc.root.children[1].id), null);
  doc.setCollapsedAll(false);
  assert.equal(a.collapsed, false);
});

test('revealPathTo expands collapsed ancestors', () => {
  const doc = docFrom('Root\n  - A\n    - A1');
  const a = doc.root.children[0];
  const a1 = a.children[0];
  doc.toggleCollapse(a.id);
  assert.equal(doc.revealPathTo(a1.id), true);
  assert.equal(a.collapsed, false);
});

test('undo and redo walk the history', () => {
  const doc = docFrom('Root\n  - A');
  assert.equal(doc.canUndo(), false);
  doc.addChild(doc.root.id, 'B');
  doc.setText(doc.root.children[0].id, 'A renamed');
  assert.deepEqual(texts(doc.root), ['A renamed', 'B']);

  doc.undo();
  assert.deepEqual(texts(doc.root), ['A', 'B']);
  doc.undo();
  assert.deepEqual(texts(doc.root), ['A']);
  assert.equal(doc.canUndo(), false);

  doc.redo();
  assert.deepEqual(texts(doc.root), ['A', 'B']);
  assert.equal(doc.canRedo(), true);
  doc.addChild(doc.root.id, 'C');
  assert.equal(doc.canRedo(), false, 'a new edit clears the redo stack');
});

test('declined mutations do not land in the history', () => {
  const doc = docFrom('Root\n  - A');
  doc.setText(doc.root.children[0].id, 'A'); // unchanged text
  assert.equal(doc.canUndo(), false);
});

test('change listeners fire and can be detached', () => {
  const doc = docFrom('Root');
  let calls = 0;
  const off = doc.onChange(() => { calls += 1; });
  doc.addChild(doc.root.id, 'A');
  assert.equal(calls, 1);
  doc.undo();
  assert.equal(calls, 2);
  off();
  doc.addChild(doc.root.id, 'B');
  assert.equal(calls, 2);
});

test('serialises and restores, including collapse and colour', () => {
  const doc = docFrom('Root\n  - A\n    - A1');
  doc.setColor(doc.root.children[0].id, 3);
  doc.toggleCollapse(doc.root.children[0].id);
  const restored = MindMapDoc.fromJSON(JSON.parse(JSON.stringify(doc.toJSON())));
  assert.equal(restored.root.text, 'Root');
  assert.equal(restored.root.children[0].colorIndex, 3);
  assert.equal(restored.root.children[0].collapsed, true);
  assert.deepEqual(texts(restored.root.children[0]), ['A1']);
  assert.notEqual(restored.root.id, doc.root.id, 'restored nodes get fresh ids');
});

test('amend folds an edit into the previous history entry', () => {
  const doc = docFrom('Root');
  const node = doc.addChild(doc.root.id, '');
  doc.setText(node.id, 'Named on creation', { amend: true });
  assert.deepEqual(texts(doc.root), ['Named on creation']);
  doc.undo();
  assert.deepEqual(texts(doc.root), [], 'one undo removes the node and its name');
});
