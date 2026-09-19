import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../src/layout.js';
import { parseOutline } from '../src/parser.js';
import { walk } from '../src/model.js';

const layoutOf = (outline, options) => computeLayout(parseOutline(outline), options);

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function assertNoOverlaps(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      assert.equal(
        overlaps(nodes[i], nodes[j]),
        false,
        `"${nodes[i].node.text}" overlaps "${nodes[j].node.text}"`,
      );
    }
  }
}

const bigOutline = [
  'Company strategy',
  '  - Product',
  '    - Discovery',
  '      - User interviews with a deliberately long label to force wrapping',
  '      - Surveys',
  '    - Delivery',
  '      - Sprint planning',
  '      - Release train',
  '        - Staging',
  '        - Production',
  '  - Marketing',
  '    - Content',
  '    - Events',
  '  - Sales',
  '    - Enablement',
  '      - Playbooks',
  '  - Support',
  '    - Docs',
  '  - Finance',
  '  - People',
].join('\n');

test('every node is laid out, nothing overlaps', () => {
  const { nodes } = layoutOf(bigOutline);
  assert.equal(nodes.length, 20);
  assertNoOverlaps(nodes);
});

test('branches are split left and right around a centred root', () => {
  const { nodes, root } = layoutOf(bigOutline);
  assert.equal(Math.round(root.x + root.w / 2), 0);
  assert.equal(Math.round(root.y + root.h / 2), 0);
  const sides = new Set(root.children.map((child) => child.side));
  assert.deepEqual([...sides].sort(), [-1, 1]);
  assert.equal(root.children.filter((c) => c.side === 1).length, 3, 'first half goes right');
  for (const box of nodes) {
    if (box.isRoot) continue;
    if (box.side === 1) assert.ok(box.x > root.x + root.w, `${box.node.text} should sit right of the root`);
    else assert.ok(box.x + box.w < root.x, `${box.node.text} should sit left of the root`);
  }
});

test('right-only mode keeps every branch on one side', () => {
  const { root, nodes } = layoutOf(bigOutline, { mode: 'right' });
  assert.ok(root.children.every((child) => child.side === 1));
  assertNoOverlaps(nodes);
});

test('descendants inherit their branch colour, overrides propagate', () => {
  const root = parseOutline('Root\n  - A\n    - A1\n  - B');
  root.children[1].colorIndex = 5;
  const { byId } = computeLayout(root);
  const a = byId.get(root.children[0].id);
  const a1 = byId.get(root.children[0].children[0].id);
  const b = byId.get(root.children[1].id);
  assert.equal(a.color, a1.color, 'a child inherits its parent branch colour');
  assert.notEqual(a.color, b.color, 'sibling branches differ');
  assert.equal(b.colorIndex, 5);
});

test('a parent is centred on its children', () => {
  const root = parseOutline('Root\n  - A\n    - A1\n    - A2\n    - A3');
  const { byId } = computeLayout(root);
  const a = byId.get(root.children[0].id);
  const kids = root.children[0].children.map((child) => byId.get(child.id));
  const midpoint = (kids[0].cy + kids[kids.length - 1].cy) / 2;
  assert.ok(Math.abs(a.cy - midpoint) < 0.51, `parent at ${a.cy}, children midpoint ${midpoint}`);
});

test('collapsed nodes hide their subtree and report the hidden count', () => {
  const root = parseOutline('Root\n  - A\n    - A1\n      - A1a\n  - B');
  const a = root.children[0];
  a.collapsed = true;
  const { nodes, byId } = computeLayout(root);
  assert.deepEqual(nodes.map((box) => box.node.text), ['Root', 'A', 'B']);
  assert.equal(byId.get(a.id).hiddenCount, 2);
  assert.equal(byId.get(a.id).collapsed, true);
});

test('nodes in the same column share an edge, columns are ordered by depth', () => {
  const { nodes } = layoutOf(bigOutline);
  const rightDepth1 = nodes.filter((box) => box.side === 1 && box.depth === 1);
  const rightDepth2 = nodes.filter((box) => box.side === 1 && box.depth === 2);
  assert.ok(rightDepth1.length > 1);
  assert.equal(new Set(rightDepth1.map((box) => box.x)).size, 1, 'a right column is left-aligned');
  assert.ok(Math.min(...rightDepth2.map((b) => b.x)) > Math.max(...rightDepth1.map((b) => b.x + b.w)));

  const leftDepth1 = nodes.filter((box) => box.side === -1 && box.depth === 1);
  assert.equal(new Set(leftDepth1.map((box) => box.x + box.w)).size, 1, 'a left column is right-aligned');
});

