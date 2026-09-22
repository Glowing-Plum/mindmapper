// Tidy tree layout.
//
// Children are positioned relative to *their own parent*, not in global
// per-depth columns: siblings share an edge with each other and with nothing
// else, so two nodes lining up vertically always means they belong to the same
// parent. Connectors resolve their curve immediately at the parent and then run
// straight into the child, which is what makes the branches easy to trace.

import { EDGE_LABEL_STYLE, createMeasurer, lineHeightFor, styleForDepth, styleForNode } from './measure.js';
import { branchColor } from './palette.js';
import { segmentLine } from './scripture.js';
import { formatChip, rollupAll } from './timing.js';

export const DEFAULT_OPTIONS = {
  mode: 'both', // 'both' | 'right'
  hGap: 44, // horizontal space between a parent and its children
  vGap: 14, // vertical space between sibling boxes
  measure: null,
  talkMode: false, // show scripture references and timings
};

const sharedMeasurer = createMeasurer();

/**
 * @param {object} root
 * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
 * @returns {{nodes: object[], edges: object[], bounds: object, byId: Map<string, object>, root: object}}
 */
export function computeLayout(root, options = {}) {
  const { mode, hGap, vGap, measure, talkMode } = { ...DEFAULT_OPTIONS, ...options };
  const measureText = measure ?? sharedMeasurer;
  const timings = talkMode ? rollupAll(root) : null;

  const makeBox = (node, depth, side, colorIndex, parentBox) => {
    const style = depth === 0 ? styleForDepth(0) : styleForNode(node, depth);
    const fallback = depth === 0 ? 'Central idea' : 'Untitled';
    const metrics = measureText(node.text?.trim() ? node.text : fallback, style);

    const chip = talkMode ? formatChip(timings?.get(node.id)?.total ?? 0) : '';
    const meta = talkMode
      ? [chip, node.note?.trim() ? '\u270E' : ''].filter(Boolean).join(' ')
      : '';
    const metaWidth = meta ? measureText(`  ${meta}`, style).width : 0;

    const label = node.edgeLabel?.trim() && parentBox
      ? measureText(node.edgeLabel, EDGE_LABEL_STYLE)
      : null;
    return {
      id: node.id,
      node,
      depth,
      side,
      style,
      lines: metrics.lines,
      // Each line split into plain text and scripture references, so the
      // references can be drawn as references.
      segments: talkMode ? metrics.lines.map((line) => segmentLine(line)) : null,
      timing: timings?.get(node.id) ?? null,
      // The time and note marker flow after the text, and the box is widened
      // to hold them, so they can never collide with a connector or a column.
      meta,
      metaWidth,
      hasNote: Boolean(node.note?.trim()),
      lineHeight: lineHeightFor(style),
      textWidth: metrics.width + metaWidth,
      w: Math.round(metrics.width + metaWidth + style.padX * 2),
      h: Math.round(Math.max(style.minHeight, metrics.height + style.padY * 2)),
      x: 0,
      y: 0,
      colorIndex,
      color: branchColor(colorIndex).stroke,
      highlight: node.highlight ?? null,
      parent: parentBox,
      children: [],
      isRoot: depth === 0,
      label: label
        ? {
          text: node.edgeLabel,
          // Split like a card's text, so a reference written on the line is
          // drawn as a reference and can be tapped.
          segments: talkMode ? segmentLine(node.edgeLabel) : null,
          w: Math.round(label.width + EDGE_LABEL_STYLE.padX * 2),
          h: Math.round(label.height + EDGE_LABEL_STYLE.padY * 2),
        }
        : null,
      collapsed: Boolean(node.collapsed) && node.children.length > 0,
      hiddenCount: node.collapsed ? countAll(node) : 0,
    };
  };

  const build = (node, depth, side, colorIndex, parentBox) => {
    const box = makeBox(node, depth, side, colorIndex, parentBox);
    if (!box.collapsed) {
      for (const child of node.children) {
        const childColor = Number.isInteger(child.colorIndex) ? child.colorIndex : colorIndex;
        box.children.push(build(child, depth + 1, side, childColor, box));
      }
    }
    return box;
  };

  const rootBox = makeBox(root, 0, 0, -1, null);
  rootBox.color = 'var(--root-bg)';

  // Split the top-level branches between the two sides, keeping reading order.
  const branches = rootBox.collapsed ? [] : root.children;
  const rightCount = mode === 'right' ? branches.length : Math.ceil(branches.length / 2);
  const sides = { right: [], left: [] };
  branches.forEach((child, index) => {
    const side = index < rightCount ? 1 : -1;
    const colorIndex = Number.isInteger(child.colorIndex) ? child.colorIndex : index;
    const box = build(child, 1, side, colorIndex, rootBox);
    rootBox.children.push(box);
    (side === 1 ? sides.right : sides.left).push(box);
  });

  // Vertical placement, one side at a time, centred on the root.
  for (const group of [sides.right, sides.left]) {
    if (group.length === 0) continue;
    let cursor = 0;
    for (const box of group) {
      cursor += placeSubtree(box, cursor, vGap) + vGap;
    }
    const top = Math.min(...group.map((box) => subtreeTop(box)));
    const bottom = Math.max(...group.map((box) => subtreeBottom(box)));
    shiftSubtrees(group, -(top + bottom) / 2);
  }

  // Horizontal placement: every child hangs off its own parent.
  rootBox.x = -rootBox.w / 2;
  rootBox.y = -rootBox.h / 2;
  assignX(rootBox, hGap);

  // Flatten to render data.
  const nodes = [];
  const edges = [];
  const byId = new Map();
  for (const box of iterate(rootBox)) {
    box.cx = box.x + box.w / 2;
    box.cy = box.y + box.h / 2;
    nodes.push(box);
    byId.set(box.id, box);
    if (box.parent) edges.push(buildEdge(box.parent, box));
  }

  return { nodes, edges, bounds: computeBounds(nodes, edges), byId, root: rootBox };
}

