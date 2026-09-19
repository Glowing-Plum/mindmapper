// Application glue: wires the document model, layout, renderer, viewport and
// editor together, and owns the interaction state (selection, drag, editing).

import { MindMapDoc, walk } from './model.js';
import { parseOutline, toOutline } from './parser.js';
import { computeLayout } from './layout.js';
import { createRenderer } from './render.js';
import { createViewport } from './viewport.js';
import { createInlineEditor } from './editor.js';
import { BRANCH_COLORS } from './palette.js';
import { SAMPLES, DEFAULT_SAMPLE } from './samples.js';
import { clearState, loadState, saveState } from './storage.js';
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
  toast: el('toast'),
  zoomLevel: el('btn-zoom-reset'),
  sampleSelect: el('sample-select'),
  help: el('help-dialog'),
};

const state = {
  selectedId: null,
  editingId: null,
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
  onCommit: (id, text) => commitEdit(id, text),
  onCancel: (id) => cancelEdit(id),
  onInput: (kind, id) => {
    if (kind === 'tab' && id) addChild(id);
  },
});

// ------------------------------------------------------------------ render

function refresh({ syncOutline = true } = {}) {
  layout = computeLayout(doc.root, { mode: state.mode });
  state.editingId = editor?.editingId() ?? null;
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
  const x = anchor.x - wrapRect.left;
  const y = anchor.y - wrapRect.top - 10;
  const offscreen = x < 40 || x > wrapRect.width - 40 || y < 44 || y > wrapRect.height;
  ui.toolbar.hidden = offscreen;
  if (offscreen) return;
  ui.toolbar.style.left = `${x}px`;
  ui.toolbar.style.top = `${y}px`;
  const node = doc.get(state.selectedId);
  for (const swatch of ui.swatches.children) {
    swatch.setAttribute('aria-pressed', String(Number(swatch.dataset.index) === node?.colorIndex));
  }
  ui.toolbar.querySelector('[data-act="delete"]').disabled = state.selectedId === doc.root.id;
}

// ---------------------------------------------------------------- outline

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveState({ doc: doc.toJSON(), theme: state.theme, mode: state.mode });
  }, 400);
}

function writeOutline() {
  if (document.activeElement === ui.outline && state.outlineDirty) return;
  ui.outline.value = toOutline(doc.root);
  state.outlineDirty = false;
  ui.outlineStatus.textContent = '';
}

function generateFromOutline() {
  const root = parseOutline(ui.outline.value, { title: 'Mind map' });
  doc.replaceRoot(root);
  state.selectedId = root.id;
  state.outlineDirty = false;
  refresh();
  fitMap();
  const count = [...walk(root)].length;
  ui.outlineStatus.textContent = `${count} node${count === 1 ? '' : 's'}`;
  if (window.innerWidth < NARROW) setSidebar(false);
  showToast(`Map generated — ${count} node${count === 1 ? '' : 's'}`);
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
    const reopened = layout.byId.get(box.id);
    return reopened?.children[0] ?? null;
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

function startEdit(id, { selectAll = true, isNew = false } = {}) {
  const box = layout?.byId.get(id);
  if (!box) return;
  if (isNew) state.newNodeId = id;
  state.editingId = id;
  renderer.render(layout, state);
  editor.open(box, viewport, { selectAll });
  ui.toolbar.hidden = true;
  viewport.ensureVisible(box, 90);
}

function commitEdit(id, text) {
  const isNew = state.newNodeId === id;
  state.newNodeId = null;
  state.editingId = null;
  if (!text && isNew) {
    const next = doc.remove(id);
    state.selectedId = next?.id ?? doc.root.id;
    refresh();
    return;
  }
  doc.setText(id, text || doc.get(id)?.text || 'Untitled', { amend: isNew });
  refresh();
  ui.canvas.focus({ preventScroll: true });
}

function cancelEdit(id) {
  const isNew = state.newNodeId === id;
  state.newNodeId = null;
  state.editingId = null;
  if (isNew) {
    const next = doc.remove(id);
    state.selectedId = next?.id ?? doc.root.id;
  }
  refresh();
  ui.canvas.focus({ preventScroll: true });
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
  const next = doc.remove(state.selectedId);
  state.selectedId = next?.id ?? doc.root.id;
  refresh();
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
    if (
      point.x >= box.x && point.x <= box.x + box.w &&
      point.y >= box.y && point.y <= box.y + box.h
    ) {
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
    if (!doc.get(state.selectedId)) state.selectedId = doc.root.id;
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

function showToast(message, duration = 2200) {
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
  el('btn-new').addEventListener('click', () => {
    const root = parseOutline('Central idea\n  - First branch\n  - Second branch');
    doc.replaceRoot(root);
    state.selectedId = root.id;
    refresh();
    fitMap();
  });
  el('btn-undo').addEventListener('click', () => {
    doc.undo();
    if (!doc.get(state.selectedId)) state.selectedId = doc.root.id;
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

  el('btn-zoom-in').addEventListener('click', () => viewport.zoomAround(1.2));
  el('btn-zoom-out').addEventListener('click', () => viewport.zoomAround(1 / 1.2));
  el('btn-zoom-reset').addEventListener('click', () => viewport.setZoom(1));
  el('btn-fit').addEventListener('click', () => fitMap());

  el('btn-toggle-sidebar').addEventListener('click', () => setSidebar(false));
  el('btn-show-sidebar').addEventListener('click', () => setSidebar(true));

  const menu = el('export-menu');
  const list = menu.querySelector('.menu-list');
  el('btn-export').addEventListener('click', (event) => {
    event.stopPropagation();
    list.hidden = !list.hidden;
    el('btn-export').setAttribute('aria-expanded', String(!list.hidden));
  });
  list.addEventListener('click', (event) => {
    const kind = event.target.dataset?.export;
    if (!kind) return;
    list.hidden = true;
    el('btn-export').setAttribute('aria-expanded', 'false');
    exportAs(kind);
  });
  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target)) {
      list.hidden = true;
      el('btn-export').setAttribute('aria-expanded', 'false');
    }
  });

  ui.toolbar.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'child') addChild();
    else if (act === 'sibling') addSibling();
    else if (act === 'delete') deleteSelected();
  });

  window.addEventListener('resize', () => {
    positionToolbar();
    editor.reposition();
  });

  window.addEventListener('beforeunload', () => {
    saveState({ doc: doc.toJSON(), theme: state.theme, mode: state.mode });
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
  if (!saved) showToast('Press ? for shortcuts');
}

boot();

// Exposed for debugging from the console.
window.mindmapper = { doc, get layout() { return layout; }, viewport, refresh, clearState };
