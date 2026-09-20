// Pan and zoom over the SVG scene: wheel/trackpad, drag, pinch, and the
// programmatic moves the toolbar and keyboard shortcuts need.

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;

export function createViewport(svg, scene, { onChange } = {}) {
  const state = { x: 0, y: 0, k: 1 };
  const pointers = new Map();
  let panning = null;
  let pinch = null;

  function apply() {
    scene.setAttribute('transform', `translate(${state.x}, ${state.y}) scale(${state.k})`);
    onChange?.(state);
  }

  function clamp(k) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
  }

  function clientToLocal(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  /** Screen point (client coords) -> world coords. */
  function toWorld(clientX, clientY) {
    const local = clientToLocal(clientX, clientY);
    return { x: (local.x - state.x) / state.k, y: (local.y - state.y) / state.k };
  }

  /** World point -> client coords. */
  function toScreen(x, y) {
    const rect = svg.getBoundingClientRect();
    return { x: x * state.k + state.x + rect.left, y: y * state.k + state.y + rect.top };
  }

  function zoomAround(factor, clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const cx = clientX ?? rect.left + rect.width / 2;
    const cy = clientY ?? rect.top + rect.height / 2;
    const before = toWorld(cx, cy);
    state.k = clamp(state.k * factor);
    const local = clientToLocal(cx, cy);
    state.x = local.x - before.x * state.k;
    state.y = local.y - before.y * state.k;
    apply();
  }

  function setZoom(k, clientX, clientY) {
    zoomAround(clamp(k) / state.k, clientX, clientY);
  }

  function panBy(dx, dy) {
    state.x += dx;
    state.y += dy;
    apply();
  }

  /**
   * Fits `bounds` (a world rect) into the viewport. `minZoom` keeps the result
   * legible: when a map is too big to fit at that scale, the view centres on
   * `focus` (usually the root) instead of shrinking further.
   */
  function fit(bounds, { padding = 24, maxZoom = 1.15, minZoom = 0, focus = null, animate = true } = {}) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height || !bounds) return;
    const ideal = Math.min(
      (rect.width - padding * 2) / bounds.width,
      (rect.height - padding * 2) / bounds.height,
      maxZoom,
    );
    const k = clamp(Math.max(ideal, minZoom));
    const centre = k > ideal + 1e-6 && focus
      ? { x: focus.cx ?? focus.x, y: focus.cy ?? focus.y }
      : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const target = {
      k,
      x: rect.width / 2 - centre.x * k,
      y: rect.height / 2 - centre.y * k,
    };
    if (animate) {
      animateTo(target);
    } else {
      Object.assign(state, target);
      apply();
    }
  }

  /** Scrolls a world-space rect into view with a little breathing room. */
  function ensureVisible(box, margin = 60) {
    const rect = svg.getBoundingClientRect();
    const left = box.x * state.k + state.x;
    const top = box.y * state.k + state.y;
    const right = left + box.w * state.k;
    const bottom = top + box.h * state.k;
    let dx = 0;
    let dy = 0;
    if (left < margin) dx = margin - left;
    else if (right > rect.width - margin) dx = rect.width - margin - right;
    if (top < margin) dy = margin - top;
    else if (bottom > rect.height - margin) dy = rect.height - margin - bottom;
    if (dx || dy) animateTo({ x: state.x + dx, y: state.y + dy, k: state.k });
  }

  let animation = null;
  function animateTo(target, duration = 260) {
    if (animation) cancelAnimationFrame(animation);
    const from = { ...state };
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      state.x = from.x + (target.x - from.x) * eased;
      state.y = from.y + (target.y - from.y) * eased;
      state.k = from.k + (target.k - from.k) * eased;
      apply();
      if (t < 1) animation = requestAnimationFrame(step);
      else animation = null;
    };
    animation = requestAnimationFrame(step);
  }

  // -- input ---------------------------------------------------------------

  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomAround(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
      } else {
        const scale = event.deltaMode === 1 ? 16 : 1; // line vs pixel deltas
        panBy(-event.deltaX * scale, -event.deltaY * scale);
      }
    },
    { passive: false },
  );

  function beginPan(event) {
    // Pending until the pointer actually moves: capturing straight away would
    // swallow the second half of a double-click on a line or a label.
    panning = { x: event.clientX, y: event.clientY, active: false, pointerId: event.pointerId };
  }

  function activatePan() {
    panning.active = true;
    svg.classList.add('is-panning');
    if (panning.pointerId !== undefined) {
      try {
        svg.setPointerCapture(panning.pointerId);
      } catch {
        /* the pointer may already be gone */
      }
    }
  }

  svg.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, event);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), k: state.k };
      panning = null;
      return;
    }
    const onEmptySpace = !event.target.closest('.node');
    const wantsPan = event.button === 1 || (event.button === 0 && onEmptySpace);
    if (wantsPan) beginPan(event);
  });

  svg.addEventListener('pointermove', (event) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, event);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      setZoom((pinch.k * distance) / pinch.distance, midX, midY);
      return;
    }
    if (!panning) return;
    const dx = event.clientX - panning.x;
    const dy = event.clientY - panning.y;
    if (!panning.active) {
      if (Math.hypot(dx, dy) < 3) return; // still a click, not a drag
      activatePan();
    }
    panBy(dx, dy);
    panning.x = event.clientX;
    panning.y = event.clientY;
  });

  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (panning) {
      panning = null;
      svg.classList.remove('is-panning');
      if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    }
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('pointerleave', endPointer);

  apply();

  return {
    state,
    apply,
    toWorld,
    toScreen,
    zoomAround,
    setZoom,
    panBy,
    fit,
    ensureVisible,
    animateTo,
    beginPan,
  };
}
