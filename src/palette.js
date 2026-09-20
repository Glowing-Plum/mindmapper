// Colour lives in the connectors, the way Whimsical does it: one hue per
// top-level branch, inherited down the branch, with the text left near-black so
// it stays the most legible thing on the canvas.
export const BRANCH_COLORS = [
  { name: 'Blue', stroke: '#2f80ed' },
  { name: 'Magenta', stroke: '#c94fc9' },
  { name: 'Emerald', stroke: '#12a06f' },
  { name: 'Amber', stroke: '#e0910a' },
  { name: 'Rose', stroke: '#e5484d' },
  { name: 'Violet', stroke: '#8b5cf6' },
  { name: 'Teal', stroke: '#0e9cb5' },
  { name: 'Lime', stroke: '#67a80e' },
];

export function branchColor(index) {
  const { length } = BRANCH_COLORS;
  return BRANCH_COLORS[((index % length) + length) % length];
}

// Text highlights. The values are CSS custom properties so each theme can pick
// a tint that keeps dark text readable.
export const HIGHLIGHTS = [
  { id: 'yellow', name: 'Yellow', var: '--hl-yellow' },
  { id: 'green', name: 'Green', var: '--hl-green' },
  { id: 'blue', name: 'Blue', var: '--hl-blue' },
  { id: 'pink', name: 'Pink', var: '--hl-pink' },
];

export function highlightVar(id) {
  return HIGHLIGHTS.find((entry) => entry.id === id)?.var ?? null;
}
