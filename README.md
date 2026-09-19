# Mindmapper

A mindmap generator in the style of Whimsical: write an outline, get a clean,
colour-branched mind map you can keep editing on the canvas. No build step, no
dependencies — it is plain ES modules, SVG and CSS.

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
| <kbd>Space</kbd> | Collapse or expand (the bubble counts what is hidden) |
| <kbd>Delete</kbd> | Delete the node and its subtree |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> | Undo (add <kbd>Shift</kbd> to redo) |
| <kbd>Shift</kbd> + <kbd>F</kbd> | Fit the map on screen |
| <kbd>?</kbd> | Shortcut help |

Drag a node onto another to re-parent it — moves that would put a node inside
its own subtree are refused. The floating toolbar over a selected node sets its
branch colour (click the active swatch again to go back to inheriting) and adds
or deletes nodes. Scroll or drag empty space to pan; <kbd>Ctrl</kbd>/<kbd>⌘</kbd>
+ scroll, or pinch, to zoom.

Work autosaves to `localStorage` and is restored on the next visit, along with
your theme and layout choice.

## Layout

Branches fan out either side of a centred root (**Balanced**) or all to the
right (**One side**). Each depth gets its own column, sized to the widest node
in it, and every subtree is stacked so that no two boxes overlap and each parent
sits centred on its children. Connectors are cubic beziers that leave the parent
horizontally and carry the branch colour, thinning with depth.

## Exporting

**PNG** (2× resolution), **SVG**, **Markdown outline**, **JSON**, or the outline
straight to the clipboard. The SVG is standalone: the current theme's colours
and the typography are written into the file, so it renders the same outside the
app.

## How it fits together

| File | Responsibility |
| --- | --- |
| `src/model.js` | The tree, editing operations, undo/redo, change events |
| `src/parser.js` | Outline → tree and back (`parseOutline`, `toOutline`) |
| `src/measure.js` | Text measurement and wrapping; falls back to an estimate without a canvas |
| `src/layout.js` | Tidy two-sided layout: positions, connector paths, bounds |
| `src/render.js` | Keyed SVG rendering, so relayouts tween instead of jumping |
| `src/viewport.js` | Pan, zoom, pinch, fit-to-screen |
| `src/editor.js` | The textarea floated over the node being edited |
| `src/exporters.js` | SVG/PNG/Markdown/JSON output and downloads |
| `src/app.js` | Interaction state and wiring |

`model.js`, `parser.js`, `measure.js` and `layout.js` have no DOM dependency,
which is why the layout engine can be unit-tested in Node — including the
invariant that no two nodes ever overlap.

## Tests

`npm test` runs 42 unit tests across the parser, the document model and the
layout engine. `npm run test:browser` boots the app in Chromium and exercises
editing, dragging, collapsing, undo, autosave and export; it skips itself
cleanly when Playwright is not installed.

## Browser support

Any current browser with ES modules and `<dialog>`: Chrome, Edge, Firefox and
Safari 15.4+.

## Licence

MIT.
