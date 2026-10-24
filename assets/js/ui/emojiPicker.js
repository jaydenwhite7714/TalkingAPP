// Emoji picker popover
import { el, debounce } from '../util.js';
import { icon } from '../icons.js';
import { EMOJI_CATEGORIES, readRecentEmojis, pushRecentEmoji, searchEmojis } from '../emojis.js';
import { openPopover, closePopover } from './menu.js';

export function openEmojiPicker({ anchor, onPick, placement = 'top' }) {
  const recent = readRecentEmojis();
  let category = recent.length ? 'recent' : 'smileys';

  const searchInput = el('input', {
    class: 'input input-search',
    placeholder: 'Search emoji',
    'aria-label': 'Search emoji',
    autocomplete: 'off',
  });
  const tabs = el('div', { class: 'ep-tabs', role: 'tablist' });
  const scroll = el('div', { class: 'ep-scroll' });
  const node = el('div', { class: 'emoji-picker' },
    el('div', { class: 'ep-search' }, el('div', { class: 'input-search-wrap' }, icon('search', 15), searchInput)),
    tabs,
    scroll,
    el('div', { class: 'ep-footer' }, icon('info', 13), el('span', { text: 'Type :name: for emoji anywhere' })),
  );

  const cats = [
    { id: 'recent', icon: '🕘', name: 'Recently used' },
    ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, icon: c.icon, name: c.name })),
  ];

  function renderTabs() {
    tabs.replaceChildren(
      ...cats.map((c) => el('button', {
        class: `ep-tab${c.id === category && !searchInput.value ? ' is-active' : ''}`,
        type: 'button',
        role: 'tab',
        title: c.name,
        'aria-label': c.name,
        onclick: () => {
          category = c.id;
          searchInput.value = '';
          renderTabs();
          renderGrid();
        },
      }, c.icon)),
    );
  }

  function cell(char, code) {
    const b = el('button', {
      class: 'ep-cell',
      type: 'button',
      'aria-label': code || char,
      title: code ? `:${code}:` : char,
      onclick: () => {
        onPick?.(char);
        pushRecentEmoji(char);
      },
    }, char);
    return b;
  }

  function group(label, emojis) {
    if (!emojis.length) return null;
    const frag = document.createDocumentFragment();
    frag.append(el('div', { class: 'ep-cat-label', text: label }));
    const grid = el('div', { class: 'ep-grid' });
    for (const e of emojis) grid.append(cell(e.char, e.codes?.[0]));
    frag.append(grid);
    return frag;
  }

  function renderGrid() {
    scroll.replaceChildren();
    const q = searchInput.value.trim();
    if (q) {
      const results = searchEmojis(q);
      if (!results.length) {
        scroll.append(el('div', { class: 'ep-empty' }, 'No emoji matches that search.'));
        return;
      }
      scroll.append(group(`Results (${results.length})`, results));
      scroll.scrollTop = 0;
      return;
    }
    if (category === 'recent') {
      const list = readRecentEmojis().map((char) => ({ char, codes: [] }));
      if (!list.length) scroll.append(el('div', { class: 'ep-empty' }, 'No recent emoji yet — pick one below.'));
      else scroll.append(group('Recently used', list));
      for (const c of EMOJI_CATEGORIES) scroll.append(group(c.name, c.emojis.map((e) => ({ char: e[0], codes: e.slice(1) }))));
    } else {
      const c = EMOJI_CATEGORIES.find((x) => x.id === category) || EMOJI_CATEGORIES[0];
      const recentList = readRecentEmojis().map((char) => ({ char, codes: [] }));
      if (recentList.length) scroll.append(group('Recently used', recentList.slice(0, 9)));
      scroll.append(group(c.name, c.emojis.map((e) => ({ char: e[0], codes: e.slice(1) }))));
    }
    scroll.scrollTop = 0;
  }

  searchInput.addEventListener('input', debounce(renderGrid, 90));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = scroll.querySelector('.ep-cell');
      if (first) { first.click(); e.preventDefault(); }
    }
  });

  openPopover({ content: node, anchor, placement, className: 'emoji-popover', closeOnScroll: false });
  renderTabs();
  renderGrid();
  setTimeout(() => searchInput.focus({ preventScroll: true }), 40);
  return node;
}

export { closePopover };
