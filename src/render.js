// SVG renderer. Nodes and edges are keyed by id and reused between renders so
// the browser can tween them -- relayouts glide instead of jumping.
//
// Only the root is drawn as a card. Every other node is bare text on the
// canvas, with an invisible rounded rect behind it for hover, selection and
// pointer hits.

import { highlightVar } from './palette.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) el.setAttribute(key, String(value));
  }
  return el;
}

export function createRenderer(svg) {
  const scene = svgEl('g', { class: 'scene' });
  const edgeLayer = svgEl('g', { class: 'layer-edges' });
  const nodeLayer = svgEl('g', { class: 'layer-nodes' });
  const labelLayer = svgEl('g', { class: 'layer-labels' });
  const overlayLayer = svgEl('g', { class: 'layer-overlay' });
  scene.append(edgeLayer, nodeLayer, labelLayer, overlayLayer);
  svg.append(scene);

  const nodeEls = new Map();
  const edgeEls = new Map();
  const labelEls = new Map();
  let lastLayout = null;

  function renderNode(box, state) {
    let entry = nodeEls.get(box.id);
    if (!entry) {
      const group = svgEl('g', { class: 'node', 'data-id': box.id });
      const hit = svgEl('rect', { class: 'node-hit' });
      const card = svgEl('rect', { class: 'node-card' });
      const highlight = svgEl('rect', { class: 'node-highlight' });
      const text = svgEl('text', { class: 'node-text' });
      const badge = svgEl('g', { class: 'node-badge' });
      const badgeCircle = svgEl('circle', { class: 'node-badge-circle', r: 9 });
      const badgeText = svgEl('text', { class: 'node-badge-text' });
      badge.append(badgeCircle, badgeText);
      // Two handles: out to the side adds a child, below adds a sibling.
      // Each has a generous invisible disc behind it so it is easy to hit.
      const childHandle = handleEl('child');
      const siblingHandle = handleEl('sibling');
      group.append(card, hit, highlight, text, badge, childHandle, siblingHandle);
      nodeLayer.append(group);
      entry = { group, hit, card, highlight, text, badge, badgeText, childHandle, siblingHandle };
      nodeEls.set(box.id, entry);
      group.classList.add('is-entering');
      requestAnimationFrame(() => group.classList.remove('is-entering'));
    }

    const { group, hit, card, highlight, text, badge, badgeText, childHandle, siblingHandle } = entry;
    group.setAttribute('transform', `translate(${box.x}, ${box.y})`);
    group.setAttribute('data-depth', Math.min(box.depth, 1));
    group.classList.toggle('is-root', box.isRoot);
    group.classList.toggle('is-selected', state.selectedId === box.id);
    group.classList.toggle('is-editing', state.editingId === box.id);
    group.classList.toggle('is-drop-target', state.dropTargetId === box.id);
    group.classList.toggle('is-dragging', state.draggingId === box.id);
    group.classList.toggle('is-collapsed', box.collapsed);

    setRect(hit, 0, 0, box.w, box.h, box.style.radius);
    card.style.display = box.isRoot ? '' : 'none';
    if (box.isRoot) setRect(card, 0, 0, box.w, box.h, box.style.radius);

    const tint = highlightVar(box.highlight);
    highlight.style.display = tint ? '' : 'none';
    if (tint) {
      const textHeight = box.lines.length * box.lineHeight;
      setRect(highlight, box.style.padX - 5, (box.h - textHeight) / 2 - 1, box.textWidth + 10, textHeight + 2, 4);
      highlight.style.fill = `var(${tint})`;
    }

    renderText(text, box);

    // Children grow away from the root, so the child handle follows the side.
    const childX = box.side === -1 ? -HANDLE_GAP : box.w + HANDLE_GAP;
    childHandle.setAttribute('transform', `translate(${childX}, ${box.h / 2})`);
    siblingHandle.setAttribute('transform', `translate(${box.w / 2}, ${box.h + HANDLE_GAP})`);
    childHandle.style.setProperty('--handle-color', box.isRoot ? 'var(--accent)' : box.color);
    siblingHandle.style.setProperty('--handle-color', box.isRoot ? 'var(--accent)' : box.color);
    // The root has no siblings to add.
    siblingHandle.style.display = box.isRoot ? 'none' : '';

    const showBadge = box.node.children.length > 0;
    badge.style.display = showBadge ? '' : 'none';
    if (showBadge) {
      // Outboard of the child dot, so the two read in order from the node:
      // first the dot that adds a child, then the button that closes the branch.
      const badgeX = box.side === -1 ? -BADGE_GAP : box.w + BADGE_GAP;
      badge.setAttribute('transform', `translate(${badgeX}, ${box.h / 2})`);
      badge.style.setProperty('--badge-color', box.color);
      badgeText.textContent = box.collapsed ? String(box.hiddenCount) : '−';
      badgeText.setAttribute('y', box.collapsed ? 3.5 : 4);
    }
    return entry;
  }

  /**
   * Puts the handles and the close-branch button around a box. `rect` is the
   * live size while a node is being typed into, which is wider than the box
   * the layout last measured -- without it the child dot ends up underneath
   * the editor and cannot be seen or reached.
   */
  function placeControls(entry, box, rect = null) {
    const dx = rect ? rect.x - box.x : 0;
    const dy = rect ? rect.y - box.y : 0;
    const w = rect ? rect.w : box.w;
    const h = rect ? rect.h : box.h;
    const outward = (gap) => (box.side === -1 ? dx - gap : dx + w + gap);

    entry.childHandle.setAttribute('transform', `translate(${outward(HANDLE_GAP)}, ${dy + h / 2})`);
    entry.siblingHandle.setAttribute('transform', `translate(${dx + w / 2}, ${dy + h + HANDLE_GAP})`);
    entry.badge.setAttribute('transform', `translate(${outward(BADGE_GAP)}, ${dy + h / 2})`);
  }

  function renderText(text, box) {
    const { style } = box;
    const key = [
      box.lines.join('\u0000'), box.w, box.h, style.fontSize, style.fontWeight, style.italic,
      box.segments ? 'talk' : 'plain', box.meta ?? '',
    ].join('|');
    if (text.dataset.key === key) return;
    text.dataset.key = key;
    text.style.fontSize = `${style.fontSize}px`;
    text.style.fontWeight = String(style.fontWeight);
    text.style.fontStyle = style.italic ? 'italic' : 'normal';
    text.textContent = '';
    const top = (box.h - box.lines.length * box.lineHeight) / 2;
    box.lines.forEach((line, index) => {
      const y = Math.round(top + index * box.lineHeight + box.lineHeight * 0.76);
      const runs = box.segments?.[index] ?? [{ text: line, reference: null }];
      runs.forEach((run, runIndex) => {
        // Only the first run on a line is positioned; the rest flow after it.
        const tspan = runIndex === 0 ? svgEl('tspan', { x: style.padX, y }) : svgEl('tspan', {});
        if (run.reference) {
          tspan.setAttribute('class', 'scripture');
          tspan.dataset.reference = run.reference.canonical;
        }
        tspan.textContent = run.text;
        text.append(tspan);
      });

      // The time and note marker trail the last line, inside the box.
      if (box.meta && index === box.lines.length - 1) {
        const metaSpan = svgEl('tspan', { class: 'node-meta' });
        metaSpan.textContent = `  ${box.meta}`;
        text.append(metaSpan);
      }
    });
  }

  function renderEdge(edge, state) {
    let entry = edgeEls.get(edge.id);
    if (!entry) {
      const group = svgEl('g', { class: 'edge-group', 'data-id': edge.id });
      const hit = svgEl('path', { class: 'edge-hit', fill: 'none' });
      const path = svgEl('path', { class: 'edge', fill: 'none' });
      group.append(path, hit);
      edgeLayer.append(group);
      entry = { group, path, hit };
      edgeEls.set(edge.id, entry);
    }
    entry.path.setAttribute('d', edge.path);
    entry.hit.setAttribute('d', edge.path);
    entry.path.style.stroke = edge.color;
    entry.path.style.strokeWidth = edge.width;
    entry.group.classList.toggle('is-labelling', state.labellingEdgeId === edge.id);
    return entry;
  }

  function renderLabel(edge, state) {
    if (!edge.label) return null;
    let entry = labelEls.get(edge.id);
    if (!entry) {
      const group = svgEl('g', { class: 'edge-label', 'data-id': edge.id });
      const bg = svgEl('rect', { class: 'edge-label-bg' });
      const text = svgEl('text', { class: 'edge-label-text' });
      group.append(bg, text);
      labelLayer.append(group);
      entry = { group, bg, text };
      labelEls.set(edge.id, entry);
    }
    const { group, bg, text } = entry;
    group.setAttribute('transform', `translate(${edge.label.x}, ${edge.label.y})`);
    group.classList.toggle('is-editing', state.editingLabelId === edge.id);
    setRect(bg, -edge.label.w / 2, -edge.label.h / 2, edge.label.w, edge.label.h, 5);
    // Inline, so it travels with the element into an exported SVG.
    text.style.fill = edge.label.color;
    const runs = edge.label.segments ?? [{ text: edge.label.text, reference: null }];
    const key = runs.map((run) => `${run.reference ? '@' : ''}${run.text}`).join('\u0000');
    if (text.dataset.key !== key) {
      text.dataset.key = key;
      text.textContent = '';
      for (const run of runs) {
        // A reference keeps the reference colour from the stylesheet; the rest
        // of the label stays the colour of its line.
        const tspan = svgEl('tspan', {});
        if (run.reference) {
          tspan.setAttribute('class', 'scripture');
          tspan.dataset.reference = run.reference.canonical;
        }
        tspan.textContent = run.text;
        text.append(tspan);
      }
    }
    text.setAttribute('y', 4);
    return entry;
  }

  function render(layout, state = {}) {
    lastLayout = layout;
    const seen = { nodes: new Set(), edges: new Set(), labels: new Set() };
    for (const box of layout.nodes) {
      renderNode(box, state);
      seen.nodes.add(box.id);
    }
    for (const edge of layout.edges) {
      renderEdge(edge, state);
      seen.edges.add(edge.id);
      if (edge.label) {
        renderLabel(edge, state);
        seen.labels.add(edge.id);
      }
    }
    prune(nodeEls, seen.nodes, (entry) => entry.group);
    prune(edgeEls, seen.edges, (entry) => entry.group);
    prune(labelEls, seen.labels, (entry) => entry.group);
  }

  function prune(store, seen, elementOf) {
    for (const [id, entry] of store) {
      if (!seen.has(id)) {
        elementOf(entry).remove();
        store.delete(id);
      }
    }
  }

  /**
   * @param {{kind:'child'|'before'|'after', box: object}|null} target
   */
  function setDropIndicator(target) {
    overlayLayer.textContent = '';
    if (!target) return;
    const { kind, box } = target;
    if (kind === 'child') {
      overlayLayer.append(
        svgEl('rect', {
          class: 'drop-indicator',
          x: box.x - 5,
          y: box.y - 4,
          width: box.w + 10,
          height: box.h + 8,
          rx: box.style.radius + 4,
        }),
      );
      return;
    }
    // A line where the node would be inserted among its new siblings.
    const y = kind === 'before' ? box.y - 5 : box.y + box.h + 5;
    overlayLayer.append(
      svgEl('line', { class: 'drop-line', x1: box.x - 4, y1: y, x2: box.x + box.w + 4, y2: y }),
      svgEl('circle', { class: 'drop-line-cap', cx: box.x - 4, cy: y, r: 3 }),
    );
  }

  /**
   * Follows the editor while a node is being typed into. Pass null when the
   * edit ends to put the controls back on the laid-out box.
   */
  function setEditingBox(id, rect) {
    const entry = nodeEls.get(id);
    const box = lastLayout?.byId.get(id);
    if (entry && box) placeControls(entry, box, rect);
  }

  return {
    svg,
    scene,
    render,
    setEditingBox,
    setDropIndicator,
    getLayout: () => lastLayout,
    getNodeElement: (id) => nodeEls.get(id)?.group ?? null,
  };
}

const HANDLE_GAP = 13;
// Far enough past the dot to clear it, and still inside the gap before the
// children begin, so it never lands on a child.
const BADGE_GAP = 34;

function handleEl(kind) {
  const group = svgEl('g', { class: `node-handle node-handle-${kind}`, 'data-handle': kind });
  group.append(
    svgEl('circle', { class: 'node-handle-hit', r: 13 }),
    svgEl('circle', { class: 'node-handle-dot', r: 4.5 }),
  );
  const label = kind === 'child' ? 'Add a child' : 'Add a sibling';
  const title = svgEl('title');
  title.textContent = label;
  group.append(title);
  return group;
}

function setRect(rect, x, y, width, height, radius) {
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', Math.max(0, width));
  rect.setAttribute('height', Math.max(0, height));
  rect.setAttribute('rx', radius);
}
