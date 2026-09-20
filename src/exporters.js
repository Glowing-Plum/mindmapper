// Export: standalone SVG, PNG, JSON and markdown. The SVG is rebuilt from the
// live scene with the theme's colours resolved to literals, so the file looks
// right anywhere -- not just inside this page.

import { FONT_STACK } from './measure.js';
import { toOutline } from './parser.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function cssVars(names) {
  const styles = getComputedStyle(document.documentElement);
  const out = {};
  for (const name of names) out[name] = styles.getPropertyValue(name).trim();
  return out;
}

function exportStylesheet() {
  const v = cssVars([
    '--surface', '--root-bg', '--root-text', '--text', '--text-soft', '--canvas-bg',
    '--hl-yellow', '--hl-green', '--hl-blue', '--hl-pink',
  ]);
  return `
    :root {
      --hl-yellow: ${v['--hl-yellow']};
      --hl-green: ${v['--hl-green']};
      --hl-blue: ${v['--hl-blue']};
      --hl-pink: ${v['--hl-pink']};
    }
    text { font-family: ${FONT_STACK}; }
    .node-hit { fill: none; stroke: none; }
    .node-card { fill: ${v['--surface']}; stroke: none; }
    .node-text { fill: ${v['--text']}; }
    .node.is-root .node-text { fill: ${v['--text']}; }
    .node-badge { display: none; }
    .node.is-collapsed .node-badge { display: inline; }
    .node-badge-circle { fill: ${v['--surface']}; stroke: var(--badge-color); stroke-width: 1.5; }
    .node-badge-text { fill: var(--badge-color); font-size: 11px; font-weight: 600; text-anchor: middle; }
    .edge { fill: none; stroke-linecap: round; }
    .edge-hit { display: none; }
    .edge-label-bg { fill: ${v['--canvas-bg']}; stroke: none; }
    /* fill comes from the element's own style: each label matches its line */
    .edge-label-text { font-size: 12px; font-weight: 500; text-anchor: middle; }
  `;
}

/** Builds a standalone SVG document string for the current map. */
export function toSvgString(renderer, bounds, { background = true } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', `${Math.round(bounds.x)} ${Math.round(bounds.y)} ${Math.round(bounds.width)} ${Math.round(bounds.height)}`);
  svg.setAttribute('width', Math.round(bounds.width));
  svg.setAttribute('height', Math.round(bounds.height));

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = exportStylesheet();
  svg.append(style);

  if (background) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', bounds.x);
    rect.setAttribute('y', bounds.y);
    rect.setAttribute('width', bounds.width);
    rect.setAttribute('height', bounds.height);
    rect.setAttribute('fill', cssVars(['--canvas-bg'])['--canvas-bg'] || '#ffffff');
    svg.append(rect);
  }

  const scene = renderer.scene.cloneNode(true);
  scene.removeAttribute('transform');
  for (const el of scene.querySelectorAll('.layer-overlay, .inline-editor, .edge-hit')) el.remove();
  for (const el of scene.querySelectorAll('.node')) {
    el.classList.remove('is-selected', 'is-editing', 'is-drop-target', 'is-dragging', 'is-entering');
  }
  svg.append(scene);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

/** Rasterises the SVG string to a PNG blob at `scale`x resolution. */
export async function toPngBlob(svgString, bounds, scale = 2) {
  const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bounds.width * scale));
    canvas.height = Math.max(1, Math.round(bounds.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not rasterise the map'));
    image.src = src;
  });
}

export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(text, fallback = 'mindmap') {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

export function markdownFor(root) {
  return `${toOutline(root)}\n`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    return ok;
  }
}
