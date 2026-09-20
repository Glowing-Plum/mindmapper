// Application glue: wires the document model, layout, renderer, viewport and
// editor together, and owns the interaction state (selection, drag, editing).

import { MindMapDoc, carryFormatting, walk } from './model.js';
import { parseOutline, toOutline } from './parser.js';
import { computeLayout } from './layout.js';
import { createRenderer } from './render.js';
import { createViewport } from './viewport.js';
import { createInlineEditor } from './editor.js';
import { BRANCH_COLORS, HIGHLIGHTS } from './palette.js';
import { SAMPLES, DEFAULT_SAMPLE } from './samples.js';
import {
  clearState, clearVersions, getVersion, listVersions, loadState, pushVersion, relativeTime, saveState,
} from './storage.js';
import { copyText, download, markdownFor, slugify, toPngBlob, toSvgString } from './exporters.js';

const el = (id) => document.getElementById(id);

const ui = {
  canvas: el('canvas'),
  wrap: el('canvas-wrap'),
  outline: el('outline'),
  outlineStatus: el('outline-status'),
  sidebar: el('sidebar'),
  toolbar: el('node-toolbar'),
  swatches: el('swatches'),
  highlights: el('highlights'),
  toast: el('toast'),
  zoomLevel: el('btn-zoom-reset'),
  sampleSelect: el('sample-select'),
  help: el('help-dialog'),
  history: el('history-dialog'),
  versionList: el('version-list'),
  confirm: el('confirm-dialog'),
};

const state = {
  selectedId: null,
  editingId: null,
  editingLabelId: null,
  draggingId: null,
  dropTargetId: null,
  mode: 'both',
  theme: 'light',
  outlineDirty: false,
  newNodeId: null, // a node created by Tab/Enter, removed if left blank
};

const saved = loadState();
const doc = saved?.doc
  ? MindMapDoc.fromJSON(saved.doc)
  : new MindMapDoc(parseOutline(DEFAULT_SAMPLE.outline));
let layout = null;

const renderer = createRenderer(ui.canvas);
// Declared before the viewport: its first transform fires onChange immediately.
let editor = null;
const viewport = createViewport(ui.canvas, renderer.scene, {
  onChange: (vp) => {
    ui.zoomLevel.textContent = `${Math.round(vp.k * 100)}%`;
    positionToolbar();
    editor?.reposition();
  },
});
editor = createInlineEditor(ui.wrap, {
  onCommit: commitEdit,
  onCancel: cancelEdit,
  onChord: handleEditorChord,
});

// ------------------------------------------------------------------ render

function refresh({ syncOutline = true } = {}) {
  layout = computeLayout(doc.root, { mode: state.mode });
  const editing = editor?.editing();
  state.editingId = editing?.kind === 'node' ? editing.id : null;
  state.editingLabelId = editing?.kind === 'label' ? editing.edgeId : null;
  renderer.render(layout, state);
  renderer.setDropIndicator(state.dropTargetId ? layout.byId.get(state.dropTargetId) : null);
  positionToolbar();
  updateChrome();
  if (syncOutline) writeOutline();
  scheduleSave();
}

function updateChrome() {
  el('btn-undo').disabled = !doc.canUndo();
  el('btn-redo').disabled = !doc.canRedo();
  for (const button of document.querySelectorAll('.seg')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  }
}

function positionToolbar() {
  const box = state.selectedId ? layout?.byId.get(state.selectedId) : null;
  if (!box || state.draggingId || editor?.isOpen()) {
    ui.toolbar.hidden = true;
    return;
  }
  const wrapRect = ui.wrap.getBoundingClientRect();
  const anchor = viewport.toScreen(box.cx, box.y);
  const halfWidth = ui.toolbar.offsetWidth / 2 || 180;
  const x = clamp(anchor.x - wrapRect.left, halfWidth + 8, wrapRect.width - halfWidth - 8);
  const y = anchor.y - wrapRect.top - 12;
  ui.toolbar.hidden = y < 50 || y > wrapRect.height;
  if (ui.toolbar.hidden) return;
  ui.toolbar.style.left = `${x}px`;
  ui.toolbar.style.top = `${y}px`;
  syncToolbarState(doc.get(state.selectedId), box);
}

