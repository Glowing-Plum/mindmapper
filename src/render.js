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
      group.append(card, hit, highlight, text, badge);
      nodeLayer.append(group);
      entry = { group, hit, card, highlight, text, badge, badgeText };
      nodeEls.set(box.id, entry);
      group.classList.add('is-entering');
      requestAnimationFrame(() => group.classList.remove('is-entering'));
    }

    const { group, hit, card, highlight, text, badge, badgeText } = entry;
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

    const showBadge = box.node.children.length > 0;
    badge.style.display = showBadge ? '' : 'none';
    if (showBadge) {
      badge.setAttribute('transform', `translate(${box.side === -1 ? 2 : box.w - 2}, ${box.h / 2})`);
      badge.style.setProperty('--badge-color', box.color);
      badgeText.textContent = box.collapsed ? String(box.hiddenCount) : '−';
      badgeText.setAttribute('y', box.collapsed ? 3.5 : 4);
    }
    return entry;
  }

  function renderText(text, box) {
    const { style } = box;
    const key = [box.lines.join('\u0000'), box.w, box.h, style.fontSize, style.fontWeight, style.italic].join('|');
    if (text.dataset.key === key) return;
    text.dataset.key = key;
    text.style.fontSize = `${style.fontSize}px`;
    text.style.fontWeight = String(style.fontWeight);
    text.style.fontStyle = style.italic ? 'italic' : 'normal';
    text.textContent = '';
    const top = (box.h - box.lines.length * box.lineHeight) / 2;
    box.lines.forEach((line, index) => {
      const tspan = svgEl('tspan', {
        x: style.padX,
        y: Math.round(top + index * box.lineHeight + box.lineHeight * 0.76),
      });
      tspan.textContent = line;
      text.append(tspan);
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
    if (text.dataset.key !== edge.label.text) {
      text.dataset.key = edge.label.text;
      text.textContent = edge.label.text;
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

  function setDropIndicator(box) {
    overlayLayer.textContent = '';
    if (!box) return;
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
  }

  return {
    svg,
    scene,
    render,
    setDropIndicator,
    getLayout: () => lastLayout,
    getNodeElement: (id) => nodeEls.get(id)?.group ?? null,
  };
}

function setRect(rect, x, y, width, height, radius) {
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', Math.max(0, width));
  rect.setAttribute('height', Math.max(0, height));
  rect.setAttribute('rx', radius);
}
