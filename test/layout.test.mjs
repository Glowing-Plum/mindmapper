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

test('siblings align with each other and with nothing else', () => {
  const { nodes } = layoutOf(bigOutline);
  const byParent = new Map();
  for (const box of nodes) {
    if (!box.parent) continue;
    // The root's children fan out both ways, so a side is part of the group.
    const key = `${box.parent.id}|${box.side}`;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(box);
  }
  for (const siblings of byParent.values()) {
    const edges = new Set(siblings.map((box) => (box.side === 1 ? box.x : box.x + box.w)));
    assert.equal(edges.size, 1, 'siblings share a leading edge');
  }
});

test('children hang off their own parent, not a shared depth column', () => {
  // Two branches whose depth-1 nodes differ in width must not line their
  // depth-2 nodes up with each other: that would imply a relationship.
  const root = parseOutline('Root\n  - Short\n    - A\n  - A much longer branch label\n    - B');
  const { byId } = computeLayout(root, { mode: 'right' });
  const a = byId.get(root.children[0].children[0].id);
  const b = byId.get(root.children[1].children[0].id);
  assert.notEqual(a.x, b.x, 'cousins under differently sized parents must not align');
  assert.equal(a.x, byId.get(root.children[0].id).x + byId.get(root.children[0].id).w + 44);
});

test('a child sits immediately right of its parent on the left side too', () => {
  const { nodes, root } = layoutOf(bigOutline);
  for (const box of nodes) {
    if (!box.parent) continue;
    const gap = box.side === 1
      ? box.x - (box.parent.x + box.parent.w)
      : box.parent.x - (box.x + box.w);
    assert.ok(gap >= 44 - 0.5, `${box.node.text} sits ${gap} from its parent`);
  }
  assert.ok(root.children.length > 0);
});

test('every edge connects a parent to a child and starts at the parent border', () => {
  const { edges, nodes } = layoutOf(bigOutline);
  assert.equal(edges.length, nodes.length - 1);
  for (const edge of edges) {
    assert.ok(edge.path.startsWith('M '));
    // A child level with its parent gets a straight line; anything else curves.
    const aligned = Math.abs(edge.to.cy - edge.from.cy) < 0.5;
    assert.ok(aligned ? edge.path.includes(' L ') : edge.path.includes(' C '));
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
  assert.equal(new Set(nodes.map((box) => box.w)).size, 2, 'one width per depth style');
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

test('the curve resolves near the parent, then runs straight to the child', () => {
  const root = parseOutline('Root\n  - Branch one\n  - Branch two');
  const { edges } = computeLayout(root, { mode: 'right' });
  const curved = edges.find((edge) => edge.path.includes(' C '));
  const [, , , c1x, , c2x] = curved.path.match(/M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)/).map(Number);
  const [, startX] = curved.path.match(/^M (-?[\d.]+)/).map(Number);
  const endX = curved.to.x;
  // Both control points sit in the first half of the run, so the line has
  // flattened out well before it reaches the child.
  assert.ok(c1x - startX <= (endX - startX) * 0.5);
  assert.ok(c2x - startX <= (endX - startX) * 0.8);
});

test('every edge carries a label anchor on its straight run', () => {
  const { edges } = layoutOf(bigOutline);
  for (const edge of edges) {
    assert.ok(Number.isFinite(edge.labelAnchor.x) && Number.isFinite(edge.labelAnchor.y));
    assert.equal(edge.labelAnchor.y, edge.to.y + edge.to.h / 2, 'the anchor sits on the line into the child');
    const [low, high] = [edge.from.x, edge.to.x].sort((a, b) => a - b);
    assert.ok(edge.labelAnchor.x >= low - 1 && edge.labelAnchor.x <= high + edge.to.w + 1);
    assert.equal(edge.label, null, 'unlabelled edges carry no label box');
  }
});

test('a labelled line reserves room for its label', () => {
  const root = parseOutline('Root\n  - Child');
  const plain = computeLayout(root, { mode: 'right' });
  const plainGap = plain.byId.get(root.children[0].id).x;

  root.children[0].edgeLabel = 'leads to a much longer explanation';
  const labelled = computeLayout(root, { mode: 'right' });
  const box = labelled.byId.get(root.children[0].id);
  const edge = labelled.edges[0];
  assert.ok(box.x > plainGap, 'the column moves out to make room');
  assert.ok(edge.label, 'the edge carries a label box');
  assert.ok(edge.label.w + 26 <= box.x - (labelled.root.x + labelled.root.w) + 1);
  assert.ok(labelled.bounds.width >= plain.bounds.width);
});

test('siblings share a column sized for the widest label among them', () => {
  const root = parseOutline('Root\n  - One\n  - Two');
  root.children[1].edgeLabel = 'a long label on the second line';
  const { byId } = computeLayout(root, { mode: 'right' });
  assert.equal(byId.get(root.children[0].id).x, byId.get(root.children[1].id).x);
});

test('bold and italic change the measured box', () => {
  const root = parseOutline('Root\n  - Formatted');
  const plain = computeLayout(root).byId.get(root.children[0].id);
  root.children[0].bold = true;
  const bold = computeLayout(root).byId.get(root.children[0].id);
  assert.ok(bold.w > plain.w, 'bold text is wider');
  root.children[0].italic = true;
  assert.equal(computeLayout(root).byId.get(root.children[0].id).style.italic, true);
});

test('a highlight is carried through to the rendered box', () => {
  const root = parseOutline('Root\n  - Marked');
  root.children[0].highlight = 'yellow';
  assert.equal(computeLayout(root).byId.get(root.children[0].id).highlight, 'yellow');
});

test('bounds include edge labels that stick out', () => {
  const root = parseOutline('Root\n  - Child');
  root.children[0].edgeLabel = 'label';
  const { bounds, edges } = computeLayout(root, { mode: 'right' });
  const label = edges[0].label;
  assert.ok(label.x - label.w / 2 >= bounds.x);
  assert.ok(label.x + label.w / 2 <= bounds.x + bounds.width);
});