function syncToolbarState(node, box) {
  if (!node) return;
  ui.toolbar.querySelector('[data-act="bold"]').setAttribute('aria-pressed', String(Boolean(node.bold)));
  ui.toolbar.querySelector('[data-act="italic"]').setAttribute('aria-pressed', String(Boolean(node.italic)));
  for (const swatch of ui.highlights.children) {
    swatch.setAttribute('aria-pressed', String((swatch.dataset.highlight || null) === (node.highlight ?? null)));
  }
  for (const swatch of ui.swatches.children) {
    swatch.setAttribute('aria-pressed', String(Number(swatch.dataset.index) === node.colorIndex));
  }
  const labelButton = ui.toolbar.querySelector('[data-act="label"]');
  labelButton.disabled = box.isRoot;
  labelButton.textContent = node.edgeLabel ? 'Edit label' : 'Label line';
  ui.toolbar.querySelector('[data-act="delete"]').disabled = box.isRoot;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// ------------------------------------------------------- saving + history

let saveTimer = null;
let versionTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const ok = saveState({ doc: doc.toJSON(), theme: state.theme, mode: state.mode });
    if (!ok && !scheduleSave.warned) {
      scheduleSave.warned = true;
      showToast('This browser is blocking local storage — export to keep your work', 6000);
    }
  }, 400);

  // Versions settle a couple of seconds after you stop typing.
  clearTimeout(versionTimer);
  versionTimer = setTimeout(() => pushVersion(doc.toJSON()), 2500);
}

/** Pins the current state in history before something replaces it. */
function checkpoint(label) {
  pushVersion(doc.toJSON(), { label, force: true });
}

function renderVersions() {
  const versions = listVersions();
  const current = JSON.stringify(doc.toJSON());
  ui.versionList.textContent = '';
  for (const version of versions) {
    const row = document.createElement('li');
    row.className = 'version-row';
    const isCurrent = version.data === current;
    if (isCurrent) row.classList.add('is-current');

    const main = document.createElement('div');
    main.className = 'version-main';
    const title = document.createElement('div');
    title.className = 'version-title';
    title.textContent = version.label || rootNameOf(version) || 'Edit';
    const meta = document.createElement('div');
    meta.className = 'version-meta';
    meta.textContent = `${relativeTime(version.at)} · ${version.nodes} node${version.nodes === 1 ? '' : 's'}${isCurrent ? ' · current' : ''}`;
    main.append(title, meta);

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'btn small';
    restore.textContent = isCurrent ? 'Current' : 'Restore';
    restore.disabled = isCurrent;
    restore.addEventListener('click', () => restoreVersion(version.id));

    row.append(main, restore);
    ui.versionList.append(row);
  }
}

function rootNameOf(version) {
  try {
    return JSON.parse(version.data)?.root?.text ?? '';
  } catch {
    return '';
  }
}

function restoreVersion(id) {
  const data = getVersion(id);
  if (!data) {
    showToast('That version could not be read');
    return;
  }
  checkpoint('Before restore');
  const restored = MindMapDoc.fromJSON(data);
  doc.replaceRoot(restored.root);
  state.selectedId = null;
  refresh();
  fitMap();
  ui.history.close();
  showToast('Version restored — Ctrl+Z undoes this');
}

function confirmAction({ title, body, confirmLabel = 'Continue' }) {
  return new Promise((resolve) => {
    el('confirm-title').textContent = title;
    el('confirm-body').textContent = body;
    el('confirm-ok').textContent = confirmLabel;
    ui.confirm.addEventListener('close', () => resolve(ui.confirm.returnValue === 'confirm'), { once: true });
    ui.confirm.showModal();
  });
}

// ---------------------------------------------------------------- outline

function writeOutline() {
  if (document.activeElement === ui.outline && state.outlineDirty) return;
  ui.outline.value = toOutline(doc.root);
  state.outlineDirty = false;
  ui.outlineStatus.textContent = '';
}

