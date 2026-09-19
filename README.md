# Mindmapper

A mindmap generator in the style of Whimsical: write an outline, get a clean,
colour-branched mind map you can keep editing on the canvas. Nodes are bare
text on the canvas — colour lives in the connectors, so the words stay the most
legible thing on screen. No build step, no dependencies — it is plain ES
modules, SVG and CSS.

```bash
npm start          # serves the app at http://localhost:4173
npm test           # unit tests for the parser, model and layout engine
npm run test:browser   # optional end-to-end pass (needs playwright)
```

ES modules need a real origin, so open the served URL rather than the file
itself.

## Generating a map

Paste an outline into the left panel and press **Generate map** (or
<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>). Markdown headings, bullets,
numbered lists and plain indentation all work, and the indent unit is inferred,
so 2-space, 4-space and tab outlines are all understood:

```markdown
# Product launch
- Positioning
  - Audience
    - Ops teams
  - Core message
- Build
  - Beta programme
```

A single top-level item becomes the root; several top-level items get a root
wrapped around them. Editing the map keeps the panel in sync, so the outline is
always a faithful text version of what you see.

## Editing on the canvas

| Key | Action |
| --- | --- |
| <kbd>Tab</kbd> | Add a child and start typing |
| <kbd>Enter</kbd> | Add a sibling |
| <kbd>F2</kbd> or double-click | Edit the selected node |
| Arrow keys | Move the selection along the branches |
| <kbd>Alt</kbd> + <kbd>↑</kbd>/<kbd>↓</kbd> | Reorder among siblings |
| <kbd>Alt</kbd> + <kbd>←</kbd>/<kbd>→</kbd> | Outdent / indent |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>B</kbd> / <kbd>I</kbd> | Bold / italic |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>H</kbd> | Cycle the text highlight |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>L</kbd> | Label the line coming into this node |
| <kbd>Space</kbd> | Collapse or expand (the bubble counts what is hidden) |
| <kbd>Delete</kbd> | Delete the node and its subtree |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> | Undo (add <kbd>Shift</kbd> to redo) |
| <kbd>Shift</kbd> + <kbd>F</kbd> | Fit the map on screen |
| <kbd>?</kbd> | Shortcut help |

Drag a node onto another to re-parent it — moves that would put a node inside
its own subtree are refused. Scroll or drag empty space to pan;
<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + scroll, or pinch, to zoom.

### Formatting and line labels

The toolbar above a selected node carries **bold**, *italic*, a text highlight
(four tints, click the active one again to clear it) and the branch colour —
click the active swatch again to go back to inheriting from the branch.

Any connector can carry a label: select the node below it and press **Label
line**, or double-click the line itself. The column shifts outward to make room,
so a labelled line never runs short of space.

## Keeping your work

- **Autosave.** Every change is written to `localStorage`, along with your theme
  and layout choice, and restored on the next visit.
- **Version history.** Timestamped snapshots are kept automatically (a run of
  quick edits collapses into one entry, so the list stays readable). Open
  **History** to see them with their node counts and restore any of them — the
  restore is itself undoable.
- **Checkpoints before destructive steps.** Starting a new map or regenerating
  from the outline pins the previous state in history first, and asks before
  wiping a map outright.
- **Undo survives everything.** Replacing, regenerating and restoring are all
  ordinary undoable edits.
- **Formatting is never lost to a regenerate.** The outline carries text only,
  so when you regenerate, highlights, bold, colours, collapse state and line
  labels are re-applied by matching nodes on their path.

## Layout

Branches fan out either side of a centred root (**Balanced**) or all to the
right (**One side**).

Children are positioned relative to **their own parent**, not in global
per-depth columns. Siblings share a leading edge with each other and with
nothing else, so two nodes lining up vertically always means they belong to the
same parent — cousins under differently sized parents deliberately do not align,
because that would imply a relationship that is not there.

Every subtree is stacked so no two nodes overlap and each parent sits centred on
its children. A connector resolves its curve immediately at the parent and then
runs straight into the child; a child level with its parent gets a dead-straight
line.

## Exporting

**PNG** (2× resolution), **SVG**, **Markdown outline**, **JSON**, or the outline
straight to the clipboard. The SVG is standalone: the current theme's colours
and the typography are written into the file, so it renders the same outside the
app.

## How it fits together

| File | Responsibility |
| --- | --- |
| `src/model.js` | The tree, editing operations, formatting, undo/redo, change events |
| `src/parser.js` | Outline → tree and back (`parseOutline`, `toOutline`) |
| `src/measure.js` | Text measurement and wrapping; falls back to an estimate without a canvas |
| `src/layout.js` | Tidy two-sided layout: positions, connector paths, bounds |
| `src/render.js` | Keyed SVG rendering, so relayouts tween instead of jumping |
| `src/viewport.js` | Pan, zoom, pinch, fit-to-screen |
| `src/editor.js` | The textarea floated over the node or label being edited |
| `src/storage.js` | Autosave and the rolling version history |
| `src/exporters.js` | SVG/PNG/Markdown/JSON output and downloads |
| `src/app.js` | Interaction state and wiring |

`model.js`, `parser.js`, `measure.js` and `layout.js` have no DOM dependency,
which is why the layout engine can be unit-tested in Node — including the
invariant that no two nodes ever overlap.

## Tests

`npm test` runs 64 unit tests across the parser, the document model, the layout
engine and local storage — including the invariants that nodes never overlap,
that siblings align only with each other, and that regenerating preserves
formatting.

`npm run test:browser` boots the app in Chromium and exercises editing,
dragging, formatting, line labels, collapsing, undo, version history, autosave
and export (26 checks). It skips itself cleanly when Playwright is not
installed.

## Browser support

Any current browser with ES modules and `<dialog>`: Chrome, Edge, Firefox and
Safari 15.4+.

## Licence

MIT.
