// Tiny synchronous event bus
const listeners = new Map();

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => bus.off(event, fn);
  },
  off(event, fn) {
    listeners.get(event)?.delete(fn);
  },
  once(event, fn) {
    const off = bus.on(event, (...args) => {
      off();
      fn(...args);
    });
    return off;
  },
  emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] handler for "${event}" failed`, err);
      }
    }
  },
};