async function generateFromOutline() {
  const source = ui.outline.value;
  const existing = [...walk(doc.root)].length;
  if (!source.trim() && existing > 1) {
    const ok = await confirmAction({
      title: 'Clear the whole map?',
      body: `The outline is empty, so generating would remove all ${existing} nodes. A version is kept in History either way.`,
      confirmLabel: 'Clear it',
    });
    if (!ok) return;
  }

  checkpoint('Before generate');
  // The outline carries text only, so formatting is re-applied by matching
  // nodes on their path: regenerating never silently drops your styling.
  const root = carryFormatting(doc.root, parseOutline(source, { title: 'Mind map' }));
  doc.replaceRoot(root);
  state.selectedId = null;
  state.outlineDirty = false;
  refresh();
  fitMap();
  const count = [...walk(root)].length;
  ui.outlineStatus.textContent = `${count} node${count === 1 ? '' : 's'}`;
  if (window.innerWidth < NARROW) setSidebar(false);
  showToast(`Map generated — ${count} node${count === 1 ? '' : 's'}. Ctrl+Z undoes this.`);
}

// -------------------------------------------------------------- selection

function select(id, { reveal = false } = {}) {
  state.selectedId = id;
  if (reveal && id) {
    doc.revealPathTo(id);
    refresh();
    const box = layout.byId.get(id);
    if (box) viewport.ensureVisible(box);
  } else {
    refresh({ syncOutline: false });
  }
  ui.canvas.focus({ preventScroll: true });
}

/**
 * Arrow-key navigation. Left/right follow the branch (out to a child, back to
 * the parent, mirrored on the left-hand side); up/down move to the nearest
 * node above or below, which walks siblings without getting stuck on them.
 */
function navigate(direction) {
  if (!layout || !state.selectedId) return;
  const from = layout.byId.get(state.selectedId);
  if (!from) return;

  if (direction === 'left' || direction === 'right') {
    const target = from.isRoot
      ? nearestChildOnSide(from, direction === 'right' ? 1 : -1)
      : direction === (from.side === -1 ? 'left' : 'right')
        ? enterChildren(from)
        : from.parent;
    if (target) select(target.id, { reveal: true });
    return;
  }

  let best = null;
  let bestScore = Infinity;
  for (const box of layout.nodes) {
    if (box.id === from.id) continue;
    const gap = direction === 'down' ? box.y - (from.y + from.h) : from.y - (box.y + box.h);
    if (gap < -2) continue; // overlapping vertically: not above or below us
    const score = gap + Math.abs(box.cx - from.cx) * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = box;
    }
  }
  if (best) select(best.id, { reveal: true });
}

/** Steps into a node's children, expanding it first if it is collapsed. */
function enterChildren(box) {
  const node = box.node;
  if (node.children.length === 0) return null;
  if (node.collapsed) {
    doc.toggleCollapse(node.id);
    refresh();
    return layout.byId.get(box.id)?.children[0] ?? null;
  }
  return nearest(box.children, box.cy);
}

function nearestChildOnSide(rootBox, side) {
  return nearest(rootBox.children.filter((child) => child.side === side), rootBox.cy);
}

function nearest(boxes, y) {
  let best = null;
  for (const box of boxes) {
    if (!best || Math.abs(box.cy - y) < Math.abs(best.cy - y)) best = box;
  }
  return best;
}

// --------------------------------------------------------------- editing

/** The world-space box for editing a node's text. */
function nodeTarget(box) {
  const textHeight = box.lines.length * box.lineHeight;
  return {
    kind: 'node',
    id: box.id,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fontSize: box.style.fontSize,
    fontWeight: box.style.fontWeight,
    italic: Boolean(box.style.italic),
    lineHeight: box.lineHeight,
    padX: box.style.padX,
    padY: (box.h - textHeight) / 2,
    radius: box.style.radius,
    align: box.isRoot ? 'center' : 'left',
    text: box.node.text,
  };
}

/** The world-space box for editing a label on a connector. */
function labelTarget(edge) {
  const w = Math.max(130, (edge.label?.w ?? 0) + 40);
  const h = 26;
  return {
    kind: 'label',
    id: edge.to.id,
    edgeId: edge.id,
    x: edge.labelAnchor.x - w / 2,
    y: edge.labelAnchor.y - h / 2,
    w,
    h,
    fontSize: 12,
    fontWeight: 500,
    italic: false,
    lineHeight: 16,
    padX: 8,
    padY: 5,
    radius: 5,
    align: 'center',
    text: edge.to.node.edgeLabel ?? '',
  };
}

