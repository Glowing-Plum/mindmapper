#!/usr/bin/env node
// End-to-end smoke test: boots the dev server, drives the real UI in Chromium
// and checks the interactions that unit tests cannot reach (editing, dragging,
// undo, exporting). Playwright is optional -- without it this exits cleanly.
//
//   npm run test:browser
//
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4319);
const BASE = `http://localhost:${PORT}/`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('playwright is not installed — skipping the browser smoke test.');
  console.log('install it with `npm i -D playwright && npx playwright install chromium`.');
  process.exit(0);
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`);
};

const server = spawn(process.execPath, [resolve(ROOT, 'scripts/serve.mjs'), String(PORT), ROOT], {
  stdio: 'ignore',
});
await waitForServer(BASE);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => message.type() === 'error' && errors.push(`console: ${message.text()}`));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const nodeCount = () => page.locator('.node').count();
  const outline = () => page.inputValue('#outline');
  const idOf = (text) =>
    page.evaluate(
      (t) => [...document.querySelectorAll('.node')].find((n) => n.textContent.startsWith(t))?.dataset.id,
      text,
    );
  const clickNode = async (text) => page.click(`.node[data-id="${await idOf(text)}"] .node-hit`);
  const centerOf = async (text) =>
    page.evaluate((id) => {
      const rect = document.querySelector(`.node[data-id="${id}"] .node-hit`).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, await idOf(text));

  const initial = await nodeCount();
  check('sample map renders', initial > 10, `(${initial} nodes)`);
  check('edges drawn for every child', (await page.locator('.edge').count()) === initial - 1);
  check('export menu starts closed', await page.isHidden('.menu-list'));

  // The top bar scrolls horizontally, which would clip an absolutely
  // positioned dropdown; the menu must be visible and fully on screen.
  await page.click('#btn-export');
  await page.waitForTimeout(250);
  const menuBox = await page.evaluate(() => {
    const list = document.querySelector('.menu-list');
    const rect = list.getBoundingClientRect();
    const item = document.querySelector('[data-export="png"]').getBoundingClientRect();
    return {
      visible: !list.hidden && rect.height > 20,
      insideWindow: rect.top >= 0 && rect.left >= 0
        && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
      itemClickable: item.width > 0 && item.bottom <= window.innerHeight,
      atPoint: document.elementFromPoint(item.left + item.width / 2, item.top + item.height / 2)?.dataset?.export,
    };
  });
  check('export menu options are visible and on screen',
    menuBox.visible && menuBox.insideWindow && menuBox.itemClickable && menuBox.atPoint === 'png',
    JSON.stringify(menuBox));
  await page.keyboard.press('Escape');
  await page.click('#canvas', { position: { x: 40, y: 400 } });
  await page.waitForTimeout(200);

  // Add and name a node; one undo should take the whole thing back.
  await clickNode('Build');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await page.keyboard.type('Docs site');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('Tab adds and names a child', (await nodeCount()) === initial + 1 && (await outline()).includes('Docs site'));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  check('one undo removes a freshly named node', (await nodeCount()) === initial);

  // Inline editing.
  await page.dblclick(`.node[data-id="${await idOf('Pricing')}"] .node-hit`);
  await page.waitForTimeout(200);
  check('double-click opens the editor', await page.isVisible('.inline-editor'));
  await page.fill('.inline-editor', 'Pricing & packaging');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('rename reaches map and outline', (await outline()).includes('Pricing & packaging'));

  // Drag to re-parent.
  const from = await centerOf('Free tier');
  const to = await centerOf('Support');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(120);
  const indicator = await page.locator('.drop-indicator').count();
  await page.mouse.up();
  await page.waitForTimeout(300);
  check('drop indicator shows while dragging', indicator === 1);
  check('drag re-parents the node', /- Support\n(\s+- .*\n)*\s+- Free tier/.test(await outline()));

  // Formatting.
  await clickNode('Build');
  await page.click('.node-toolbar [data-act="bold"]');
  await page.keyboard.press('Control+i');
  await page.click('#highlights .swatch[data-highlight="yellow"]');
  await page.waitForTimeout(300);
  const buildId = await idOf('Build');
  const formatting = await page.evaluate((id) => {
    const text = document.querySelector(`.node[data-id="${id}"] .node-text`);
    const highlight = document.querySelector(`.node[data-id="${id}"] .node-highlight`);
    const style = getComputedStyle(text);
    return {
      bold: style.fontWeight === '700',
      italic: style.fontStyle === 'italic',
      highlighted: highlight && highlight.style.display !== 'none',
    };
  }, buildId);
  check('bold, italic and highlight apply', formatting.bold && formatting.italic && formatting.highlighted,
    JSON.stringify(formatting));

  // Labelling a connector.
  await clickNode('Pricing');
  await page.click('.node-toolbar [data-act="label"]');
  await page.waitForTimeout(200);
  await page.fill('.inline-editor', 'depends on');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  check('a line can be labelled', (await page.textContent('.edge-label-text')) === 'depends on');
  const room = await page.evaluate(() => {
    const edge = window.mindmapper.layout.edges.find((e) => e.label);
    return Math.abs(edge.to.x - (edge.from.x + edge.from.w)) >= edge.label.w + 26;
  });
  check('the labelled line makes room for its label', room);

  // Double-clicking a bare line starts a label there.
  const bareEdge = await page.evaluate(() =>
    window.mindmapper.layout.edges.find((e) => !e.label && e.to.node.text === 'Free tier')?.id);
  await page.dblclick(`.edge-group[data-id="${bareEdge}"] .edge-hit`, { force: true });
  await page.waitForTimeout(250);
  check('double-click on a line opens a label editor', await page.isVisible('.inline-editor'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Holding space pans from anywhere, including from on top of a node.
  const beforeSpace = await page.evaluate(() => ({ ...window.mindmapper.viewport.state }));
  const overNode = await page.evaluate(() => {
    const r = document.querySelector('.node:not(.is-root) .node-hit').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const outlineBeforeSpace = await outline();
  await page.keyboard.down('Space');
  await page.mouse.move(overNode.x, overNode.y);
  await page.mouse.down();
  await page.mouse.move(overNode.x + 110, overNode.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.waitForTimeout(250);
  const afterSpace = await page.evaluate(() => ({ ...window.mindmapper.viewport.state }));
  check('space + drag over a node pans instead of moving it',
    Math.abs(afterSpace.x - beforeSpace.x) > 60 && (await outline()) === outlineBeforeSpace);
  check('releasing space leaves pan mode',
    !(await page.evaluate(() => document.getElementById('canvas').classList.contains('is-pan-ready'))));

  // The two handles on a node: one adds a child, one adds a sibling.
  await clickNode('Launch checklist');
  await page.waitForTimeout(250);
  const handleId = await idOf('Launch checklist');
  check('handles show on the selected node', await page.evaluate((id) =>
    getComputedStyle(document.querySelector(`.node[data-id="${id}"] .node-handle-child`)).opacity === '1', handleId));
  await page.click(`.node[data-id="${handleId}"] .node-handle-child`);
  await page.waitForTimeout(250);
  check('the side handle opens a new child for typing', await page.isVisible('.inline-editor'));
  await page.keyboard.type('Sub item');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  check('the child is created under that node',
    /- Launch checklist\n\s+- Sub item/.test(await outline()));

  const subId = await idOf('Sub item');
  await page.dblclick(`.node[data-id="${subId}"] .node-hit`);
  await page.waitForTimeout(250);
  check('handles stay visible while typing', await page.evaluate((id) =>
    getComputedStyle(document.querySelector(`.node[data-id="${id}"] .node-handle-sibling`)).opacity === '1', subId));
  await page.click(`.node[data-id="${subId}"] .node-handle-sibling`, { force: true });
  await page.waitForTimeout(300);
  await page.keyboard.type('Next to it');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  check('the lower handle adds a sibling', /- Sub item\n\s+- Next to it/.test(await outline()));

  // The collapse button sits outboard of the child dot, and still works there.
  await clickNode('Positioning');
  await page.waitForTimeout(250);
  const controls = await page.evaluate(() => {
    const id = [...document.querySelectorAll('.node')]
      .find((n) => n.textContent.startsWith('Positioning')).dataset.id;
    const node = document.querySelector(`.node[data-id="${id}"] .node-hit`).getBoundingClientRect();
    const dot = document.querySelector(`.node[data-id="${id}"] .node-handle-child .node-handle-dot`).getBoundingClientRect();
    const badge = document.querySelector(`.node[data-id="${id}"] .node-badge-circle`).getBoundingClientRect();
    const side = dot.left > node.right ? 1 : -1;
    const from = (r) => (side === 1 ? r.left - node.right : node.left - r.right);
    return { dotAt: from(dot), badgeAt: from(badge), overlap: side === 1
      ? badge.left < dot.right : badge.right > dot.left };
  });
  check('the collapse button sits past the child dot, clear of it',
    controls.badgeAt > controls.dotAt && !controls.overlap, JSON.stringify(controls));

  const beforeCollapse = await nodeCount();
  await page.click('.node.is-selected .node-badge');
  await page.waitForTimeout(400);
  check('the collapse button still works where it now sits',
    (await nodeCount()) < beforeCollapse);
  await page.click('.node.is-selected .node-badge');
  await page.waitForTimeout(400);

  // A card can be dropped between siblings, not only onto a parent.
  const dropBetween = await (async () => {
    const from = await page.evaluate((id) => {
      const r = document.querySelector(`.node[data-id="${id}"] .node-hit`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, await idOf('Next to it'));
    const to = await page.evaluate((id) => {
      const r = document.querySelector(`.node[data-id="${id}"] .node-hit`).getBoundingClientRect();
      return { x: r.left + r.width / 2, top: r.top };
    }, await idOf('Landing page'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 6, { steps: 3 });
    await page.mouse.move(to.x, to.top + 3, { steps: 10 });
    await page.waitForTimeout(150);
    const line = await page.locator('.drop-line').count();
    await page.mouse.up();
    await page.waitForTimeout(350);
    return line;
  })();
  check('dropping at a node edge shows an insertion line and places it there',
    dropBetween === 1 && /- Next to it\n\s+- Landing page/.test(await outline()),
    JSON.stringify((await outline()).split('\n').slice(-8)));

  // Dragging empty space still pans (the pan must not steal that double-click).
  const beforePan = await page.evaluate(() => ({ ...window.mindmapper.viewport.state }));
  await page.mouse.move(700, 800);
  await page.mouse.down();
  await page.mouse.move(760, 830, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterPan = await page.evaluate(() => ({ ...window.mindmapper.viewport.state }));
  check('dragging the background pans', Math.abs(afterPan.x - beforePan.x) > 20);

  // Collapsing.
  await clickNode('Positioning');
  await page.keyboard.press('.');
  await page.waitForTimeout(300);
  check('collapse hides the subtree', (await nodeCount()) < initial);
  check('collapsed node shows a count', /^\d+$/.test(await page.textContent('.node.is-collapsed .node-badge-text')));
  await page.keyboard.press('.');
  await page.waitForTimeout(300);

  // Regenerating keeps formatting that the outline itself cannot carry.
  await page.click('#btn-generate');
  await page.waitForTimeout(400);
  check('regenerating preserves formatting and labels', await page.evaluate(() => {
    const nodes = [...window.mindmapper.doc.nodes.values()];
    return nodes.find((n) => n.text === 'Build')?.bold === true
      && nodes.find((n) => n.text === 'Pricing & packaging')?.edgeLabel === 'depends on';
  }));

  // Generating from the outline panel.
  await page.fill('#outline', '# Weekly review\n- Wins\n  - Shipped search\n- Risks\n  - Hiring slow');
  await page.click('#btn-generate');
  await page.waitForTimeout(400);
  check('outline generates a map', (await nodeCount()) === 5);

  // Content safety: destructive actions confirm, and history can bring a map back.
  const beforeNew = await nodeCount();
  await page.click('#btn-new');
  await page.waitForTimeout(250);
  check('New map asks before replacing', await page.isVisible('#confirm-dialog'));
  await page.click('#confirm-dialog button[value="cancel"]');
  await page.waitForTimeout(250);
  check('cancelling leaves the map alone', (await nodeCount()) === beforeNew);

  await page.click('#btn-new');
  await page.waitForTimeout(250);
  await page.click('#confirm-ok');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(350);
  check('replacing the map is undoable', (await nodeCount()) === beforeNew);

  await page.click('#btn-history');
  await page.waitForTimeout(300);
  const versions = await page.locator('.version-row').count();
  check('history lists restorable versions', versions >= 2, `(${versions})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Loading a sample must not silently discard the map you are working on.
  const beforeSample = await nodeCount();
  check('the sample picker starts on its placeholder', (await page.inputValue('#sample-select')) === '');
  await page.selectOption('#sample-select', 'trip');
  await page.waitForTimeout(300);
  check('picking a sample asks first', await page.isVisible('#confirm-dialog'));
  await page.click('#confirm-dialog button[value="cancel"]');
  await page.waitForTimeout(300);
  check('cancelling keeps the current map', (await nodeCount()) === beforeSample);
  check('the picker resets after cancelling', (await page.inputValue('#sample-select')) === '');

  await page.selectOption('#sample-select', 'trip');
  await page.waitForTimeout(250);
  await page.click('#confirm-ok');
  await page.waitForTimeout(500);
  check('confirming loads the sample', (await outline()).includes('Kyoto'));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  check('loading a sample is undoable', (await nodeCount()) === beforeSample);

  // ---- files -------------------------------------------------------------
  // The File System Access API opens a native dialog no test can drive, so the
  // pickers are stubbed. Everything below them is the app's real code path.
  await page.evaluate(() => {
    window.__savedText = null;
    const handle = {
      name: 'from-disk.json',
      async getFile() {
        return new File([window.__fileContents], 'from-disk.json', { type: 'application/json' });
      },
      async createWritable() {
        return {
          async write(text) { window.__savedText = text; },
          async close() {},
        };
      },
    };
    window.__handle = handle;
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => handle;
  });
  await page.evaluate(() => {
    window.__fileContents = JSON.stringify({
      version: 1,
      root: {
        text: 'Opened from a file',
        children: [{ text: 'Styled', bold: true, highlight: 'yellow', edgeLabel: 'via', children: [] }],
      },
    });
  });

  await page.click('#btn-open');
  await page.waitForTimeout(500);
  check('opening a file loads the map', (await outline()).includes('Opened from a file'));
  check('the file name is shown', (await page.textContent('#file-name')) === 'from-disk.json');
  check('a freshly opened file is not dirty',
    !(await page.evaluate(() => document.getElementById('file-name').classList.contains('is-dirty'))));
  check('json keeps formatting the outline cannot carry', await page.evaluate(() => {
    const node = [...window.mindmapper.doc.nodes.values()].find((n) => n.text === 'Styled');
    return node?.bold === true && node?.highlight === 'yellow' && node?.edgeLabel === 'via';
  }));

  // Editing marks it unsaved; Ctrl+S writes back to the same file.
  await clickNode('Styled');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await page.keyboard.type('Added offline');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  check('editing marks the file unsaved',
    await page.evaluate(() => document.getElementById('file-name').classList.contains('is-dirty')));

  await page.keyboard.press('Control+s');
  await page.waitForTimeout(500);
  const written = await page.evaluate(() => window.__savedText);
  check('Ctrl+S writes back to the same file', Boolean(written) && written.includes('Added offline'));
  check('saving clears the unsaved marker',
    !(await page.evaluate(() => document.getElementById('file-name').classList.contains('is-dirty'))));

  // Dropping a file onto the canvas opens it.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['# Dropped map\n- One\n- Two'], 'dropped.md', { type: 'text/markdown' }));
    const wrap = document.getElementById('canvas-wrap');
    wrap.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    wrap.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(600);
  check('dropping a file opens it', (await outline()).includes('Dropped map'));
  check('the dropped file name is adopted', (await page.textContent('#file-name')) === 'dropped.md');

  // A file that is not a mind map fails with a clear message, changing nothing.
  const beforeBad = await outline();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['{"hello":"world"}'], 'other.json', { type: 'application/json' }));
    const wrap = document.getElementById('canvas-wrap');
    wrap.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  check('a file that is not a mind map is refused',
    (await outline()) === beforeBad && (await page.textContent('#toast')).includes('does not look like a mind map'));

  // ---- talk mode ---------------------------------------------------------
  await page.fill('#outline', [
    '# Comfort for the bereaved',
    '- Grief is natural',
    '  - Genesis 23:2',
    '  - John 11:35',
    '- Jehovah promises comfort',
    '  - 시편 34:18',
  ].join('\n'));
  await page.click('#btn-generate');
  await page.waitForTimeout(400);
  await page.click('#btn-talk');
  await page.waitForTimeout(400);

  check('talk mode marks scripture on the map', (await page.locator('.scripture').count()) === 3);
  check('the scripture index lists them as written',
    (await page.locator('.ref-row').count()) === 3
    && (await page.textContent('.ref-row .ref-cite')) === 'Genesis 23:2');
  check('a Korean reference resolves to its English book', await page.evaluate(async () => {
    const mod = await import('/src/scripture.js');
    return mod.findReferences('시편 34:18')[0].canonical === 'Psalms 34:18';
  }));

  // Timings roll up, and the target is judged.
  await page.fill('#talk-target', '10');
  const timeNode = async (text, minutes) => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    await clickNode(text);
    await page.waitForTimeout(150);
    await page.fill('#talk-minutes', String(minutes)); // saves itself, no Enter
    await page.waitForTimeout(450);
  };
  await timeNode('Grief is natural', 4);
  await timeNode('Jehovah promises comfort', 5);
  check('timings roll up to the root', (await page.textContent('#talk-total')).includes('9 min'),
    await page.textContent('#talk-total'));
  check('a time chip is drawn on the map', await page.evaluate(() =>
    [...document.querySelectorAll('.node-meta')].some((n) => n.textContent.includes('9m'))));

  await page.fill('#talk-target', '5');
  await page.waitForTimeout(250);
  check('going over the time is flagged',
    (await page.getAttribute('#talk-total', 'class')).includes('is-over'));

  // Speaker notes.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Escape');
  await clickNode('Jehovah promises comfort');
  await page.waitForTimeout(200);
  await page.fill('#talk-note', 'Pause here.'); // saves itself, no Enter
  await page.waitForTimeout(450);
  check('a note is kept and marked on the map', await page.evaluate(() => {
    const node = [...window.mindmapper.doc.nodes.values()].find((n) => n.text === 'Jehovah promises comfort');
    return node.note === 'Pause here.';
  }));

  // The rehearsal timer.
  await page.click('#btn-timer');
  await page.waitForTimeout(1600);
  const timer = await page.evaluate(() => ({
    clock: document.getElementById('timer-clock').textContent,
    button: document.getElementById('btn-timer').textContent,
    onCanvas: !document.getElementById('canvas-timer').hidden,
  }));
  check('the timer runs and shows on the canvas',
    /0:0[12]/.test(timer.clock) && timer.button === 'Pause' && timer.onCanvas, JSON.stringify(timer));
  await page.click('#btn-timer');
  const held = await page.textContent('#timer-clock');
  await page.waitForTimeout(800);
  check('pausing holds the clock', (await page.textContent('#timer-clock')) === held);
  await page.click('#btn-timer-reset');
  await page.waitForTimeout(200);
  check('resetting clears it and hides the canvas clock',
    (await page.textContent('#timer-clock')) === '0:00'
    && await page.evaluate(() => document.getElementById('canvas-timer').hidden));

  // Tapping a verse opens the library panel in the corner.
  await page.click('.node .scripture');
  await page.waitForTimeout(400);
  const versePanel = await page.evaluate(() => {
    const el = document.getElementById('verse-panel');
    const rect = el.getBoundingClientRect();
    const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
    return {
      open: !el.hidden,
      corner: rect.left - wrap.left < 40 && wrap.bottom - rect.bottom < 40,
      cite: document.getElementById('verse-cite').textContent,
      src: document.getElementById('verse-frame').getAttribute('src'),
    };
  });
  check('tapping a verse opens it bottom-left, as written, in the library',
    versePanel.open && versePanel.corner && versePanel.cite === 'Genesis 23:2'
    && versePanel.src.includes('wol.jw.org'), JSON.stringify(versePanel));

  await page.selectOption('#talk-wol-lang', 'ko');
  await page.waitForTimeout(400);
  check('the language choice reloads the open verse',
    (await page.getAttribute('#verse-frame', 'src')).includes('/ko/'));
  await page.click('#btn-verse-close');
  await page.waitForTimeout(200);
  check('the verse panel closes', await page.evaluate(() =>
    document.getElementById('verse-panel').hidden));
  await page.selectOption('#talk-wol-lang', 'en');

  // Minutes and notes need no Enter, and land on the node being typed into.
  await clickNode('Grief is natural');
  await page.waitForTimeout(200);
  await page.fill('#talk-minutes', '6');
  await page.waitForTimeout(450);
  check('minutes save as you type', await page.evaluate(() =>
    [...window.mindmapper.doc.nodes.values()].find((n) => n.text === 'Grief is natural').minutes === 6));

  // The printable outline.
  const printed = await page.evaluate(() => {
    window.print = () => { window.__printed = true; };
    document.getElementById('btn-print').click();
    return {
      called: window.__printed === true,
      title: document.querySelector('.print-title')?.textContent,
      scriptures: document.querySelectorAll('.print-scripture').length,
      notes: document.querySelectorAll('.print-note').length,
      times: document.querySelectorAll('.print-time').length,
    };
  });
  check('print builds an outline with scripture, times and notes',
    printed.called && printed.title === 'Comfort for the bereaved'
    && printed.scriptures === 3 && printed.notes === 1 && printed.times >= 2,
    JSON.stringify(printed));

  // Talk mode is remembered.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check('talk mode survives a reload', (await page.getAttribute('#btn-talk', 'aria-pressed')) === 'true');
  await page.click('#btn-talk');
  await page.waitForTimeout(300);
  check('talk mode can be turned off', (await page.locator('.scripture').count()) === 0);

  // Export.
  const svg = await page.evaluate(async () => {
    const mod = await import('/src/exporters.js');
    return mod.toSvgString({ scene: document.querySelector('.scene') }, window.mindmapper.layout.bounds);
  });
  check('svg export is self-contained', svg.includes('<svg') && svg.includes('font-family') && !svg.includes('is-selected'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export').then(() => page.click('[data-export="png"]')),
  ]);
  check('png download starts', download.suggestedFilename().endsWith('.png'));

  // Autosave: whatever is on screen now must still be there after a reload.
  const beforeReload = await outline();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check('map survives a reload', (await outline()) === beforeReload);
  check('the file name survives a reload', (await page.textContent('#file-name')) === 'dropped.md');

  check('no console errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start at ${url}`);
}
