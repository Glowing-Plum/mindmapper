// The mind map document: a tree of nodes plus the editing operations the UI
// needs, with undo/redo and change notification. Pure data -- no DOM.

let seq = 0;
export function uid() {
  seq += 1;
  return `n${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createNode(text = '', extra = {}) {
  return {
    id: uid(),
    text,
    note: '',
    collapsed: false,
    colorIndex: null, // null => inherit from the branch
    bold: false,
    italic: false,
    highlight: null, // a HIGHLIGHTS id, or null
    edgeLabel: '', // text drawn on the line coming from this node's parent
    children: [],
    ...extra,
  };
}

export function cloneTree(node) {
  return { ...node, children: node.children.map(cloneTree) };
}

/** Depth-first walk, parents before children. */
export function* walk(node, parent = null, depth = 0) {
  yield { node, parent, depth };
  for (const child of node.children) yield* walk(child, node, depth + 1);
}

export function countDescendants(node) {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

/**
 * Copies formatting from one tree onto another by matching nodes on their path
 * of texts. Regenerating from the outline rebuilds the tree from text alone,
 * so without this every highlight, bold, colour, collapse and line label would
 * be silently thrown away.
 *
 * @returns {object} `toRoot`, mutated in place
 */
export function carryFormatting(fromRoot, toRoot) {
  const sources = new Map();
  const collect = (node, path) => {
    const key = [...path, node.text].join('\u0000');
    if (!sources.has(key)) sources.set(key, []);
    sources.get(key).push(node);
    for (const child of node.children) collect(child, [...path, node.text]);
  };
  collect(fromRoot, []);

  const apply = (node, path) => {
    const key = [...path, node.text].join('\u0000');
    const source = sources.get(key)?.shift(); // repeated texts match in order
    if (source) {
      node.bold = source.bold;
      node.italic = source.italic;
      node.highlight = source.highlight;
      node.edgeLabel = source.edgeLabel;
      node.colorIndex = source.colorIndex;
      node.note = source.note;
      node.collapsed = source.collapsed && node.children.length > 0;
    }
    for (const child of node.children) apply(child, [...path, node.text]);
  };
  apply(toRoot, []);
  return toRoot;
}

const MAX_HISTORY = 100;

export class MindMapDoc {
  constructor(root = createNode('Central idea')) {
    this.root = root;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.reindex();
  }

  static fromJSON(data) {
    const revive = (raw) =>
      createNode(String(raw?.text ?? ''), {
        note: String(raw?.note ?? ''),
        collapsed: Boolean(raw?.collapsed),
        colorIndex: Number.isInteger(raw?.colorIndex) ? raw.colorIndex : null,
        bold: Boolean(raw?.bold),
        italic: Boolean(raw?.italic),
        highlight: raw?.highlight ?? null,
        edgeLabel: String(raw?.edgeLabel ?? ''),
        children: Array.isArray(raw?.children) ? raw.children.map(revive) : [],
      });
    return new MindMapDoc(revive(data?.root ?? data));
  }

  toJSON() {
    const strip = (node) => ({
      text: node.text,
      note: node.note || undefined,
      collapsed: node.collapsed || undefined,
      colorIndex: node.colorIndex ?? undefined,
      bold: node.bold || undefined,
      italic: node.italic || undefined,
      highlight: node.highlight ?? undefined,
      edgeLabel: node.edgeLabel || undefined,
      children: node.children.map(strip),
    });
    return { version: 1, root: strip(this.root) };
  }

  // -- lookups -------------------------------------------------------------

  reindex() {
    this.nodes = new Map();
    this.parents = new Map();
    this.depths = new Map();
    for (const { node, parent, depth } of walk(this.root)) {
      this.nodes.set(node.id, node);
      this.parents.set(node.id, parent);
      this.depths.set(node.id, depth);
    }
  }

  get(id) {
    return this.nodes.get(id) ?? null;
  }

  parentOf(id) {
    return this.parents.get(id) ?? null;
  }

  depthOf(id) {
    return this.depths.get(id) ?? 0;
  }

  indexOf(id) {
    const parent = this.parentOf(id);
    return parent ? parent.children.findIndex((child) => child.id === id) : -1;
  }

  /** True when `ancestorId` is `id` or one of its ancestors. */
  contains(ancestorId, id) {
    let cursor = this.get(id);
    while (cursor) {
      if (cursor.id === ancestorId) return true;
      cursor = this.parentOf(cursor.id);
    }
    return false;
  }

  /** Nearest visible ancestor chain is expanded, so the node can be seen. */
  revealPathTo(id) {
    let parent = this.parentOf(id);
    let changed = false;
    while (parent) {
      if (parent.collapsed) {
        parent.collapsed = false;
        changed = true;
      }
      parent = this.parentOf(parent.id);
    }
    return changed;
  }

  // -- history -------------------------------------------------------------

  /** Runs `mutate`, recording a snapshot so the change can be undone. */
  transact(mutate) {
    const before = cloneTree(this.root);
    const result = mutate();
    if (result === false) return null; // mutation declined, keep history clean
    this.undoStack.push(before);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.reindex();
    this.emit();
    return result;
  }

  /**
   * Applies `mutate` without opening a new history entry, folding the change
   * into the previous one. Naming a just-created node should cost one undo,
   * not two.
   */
  amend(mutate) {
    const result = mutate();
    if (result === false) return null;
    this.redoStack.length = 0;
    this.reindex();
    this.emit();
    return result;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.redoStack.push(cloneTree(this.root));
    this.root = this.undoStack.pop();
    this.reindex();
    this.emit();
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.undoStack.push(cloneTree(this.root));
    this.root = this.redoStack.pop();
    this.reindex();
    this.emit();
    return true;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this);
  }

  // -- editing operations --------------------------------------------------

  replaceRoot(root) {
    return this.transact(() => {
      this.root = root;
      return root;
    });
  }

  setText(id, text, { amend = false } = {}) {
    const node = this.get(id);
    if (!node || node.text === text) return null;
    const apply = () => {
      node.text = text;
      return node;
    };
    return amend ? this.amend(apply) : this.transact(apply);
  }

  setNote(id, note) {
    const node = this.get(id);
    if (!node || node.note === note) return null;
    return this.transact(() => {
      node.note = note;
      return node;
    });
  }

  /** Toggles bold or italic on a node. */
  toggleFormat(id, key) {
    const node = this.get(id);
    if (!node || (key !== 'bold' && key !== 'italic')) return null;
    return this.transact(() => {
      node[key] = !node[key];
      return node;
    });
  }

  /** Sets (or clears, with null) the text highlight. */
  setHighlight(id, highlight) {
    const node = this.get(id);
    if (!node || node.highlight === highlight) return null;
    return this.transact(() => {
      node.highlight = highlight;
      return node;
    });
  }

  /** Labels the line that runs from this node's parent into it. */
  setEdgeLabel(id, text) {
    const node = this.get(id);
    if (!node || !this.parentOf(id)) return null;
    const value = String(text ?? '').trim();
    if (node.edgeLabel === value) return null;
    return this.transact(() => {
      node.edgeLabel = value;
      return node;
    });
  }

  setColor(id, colorIndex) {
    const node = this.get(id);
    if (!node) return null;
    return this.transact(() => {
      node.colorIndex = colorIndex;
      return node;
    });
  }

  addChild(parentId, text = '', index = -1) {
    const parent = this.get(parentId);
    if (!parent) return null;
    return this.transact(() => {
      const node = createNode(text);
      const at = index < 0 ? parent.children.length : Math.min(index, parent.children.length);
      parent.children.splice(at, 0, node);
      parent.collapsed = false;
      return node;
    });
  }

  addSibling(id, text = '', after = true) {
    const parent = this.parentOf(id);
    if (!parent) return this.addChild(id, text); // the root gets a child instead
    const index = this.indexOf(id);
    return this.addChild(parent.id, text, after ? index + 1 : index);
  }

  remove(id) {
    const parent = this.parentOf(id);
    if (!parent) return null; // the root is never removed
    const index = this.indexOf(id);
    return this.transact(() => {
      parent.children.splice(index, 1);
      // Select something sensible afterwards.
      return parent.children[Math.min(index, parent.children.length - 1)] ?? parent;
    });
  }

  /** Re-parents `id` under `newParentId`. Rejects cycles. */
  move(id, newParentId, index = -1) {
    const node = this.get(id);
    const newParent = this.get(newParentId);
    const oldParent = this.parentOf(id);
    if (!node || !newParent || !oldParent) return null;
    if (this.contains(id, newParentId)) return null; // would detach the subtree
    return this.transact(() => {
      const from = this.indexOf(id);
      oldParent.children.splice(from, 1);
      let at = index < 0 ? newParent.children.length : index;
      if (oldParent === newParent && from < at) at -= 1;
      newParent.children.splice(Math.min(at, newParent.children.length), 0, node);
      newParent.collapsed = false;
      return node;
    });
  }

  /** Moves a node up or down among its siblings. */
  reorder(id, delta) {
    const parent = this.parentOf(id);
    if (!parent) return null;
    const index = this.indexOf(id);
    const target = index + delta;
    if (target < 0 || target >= parent.children.length) return null;
    return this.transact(() => {
      const [node] = parent.children.splice(index, 1);
      parent.children.splice(target, 0, node);
      return node;
    });
  }

  /** Makes a node a child of its previous sibling. */
  indent(id) {
    const parent = this.parentOf(id);
    if (!parent) return null;
    const index = this.indexOf(id);
    if (index <= 0) return null;
    return this.move(id, parent.children[index - 1].id);
  }

  /** Makes a node a sibling of its parent. */
  outdent(id) {
    const parent = this.parentOf(id);
    const grandparent = parent ? this.parentOf(parent.id) : null;
    if (!grandparent) return null;
    return this.move(id, grandparent.id, this.indexOf(parent.id) + 1);
  }

  toggleCollapse(id) {
    const node = this.get(id);
    if (!node || node.children.length === 0) return null;
    return this.transact(() => {
      node.collapsed = !node.collapsed;
      return node;
    });
  }

  setCollapsedAll(collapsed, fromDepth = 1) {
    return this.transact(() => {
      for (const { node, depth } of walk(this.root)) {
        if (node.children.length > 0) node.collapsed = collapsed && depth >= fromDepth;
      }
      return this.root;
    });
  }
}
