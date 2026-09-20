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
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  check('collapse hides the subtree', (await nodeCount()) < initial);
  check('collapsed node shows a count', /^\d+$/.test(await page.textContent('.node.is-collapsed .node-badge-text')));
  await page.keyboard.press(' ');
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

  // Autosave.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check('map survives a reload', (await outline()).includes('Weekly review'));

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
