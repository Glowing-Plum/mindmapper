// Inline node editing: a textarea floated exactly over the node being edited,
// styled to match, so typing feels like editing the node itself.

import { FONT_STACK } from './measure.js';

export function createInlineEditor(host, { onCommit, onCancel, onInput } = {}) {
  const input = document.createElement('textarea');
  input.className = 'inline-editor';
  input.setAttribute('spellcheck', 'false');
  input.style.display = 'none';
  host.append(input);

  let current = null;

  function place(box, viewport) {
    const k = viewport.state.k;
    const topLeft = viewport.toScreen(box.x, box.y);
    const hostRect = host.getBoundingClientRect();
    input.style.left = `${topLeft.x - hostRect.left}px`;
    input.style.top = `${topLeft.y - hostRect.top}px`;
    input.style.width = `${box.w * k}px`;
    input.style.height = `${box.h * k}px`;
    input.style.fontSize = `${box.style.fontSize * k}px`;
    input.style.lineHeight = `${box.lineHeight * k}px`;
    input.style.fontWeight = String(box.style.fontWeight);
    input.style.fontFamily = FONT_STACK;
    input.style.padding = `${(box.h - box.lines.length * box.lineHeight) / 2 * k}px ${box.style.padX * k}px`;
    input.style.borderRadius = `${box.style.radius * k}px`;
    input.style.textAlign = box.isRoot ? 'center' : 'left';
  }

  function open(box, viewport, { selectAll = true } = {}) {
    current = { id: box.id, box, viewport };
    input.value = box.node.text;
    input.style.display = 'block';
    place(box, viewport);
    input.focus();
    if (selectAll) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  }

  function close({ commit = true } = {}) {
    if (!current) return null;
    const { id } = current;
    const value = input.value.trim();
    current = null;
    input.style.display = 'none';
    input.blur();
    if (commit) onCommit?.(id, value);
    else onCancel?.(id);
    return id;
  }

  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // the canvas shortcuts must not fire while typing
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      close({ commit: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close({ commit: false });
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const id = close({ commit: true });
      if (id) onInput?.('tab', id);
    }
  });

  input.addEventListener('blur', () => close({ commit: true }));
  input.addEventListener('input', () => onInput?.('typing', current?.id, input.value));

  return {
    open,
    close,
    reposition: () => current && place(current.box, current.viewport),
    isOpen: () => current !== null,
    editingId: () => current?.id ?? null,
    element: input,
  };
}