/**
 * Places a parent's children in one column of their own. The column is pushed
 * out far enough for the widest label on any of the lines feeding into it, so
 * a labelled line never runs short of room.
 */
function assignX(box, hGap) {
  if (box.children.length === 0) return;
  const labelRoom = Math.max(0, ...box.children.map((child) => (child.label ? child.label.w + 26 : 0)));
  const gap = Math.max(hGap, labelRoom);
  for (const child of box.children) {
    child.x = child.side === 1 ? box.x + box.w + gap : box.x - gap - child.w;
    assignX(child, hGap);
  }
}

function buildEdge(parent, child) {
  const side = child.side === -1 ? -1 : 1;
  const px = side === 1 ? parent.x + parent.w : parent.x;
  const py = parent.y + parent.h / 2;
  const cx = side === 1 ? child.x : child.x + child.w;
  const cy = child.y + child.h / 2;
  const span = Math.abs(cx - px);
  const straight = Math.abs(cy - py) < 0.5;

  // Control points sit close to the parent so the bend happens there and the
  // rest of the run is a straight horizontal line into the child.
  const lead = Math.min(20, span * 0.3);
  const settle = Math.min(48, span * 0.7);
  const path = straight
    ? `M ${round(px)} ${round(py)} L ${round(cx)} ${round(cy)}`
    : `M ${round(px)} ${round(py)} C ${round(px + lead * side)} ${round(py)}, ${round(px + settle * side)} ${round(cy)}, ${round(cx)} ${round(cy)}`;

  // The label sits at the horizontal centre of the connector, on the line: the
  // midpoint of the straight run would hug the child, because on a short or
  // steeply diagonal edge the curve eats most of the span.
  const labelX = (px + cx) / 2;
  const labelAnchor = straight
    ? { x: labelX, y: py }
    : pointOnCubicAtX(
      { x: px, y: py },
      { x: px + lead * side, y: py },
      { x: px + settle * side, y: cy },
      { x: cx, y: cy },
      labelX,
    );
  return {
    id: `${parent.id}->${child.id}`,
    from: parent,
    to: child,
    color: child.color,
    width: child.depth <= 1 ? 2.2 : 1.8,
    path,
    labelAnchor,
    label: child.label ? { ...child.label, ...labelAnchor, color: child.color } : null,
  };
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * The point on a connector at a given x. Our control points never double back
 * horizontally, so x is monotonic along the curve and a bisection converges.
 */
function pointOnCubicAtX(p0, p1, p2, p3, targetX) {
  const rising = p3.x > p0.x;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (rising === cubicPoint(p0, p1, p2, p3, mid).x < targetX) low = mid;
    else high = mid;
  }
  return cubicPoint(p0, p1, p2, p3, (low + high) / 2);
}

function countAll(node) {
  return node.children.reduce((total, child) => total + 1 + countAll(child), 0);
}

function* iterate(box) {
  yield box;
  for (const child of box.children) yield* iterate(child);
}

/**
 * Stacks a subtree starting at `top` and returns the height it occupies,
 * centring `box` on its children.
 */
function placeSubtree(box, top, vGap) {
  if (box.children.length === 0) {
    box.y = top;
    return box.h;
  }
  let cursor = top;
  for (const child of box.children) {
    cursor += placeSubtree(child, cursor, vGap) + vGap;
  }
  const first = box.children[0];
  const last = box.children[box.children.length - 1];
  box.y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - box.h / 2;

  // A parent taller than its children block would stick out above `top`;
  // push the whole subtree down so siblings never overlap it.
  const overflowTop = top - Math.min(box.y, subtreeTop(box, true));
  if (overflowTop > 0) shiftSubtrees([box], overflowTop);

  return subtreeBottom(box) - top;
}

function subtreeTop(box, childrenOnly = false) {
  let top = childrenOnly ? Infinity : box.y;
  for (const child of box.children) top = Math.min(top, subtreeTop(child));
  return top === Infinity ? box.y : top;
}

function subtreeBottom(box, childrenOnly = false) {
  let bottom = childrenOnly ? -Infinity : box.y + box.h;
  for (const child of box.children) bottom = Math.max(bottom, subtreeBottom(child));
  return bottom === -Infinity ? box.y + box.h : bottom;
}

function shiftSubtrees(boxes, dy) {
  if (!dy) return;
  const stack = [...boxes];
  while (stack.length) {
    const box = stack.pop();
    box.y += dy;
    stack.push(...box.children);
  }
}

function round(value) {
  return Math.round(value * 10) / 10;
}

export function computeBounds(nodes, edges = [], padding = 90) {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x, y, w, h) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const box of nodes) include(box.x, box.y, box.w, box.h);
  for (const edge of edges) {
    if (edge.label) include(edge.label.x - edge.label.w / 2, edge.label.y - edge.label.h / 2, edge.label.w, edge.label.h);
  }
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}