function startEdit(id, { selectAll = true, isNew = false } = {}) {
  const box = layout?.byId.get(id);
  if (!box) return;
  if (isNew) state.newNodeId = id;
  state.editingId = id;
  renderer.render(layout, state);
  editor.open(nodeTarget(box), viewport, { selectAll });
  ui.toolbar.hidden = true;
  viewport.ensureVisible(box, 90);
}

function startLabelEdit(nodeId = state.selectedId) {
  const edge = layout?.edges.find((candidate) => candidate.to.id === nodeId);
  if (!edge) {
    showToast('The root has no incoming line to label');
    return;
  }
  state.editingLabelId = edge.id;
  renderer.render(layout, state);
  editor.open(labelTarget(edge), viewport, { selectAll: true });
  ui.toolbar.hidden = true;
}

function commitEdit(target, value) {
  if (target.kind === 'label') {
    state.editingLabelId = null;
    doc.setEdgeLabel(target.id, value);
    refresh();
    ui.canvas.focus({ preventScroll: true });
    return;
  }
  const isNew = state.newNodeId === target.id;
  state.newNodeId = null;
  state.editingId = null;
  if (!value && isNew) {
    const next = doc.remove(target.id);
    state.selectedId = next?.id ?? doc.root.id;
    refresh();
    return;
  }
  doc.setText(target.id, value || doc.get(target.id)?.text || 'Untitled', { amend: isNew });
  refresh();
  ui.canvas.focus({ preventScroll: true });
}

function cancelEdit(target) {
  if (target.kind === 'label') {
    state.editingLabelId = null;
    refresh({ syncOutline: false });
    return;
  }
  const isNew = state.newNodeId === target.id;
  state.newNodeId = null;
  state.editingId = null;
  if (isNew) {
    const next = doc.remove(target.id);
    state.selectedId = next?.id ?? doc.root.id;
  }
  refresh();
  ui.canvas.focus({ preventScroll: true });
}

/** Formatting shortcuts and Tab pressed while the editor has focus. */
function handleEditorChord(key, target) {
  if (!target) return;
  if (key === 'tab') {
    addChild(target.id);
    return;
  }
  if (target.kind !== 'node') return;
  if (key === 'b') doc.toggleFormat(target.id, 'bold');
  else if (key === 'i') doc.toggleFormat(target.id, 'italic');
  else if (key === 'h') cycleHighlight(target.id);
  refresh({ syncOutline: false });
}

function addChild(parentId = state.selectedId) {
  if (!parentId) return;
  const node = doc.addChild(parentId, '');
  if (!node) return;
  state.selectedId = node.id;
  refresh();
  startEdit(node.id, { isNew: true });
}

function addSibling(id = state.selectedId) {
  if (!id) return;
  const node = doc.addSibling(id, '');
  if (!node) return;
  state.selectedId = node.id;
  refresh();
  startEdit(node.id, { isNew: true });
}

function deleteSelected() {
  if (!state.selectedId || state.selectedId === doc.root.id) return;
  const node = doc.get(state.selectedId);
  const size = node ? 1 + [...walk(node)].length - 1 : 1;
  const next = doc.remove(state.selectedId);
  state.selectedId = next?.id ?? doc.root.id;
  refresh();
  if (size > 3) showToast(`Deleted ${size} nodes — Ctrl+Z undoes this`);
}

function cycleHighlight(id = state.selectedId) {
  const node = doc.get(id);
  if (!node) return;
  const order = [null, ...HIGHLIGHTS.map((entry) => entry.id)];
  const next = order[(order.indexOf(node.highlight ?? null) + 1) % order.length];
  doc.setHighlight(id, next);
}

// ------------------------------------------------------------ interaction

function nodeIdFromEvent(event) {
  return event.target.closest('.node')?.dataset.id ?? null;
}

ui.canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const id = nodeIdFromEvent(event);
  if (!id) {
    if (!editor.isOpen()) {
      state.selectedId = null;
      refresh({ syncOutline: false });
    }
    return;
  }
  if (event.target.closest('.node-badge')) {
    doc.toggleCollapse(id);
    state.selectedId = id;
    refresh();
    return;
  }
  if (state.selectedId !== id) {
    state.selectedId = id;
    refresh({ syncOutline: false });
  }
  beginDrag(event, id);
});