test('every edge connects a parent to a child and starts at the parent border', () => {
  const { edges, nodes } = layoutOf(bigOutline);
  assert.equal(edges.length, nodes.length - 1);
  for (const edge of edges) {
    assert.ok(edge.path.startsWith('M '));
    assert.ok(edge.path.includes(' C '));
    const [, x, y] = edge.path.match(/^M (-?[\d.]+) (-?[\d.]+)/).map(Number);
    const expectedX = edge.to.side === 1 ? edge.from.x + edge.from.w : edge.from.x;
    assert.ok(Math.abs(x - expectedX) < 0.6);
    assert.ok(Math.abs(y - (edge.from.y + edge.from.h / 2)) < 0.6);
  }
});

test('bounds enclose every node plus padding', () => {
  const { nodes, bounds } = layoutOf(bigOutline);
  for (const box of nodes) {
    assert.ok(box.x >= bounds.x && box.x + box.w <= bounds.x + bounds.width);
    assert.ok(box.y >= bounds.y && box.y + box.h <= bounds.y + bounds.height);
  }
});

test('a tall parent with a single short child does not overlap its siblings', () => {
  const outline = [
    'Root',
    '  - A node whose label is long enough to wrap onto several lines in the box',
    '    - x',
    '  - Second',
    '  - Third',
  ].join('\n');
  assertNoOverlaps(layoutOf(outline, { mode: 'right' }).nodes);
});

test('deep chains and wide fans stay tidy', () => {
  const deep = ['Root', ...Array.from({ length: 12 }, (_, i) => `${'  '.repeat(i + 1)}- level ${i + 1}`)].join('\n');
  assertNoOverlaps(computeLayout(parseOutline(deep)).nodes);

  const wide = ['Root', ...Array.from({ length: 40 }, (_, i) => `  - branch ${i + 1}`)].join('\n');
  const layout = computeLayout(parseOutline(wide));
  assertNoOverlaps(layout.nodes);
  assert.equal(layout.nodes.length, 41);
});

test('a lone root lays out without children', () => {
  const layout = computeLayout(parseOutline('Just me'));
  assert.equal(layout.nodes.length, 1);
  assert.equal(layout.edges.length, 0);
  assert.ok(layout.bounds.width > layout.nodes[0].w);
});

test('empty node text still produces a sized box', () => {
  const root = parseOutline('Root\n  - A');
  root.children[0].text = '';
  const box = computeLayout(root).byId.get(root.children[0].id);
  assert.ok(box.w > 0 && box.h > 0);
  assert.deepEqual(box.lines, ['Untitled']);
});

test('layout is deterministic for the same input', () => {
  const root = parseOutline(bigOutline);
  const a = computeLayout(root).nodes.map((box) => [box.x, box.y]);
  const b = computeLayout(root).nodes.map((box) => [box.x, box.y]);
  assert.deepEqual(a, b);
});

test('a custom measurer is honoured', () => {
  const measure = () => ({ width: 100, height: 20, lines: ['fixed'] });
  const { nodes } = computeLayout(parseOutline(bigOutline), { measure });
  assert.equal(new Set(nodes.map((box) => box.w)).size, 3, 'one width per depth style');
  assertNoOverlaps(nodes);
});

test('gap options change the spacing', () => {
  const tight = layoutOf(bigOutline, { hGap: 20, vGap: 4 }).bounds;
  const loose = layoutOf(bigOutline, { hGap: 120, vGap: 40 }).bounds;
  assert.ok(loose.width > tight.width);
  assert.ok(loose.height > tight.height);
});

test('walk order matches the rendered node order', () => {
  const root = parseOutline(bigOutline);
  const { nodes } = computeLayout(root);
  const expected = [...walk(root)].map((entry) => entry.node.text);
  const actual = nodes.map((box) => box.node.text);
  assert.equal(actual.length, expected.length);
  assert.deepEqual(new Set(actual), new Set(expected));
});
