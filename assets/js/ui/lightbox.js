// Full-screen image viewer
import { el } from '../util.js';
import { icon } from '../icons.js';

export function openLightbox(src, alt = '') {
  if (!src) return;
  const box = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image viewer' });
  const img = el('img', { src, alt });
  const close = el('button', { class: 'lightbox-close', type: 'button', 'aria-label': 'Close image' }, icon('close', 20));
  box.append(img, close);
  const root = document.getElementById('lightboxRoot');
  root.append(box);
  const onKey = (e) => { if (e.key === 'Escape') done(); };
  function done() {
    document.removeEventListener('keydown', onKey, true);
    box.remove();
  }
  close.addEventListener('click', done);
  box.addEventListener('click', (e) => { if (e.target === box || e.target === img) done(); });
  document.addEventListener('keydown', onKey, true);
}