ui.canvas.addEventListener('dblclick', (event) => {
  const edgeId = event.target.closest('.edge-group, .edge-label')?.dataset.id;
  if (edgeId) {
    const edge = layout.edges.find((candidate) => candidate.id === edgeId);
    if (edge) startLabelEdit(edge.to.id);
    return;
  }
  const id = nodeIdFromEvent(event);
  if (id) startEdit(id);
});

function beginDrag(event, id) {
  if (id === doc.root.id) return; // the root anchors the map
  const origin = { x: event.clientX, y: event.clientY };
  let active = false;

  const move = (moveEvent) => {
    if (!active && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 5) return;
    if (!active) {
      active = true;
      state.draggingId = id;
      ui.toolbar.hidden = true;
    }
    const target = hitTest(moveEvent.clientX, moveEvent.clientY, id);
    state.dropTargetId = target?.id ?? null;
    renderer.render(layout, state);
    renderer.setDropIndicator(target ?? null);
  };

  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const targetId = state.dropTargetId;
    state.draggingId = null;
    state.dropTargetId = null;
    if (active && targetId && targetId !== id) {
      const moved = doc.move(id, targetId);
      if (!moved) showToast('A node cannot be moved inside itself');
    }
    renderer.setDropIndicator(null);
    refresh();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Node under the cursor, skipping the dragged node's own subtree. */
function hitTest(clientX, clientY, excludeSubtreeOf) {
  const point = viewport.toWorld(clientX, clientY);
  for (const box of layout.nodes) {
    if (excludeSubtreeOf && doc.contains(excludeSubtreeOf, box.id)) continue;
    if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
      return box;
    }
  }
  return null;
}

// --------------------------------------------------------------- keyboard

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement;
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) doc.redo();
    else doc.undo();
    if (!doc.get(state.selectedId)) state.selectedId = null;
    refresh();
    return;
  }
  if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    doc.redo();
    refresh();
    return;
  }
  if (typing || editor.isOpen()) return;

  // Formatting works on the selected node without opening the editor.
  if (mod && state.selectedId && ['b', 'i', 'h', 'l'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    const key = event.key.toLowerCase();
    if (key === 'b') doc.toggleFormat(state.selectedId, 'bold');
    else if (key === 'i') doc.toggleFormat(state.selectedId, 'italic');
    else if (key === 'h') cycleHighlight();
    else if (key === 'l') {
      startLabelEdit();
      return;
    }
    refresh({ syncOutline: false });
    return;
  }

  if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
    event.preventDefault();
    ui.help.showModal();
    return;
  }
  if (event.key.toLowerCase() === 'f' && event.shiftKey) {
    event.preventDefault();
    fitMap();
    return;
  }

  // Canvas shortcuts only apply when the canvas has focus (or nothing does):
  // Tab and the printable keys must still reach the toolbar and the panel.
  const onCanvas = target === document.body || ui.canvas.contains(target);
  if (!onCanvas) return;

  if (!state.selectedId && ['Tab', 'Enter', ' ', 'Delete', 'Backspace', 'F2'].includes(event.key)) {
    state.selectedId = doc.root.id;
  }

  switch (event.key) {
    case 'Tab':
      event.preventDefault();
      addChild();
      break;
    case 'Enter':
      event.preventDefault();
      addSibling();
      break;
    case 'F2':
      event.preventDefault();
      if (state.selectedId) startEdit(state.selectedId);
      break;
    case 'Delete':
    case 'Backspace':
      event.preventDefault();
      deleteSelected();
      break;
    case ' ':
      event.preventDefault();
      if (state.selectedId) {
        doc.toggleCollapse(state.selectedId);
        refresh();
      }
      break;
    case 'Escape':
      state.selectedId = null;
      refresh({ syncOutline: false });
      break;
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight': {
      event.preventDefault();
      const direction = event.key.replace('Arrow', '').toLowerCase();
      if (event.altKey) restructure(direction);
      else navigate(direction);
      break;
    }
    default:
      // A printable key starts editing the selected node, like a spreadsheet.
      if (!mod && !event.altKey && event.key.length === 1 && state.selectedId) {
        startEdit(state.selectedId);
        editor.element.value = event.key;
        event.preventDefault();
      }
  }
});

