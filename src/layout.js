// Tidy two-sided tree layout.
//
// The root sits at the origin; branches fan out left and right in per-depth
// columns, each subtree stacked so nothing overlaps and every parent is
// vertically centred on its children. Connectors are cubic beziers that leave
// the parent horizontally, which is what gives the map its soft Whimsical feel.

import { createMeasurer, lineHeightFor, styleForDepth } from './measure.js';
import { branchColor } from './palette.js';

export const DEFAULT_OPTIONS = {
  mode: 'both', // 'both' | 'right'
  hGap: 64, // horizontal space between columns
  vGap: 16, // vertical space between sibling boxes
  measure: null,
};

const sharedMeasurer = createMeasurer();

/**
 * @param {object} root
 * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
 * @returns {{nodes: object[], edges: object[], bounds: object, byId: Map<string, object>}}
 */
export function computeLayout(root, options = {}) {
  const { mode, hGap, vGap, measure } = { ...DEFAULT_OPTIONS, ...options };
  const measureText = measure ?? sharedMeasurer;

  // 1. Build the visible tree, measuring as we go.
  const build = (node, depth, side, colorIndex, parentBox) => {
    const style = styleForDepth(depth);
    const text = node.text?.trim() ? node.text : 'Untitled';
    const metrics = measureText(text, style);
    const box = {
      id: node.id,
      node,
      depth,
      side,
      style,
      lines: metrics.lines,
      lineHeight: lineHeightFor(style),
      w: Math.round(metrics.width + style.padX * 2),
      h: Math.round(Math.max(style.minHeight, metrics.height + style.padY * 2)),
      x: 0,
      y: 0,
      colorIndex,
      color: branchColor(colorIndex).stroke,
      parent: parentBox,
      children: [],
      hiddenCount: node.collapsed ? countAll(node) : 0,
      collapsed: Boolean(node.collapsed) && node.children.length > 0,
    };
    if (!box.collapsed) {
      for (const child of node.children) {
        const childColor = Number.isInteger(child.colorIndex) ? child.colorIndex : colorIndex;
        box.children.push(build(child, depth + 1, side, childColor, box));
      }
    }
    return box;
  };

  const rootStyle = styleForDepth(0);
  const rootMetrics = measureText(root.text?.trim() ? root.text : 'Central idea', rootStyle);
  const rootBox = {
    id: root.id,
    node: root,
    depth: 0,
    side: 0,
    style: rootStyle,
    lines: rootMetrics.lines,
    lineHeight: lineHeightFor(rootStyle),
    w: Math.round(rootMetrics.width + rootStyle.padX * 2),
    h: Math.round(Math.max(rootStyle.minHeight, rootMetrics.height + rootStyle.padY * 2)),
    x: 0,
    y: 0,
    colorIndex: -1,
    color: 'var(--root-bg)',
    parent: null,
    children: [],
    isRoot: true,
    hiddenCount: root.collapsed ? countAll(root) : 0,
    collapsed: Boolean(root.collapsed) && root.children.length > 0,
  };

  // 2. Split the top-level branches between the two sides, keeping order:
  //    the first half goes right, the rest left (reading order, top to bottom).
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

  // 3. Vertical placement, one side at a time.
  for (const group of [sides.right, sides.left]) {
    if (group.length === 0) continue;
    let cursor = 0;
    for (const box of group) {
      const height = placeSubtree(box, cursor, vGap);
      cursor += height + vGap;
    }
    const top = Math.min(...group.map(subtreeTop));
    const bottom = Math.max(...group.map(subtreeBottom));
    shiftSubtrees(group, -(top + bottom) / 2); // centre the side on the root
  }

  // 4. Horizontal placement: one column per depth per side, wide enough for
  //    the widest node in it.
  const columns = { 1: new Map(), '-1': new Map() };
  for (const box of iterate(rootBox)) {
    if (box.isRoot) continue;
    const perSide = columns[box.side];
    perSide.set(box.depth, Math.max(perSide.get(box.depth) ?? 0, box.w));
  }
  const columnStart = { 1: new Map(), '-1': new Map() };
  for (const side of [1, -1]) {
    let offset = rootBox.w / 2 + hGap;
    const depths = [...columns[side].keys()].sort((a, b) => a - b);
    for (const depth of depths) {
      columnStart[side].set(depth, offset);
      offset += columns[side].get(depth) + hGap;
    }
  }
  for (const box of iterate(rootBox)) {
    if (box.isRoot) {
      box.x = -box.w / 2;
      continue;
    }
    const start = columnStart[box.side].get(box.depth) ?? 0;
    box.x = box.side === 1 ? start : -start - box.w;
  }
  rootBox.y = -rootBox.h / 2;

  // 5. Flatten to render data.
  const nodes = [];
  const edges = [];
  const byId = new Map();
  for (const box of iterate(rootBox)) {
    box.cx = box.x + box.w / 2;
    box.cy = box.y + box.h / 2;
    nodes.push(box);
    byId.set(box.id, box);
    if (box.parent) {
      edges.push({
        id: `${box.parent.id}->${box.id}`,
        from: box.parent,
        to: box,
        color: box.color,
        width: Math.max(1.5, 3.5 - box.depth * 0.6),
        path: connector(box.parent, box),
      });
    }
  }

  const bounds = computeBounds(nodes);
  return { nodes, edges, bounds, byId, root: rootBox };
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
 * positioning `box` centred on its children (and nudging the subtree down if
 * the parent box is taller than the children block).
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

/** Cubic bezier that leaves the parent horizontally and arrives the same way. */
export function connector(parent, child) {
  const side = child.side === -1 ? -1 : 1;
  const px = side === 1 ? parent.x + parent.w : parent.x;
  const py = parent.y + parent.h / 2;
  const cx = side === 1 ? child.x : child.x + child.w;
  const cy = child.y + child.h / 2;
  const bend = Math.max(24, Math.abs(cx - px) * 0.5);
  return `M ${round(px)} ${round(py)} C ${round(px + bend * side)} ${round(py)}, ${round(cx - bend * side)} ${round(cy)}, ${round(cx)} ${round(cy)}`;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

export function computeBounds(nodes, padding = 80) {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of nodes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}
