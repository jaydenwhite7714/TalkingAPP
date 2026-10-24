// Modal system with a stack, focus trap and escape handling
import { el, focusQuiet } from '../util.js';
import { icon } from '../icons.js';

const stack = [];

function focusables(root) {
  return Array.from(
    root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ).filter((n) => n.offsetParent !== null || n.getClientRects().length);
}

function onKeydown(e) {
  const top = stack.at(-1);
  if (!top) return;
  if (e.key === 'Escape' && top.dismissible) {
    e.preventDefault();
    e.stopPropagation();
    top.close();
    return;
  }
  if (e.key !== 'Tab') return;
  const f = focusables(top.root);
  if (!f.length) return;
  const first = f[0];
  const last = f.at(-1);
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {Node|string} [opts.content]
 * @param {Node} [opts.footer]
 * @param {'wide'|'xwide'|''} [opts.size]
 * @param {string} [opts.icon] icon name for header
 * @param {boolean} [opts.dismissible]
 * @param {string} [opts.className]
 * @param {() => void} [opts.onClose]
 * @param {boolean} [opts.hideClose]
 * @param {boolean} [opts.hero] use hero header style
 */
export function openModal(opts = {}) {
  const {
    title = '', subtitle = '', content = null, footer = null, size = '', icon: iconName = null,
    dismissible = true, className = '', onClose = null, hideClose = false, headless = false, hero,
  } = opts;

  const previousFocus = document.activeElement;
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', {
    class: `modal ${size} ${className}`.trim(),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || 'Dialog',
    tabindex: '-1',
  });

  let closeBtn = null;
  if (!headless) {
    const useHero = hero ?? Boolean(iconName && subtitle);
    const head = el('div', { class: `modal-head${useHero ? ' modal-hero' : ''}` },
      iconName ? el('div', { class: 'modal-icon' }, icon(iconName, 24)) : null,
      el('h2', { text: title }),
      subtitle ? el('p', { text: subtitle }) : null,
    );
    if (!hideClose) {
      closeBtn = el('button', {
        class: 'icon-btn modal-close',
        type: 'button',
        'aria-label': 'Close',
        onclick: () => close(),
      }, icon('close', 18));
      head.append(closeBtn);
    }
    modal.append(head);
  }

  const body = el('div', { class: 'modal-body' });
  if (content != null) body.append(content);
  modal.append(body);
  if (footer) modal.append(footer);
  backdrop.append(modal);
  document.getElementById('modalRoot').append(backdrop);

  function close(result) {
    const i = stack.findIndex((s) => s.root === modal);
    if (i === -1) return;
    stack.splice(i, 1);
    backdrop.remove();
    if (!stack.length) document.removeEventListener('keydown', onKeydown, true);
    if (previousFocus && previousFocus.isConnected) focusQuiet(previousFocus);
    onClose?.(result);
  }

  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && dismissible) close();
  });

  const entry = { root: modal, backdrop, body, close, dismissible, opts };
  stack.push(entry);
  if (stack.length === 1) document.addEventListener('keydown', onKeydown, true);

  requestAnimationFrame(() => {
    const auto = modal.querySelector('[autofocus]');
    const f = auto || focusables(modal)[0];
    if (f && !opts.noAutofocus) focusQuiet(f);
  });

  return { ...entry, modal, footer };
}

export function closeAllModals() {
  while (stack.length) stack.at(-1).close();
}

export function closeTopModal() {
  stack.at(-1)?.close();
}

export function isModalOpen() {
  return stack.length > 0;
}

export function confirmDialog({
  title = 'Are you sure?',
  body = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  icon: iconName = null,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    const footer = el('div', { class: 'modal-foot' },
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { done(false); ref.close(); } }, cancelLabel),
      el('button', {
        class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
        type: 'button',
        onclick: () => { done(true); ref.close(); },
      }, confirmLabel),
    );

    const content = el('div', { class: 'modal-body pad' });
    if (typeof body === 'string' && body) content.append(el('p', { class: 'muted', style: { fontSize: '13.5px', lineHeight: '1.55' }, text: body }));
    else if (body) content.append(body);

    const ref = openModal({
      title,
      content: null,
      footer,
      icon: iconName,
      headless: false,
      onClose: () => done(false),
    });
    // replace generated head layout: title + optional icon only
    if (iconName) {
      const head = ref.modal.querySelector('.modal-head');
      head.classList.add('modal-hero');
    }
    ref.modal.querySelector('.modal-body')?.replaceWith(content);
    requestAnimationFrame(() => ref.modal.querySelector('.btn-primary, .btn-danger')?.focus({ preventScroll: true }));
  });
}

export function alertDialog({ title = 'Heads up', body = '', okLabel = 'Got it', icon: iconName = null } = {}) {
  return new Promise((resolve) => {
    const footer = el('div', { class: 'modal-foot' },
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => ref.close() }, okLabel),
    );
    const content = el('div', { class: 'modal-body pad' });
    content.append(typeof body === 'string' ? el('p', { text: body, style: { fontSize: '13.5px', lineHeight: '1.55', color: 'var(--text-2)' } }) : body);
    const ref = openModal({ title, content, footer, icon: iconName, onClose: () => resolve() });
  });
}

/** A single-line text prompt. Resolves with the string or null. */
export function promptDialog({ title = 'Enter a value', label = '', value = '', placeholder = '', confirmLabel = 'Save', maxlength = 100, hint = '' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const input = el('input', { class: 'input', value, placeholder, maxlength, autofocus: true });
    const wrap = el('div', { class: 'modal-body pad' },
      el('label', { class: 'form-group' },
        label ? el('span', { class: 'form-label', text: label }) : null,
        input,
        hint ? el('div', { class: 'form-help', text: hint }) : null,
      ),
    );
    const submit = () => { done(input.value.trim()); ref.close(); };
    const footer = el('div', { class: 'modal-foot' },
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { done(null); ref.close(); } }, 'Cancel'),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, confirmLabel),
    );
    const ref = openModal({ title, content: wrap, footer, onClose: () => done(null) });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}
