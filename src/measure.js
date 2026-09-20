// Text measurement + greedy word wrapping. Layout depends on this, so it is
// kept free of DOM requirements: without a canvas it falls back to a metric
// estimate, which lets the layout engine run (and be tested) in Node.

export const FONT_STACK =
  'Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

// Per-depth typography. Depth 0 is the root -- the one node drawn as a card.
// Everything below it is bare text, so its padding is really just the gap
// between the connector and the first letter, plus a comfortable hit area.
const BASE_NODE_STYLES = [
  { fontSize: 19, fontWeight: 600, maxWidth: 280, padX: 16, padY: 9, minHeight: 38, radius: 10 },
  { fontSize: 14.5, fontWeight: 500, maxWidth: 260, padX: 9, padY: 4, minHeight: 23, radius: 6 },
];

/**
 * A fingertip is far blunter than a cursor, so on touch devices the invisible
 * hit area around each node grows. The text is untouched -- only the padding.
 */
function usesCoarsePointer() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export const NODE_STYLES = usesCoarsePointer()
  ? BASE_NODE_STYLES.map((style) => ({
    ...style,
    padX: style.padX + 3,
    padY: style.padY + 5,
    minHeight: Math.max(style.minHeight, 40),
  }))
  : BASE_NODE_STYLES;

export function styleForDepth(depth) {
  return NODE_STYLES[Math.min(depth, NODE_STYLES.length - 1)];
}

/** Folds a node's own formatting into its depth style. */
export function styleForNode(node, depth) {
  const base = styleForDepth(depth);
  if (!node?.bold && !node?.italic) return base;
  return {
    ...base,
    fontWeight: node.bold ? 700 : base.fontWeight,
    italic: Boolean(node.italic),
  };
}

export const EDGE_LABEL_STYLE = { fontSize: 12, fontWeight: 500, maxWidth: 190, padX: 6, padY: 3 };

export function lineHeightFor(style) {
  return Math.round(style.fontSize * 1.35);
}

const NARROW = new Set([...'ijltfrI.,;:!|\'"`()[]{}-']);
const WIDE = new Set([...'mwMW@%']);

// Rough advance width, good to a few percent for latin text at these sizes.
function estimateWidth(text, fontSize, fontWeight) {
  let units = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) units += 1;        // CJK and friends are square
    else if (NARROW.has(ch)) units += 0.32;
    else if (WIDE.has(ch)) units += 0.92;
    else if (ch >= 'A' && ch <= 'Z') units += 0.66;
    else if (ch === ' ') units += 0.28;
    else units += 0.53;
  }
  return units * fontSize * (fontWeight >= 600 ? 1.03 : 1);
}

/**
 * @returns {(text: string, style: object) => {width:number, height:number, lines:string[]}}
 */
export function createMeasurer() {
  let ctx = null;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  }
  const cache = new Map();

  return function measure(text, style) {
    const key = `${style.fontSize}|${style.fontWeight}|${style.italic ? 'i' : ''}|${style.maxWidth}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const widthOf = (s) => {
      if (!ctx) return estimateWidth(s, style.fontSize, style.fontWeight);
      ctx.font = `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${FONT_STACK}`;
      return ctx.measureText(s).width;
    };

    const lines = wrapText(text, style.maxWidth, widthOf);
    const result = {
      width: Math.max(...lines.map(widthOf), 1),
      height: lines.length * lineHeightFor(style),
      lines,
    };
    if (cache.size > 4000) cache.clear();
    cache.set(key, result);
    return result;
  };
}

export function wrapText(text, maxWidth, widthOf) {
  const paragraphs = String(text ?? '').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && widthOf(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
      // A single word wider than the box: break it on character boundaries.
      while (widthOf(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && widthOf(line.slice(0, cut)) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}
