// Branch colours. Each top-level branch claims one and its descendants inherit
// it, which is what gives a Whimsical map its "rivers of colour" look.
export const BRANCH_COLORS = [
  { name: 'Indigo', stroke: '#6366f1' },
  { name: 'Emerald', stroke: '#10b981' },
  { name: 'Amber', stroke: '#f59e0b' },
  { name: 'Rose', stroke: '#f43f5e' },
  { name: 'Violet', stroke: '#a855f7' },
  { name: 'Sky', stroke: '#0ea5e9' },
  { name: 'Lime', stroke: '#65a30d' },
  { name: 'Orange', stroke: '#fb923c' },
];

export function branchColor(index) {
  return BRANCH_COLORS[((index % BRANCH_COLORS.length) + BRANCH_COLORS.length) % BRANCH_COLORS.length];
}
