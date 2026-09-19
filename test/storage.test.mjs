import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// A minimal localStorage so the storage module can be exercised in Node.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
globalThis.localStorage = new MemoryStorage();

const {
  MAX_VERSIONS, clearVersions, getVersion, listVersions, loadState, pushVersion, relativeTime, saveState,
} = await import('../src/storage.js');

const docWith = (...texts) => ({
  version: 1,
  root: { text: 'Root', children: texts.map((text) => ({ text, children: [] })) },
});

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  clearVersions();
});

test('state round-trips', () => {
  saveState({ doc: docWith('A'), theme: 'dark', mode: 'right' });
  const loaded = loadState();
  assert.equal(loaded.theme, 'dark');
  assert.equal(loaded.doc.root.children[0].text, 'A');
});

test('a version records the node count and is readable back', () => {
  pushVersion(docWith('A', 'B'), { now: 1000 });
  const [version] = listVersions();
  assert.equal(version.nodes, 3);
  assert.deepEqual(getVersion(version.id), docWith('A', 'B'));
});

test('an unchanged document does not create a second version', () => {
  pushVersion(docWith('A'), { now: 1000 });
  pushVersion(docWith('A'), { now: 400_000 });
  assert.equal(listVersions().length, 1);
});

test('rapid edits collapse into one entry, quiet ones are kept apart', () => {
  pushVersion(docWith('A'), { now: 0 });
  pushVersion(docWith('A', 'B'), { now: 5_000 });
  pushVersion(docWith('A', 'B', 'C'), { now: 9_000 });
  assert.equal(listVersions().length, 1, 'edits inside the window collapse');
  assert.equal(listVersions()[0].nodes, 4, 'and the newest state wins');

  pushVersion(docWith('A', 'B', 'C', 'D'), { now: 200_000 });
  assert.equal(listVersions().length, 2, 'a later edit starts a new entry');
});

test('a forced checkpoint is always kept, and protects the entry before it', () => {
  pushVersion(docWith('A'), { now: 0, label: 'Opened', force: true });
  pushVersion(docWith('A', 'B'), { now: 1_000, label: 'Before generate', force: true });
  pushVersion(docWith('X'), { now: 2_000 });
  const versions = listVersions();
  assert.equal(versions.length, 3);
  assert.deepEqual(versions.map((v) => v.label), ['', 'Before generate', 'Opened']);
});

test('history is capped and keeps the newest entries', () => {
  for (let i = 0; i < MAX_VERSIONS + 10; i++) {
    pushVersion(docWith(`node ${i}`), { now: i * 120_000 });
  }
  const versions = listVersions();
  assert.equal(versions.length, MAX_VERSIONS);
  assert.equal(JSON.parse(versions[0].data).root.children[0].text, `node ${MAX_VERSIONS + 9}`);
});

test('a storage failure never throws', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(saveState({ doc: docWith('A') }), false);
  assert.equal(loadState(), null);
  assert.deepEqual(listVersions(), []);
  assert.doesNotThrow(() => pushVersion(docWith('A')));
  assert.equal(getVersion('nope'), null);
});

test('relative time reads naturally', () => {
  const now = 1_000_000_000;
  assert.equal(relativeTime(now - 600_000, now), '10 min ago');
  assert.equal(relativeTime(now - 1_000, now), 'just now');
  assert.equal(relativeTime(now - 7_200_000, now), '2 hours ago');
  assert.equal(relativeTime(now - 172_800_000, now), '2 days ago');
});
