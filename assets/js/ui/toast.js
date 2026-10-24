// Toasts
import { el } from '../util.js';
import { icon } from '../icons.js';

const icons = { info: 'info', ok: 'check', success: 'check', error: 'warning', warn: 'warning', warning: 'warning', party: 'party' };

export function toast(message, kind = 'info', opts = {}) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const { duration = 3200, action = null } = opts;
  const node = el('div', { class: `toast toast-${kind}`, role: 'status' },
    icon(icons[kind] || 'info', 17),
    el('span', { class: 'toast-msg', text: message }),
  );
  if (action) {
    node.append(el('button', {
      class: 'toast-action',
      type: 'button',
      onclick: () => { action.onClick?.(); dismiss(); },
    }, action.label));
  }
  root.append(node);
  const existing = Array.from(root.children);
  if (existing.length > 4) existing[0].remove();

  let timer = setTimeout(dismiss, duration);
  function dismiss() {
    clearTimeout(timer);
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 1200); });
  return dismiss;
}
