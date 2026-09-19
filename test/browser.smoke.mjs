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
  const clickNode = async (text) => page.click(`.node[data-id="${await idOf(text)}"] .node-base`);
  const centerOf = async (text) =>
    page.evaluate((id) => {
      const rect = document.querySelector(`.node[data-id="${id}"] .node-base`).getBoundingClientRect();
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
  await page.dblclick(`.node[data-id="${await idOf('Pricing')}"] .node-base`);
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

  // Collapsing.
  await clickNode('Positioning');
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  check('collapse hides the subtree', (await nodeCount()) < initial);
  check('collapsed node shows a count', /^\d+$/.test(await page.textContent('.node.is-collapsed .node-badge-text')));
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);

  // Generating from the outline panel.
  await page.fill('#outline', '# Weekly review\n- Wins\n  - Shipped search\n- Risks\n  - Hiring slow');
  await page.click('#btn-generate');
  await page.waitForTimeout(400);
  check('outline generates a map', (await nodeCount()) === 5);

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
