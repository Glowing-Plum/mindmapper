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
import { LINK_TEMPLATES, collectReferences, findReferences, referenceUrl } from './scripture.js';
import { formatMinutes, rollup, rollupAll, summarise } from './timing.js';
import {
  ensureExtension, openFile, parseFileContents, readDroppedFile, saveFileAs, serialiseDoc,
  supportsFileHandles, writeToHandle,
} from './files.js';

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
  fileName: el('file-name'),
  help: el('help-dialog'),
  history: el('history-dialog'),
  versionList: el('version-list'),
  confirm: el('confirm-dialog'),
  talkTarget: el('talk-target'),
  talkTotal: el('talk-total'),
  talkBar: el('talk-bar-fill'),
  talkSelection: el('talk-selection'),
  talkMinutes: el('talk-minutes'),
  talkRollup: el('talk-rollup'),
  talkNote: el('talk-note'),
  talkRefs: el('talk-refs'),
  talkRefCount: el('talk-ref-count'),
  talkLink: el('talk-link'),
  talkLinkCustom: el('talk-link-custom'),
  printView: el('print-view'),
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
  // The file this map belongs to, when it came from -- or has been saved to --
  // one. `handle` is only ever set where the browser supports file handles.
  file: { handle: null, name: '', dirty: false },
  // Talk preparation: timings, scripture references and speaker notes.
  talkMode: false,
  talkTarget: 0,
  linkPreset: 'none',
  linkCustom: '',
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
  layout = computeLayout(doc.root, { mode: state.mode, talkMode: state.talkMode });
  const editing = editor?.editing();
  state.editingId = editing?.kind === 'node' ? editing.id : null;
  state.editingLabelId = editing?.kind === 'label' ? editing.edgeId : null;
  renderer.render(layout, state);
  renderer.setDropIndicator(state.dropTargetId ? layout.byId.get(state.dropTargetId) : null);
  positionToolbar();
  updateChrome();
  updateFileChrome();
  updateTalkPanel();
  if (syncOutline) writeOutline();
  scheduleSave();
}

function updateChrome() {
  el('btn-undo').disabled = !doc.canUndo();
  el('btn-redo').disabled = !doc.canRedo();
  for (const button of document.querySelectorAll('.seg')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  }
  el('btn-talk').setAttribute('aria-pressed', String(state.talkMode));
  document.body.classList.toggle('is-talk-mode', state.talkMode);
}

// -------------------------------------------------------------- talk mode

function setTalkMode(on) {
  state.talkMode = on;
  if (on) showPanel('talk');
  refresh({ syncOutline: false });
  scheduleSave();
}

function showPanel(which) {
  for (const [tab, panel] of [['tab-outline', 'panel-outline'], ['tab-talk', 'panel-talk']]) {
    const selected = tab === `tab-${which}`;
    el(tab).setAttribute('aria-selected', String(selected));
    el(panel).hidden = !selected;
  }
  if (ui.sidebar.hidden) setSidebar(true);
}

function linkTemplate() {
  if (state.linkPreset === 'custom') return state.linkCustom.trim() || null;
  return LINK_TEMPLATES.find((entry) => entry.id === state.linkPreset)?.template ?? null;
}

function updateTalkPanel() {
  if (el('panel-talk').hidden && !state.talkMode) return;

  const summary = summarise(doc.root, state.talkTarget);
  ui.talkTotal.textContent = summary.timed === 0
    ? 'No timings yet'
    : state.talkTarget > 0
      ? `${formatMinutes(summary.total)} of ${formatMinutes(state.talkTarget)}` +
        (summary.over > 0 ? ` — ${formatMinutes(summary.over)} over` : '')
      : formatMinutes(summary.total);
  ui.talkTotal.className = `talk-total is-${summary.status === 'untargeted' ? 'ok' : summary.status}`;

  const fraction = state.talkTarget > 0 ? Math.min(1.2, summary.total / state.talkTarget) : 0;
  ui.talkBar.style.width = `${Math.min(100, fraction * 100)}%`;
  ui.talkBar.className = `talk-bar-fill is-${summary.status === 'untargeted' ? 'ok' : summary.status}`;

  // The selected part.
  const node = state.selectedId ? doc.get(state.selectedId) : null;
  ui.talkSelection.textContent = node ? node.text || 'Untitled' : 'Select a node on the map.';
  ui.talkSelection.classList.toggle('is-empty', !node);
  ui.talkMinutes.disabled = !node;
  ui.talkNote.disabled = !node;
  if (document.activeElement !== ui.talkMinutes) ui.talkMinutes.value = node?.minutes ?? '';
  if (document.activeElement !== ui.talkNote) ui.talkNote.value = node?.note ?? '';
  if (node) {
    const parts = rollup(node);
    ui.talkRollup.textContent = node.children.length === 0
      ? ''
      : parts.own !== null
        ? `Its parts add up to ${formatMinutes(parts.children)}, but this section is set to ${formatMinutes(parts.own)}.`
        : `Adds up from its parts: ${formatMinutes(parts.children)}.`;
  } else {
    ui.talkRollup.textContent = '';
  }

  renderReferenceList();
}

