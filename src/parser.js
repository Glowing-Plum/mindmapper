// Outline <-> tree. The generator side of the app: paste a markdown outline or
// an indented list and get a mind map, and vice versa.

import { createNode } from './model.js';

const BULLET = /^[-*+•]\s+/;
const HEADING = /^(#{1,6})\s+/;
const ORDERED = /^\d+[.)]\s+/;

function indentWidth(raw) {
  let width = 0;
  for (const ch of raw) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

/**
 * Parses an outline into a tree.
 *
 * Understands markdown headings (`#`, `##`, ...), bullets (`-`, `*`, `+`),
 * numbered items and plain indented text. Indentation unit is inferred from
 * the smallest indent step in the text, so 2-space and 4-space outlines and
 * tabs all work.
 *
 * @param {string} text
 * @param {{title?: string}} [options]
 * @returns {object} root node
 */
export function parseOutline(text, options = {}) {
  const rawLines = String(text ?? '').split('\n');
  const entries = [];

  for (const raw of rawLines) {
    if (!raw.trim()) continue;
    const indent = indentWidth(raw);
    let body = raw.trim();

    const heading = body.match(HEADING);
    if (heading) {
      entries.push({ kind: 'heading', level: heading[1].length, indent, text: body.slice(heading[0].length).trim() });
      continue;
    }
    body = body.replace(BULLET, '').replace(ORDERED, '').trim();
    if (!body) continue;
    entries.push({ kind: 'item', indent, text: body });
  }

  if (entries.length === 0) {
    return createNode(options.title || 'Central idea');
  }

  // Infer the indent step from the distinct indents actually used.
  const indents = [...new Set(entries.filter((e) => e.kind === 'item').map((e) => e.indent))].sort((a, b) => a - b);
  let unit = 0;
  for (let i = 1; i < indents.length; i++) {
    const step = indents[i] - indents[i - 1];
    if (step > 0 && (unit === 0 || step < unit)) unit = step;
  }
  if (unit === 0) unit = 2;

  // Turn each entry into an absolute depth. Headings set a base depth that the
  // bullets following them nest inside.
  let headingBase = 0;
  let sawHeading = false;
  const resolved = entries.map((entry) => {
    if (entry.kind === 'heading') {
      sawHeading = true;
      headingBase = entry.level - 1;
      return { text: entry.text, depth: headingBase };
    }
    const relative = Math.max(0, Math.round((entry.indent - (indents[0] ?? 0)) / unit));
    return { text: entry.text, depth: (sawHeading ? headingBase + 1 : 0) + relative };
  });

  // Normalise so the shallowest entry sits at depth 0, and clamp jumps so a
  // sudden deep indent still attaches to the previous node.
  const minDepth = Math.min(...resolved.map((entry) => entry.depth));
  const nodes = [];
  let previousDepth = -1;
  for (const entry of resolved) {
    const depth = Math.min(entry.depth - minDepth, previousDepth + 1);
    nodes.push({ node: createNode(entry.text), depth });
    previousDepth = depth;
  }

  const tops = nodes.filter((entry) => entry.depth === 0);
  const stack = [];
  let root;
  if (tops.length === 1) {
    root = tops[0].node;
  } else {
    root = createNode(options.title || 'Mind map');
    stack.push({ node: root, depth: -1 });
  }

  for (const entry of nodes) {
    if (entry.node === root) {
      stack.length = 0;
      stack.push(entry);
      continue;
    }
    while (stack.length && stack[stack.length - 1].depth >= entry.depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : root;
    parent.children.push(entry.node);
    stack.push(entry);
  }

  return root;
}

/**
 * Serialises a tree back to a markdown outline: the root as an `#` heading,
 * everything below it as nested bullets.
 */
export function toOutline(root, { indent = '  ' } = {}) {
  const lines = [`# ${root.text}`];
  const write = (node, depth) => {
    for (const child of node.children) {
      lines.push(`${indent.repeat(depth)}- ${child.text.replace(/\n+/g, ' ')}`);
      write(child, depth + 1);
    }
  };
  write(root, 0);
  return lines.join('\n');
}

/** Plain-text outline without markdown syntax, handy for pasting elsewhere. */
export function toPlainOutline(root, { indent = '    ' } = {}) {
  const lines = [];
  const write = (node, depth) => {
    lines.push(`${indent.repeat(depth)}${node.text}`);
    for (const child of node.children) write(child, depth + 1);
  };
  write(root, 0);
  return lines.join('\n');
}
