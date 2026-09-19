// SVG renderer. Nodes and edges are keyed by id and reused between renders so
// the browser can tween them -- relayouts glide instead of jumping.

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
  const overlayLayer = svgEl('g', { class: 'layer-overlay' });
  scene.append(edgeLayer, nodeLayer, overlayLayer);
  svg.append(scene);

  const nodeEls = new Map();
  const edgeEls = new Map();
  let lastLayout = null;

  function renderNode(box, state) {
    let entry = nodeEls.get(box.id);
    if (!entry) {
      const group = svgEl('g', { class: 'node', 'data-id': box.id });
      const ring = svgEl('rect', { class: 'node-ring' });
      const base = svgEl('rect', { class: 'node-base' });
      const tint = svgEl('rect', { class: 'node-tint' });
      const accent = svgEl('rect', { class: 'node-accent' });
      const text = svgEl('text', { class: 'node-text' });
      const badge = svgEl('g', { class: 'node-badge' });
      const badgeCircle = svgEl('circle', { class: 'node-badge-circle', r: 10 });
      const badgeText = svgEl('text', { class: 'node-badge-text' });
      badge.append(badgeCircle, badgeText);
      group.append(ring, base, tint, accent, text, badge);
      nodeLayer.append(group);
      entry = { group, ring, base, tint, accent, text, badge, badgeCircle, badgeText };
      nodeEls.set(box.id, entry);
      // New nodes pop in rather than sliding from the origin.
      group.classList.add('is-entering');
      requestAnimationFrame(() => group.classList.remove('is-entering'));
    }

    const { group, ring, base, tint, accent, text, badge, badgeText } = entry;
    group.setAttribute('transform', `translate(${box.x}, ${box.y})`);
    group.setAttribute('data-depth', Math.min(box.depth, 2));
    group.classList.toggle('is-root', Boolean(box.isRoot));
    group.classList.toggle('is-selected', state.selectedId === box.id);
    group.classList.toggle('is-editing', state.editingId === box.id);
    group.classList.toggle('is-drop-target', state.dropTargetId === box.id);
    group.classList.toggle('is-dragging', state.draggingId === box.id);
    group.classList.toggle('is-collapsed', box.collapsed);

    const radius = box.style.radius;
    setRect(ring, -4, -4, box.w + 8, box.h + 8, radius + 4);
    setRect(base, 0, 0, box.w, box.h, radius);
    setRect(tint, 0, 0, box.w, box.h, radius);
    const hasAccent = !box.isRoot && box.depth >= 2;
    accent.style.display = hasAccent ? '' : 'none';
    if (hasAccent) setRect(accent, box.side === -1 ? box.w - 4 : 0, 6, 4, box.h - 12, 2);

    if (!box.isRoot) {
      base.style.stroke = box.color;
      tint.style.fill = box.color;
      accent.style.fill = box.color;
    } else {
      base.style.stroke = '';
      tint.style.fill = '';
    }

    renderText(text, box);

    const showBadge = box.node.children.length > 0;
    badge.style.display = showBadge ? '' : 'none';
    if (showBadge) {
      const bx = box.side === -1 ? 0 : box.w;
      badge.setAttribute('transform', `translate(${bx}, ${box.h / 2})`);
      badge.style.setProperty('--badge-color', box.color);
      badgeText.textContent = box.collapsed ? String(box.hiddenCount) : '−';
      badgeText.setAttribute('y', box.collapsed ? 4 : 4.5);
    }
    return entry;
  }

  function renderText(text, box) {
    const key = `${box.lines.join('\u0000')}|${box.w}|${box.h}|${box.style.fontSize}`;
    if (text.dataset.key === key) return;
    text.dataset.key = key;
    text.style.fontSize = `${box.style.fontSize}px`;
    text.style.fontWeight = String(box.style.fontWeight);
    text.textContent = '';
    const top = (box.h - box.lines.length * box.lineHeight) / 2;
    const x = box.style.padX + (box.depth >= 2 && box.side === 1 ? 6 : 0);
    box.lines.forEach((line, index) => {
      const tspan = svgEl('tspan', {
        x,
        y: Math.round(top + index * box.lineHeight + box.lineHeight * 0.74),
      });
      tspan.textContent = line;
      text.append(tspan);
    });
  }

  function renderEdge(edge) {
    let path = edgeEls.get(edge.id);
    if (!path) {
      path = svgEl('path', { class: 'edge', 'data-id': edge.id, fill: 'none' });
      edgeLayer.append(path);
      edgeEls.set(edge.id, path);
    }
    path.setAttribute('d', edge.path);
    path.style.stroke = edge.color;
    path.style.strokeWidth = edge.width;
    return path;
  }

  function render(layout, state = {}) {
    lastLayout = layout;
    const seenNodes = new Set();
    const seenEdges = new Set();
    for (const box of layout.nodes) {
      renderNode(box, state);
      seenNodes.add(box.id);
    }
    for (const edge of layout.edges) {
      renderEdge(edge);
      seenEdges.add(edge.id);
    }
    for (const [id, entry] of nodeEls) {
      if (!seenNodes.has(id)) {
        entry.group.remove();
        nodeEls.delete(id);
      }
    }
    for (const [id, path] of edgeEls) {
      if (!seenEdges.has(id)) {
        path.remove();
        edgeEls.delete(id);
      }
    }
  }

  function setDropIndicator(box) {
    overlayLayer.textContent = '';
    if (!box) return;
    const marker = svgEl('rect', {
      class: 'drop-indicator',
      x: box.x - 6,
      y: box.y - 6,
      width: box.w + 12,
      height: box.h + 12,
      rx: box.style.radius + 6,
    });
    overlayLayer.append(marker);
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