function renderReferenceList() {
  const found = collectReferences(doc.root);
  ui.talkRefCount.textContent = found.length ? `(${found.length})` : '';
  ui.talkRefs.textContent = '';
  const seen = new Set();
  for (const { node, reference } of found) {
    const key = `${reference.canonical}|${node.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = document.createElement('li');
    row.className = 'ref-row';
    // Shown as you wrote it -- the canonical English form is only needed for
    // the link. Context is added only when the node says more than the
    // reference itself.
    const cite = document.createElement('span');
    cite.className = 'ref-cite';
    cite.textContent = reference.text;
    row.append(cite);
    const context = node.text.trim() === reference.text.trim() ? '' : node.text;
    if (context) {
      const where = document.createElement('span');
      where.className = 'ref-where';
      where.textContent = context;
      row.append(where);
    }
    row.title = linkTemplate() ? `Open ${reference.canonical}` : `Go to "${node.text}"`;
    row.addEventListener('click', () => {
      const url = referenceUrl(reference, linkTemplate());
      if (url) window.open(url, '_blank', 'noopener');
      else select(node.id, { reveal: true });
    });
    ui.talkRefs.append(row);
  }
}

/** Builds the printable outline and hands it to the browser's print dialog. */
function printOutline() {
  const timings = rollupAll(doc.root);
  const summary = summarise(doc.root, state.talkTarget);
  ui.printView.textContent = '';

  const title = document.createElement('h1');
  title.className = 'print-title';
  title.textContent = doc.root.text || 'Untitled talk';
  const meta = document.createElement('p');
  meta.className = 'print-meta';
  const bits = [];
  if (summary.timed > 0) {
    bits.push(state.talkTarget > 0
      ? `Planned ${formatMinutes(summary.total)} of ${formatMinutes(state.talkTarget)}`
      : `Planned ${formatMinutes(summary.total)}`);
  }
  const refCount = collectReferences(doc.root).length;
  if (refCount) bits.push(`${refCount} scripture${refCount === 1 ? '' : 's'}`);
  const printed = new Date().toLocaleDateString();
  bits.push(printed);
  meta.textContent = bits.join(' · ');
  ui.printView.append(title, meta);

  const write = (node, depth) => {
    for (const child of node.children) {
      const item = document.createElement('div');
      item.className = `print-item print-depth-${Math.min(depth, 3)}`;
      item.style.marginLeft = `${(depth - 1) * 16}pt`;

      const row = document.createElement('div');
      row.className = 'print-row';
      const text = document.createElement('div');
      text.className = 'print-text';
      // Scripture references are set in bold so they are findable at a glance.
      let cursor = 0;
      for (const reference of findReferences(child.text)) {
        if (reference.start > cursor) text.append(child.text.slice(cursor, reference.start));
        const strong = document.createElement('span');
        strong.className = 'print-scripture';
        strong.textContent = reference.text;
        text.append(strong);
        cursor = reference.end;
      }
      text.append(child.text.slice(cursor));

      row.append(text);
      const minutes = timings.get(child.id)?.total ?? 0;
      if (minutes > 0) {
        const time = document.createElement('div');
        time.className = 'print-time';
        time.textContent = formatMinutes(minutes);
        row.append(time);
      }
      item.append(row);

      if (child.note?.trim()) {
        const note = document.createElement('div');
        note.className = 'print-note';
        note.textContent = child.note.trim();
        item.append(note);
      }
      ui.printView.append(item);
      write(child, depth + 1);
    }
  };
  write(doc.root, 1);

  window.print();
}

function buildLinkOptions() {
  for (const entry of LINK_TEMPLATES) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    ui.talkLink.append(option);
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
  ui.toolbar.classList.remove('is-away'); // a fresh selection always shows it
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
    const ok = saveState({
      doc: doc.toJSON(),
      theme: state.theme,
      mode: state.mode,
      file: { name: state.file.name, dirty: state.file.dirty },
    });
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

// ------------------------------------------------------------------ files

function updateFileChrome() {
  const { name, dirty } = state.file;
  ui.fileName.textContent = name || 'Not saved to a file';
  ui.fileName.classList.toggle('is-file', Boolean(name));
  ui.fileName.classList.toggle('is-dirty', Boolean(name) && dirty);
  ui.fileName.title = name
    ? `${name}${dirty ? ' — unsaved changes' : ' — saved'}`
    : 'This map is autosaved in the browser only. Save it to a file to keep it.';
  // Be honest about what the button will do in this browser.
  const save = el('btn-save');
  if (state.file.handle) {
    save.textContent = 'Save';
    save.title = `Save to ${name} (Ctrl+S)`;
  } else if (supportsFileHandles()) {
    save.textContent = 'Save…';
    save.title = 'Choose where to save this map (Ctrl+S)';
  } else {
    save.textContent = 'Save a copy';
    save.title = 'This browser downloads a copy rather than saving back to a file (Ctrl+S)';
  }
  document.title = name
    ? `${dirty ? '• ' : ''}${name} — Mindmapper`
    : 'Mindmapper — outline to mind map';
}

function setFile({ handle = null, name = '', dirty = false }) {
  state.file = { handle, name, dirty };
  updateFileChrome();
}

function markDirty() {
  if (state.file.dirty) return;
  state.file.dirty = true;
  updateFileChrome();
}

/** Loads parsed file contents into the document. */
function adoptFile({ name, text, handle }) {
  const { kind, data } = parseFileContents(name, text);
  checkpoint(`Before opening ${name}`);
  const root = kind === 'json' ? MindMapDoc.fromJSON(data).root : data;
  doc.replaceRoot(root);
  state.selectedId = null;
  setFile({ handle, name, dirty: false });
  refresh();
  fitMap();
  const count = [...walk(root)].length;
  if (window.innerWidth < NARROW) setSidebar(false);
  showToast(`Opened ${name} — ${count} node${count === 1 ? '' : 's'}`);
}

async function openFromFile() {
  try {
    if (!(await confirmDiscardIfNeeded('Open another map?'))) return;
    const file = await openFile();
    if (!file) return; // cancelled
    adoptFile(file);
  } catch (error) {
    console.warn('Could not open that file:', error);
    showToast(error.message || 'That file could not be opened', 5000);
  }
}

/** Ctrl+S: write back to the open file, or ask where to put it the first time. */
async function saveToFile({ saveAs = false } = {}) {
  const text = serialiseDoc(doc.toJSON());
  try {
    if (!saveAs && state.file.handle) {
      await writeToHandle(state.file.handle, text);
      setFile({ ...state.file, dirty: false });
      showToast(`Saved ${state.file.name}`);
      return;
    }
    const suggested = ensureExtension(state.file.name || slugify(doc.root.text));
    const result = await saveFileAs(suggested, text, { download });
    if (!result) return; // cancelled
    setFile({ handle: result.handle, name: result.name, dirty: false });
    showToast(
      result.handle
        ? `Saved ${result.name}`
        : `Downloaded ${result.name} — this browser cannot save back to a file, so each save is a copy`,
      result.handle ? 2600 : 5200,
    );
  } catch (error) {
    console.warn('Could not save that file:', error);
    showToast(error.message || 'That file could not be saved', 5000);
  }
}

/** Asks before throwing away edits that were never written to their file. */
async function confirmDiscardIfNeeded(title) {
  if (!state.file.name || !state.file.dirty) return true;
  return confirmAction({
    title,
    body: `${state.file.name} has changes you have not saved. They stay in History and can be undone, but the file will not have them.`,
    confirmLabel: 'Continue without saving',
  });
}

function bindFileDrop() {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  ui.wrap.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    stop(event);
    event.dataTransfer.dropEffect = 'copy';
    ui.wrap.classList.add('is-drop-zone');
  });
  ui.wrap.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && ui.wrap.contains(event.relatedTarget)) return;
    ui.wrap.classList.remove('is-drop-zone');
  });
  ui.wrap.addEventListener('drop', async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    stop(event);
    ui.wrap.classList.remove('is-drop-zone');
    try {
      if (!(await confirmDiscardIfNeeded('Open the dropped map?'))) return;
      adoptFile(await readDroppedFile(file));
    } catch (error) {
      console.warn('Could not open the dropped file:', error);
      showToast(error.message || 'That file could not be opened', 5000);
    }
  });
}

// ---------------------------------------------------------------- outline

function writeOutline() {
  if (document.activeElement === ui.outline && state.outlineDirty) return;
  ui.outline.value = toOutline(doc.root);
  state.outlineDirty = false;
  ui.outlineStatus.textContent = '';
}

async function generateFromOutline({
  checkpointLabel = 'Before generate',
  preserveFormatting = true,
  what = 'Map generated',
} = {}) {
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

  checkpoint(checkpointLabel);
  // The outline carries text only, so formatting is re-applied by matching
  // nodes on their path: regenerating never silently drops your styling.
  // A sample is unrelated content, so it starts clean instead.
  const parsed = parseOutline(source, { title: 'Mind map' });
  const root = preserveFormatting ? carryFormatting(doc.root, parsed) : parsed;
  doc.replaceRoot(root);
  state.selectedId = null;
  state.outlineDirty = false;
  refresh();
  fitMap();
  const count = [...walk(root)].length;
  ui.outlineStatus.textContent = `${count} node${count === 1 ? '' : 's'}`;
  if (window.innerWidth < NARROW) setSidebar(false);
  showToast(`${what} — ${count} node${count === 1 ? '' : 's'}. Ctrl+Z undoes this.`);
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
  if (event.button !== 0 || viewport.modifiers.spaceHeld) return;
  const id = nodeIdFromEvent(event);
  if (!id) {
    if (!editor.isOpen()) {
      state.selectedId = null;
      refresh({ syncOutline: false });
    }
    return;
  }
  const handle = event.target.closest('.node-handle');
  if (handle) {
    event.preventDefault();
    const kind = handle.dataset.handle;
    // Clicking a handle while typing blurs the editor, which commits the
    // text; the new node is added after that has settled.
    if (editor.isOpen()) editor.close({ commit: true });
    setTimeout(() => (kind === 'child' ? addChild(id) : addSibling(id)), 0);
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

// The toolbar floats over the map, so it can sit on top of other nodes. When
// the mouse moves away from it, it gets out of the way: without this, aiming
// at a node behind the toolbar hits a toolbar button instead, which would
// quietly format the node you had selected before.
ui.wrap.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || ui.toolbar.hidden) return;
  const rect = ui.toolbar.getBoundingClientRect();
  const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
  const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
  ui.toolbar.classList.toggle('is-away', Math.hypot(dx, dy) > 90);
});

// A scripture reference on the map opens in the chosen Bible site.
ui.canvas.addEventListener('click', (event) => {
  const cite = event.target.closest('.scripture');
  if (!cite) return;
  const template = linkTemplate();
  if (!template) {
    showToast('Pick where to open references in the Talk panel');
    showPanel('talk');
    return;
  }
  const [reference] = findReferences(cite.dataset.reference ?? '');
  const url = referenceUrl(reference, template);
  if (url) window.open(url, '_blank', 'noopener');
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
  let dropped = null;

  const move = (moveEvent) => {
    if (!active && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 5) return;
    if (!active) {
      active = true;
      state.draggingId = id;
      ui.toolbar.hidden = true;
    }
    const target = dropTarget(moveEvent.clientX, moveEvent.clientY, id);
    state.dropTargetId = target?.kind === 'child' ? target.box.id : null;
    dropped = target;
    renderer.render(layout, state);
    renderer.setDropIndicator(target);
  };

  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const target = dropped;
    state.draggingId = null;
    state.dropTargetId = null;
    dropped = null;
    if (active && target) applyDrop(id, target);
    renderer.setDropIndicator(null);
    refresh();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/**
 * Where a drag would land. Over the middle of a node makes the dragged node
 * its child; near the top or bottom edge drops it above or below that node as
 * a sibling, which is what lets you put a card anywhere, not just deeper.
 *
 * @returns {{kind:'child'|'before'|'after', box: object}|null}
 */
function dropTarget(clientX, clientY, draggingId) {
  const point = viewport.toWorld(clientX, clientY);
  const margin = 14; // a little forgiveness around each box
  for (const box of layout.nodes) {
    if (draggingId && doc.contains(draggingId, box.id)) continue;
    const inside = point.x >= box.x - margin && point.x <= box.x + box.w + margin
      && point.y >= box.y - margin && point.y <= box.y + box.h + margin;
    if (!inside) continue;
    // The root has no siblings, so it can only take children.
    if (box.isRoot) return { kind: 'child', box };
    const fraction = (point.y - box.y) / box.h;
    if (fraction < 0.3) return { kind: 'before', box };
    if (fraction > 0.7) return { kind: 'after', box };
    return { kind: 'child', box };
  }
  return null;
}

function applyDrop(id, target) {
  const { kind, box } = target;
  if (kind === 'child') {
    if (box.id === id) return;
    if (!doc.move(id, box.id)) showToast('A node cannot be moved inside itself');
    return;
  }
  const parent = doc.parentOf(box.id);
  if (!parent) return;
  const index = doc.indexOf(box.id) + (kind === 'after' ? 1 : 0);
  if (!doc.move(id, parent.id, index)) showToast('A node cannot be moved inside itself');
}

// --------------------------------------------------------------- keyboard

function setPanMode(on) {
  if (viewport.modifiers.spaceHeld === on) return;
  viewport.modifiers.spaceHeld = on;
  ui.canvas.classList.toggle('is-pan-ready', on);
}

document.addEventListener('keyup', (event) => {
  if (event.code === 'Space' || event.key === ' ') setPanMode(false);
});
// A lost keyup (tab away mid-drag) would leave the canvas stuck in pan mode.
window.addEventListener('blur', () => setPanMode(false));

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
  if (mod && event.key.toLowerCase() === 't') {
    event.preventDefault();
    setTalkMode(!state.talkMode);
    return;
  }
  if (mod && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    printOutline();
    return;
  }
  if (mod && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    openFromFile();
    return;
  }
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveToFile({ saveAs: event.shiftKey });
    return;
  }
  if (typing || editor.isOpen()) return;

  // Hold space to pan, the way every canvas tool does it.
  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault(); // stop the page scrolling under us
    setPanMode(true);
    return;
  }

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

  if (!state.selectedId && ['Tab', 'Enter', '.', 'Delete', 'Backspace', 'F2'].includes(event.key)) {
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
    case '.':
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

const NARROW = 900; // below this the outline panel floats over the canvas

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
  // A menu, not a state display: it never claims the map you are working on is
  // one of the samples, and it resets so the same sample can be picked twice.
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Sample maps…';
  ui.sampleSelect.append(placeholder);
  for (const sample of SAMPLES) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sample.name;
    ui.sampleSelect.append(option);
  }
  ui.sampleSelect.value = '';

  ui.sampleSelect.addEventListener('change', async () => {
    const sample = SAMPLES.find((entry) => entry.id === ui.sampleSelect.value);
    ui.sampleSelect.value = '';
    if (!sample) return;

    const existing = [...walk(doc.root)].length;
    if (existing > 1) {
      const ok = await confirmAction({
        title: `Load the ${sample.name} sample?`,
        body: `This replaces the map you are working on (${existing} nodes). A version is kept in History, and Ctrl+Z undoes it.`,
        confirmLabel: 'Load sample',
      });
      if (!ok) return;
    }
    ui.outline.value = sample.outline;
    setFile({ name: '', dirty: false }); // a sample is not your file
    generateFromOutline({
      checkpointLabel: `Before loading ${sample.name}`,
      preserveFormatting: false,
      what: `${sample.name} loaded`,
    });
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
    setFile({ name: '', dirty: false });
    refresh();
    fitMap();
  });
  el('btn-open').addEventListener('click', openFromFile);
  el('btn-save').addEventListener('click', () => saveToFile());
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
  el('btn-talk').addEventListener('click', () => setTalkMode(!state.talkMode));
  el('tab-outline').addEventListener('click', () => showPanel('outline'));
  el('tab-talk').addEventListener('click', () => showPanel('talk'));
  el('btn-print').addEventListener('click', printOutline);

  ui.talkTarget.addEventListener('input', () => {
    state.talkTarget = Math.max(0, Number(ui.talkTarget.value) || 0);
    updateTalkPanel();
    scheduleSave();
  });
  ui.talkMinutes.addEventListener('change', () => {
    if (!state.selectedId) return;
    doc.setMinutes(state.selectedId, Number(ui.talkMinutes.value));
    refresh({ syncOutline: false });
  });
  // Notes commit on blur so every keystroke is not its own undo step.
  ui.talkNote.addEventListener('blur', () => {
    if (!state.selectedId) return;
    doc.setNote(state.selectedId, ui.talkNote.value);
    refresh({ syncOutline: false });
  });
  ui.talkLink.addEventListener('change', () => {
    state.linkPreset = ui.talkLink.value;
    ui.talkLinkCustom.hidden = state.linkPreset !== 'custom';
    renderReferenceList();
    scheduleSave();
  });
  ui.talkLinkCustom.addEventListener('input', () => {
    state.linkCustom = ui.talkLinkCustom.value;
    renderReferenceList();
    scheduleSave();
  });

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
  const exportButton = el('btn-export');
  const closeMenu = () => {
    list.hidden = true;
    exportButton.setAttribute('aria-expanded', 'false');
  };
  const openMenu = () => {
    list.hidden = false;
    exportButton.setAttribute('aria-expanded', 'true');
    // The menu is fixed, so it is placed against the button's position on
    // screen and kept inside the window.
    const rect = exportButton.getBoundingClientRect();
    list.style.top = `${rect.bottom + 6}px`;
    const width = list.offsetWidth || 190;
    const right = Math.min(window.innerWidth - 8, Math.max(rect.right, width + 8));
    list.style.left = `${right - width}px`;
  };
  exportButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (list.hidden) openMenu();
    else closeMenu();
  });
  // A fixed menu cannot follow the bar, so it closes rather than drifting.
  window.addEventListener('resize', closeMenu);
  document.querySelector('.topbar').addEventListener('scroll', closeMenu);
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

  window.addEventListener('beforeunload', (event) => {
    saveState({
      doc: doc.toJSON(),
      theme: state.theme,
      mode: state.mode,
      file: { name: state.file.name, dirty: state.file.dirty },
      talk: {
        mode: state.talkMode,
        target: state.talkTarget,
        linkPreset: state.linkPreset,
        linkCustom: state.linkCustom,
      },
    });
    pushVersion(doc.toJSON());
    // Only warn when a file is involved: without one, autosave has it covered.
    if (state.file.name && state.file.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

// ------------------------------------------------------------------- boot

function boot() {
  doc.onChange(markDirty);
  buildSwatches();
  buildLinkOptions();
  buildSampleSelect();
  bindChrome();
  applyTheme(saved?.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  state.mode = saved?.mode === 'right' ? 'right' : 'both';
  setSidebar(window.innerWidth >= NARROW, { refit: false });
  ui.outline.value = toOutline(doc.root);
  setFile(saved?.file ?? { name: '', dirty: false });

  const talk = saved?.talk ?? {};
  state.talkMode = Boolean(talk.mode);
  state.talkTarget = Number(talk.target) || 0;
  state.linkPreset = LINK_TEMPLATES.some((entry) => entry.id === talk.linkPreset) ? talk.linkPreset : 'none';
  state.linkCustom = String(talk.linkCustom ?? '');
  ui.talkTarget.value = state.talkTarget || '';
  ui.talkLink.value = state.linkPreset;
  ui.talkLinkCustom.value = state.linkCustom;
  ui.talkLinkCustom.hidden = state.linkPreset !== 'custom';
  if (state.talkMode) showPanel('talk');
  bindFileDrop();
  refresh();
  fitMap({ animate: false });
  pushVersion(doc.toJSON(), { label: 'Opened', force: true });
  if (!saved) showToast('Press ? for shortcuts');
}

boot();

// Offline support, so the app keeps working without a connection once it has
// been loaded. Only over https (or localhost); a failure here is not fatal.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('Offline support is unavailable:', error);
    });
  });
}

// Exposed for debugging from the console.
window.mindmapper = { doc, get layout() { return layout; }, viewport, refresh, clearState };
