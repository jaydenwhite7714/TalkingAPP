// TalkingApp — small, safe markdown-ish renderer for chat messages.
import { escapeHtml } from './util.js';
import { shortcodeToEmoji } from './emojis.js';

const SAFE_PROTO = /^(https?:\/\/|mailto:)/i;

function safeUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return null;
  if (/^javascript:/i.test(url) || /^data:/i.test(url)) return null;
  if (SAFE_PROTO.test(url)) return url;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) return 'https://' + url;
  return null;
}

export function linkify(rawUrl, label) {
  const href = safeUrl(rawUrl);
  if (!href) return escapeHtml(label ?? rawUrl);
  const text = escapeHtml(label ?? rawUrl);
  return `<a class="msg-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
}

const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|\uFE0F|\u200D|\s){1,12}$/u;

export function isEmojiOnly(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 24) return false;
  if (!EMOJI_ONLY_RE.test(t)) return false;
  const count = [...t.replace(/\s/g, '')].filter((c) => /\p{Extended_Pictographic}/u.test(c)).length;
  return count >= 1 && count <= 6;
}

/**
 * Render message content to HTML.
 * @param {string} raw
 * @param {{allowMarkdown?: boolean}} opts
 */
export function renderContent(raw, opts = {}) {
  const { allowMarkdown = true } = opts;
  let s = String(raw ?? '');
  const slots = [];
  const stash = (html) => `\u0001${slots.push(html) - 1}\u0001`;

  // 1. escape everything first
  s = escapeHtml(s);

  // 2. code fences
  s = s.replace(/```([a-z0-9+#-]*)\n?([\s\S]*?)```/gi, (_, lang, code) => {
    const clean = code.replace(/\n$/, '');
    const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    return stash(`<div class="codeblock">${langLabel}<pre><code>${clean}</code></pre></div>`);
  });

  // 3. inline code
  s = s.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code class="inline-code">${code}</code>`));

  // 4. markdown links [label](url)
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, url) => stash(linkify(decodeEntities(url), label)));

  // 5. bare urls
  s = s.replace(/\b(https?:\/\/[^\s<>"']+[^\s<>"'.,!?;:)\]}])/gi, (m) => stash(linkify(m, m)));
  // bare domains
  s = s.replace(/(^|[\s(])((?:www\.)?[a-z0-9-]+(?:\.[a-z]{2,})+[^\s<>"']*[^\s<>"'.,!?;:)\]}])/gi, (m, pre, url) => {
    if (/@$/.test(pre)) return m;
    return pre + stash(linkify(url, url));
  });

  // 6. EMOJI shortcodes
  s = s.replace(/:([a-z0-9_+-]{2,32}):/gi, (m, code) => {
    const e = shortcodeToEmoji(code.toLowerCase());
    return e ? stash(`<span class="emoji" role="img" aria-label="${escapeHtml(code)}">${e}</span>`) : m;
  });

  // 7. mentions & channel refs
  s = s.replace(/(^|[\s(])@([a-z0-9._-]{2,20})/gi, (m, pre, handle) =>
    pre + stash(`<span class="mention" data-mention="${escapeHtml(handle.toLowerCase())}">@${escapeHtml(handle)}</span>`));
  s = s.replace(/(^|[\s(])#([a-z0-9_-]{1,28})/gi, (m, pre, name) =>
    pre + stash(`<span class="channel-ref" data-channel="${escapeHtml(name.toLowerCase())}">#${escapeHtml(name)}</span>`));

  if (allowMarkdown) {
    // 8. inline formatting (repeat to allow simple nesting)
    for (let i = 0; i < 2; i++) {
      s = s
        .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/__([^_\n]+)__/g, '<u>$1</u>')
        .replace(/(^|[^\w_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
        .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    }
  }

  // 9. spoilers
  s = s.replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler" tabindex="0" role="button" aria-label="Spoiler">$1</span>');

  // 10. blockquotes (line-leading &gt;)
  s = s.replace(/(?:^|\n)((?:&gt; ?[^\n]*(?:\n|$))+)/g, (m) => {
    const inner = m
      .replace(/^\n/, '')
      .split('\n')
      .filter((l) => l.startsWith('&gt;'))
      .map((l) => l.replace(/^&gt; ?/, ''))
      .join('\n');
    if (!inner.trim()) return m;
    return `\n${stash(`<blockquote class="msg-quote">${inner}</blockquote>`)}\n`;
  });

  // 11. restore stashed html
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => slots[Number(i)] ?? '');

  // 12. newlines
  s = s.replace(/\n/g, '<br />');
  // tidy: collapse <br> right before/after block elements
  s = s.replace(/<br \/>(\s*<(?:div class="codeblock"|blockquote))/g, '$1').replace(/(<\/(?:div|blockquote)>)<br \/>/g, '$1');

  // 13. unicode emoji sizing
  if (isEmojiOnly(raw)) s = `<span class="jumbo">${s}</span>`;

  return s;
}

function decodeEntities(str = '') {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Short plain-text preview of a message (for replies, search, notifications). */
export function plainPreview(raw, max = 90) {
  let s = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~|]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