function restructure(direction) {
  if (!state.selectedId) return;
  const box = layout.byId.get(state.selectedId);
  const towardParent = box?.side === -1 ? 'right' : 'left';
  if (direction === 'up') doc.reorder(state.selectedId, -1);
  else if (direction === 'down') doc.reorder(state.selectedId, 1);
  else if (direction === towardParent) doc.outdent(state.selectedId);
  else doc.indent(state.selectedId);
  refresh();
}

// ------------------------------------------------------------------ chrome

const NARROW = 760; // below this the outline panel floats over the canvas

/** Fits the whole map, but never so small that the labels stop being legible. */
function fitMap({ animate = true } = {}) {
  if (!layout) return;
  viewport.fit(layout.bounds, {
    animate,
    minZoom: window.innerWidth < NARROW ? 0.5 : 0.35,
    focus: layout.root,
  });
}

function setSidebar(visible, { refit = true } = {}) {
  ui.sidebar.hidden = !visible;
  el('btn-show-sidebar').hidden = visible;
  if (refit && layout) requestAnimationFrame(() => fitMap());
}

function showToast(message, duration = 2600) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    ui.toast.hidden = true;
  }, duration);
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  scheduleSave();
}

function setMode(mode) {
  state.mode = mode;
  refresh({ syncOutline: false });
  fitMap();
}

async function exportAs(kind) {
  const name = slugify(doc.root.text);
  try {
    if (kind === 'md') {
      download(`${name}.md`, markdownFor(doc.root), 'text/markdown');
    } else if (kind === 'json') {
      download(`${name}.json`, JSON.stringify(doc.toJSON(), null, 2), 'application/json');
    } else if (kind === 'copy') {
      const ok = await copyText(markdownFor(doc.root));
      showToast(ok ? 'Outline copied to clipboard' : 'Could not reach the clipboard');
      return;
    } else {
      const bounds = layout.bounds;
      const svgString = toSvgString(renderer, bounds);
      if (kind === 'svg') {
        download(`${name}.svg`, svgString, 'image/svg+xml');
      } else {
        const blob = await toPngBlob(svgString, bounds, 2);
        download(`${name}.png`, blob, 'image/png');
      }
    }
    showToast(`Exported ${kind.toUpperCase()}`);
  } catch (error) {
    console.error(error);
    showToast('Export failed — see the console for details');
  }
}

function buildSwatches() {
  BRANCH_COLORS.forEach((color, index) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.dataset.index = String(index);
    swatch.style.background = color.stroke;
    swatch.title = `${color.name} branch (click again to inherit)`;
    swatch.setAttribute('aria-label', `${color.name} branch colour`);
    swatch.addEventListener('click', () => {
      if (!state.selectedId) return;
      const node = doc.get(state.selectedId);
      doc.setColor(state.selectedId, node?.colorIndex === index ? null : index);
      refresh({ syncOutline: false });
    });
    ui.swatches.append(swatch);
  });

  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'swatch is-none';
  none.title = 'No highlight';
  none.setAttribute('aria-label', 'Remove highlight');
  none.addEventListener('click', () => applyHighlight(null));
  ui.highlights.append(none);

  for (const entry of HIGHLIGHTS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.dataset.highlight = entry.id;
    swatch.style.background = `var(${entry.var})`;
    swatch.title = `${entry.name} highlight`;
    swatch.setAttribute('aria-label', `${entry.name} highlight`);
    swatch.addEventListener('click', () => applyHighlight(entry.id));
    ui.highlights.append(swatch);
  }
}

function applyHighlight(id) {
  if (!state.selectedId) return;
  const node = doc.get(state.selectedId);
  doc.setHighlight(state.selectedId, node?.highlight === id ? null : id);
  refresh({ syncOutline: false });
}

function buildSampleSelect() {
  for (const sample of SAMPLES) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sample.name;
    ui.sampleSelect.append(option);
  }
  ui.sampleSelect.value = DEFAULT_SAMPLE.id;
  ui.sampleSelect.addEventListener('change', () => {
    const sample = SAMPLES.find((entry) => entry.id === ui.sampleSelect.value);
    if (!sample) return;
    ui.outline.value = sample.outline;
    generateFromOutline();
  });
}

