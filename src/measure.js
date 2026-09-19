// Text measurement + greedy word wrapping. Layout depends on this, so it is
// kept free of DOM requirements: without a canvas it falls back to a metric
// estimate, which lets the layout engine run (and be tested) in Node.

export const FONT_STACK =
  'Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

// Per-depth typography. Depth 0 is the root, 1 the main branches, 2+ the rest.
export const NODE_STYLES = [
  { fontSize: 17, fontWeight: 600, maxWidth: 260, padX: 18, padY: 12, minHeight: 44, radius: 14 },
  { fontSize: 15, fontWeight: 600, maxWidth: 230, padX: 15, padY: 10, minHeight: 38, radius: 11 },
  { fontSize: 14, fontWeight: 500, maxWidth: 210, padX: 13, padY: 9, minHeight: 34, radius: 9 },
];

export function styleForDepth(depth) {
  return NODE_STYLES[Math.min(depth, NODE_STYLES.length - 1)];
}

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
    const key = `${style.fontSize}|${style.fontWeight}|${style.maxWidth}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const widthOf = (s) => {
      if (!ctx) return estimateWidth(s, style.fontSize, style.fontWeight);
      ctx.font = `${style.fontWeight} ${style.fontSize}px ${FONT_STACK}`;
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
