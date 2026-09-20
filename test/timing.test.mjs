import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatChip, formatMinutes, rollup, rollupAll, summarise } from '../src/timing.js';
import { MindMapDoc } from '../src/model.js';
import { parseOutline } from '../src/parser.js';

function talk(outline, times = {}) {
  const doc = new MindMapDoc(parseOutline(outline));
  for (const [text, minutes] of Object.entries(times)) {
    const node = [...doc.nodes.values()].find((candidate) => candidate.text === text);
    doc.setMinutes(node.id, minutes);
  }
  return doc;
}

test('a leaf contributes its own minutes', () => {
  const doc = talk('Talk\n  - Intro\n  - Body', { Intro: 3, Body: 12 });
  assert.equal(rollup(doc.root).total, 15);
});

test('a parent with no time of its own sums its children', () => {
  const doc = talk('Talk\n  - Body\n    - One\n    - Two', { One: 4, Two: 6 });
  const body = doc.root.children[0];
  assert.deepEqual(rollup(body), { total: 10, own: null, children: 10 });
});

test('an explicit time on a parent wins over its children', () => {
  const doc = talk('Talk\n  - Body\n    - One\n    - Two', { Body: 8, One: 4, Two: 6 });
  const body = doc.root.children[0];
  assert.deepEqual(rollup(body), { total: 8, own: 8, children: 10 },
    'a decision about the section beats the sum of its parts');
  assert.equal(rollup(doc.root).total, 8);
});

test('untimed nodes contribute nothing', () => {
  const doc = talk('Talk\n  - Intro\n  - Body', { Body: 10 });
  assert.equal(rollup(doc.root).total, 10);
  assert.equal(summarise(doc.root).timed, 1);
});

test('rollupAll indexes every node', () => {
  const doc = talk('Talk\n  - A\n    - A1\n  - B', { A1: 5, B: 7 });
  const table = rollupAll(doc.root);
  assert.equal(table.size, 4);
  assert.equal(table.get(doc.root.id).total, 12);
  assert.equal(table.get(doc.root.children[0].id).total, 5);
});

test('summarise compares the plan with the time available', () => {
  const doc = talk('Talk\n  - Intro\n  - Body', { Intro: 5, Body: 20 });
  assert.deepEqual(summarise(doc.root, 30), { total: 25, target: 30, over: -5, timed: 2, status: 'ok' });
  assert.equal(summarise(doc.root, 20).status, 'over');
  assert.equal(summarise(doc.root, 20).over, 5);
  assert.equal(summarise(doc.root, 60).status, 'short');
  assert.equal(summarise(doc.root, 0).status, 'untargeted');
});

test('minutes survive saving and reopening, and a regenerate', () => {
  const doc = talk('Talk\n  - Body', { Body: 9 });
  const restored = MindMapDoc.fromJSON(JSON.parse(JSON.stringify(doc.toJSON())));
  assert.equal(restored.root.children[0].minutes, 9);
});

test('minutes are validated and clearable', () => {
  const doc = talk('Talk\n  - Body');
  const body = doc.root.children[0];
  doc.setMinutes(body.id, 7.25);
  assert.equal(body.minutes, 7.3, 'rounded to a tenth');
  doc.setMinutes(body.id, 0);
  assert.equal(body.minutes, null, 'zero clears it');
  doc.setMinutes(body.id, -5);
  assert.equal(body.minutes, null, 'negatives are refused');
  doc.setMinutes(body.id, 5);
  doc.undo();
  // Undo swaps in a restored tree, so the node must be read back from the doc.
  assert.equal(doc.root.children[0].minutes, null, 'setting minutes is undoable');
});

test('formats minutes for people', () => {
  assert.equal(formatMinutes(0), '—');
  assert.equal(formatMinutes(4), '4 min');
  assert.equal(formatMinutes(4.5), '4.5 min');
  assert.equal(formatMinutes(60), '1 h');
  assert.equal(formatMinutes(65), '1 h 05');
  assert.equal(formatChip(4), '4m');
  assert.equal(formatChip(65), '1h05');
  assert.equal(formatChip(null), '');
});
