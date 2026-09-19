// Inline editing: a textarea floated exactly over whatever is being edited --
// a node's text or a label on a connector -- styled to match, so typing feels
// like editing the thing itself.

import { FONT_STACK } from './measure.js';

/**
 * A target describes the world-space box to edit:
 * { id, kind: 'node' | 'label', x, y, w, h, fontSize, fontWeight, italic,
 *   lineHeight, padX, padY, radius, align, text }
 */
export function createInlineEditor(host, { onCommit, onCancel, onChord } = {}) {
  const input = document.createElement('textarea');
  input.className = 'inline-editor';
  input.setAttribute('spellcheck', 'false');
  input.style.display = 'none';
  host.append(input);

  let current = null;

  function place(target, viewport) {
    const k = viewport.state.k;
    const topLeft = viewport.toScreen(target.x, target.y);
    const hostRect = host.getBoundingClientRect();
    Object.assign(input.style, {
      left: `${topLeft.x - hostRect.left}px`,
      top: `${topLeft.y - hostRect.top}px`,
      width: `${target.w * k}px`,
      height: `${target.h * k}px`,
      fontSize: `${target.fontSize * k}px`,
      lineHeight: `${target.lineHeight * k}px`,
      fontWeight: String(target.fontWeight),
      fontStyle: target.italic ? 'italic' : 'normal',
      fontFamily: FONT_STACK,
      padding: `${target.padY * k}px ${target.padX * k}px`,
      borderRadius: `${(target.radius ?? 6) * k}px`,
      textAlign: target.align ?? 'left',
    });
  }

  function open(target, viewport, { selectAll = true } = {}) {
    current = { target, viewport };
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
    if (commit) onCommit?.(target, value);
    else onCancel?.(target);
    return target;
  }

  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // canvas shortcuts must not fire while typing
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

  input.addEventListener('blur', () => close({ commit: true }));

  return {
    open,
    close,
    reposition: () => current && place(current.target, current.viewport),
    isOpen: () => current !== null,
    editing: () => current?.target ?? null,
    element: input,
  };
}
