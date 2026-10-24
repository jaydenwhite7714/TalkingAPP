// Context / dropdown menus and anchored popovers
import { el, clamp, focusQuiet } from '../util.js';
import { icon } from '../icons.js';

const root = () => document.getElementById('menuRoot');
let activeMenu = null;

/**
 * @param {object} opts
 * @param {{label?:string, icon?:string, danger?:boolean, disabled?:boolean, onClick?:Function, sep?:boolean, key?:string, type?:'item'|'sep'|'label'}[]} opts.items
 * @param {MouseEvent|{x:number,y:number}|HTMLElement} opts.at
 */
export function openMenu(opts = {}) {
  closeMenu();
  const { items = [], at = null, align = 'start', anchorRect = null, minWidth = 196, className = '' } = opts;
  const menu = el('div', { class: `menu ${className}`.trim(), role: 'menu', style: { minWidth: `${minWidth}px` } });

  for (const item of items) {
    if (!item) continue;
    if (item.type === 'sep' || item.sep) {
      menu.append(el('div', { class: 'menu-sep' }));
      continue;
    }
    if (item.type === 'label') {
      menu.append(el('div', { class: 'menu-label', text: item.label }));
      continue;
    }
    const btn = el('button', {
      class: `menu-item${item.danger ? ' danger' : ''}`,
      type: 'button',
      role: 'menuitem',
      disabled: item.disabled || false,
      onclick: (e) => {
        e.stopPropagation();
        if (item.disabled) return;
        closeMenu();
        item.onClick?.(e);
      },
    },
      item.icon ? icon(item.icon, 17) : null,
      el('span', { class: 'mi-label', text: item.label }),
      item.key ? el('span', { class: 'mi-key', text: item.key }) : null,
    );
    menu.append(btn);
  }

  root().append(menu);
  positionMenu(menu, at, align, anchorRect);
  activeMenu = menu;
  requestAnimationFrame(() => {
    menu.addEventListener('mousedown', (e) => e.stopPropagation());
    const first = menu.querySelector('.menu-item:not([disabled])');
    if (first) focusQuiet(first);
  });
  setTimeout(() => {
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeMenu, { once: true });
    window.addEventListener('scroll', (e) => { if (!menu.contains(e.target)) closeMenu(); }, { capture: true, once: true });
  }, 0);

  return menu;
}

function positionMenu(menu, at, align = 'start', anchorRect = null) {
  const pad = 8;
  let x = 0, y = 0;
  let rect = anchorRect;
  if (at instanceof HTMLElement) rect = at.getBoundingClientRect();
  else if (at && typeof at.x === 'number') {
    x = at.x; y = at.y;
  }
  if (rect) {
    x = align === 'end' ? rect.right - menu.offsetWidth : rect.left;
    y = rect.bottom + 6;
  }
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  x = clamp(x, pad, window.innerWidth - mw - pad);
  if (y + mh > window.innerHeight - pad) {
    y = rect ? Math.max(pad, rect.top - mh - 6) : window.innerHeight - mh - pad;
  }
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
}

function onDocDown(e) {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
}
function onKey(e) {
  if (!activeMenu) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeMenu();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = Array.from(activeMenu.querySelectorAll('.menu-item:not([disabled])'));
  const i = items.indexOf(document.activeElement);
  const next = e.key === 'ArrowDown' ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length];
  next?.focus();
}

export function closeMenu() {
  if (!activeMenu) return;
  activeMenu.remove();
  activeMenu = null;
  document.removeEventListener('pointerdown', onDocDown, true);
  document.removeEventListener('keydown', onKey, true);
}

/* ------------------------------ popovers -------------------------------- */

let activePopover = null;

/**
 * Anchored popover. position: prefer above if there is no space below.
 */
export function openPopover({ content, anchor, placement = 'auto', offset = 8, className = '', onClose = null, closeOnScroll = true }) {
  closePopover();
  const node = el('div', { class: `popover ${className}`.trim() });
  node.append(content);
  document.getElementById('popoverRoot').append(node);
  place(node, anchor, placement, offset);
  activePopover = { node, onClose, anchor };

  const onDown = (e) => {
    if (node.contains(e.target) || (anchor instanceof Element && anchor.contains(e.target))) return;
    if (e.target.closest?.('.popover, .menu, .emoji-picker')) return;
    closePopover();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } };
  const onScroll = (e) => {
    if (!closeOnScroll) return;
    if (node.contains(e.target)) return;
    closePopover();
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closePopover, { once: true });
    document.addEventListener('scroll', onScroll, true);
  }, 0);

  activePopover.cleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', onScroll, true);
  };
  return node;
}

function place(node, anchor, placement, offset) {
  const pad = 10;
  const a = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  let x, y;
  let p = placement;
  if (p === 'auto') p = a.top - h - offset > pad ? 'top' : 'bottom';
  if (p === 'top') {
    y = a.top - h - offset;
    x = clamp(a.left, pad, window.innerWidth - w - pad);
  } else if (p === 'bottom') {
    y = a.bottom + offset;
    x = clamp(a.left + a.width / 2 - w / 2, pad, window.innerWidth - w - pad);
  } else if (p === 'right') {
    x = a.right + offset;
    y = clamp(a.top, pad, window.innerHeight - h - pad);
  } else {
    x = clamp(a.left - w - offset, pad, window.innerWidth - w - pad);
    y = clamp(a.top, pad, window.innerHeight - h - pad);
  }
  y = clamp(y, pad, window.innerHeight - h - pad);
  x = clamp(x, pad, window.innerWidth - w - pad);
  node.style.left = `${Math.round(x)}px`;
  node.style.top = `${Math.round(y)}px`;
}

export function closePopover() {
  if (!activePopover) return;
  const { node, cleanup, onClose } = activePopover;
  activePopover = null;
  cleanup?.();
  node.remove();
  onClose?.();
}

export function isPopoverOpen() {
  return Boolean(activePopover);
}
