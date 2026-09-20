// Talk timing.
//
// A talk has a length, and the point of an outline is knowing whether you can
// actually deliver it in that time. Minutes can be set on any node; a parent
// with no time of its own inherits the sum of its children, so you can plan
// top-down ("10 minutes for this section") or bottom-up, or mix the two.
//
// Pure and DOM-free.

/**
 * Minutes for a subtree.
 *
 * An explicit time on a node wins: it is what you have decided that section
 * will take, regardless of how its children add up. Otherwise the node's time
 * is the sum of its children.
 *
 * @returns {{total: number, own: number|null, children: number}}
 */
export function rollup(node) {
  const children = node.children.reduce((sum, child) => sum + rollup(child).total, 0);
  const own = Number.isFinite(node.minutes) && node.minutes > 0 ? node.minutes : null;
  return { total: own ?? children, own, children };
}

/** Rollup for every node in a tree, keyed by id. */
export function rollupAll(root) {
  const table = new Map();
  const visit = (node) => {
    const children = node.children.reduce((sum, child) => sum + visit(child), 0);
    const own = Number.isFinite(node.minutes) && node.minutes > 0 ? node.minutes : null;
    const total = own ?? children;
    table.set(node.id, { total, own, children });
    return total;
  };
  visit(root);
  return table;
}

/**
 * How the plan compares with the time you have.
 * @param {object} root
 * @param {number} target minutes available, 0 for "no target"
 */
export function summarise(root, target = 0) {
  const total = rollup(root).total;
  const timed = countTimed(root);
  const over = target > 0 ? total - target : 0;
  return {
    total,
    target,
    over,
    timed,
    // Being a little under is normal and fine; a quarter under means the
    // talk does not fill its slot yet.
    status: target <= 0
      ? 'untargeted'
      : over > 0
        ? 'over'
        : over < -Math.max(2, target * 0.25) ? 'short' : 'ok',
  };
}

function countTimed(node) {
  const own = Number.isFinite(node.minutes) && node.minutes > 0 ? 1 : 0;
  return own + node.children.reduce((sum, child) => sum + countTimed(child), 0);
}

/** "4 min", "1 h 05", "—". Kept short: it sits next to the text on the map. */
export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const rounded = Math.round(minutes * 10) / 10;
  if (rounded < 60) return `${trimZero(rounded)} min`;
  const hours = Math.floor(rounded / 60);
  const rest = Math.round(rounded % 60);
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

function trimZero(value) {
  return String(Number(value.toFixed(1)));
}

/** A compact form for the chip on a node: "4m", "12m", "1h05". */
export function formatChip(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const rounded = Math.round(minutes * 10) / 10;
  if (rounded < 60) return `${trimZero(rounded)}m`;
  const hours = Math.floor(rounded / 60);
  const rest = Math.round(rounded % 60);
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}