function bindChrome() {
  el('btn-new').addEventListener('click', async () => {
    const existing = [...walk(doc.root)].length;
    if (existing > 1) {
      const ok = await confirmAction({
        title: 'Start a new map?',
        body: `This replaces the current map (${existing} nodes). A version is kept in History, and Ctrl+Z undoes it.`,
        confirmLabel: 'New map',
      });
      if (!ok) return;
    }
    checkpoint('Before new map');
    doc.replaceRoot(parseOutline('Central idea\n  - First branch\n  - Second branch'));
    state.selectedId = null;
    refresh();
    fitMap();
  });
  el('btn-undo').addEventListener('click', () => {
    doc.undo();
    if (!doc.get(state.selectedId)) state.selectedId = null;
    refresh();
  });
  el('btn-redo').addEventListener('click', () => {
    doc.redo();
    refresh();
  });
  el('btn-collapse').addEventListener('click', () => {
    doc.setCollapsedAll(true, 1);
    refresh();
    fitMap();
  });
  el('btn-expand').addEventListener('click', () => {
    doc.setCollapsedAll(false);
    refresh();
    fitMap();
  });
  for (const button of document.querySelectorAll('.seg')) {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  }
  el('btn-generate').addEventListener('click', generateFromOutline);
  ui.outline.addEventListener('input', () => {
    state.outlineDirty = true;
    ui.outlineStatus.textContent = 'Unapplied changes';
  });
  ui.outline.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') generateFromOutline();
  });

  el('btn-theme').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
  el('btn-help').addEventListener('click', () => ui.help.showModal());
  el('btn-history').addEventListener('click', () => {
    pushVersion(doc.toJSON()); // make sure the live state is represented
    renderVersions();
    ui.history.showModal();
  });
  el('btn-clear-history').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'Clear version history?',
      body: 'Saved versions are removed from this browser. The map you are working on is not affected.',
      confirmLabel: 'Clear history',
    });
    if (!ok) return;
    clearVersions();
    renderVersions();
  });

  el('btn-zoom-in').addEventListener('click', () => viewport.zoomAround(1.2));
  el('btn-zoom-out').addEventListener('click', () => viewport.zoomAround(1 / 1.2));
  el('btn-zoom-reset').addEventListener('click', () => viewport.setZoom(1));
  el('btn-fit').addEventListener('click', () => fitMap());

  el('btn-toggle-sidebar').addEventListener('click', () => setSidebar(false));
  el('btn-show-sidebar').addEventListener('click', () => setSidebar(true));

  const menu = el('export-menu');
  const list = menu.querySelector('.menu-list');
  const closeMenu = () => {
    list.hidden = true;
    el('btn-export').setAttribute('aria-expanded', 'false');
  };
  el('btn-export').addEventListener('click', (event) => {
    event.stopPropagation();
    list.hidden = !list.hidden;
    el('btn-export').setAttribute('aria-expanded', String(!list.hidden));
  });
  list.addEventListener('click', (event) => {
    const kind = event.target.dataset?.export;
    if (!kind) return;
    closeMenu();
    exportAs(kind);
  });
  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target)) closeMenu();
  });

  ui.toolbar.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (!act || !state.selectedId) return;
    if (act === 'child') addChild();
    else if (act === 'sibling') addSibling();
    else if (act === 'delete') deleteSelected();
    else if (act === 'label') startLabelEdit();
    else if (act === 'bold' || act === 'italic') {
      doc.toggleFormat(state.selectedId, act);
      refresh({ syncOutline: false });
    }
  });

  window.addEventListener('resize', () => {
    positionToolbar();
    editor.reposition();
  });

  window.addEventListener('beforeunload', () => {
    saveState({ doc: doc.toJSON(), theme: state.theme, mode: state.mode });
    pushVersion(doc.toJSON());
  });
}

// ------------------------------------------------------------------- boot

function boot() {
  buildSwatches();
  buildSampleSelect();
  bindChrome();
  applyTheme(saved?.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  state.mode = saved?.mode === 'right' ? 'right' : 'both';
  setSidebar(window.innerWidth >= NARROW, { refit: false });
  ui.outline.value = toOutline(doc.root);
  refresh();
  fitMap({ animate: false });
  pushVersion(doc.toJSON(), { label: 'Opened', force: true });
  if (!saved) showToast('Press ? for shortcuts');
}

boot();

// Exposed for debugging from the console.
window.mindmapper = { doc, get layout() { return layout; }, viewport, refresh, clearState };
