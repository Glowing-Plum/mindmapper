// Inline editing: a textarea floated exactly over whatever is being edited --
// a node's text or a label on a connector -- styled to match, so typing feels
// like editing the thing itself.

import { FONT_STACK, createMeasurer } from './measure.js';

// The same measurements the layout uses, so a card is the size while you type
// that it will be once you stop.
const measure = createMeasurer();

// The editor's focus ring, from the stylesheet. Boxes are border-box, so it
// would otherwise eat into the space the text needs and clip the last line.
const BORDER = 2;

/**
 * How big the box needs to be for `value`: wider as you type, up to the same
 * maximum the layout wraps at, then taller as the text wraps.
 */
function sizeFor(target, value) {
  if (!target.grows) return { w: target.w, h: target.h, lines: 1 };
  const metrics = measure(value || ' ', {
    fontSize: target.fontSize,
    fontWeight: target.fontWeight,
    italic: target.italic,
    maxWidth: target.maxWidth,
  });
  // A couple of pixels of slack: sized to the measurement exactly, the
  // browser's own wrapping can disagree by a sub-pixel and break the line,
  // leaving text clipped in a box built for one line.
  const width = Math.max(target.minWidth, Math.min(metrics.width + 3, target.maxWidth));
  return {
    w: Math.round(width + target.padX * 2),
    h: Math.round(Math.max(target.minHeight, metrics.lines.length * target.lineHeight + target.padYStyle * 2)),
    lines: metrics.lines.length,
  };
}

/**
 * A target describes the world-space box to edit:
 * { id, kind: 'node' | 'label', x, y, w, h, fontSize, fontWeight, italic,
 *   lineHeight, padX, padY, radius, align, text }
 */
export function createInlineEditor(host, { onCommit, onCancel, onChord, onResize } = {}) {
  const input = document.createElement('textarea');
  input.className = 'inline-editor';
  input.setAttribute('spellcheck', 'false');
  input.style.display = 'none';
  host.append(input);

  let current = null;

  // True while an input method is mid-syllable. Typing Korean, Japanese or
  // Chinese goes through an IME: keystrokes build up a syllable that is not
  // yet text, and the browser marks them `isComposing`. A key pressed then
  // belongs to the IME, not to us.
  let composing = false;

  function place(target, viewport) {
    const k = viewport.state.k;
    const { w, h, lines } = sizeFor(target, input.value);

    // Grow away from the side the card is anchored on, so the text you are
    // typing stays put: rightwards on the right of the map, leftwards on the
    // left, and outwards from the middle for the root.
    const anchor = target.side === -1 ? 1 : target.align === 'center' ? 0.5 : 0;
    const x = target.x - (w - target.w) * anchor;
    const y = target.y - (h - target.h) / 2; // stays vertically centred

    const topLeft = viewport.toScreen(x, y);
    const hostRect = host.getBoundingClientRect();
    // Centre the text in the box the same way the map does.
    const padY = target.grows ? (h - lines * target.lineHeight) / 2 : target.padY;
    Object.assign(input.style, {
      // Offset by the ring so the text still lines up with the map's own.
      left: `${topLeft.x - hostRect.left - BORDER}px`,
      top: `${topLeft.y - hostRect.top - BORDER}px`,
      width: `${w * k + BORDER * 2}px`,
      height: `${h * k + BORDER * 2}px`,
      fontSize: `${target.fontSize * k}px`,
      lineHeight: `${target.lineHeight * k}px`,
      fontWeight: String(target.fontWeight),
      fontStyle: target.italic ? 'italic' : 'normal',
      fontFamily: FONT_STACK,
      padding: `${Math.max(0, padY) * k}px ${target.padX * k}px`,
      borderRadius: `${(target.radius ?? 6) * k}px`,
      textAlign: target.align ?? 'left',
    });

    // So whatever is drawn around the node can keep up with it.
    onResize?.(target, { x, y, w, h });
  }

  function open(target, viewport, { selectAll = true } = {}) {
    current = { target, viewport };
    composing = false;
    input.value = target.text ?? '';
    input.dataset.kind = target.kind;
    input.style.display = 'block';
    place(target, viewport);
    input.focus();
    if (selectAll) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  }

  function close({ commit = true } = {}) {
    if (!current) return null;
    const { target } = current;
    const value = input.value.trim();
    current = null;
    input.style.display = 'none';
    input.blur();
    onResize?.(target, null);
    if (commit) onCommit?.(target, value);
    else onCancel?.(target);
    return target;
  }

  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // canvas shortcuts must not fire while typing

    // Let the IME have its keystroke. Acting on it would commit the card and
    // move the focus away while a syllable is still half-formed -- and the
    // IME, finishing a moment later, would put that syllable into whatever
    // has the focus by then, which is how the last word ended up repeated in
    // the card after it. keyCode 229 is the older way browsers said the same
    // thing, and the flag covers engines that report it late.
    if (composing || event.isComposing || event.keyCode === 229) {
      // Tab would still move the focus out of the editor by default, closing
      // the card mid-syllable. Stay put: the syllable lands, and the next Tab
      // -- no longer part of a composition -- makes the card.
      if (event.key === 'Tab') event.preventDefault();
      return;
    }

    const mod = event.ctrlKey || event.metaKey;
    if (mod && ['b', 'i', 'h'].includes(event.key.toLowerCase())) {
      // Formatting shortcuts still apply to the node being edited.
      event.preventDefault();
      onChord?.(event.key.toLowerCase(), current?.target ?? null);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      close({ commit: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close({ commit: false });
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const target = close({ commit: true });
      if (target) onChord?.('tab', target);
    }
  });

  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => {
    composing = false;
    // The finished syllable changes the width, and the resize below is
    // skipped for the input events that carried the composition.
    if (current) place(current.target, current.viewport);
  });

  // Resize as you type rather than scrolling inside a box fixed at the size
  // the text used to be.
  input.addEventListener('input', () => {
    if (current) place(current.target, current.viewport);
  });

  input.addEventListener('blur', () => {
    // Closing mid-syllable would hand the IME a textarea that is no longer
    // there; the composition is left to finish and the blur that follows it
    // does the closing.
    composing = false;
    close({ commit: true });
  });

  return {
    open,
    close,
    reposition: () => current && place(current.target, current.viewport),
    isOpen: () => current !== null,
    editing: () => current?.target ?? null,
    element: input,
  };
}
