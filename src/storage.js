// Local persistence: the live document plus a rolling version history, so a
// bad edit, an accidental "New map" or a regenerate is always recoverable --
// not just by undo, which dies with the tab.
//
// Best-effort throughout: private-mode browsers can refuse localStorage, and a
// failed save must never break editing.

const KEY = 'mindmapper:v1';
const HISTORY_KEY = 'mindmapper:history:v1';
export const MAX_VERSIONS = 30;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function saveState(state) {
  return write(KEY, state);
}

export function loadState() {
  return read(KEY);
}

export function clearState() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function listVersions() {
  const history = read(HISTORY_KEY);
  return Array.isArray(history) ? history : [];
}

/**
 * Records a version. Identical consecutive documents are skipped, and a run of
 * small edits collapses into the newest entry rather than filling the history:
 * a version is only kept apart from the previous one if `minGapMs` has passed
 * or the map changed substantially.
 *
 * @param {object} docJSON  serialised document
 * @param {{label?: string, force?: boolean, minGapMs?: number, now?: number}} [options]
 */
export function pushVersion(docJSON, { label = '', force = false, minGapMs = 60_000, now = Date.now() } = {}) {
  const serialised = JSON.stringify(docJSON);
  const versions = listVersions();
  const previous = versions[0];
  if (previous?.data === serialised) return versions;

  const entry = {
    id: `v${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: now,
    label,
    nodes: countNodes(docJSON?.root),
    data: serialised,
  };

  // Collapse rapid edits into one entry unless this version is worth keeping
  // on its own (a labelled checkpoint, or the first one after a quiet spell).
  const recent = previous && now - previous.at < minGapMs;
  const next = recent && !force && !previous.label ? [entry, ...versions.slice(1)] : [entry, ...versions];
  const trimmed = next.slice(0, MAX_VERSIONS);
  write(HISTORY_KEY, trimmed);
  return trimmed;
}

export function getVersion(id) {
  const entry = listVersions().find((version) => version.id === id);
  if (!entry) return null;
  try {
    return JSON.parse(entry.data);
  } catch {
    return null;
  }
}

export function clearVersions() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

function countNodes(node) {
  if (!node) return 0;
  return 1 + (node.children ?? []).reduce((total, child) => total + countNodes(child), 0);
}

/** "just now", "12 min ago", "3 hours ago", then a date. */
export function relativeTime(timestamp, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(timestamp).toLocaleDateString();
}
