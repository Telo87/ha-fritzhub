/* FritzHub – single page app (no build step, no external dependencies) */
(() => {
  'use strict';

  // ------------------------------------------------------------------ utils
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  // Re-render without jumping: automatic refreshes replace the page content,
  // which can briefly shorten the document and reset the scroll position.
  function keepScroll(fn) {
    const el = document.scrollingElement || document.documentElement;
    const top = el.scrollTop;
    fn();
    if (el.scrollTop !== top) el.scrollTop = top;
  }
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // DOM morphing: periodic refreshes only touch what actually changed, so hover
  // states, focus, tooltips and running animations survive. Children are matched
  // by data-key / id, otherwise by position. Elements marked data-keep are left
  // alone (their content is managed elsewhere, e.g. the chart). An element whose
  // data-flash value changes lights up briefly (device goes online …).
  const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || n.id || null : null);
  function flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
    clearTimeout(el._flashT);
    el._flashT = setTimeout(() => el.classList.remove('flash'), 1600);
  }
  function morphNode(a, b) {
    if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    if (a.hasAttribute('data-keep') && b.hasAttribute('data-keep')) return;
    const changed = a.hasAttribute('data-flash') && b.hasAttribute('data-flash') && a.getAttribute('data-flash') !== b.getAttribute('data-flash');
    // while the page fades in, keep the stagger delay (style="--i") – removing it
    // would restart the running animation and make the element jump
    const keepI = a.style && a.closest('.page-in') ? a.style.getPropertyValue('--i') : '';
    Array.from(a.attributes).forEach((at) => { if (!b.hasAttribute(at.name) && !(at.name === 'style' && keepI)) a.removeAttribute(at.name); });
    Array.from(b.attributes).forEach((at) => { if (a.getAttribute(at.name) !== at.value && !(at.name === 'style' && keepI)) a.setAttribute(at.name, at.value); });
    if (keepI && b.hasAttribute('style')) { a.setAttribute('style', b.getAttribute('style')); a.style.setProperty('--i', keepI); }
    if (a.tagName === 'INPUT') {
      if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
      else if (a !== document.activeElement && a.value !== (b.getAttribute('value') || '')) a.value = b.getAttribute('value') || '';
    }
    if (a.tagName !== 'TEXTAREA') morphChildren(a, b);
    if (changed) flash(a);
  }
  function morphChildren(cur, next) {
    const keyed = new Map();
    Array.from(cur.childNodes).forEach((n) => { const k = keyOf(n); if (k) keyed.set(k, n); });
    const list = Array.from(next.childNodes);
    list.forEach((nb, i) => {
      const k = keyOf(nb);
      let na = k ? keyed.get(k) : cur.childNodes[i];
      if (na && k) keyed.delete(k);
      if (na && (na.nodeType !== nb.nodeType || na.nodeName !== nb.nodeName || (!k && keyOf(na)))) na = null;
      if (!na) { cur.insertBefore(nb, cur.childNodes[i] || null); return; }
      if (na !== cur.childNodes[i]) cur.insertBefore(na, cur.childNodes[i] || null);
      morphNode(na, nb);
    });
    while (cur.childNodes.length > list.length) cur.lastChild.remove();
  }
  function morph(target, html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    morphChildren(target, tpl.content);
    animateCounts(target);
  }
  // first draw after the loading skeleton: replace (so the page fades in), later: morph
  function render(el, html) {
    if (!el.firstElementChild || el.querySelector(':scope > .card > .card-body > .skeleton')) { el.innerHTML = html; animateCounts(el); } else morph(el, html);
  }
  // one listener per element and event; redraws only swap the handler
  function on(el, type, fn) {
    if (!el) return;
    el._on = el._on || {};
    if (!el._on[type]) el.addEventListener(type, (e) => el._on[type](e));
    el._on[type] = fn;
  }

  // Numbers count up/down to their new value: <span data-count=key …>
  const counts = new Map();
  function cnt(key, text, unit = '') {
    const s = String(text);
    if (!/^-?[\d.]+(,\d+)?$/.test(s)) return esc(s);
    const dec = (s.split(',')[1] || '').length;
    const val = Number(s.replace(/\./g, '').replace(',', '.'));
    return `<span data-count="${esc(key)}" data-val="${val}" data-dec="${dec}" data-unit="${esc(unit)}">${s}</span>`;
  }
  function animateCounts(root) {
    root.querySelectorAll('[data-count]').forEach((el) => {
      const key = el.dataset.count; const to = Number(el.dataset.val); const dec = Number(el.dataset.dec); const unit = el.dataset.unit;
      const prev = counts.get(key);
      counts.set(key, { v: to, unit });
      const from = prev ? (prev.unit === unit ? prev.v : to) : 0;
      if (el._anim) cancelAnimationFrame(el._anim);
      if (from === to || reducedMotion()) return;
      const fmt = (v) => nf(v, dec);
      const t0 = performance.now(); const dur = prev ? 600 : 800;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur); const e = 1 - (1 - p) ** 3;
        el.textContent = fmt(from + (to - from) * e);
        el._anim = p < 1 ? requestAnimationFrame(step) : null;
      };
      el.textContent = fmt(from);
      el._anim = requestAnimationFrame(step);
    });
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fritzhub.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fritzhub.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const P = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    devices: '<rect x="2" y="4" width="14" height="11" rx="2"/><path d="M5.5 19h7M9 15v4"/><rect x="17" y="8" width="5" height="12" rx="1.5"/>',
    topology: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.2 5.4M12 11.5l5.2 5.4"/>',
    wifi: '<path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
    wifiOff: '<path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/><path d="M3 3l18 18"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    voicemail: '<circle cx="6" cy="12" r="4"/><circle cx="18" cy="12" r="4"/><path d="M6 16h12"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3"/>',
    archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    router: '<rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 17h.01M10 17h.01M14.5 17h3.5M6.5 13 5 5M17.5 13 19 5"/>',
    repeater: '<rect x="7" y="3" width="10" height="18" rx="3"/><path d="M9.8 8.2a3 3 0 0 1 4.4 0"/><path d="M12 11.5h.01"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    radar: '<path d="M19.1 4.9A10 10 0 1 0 22 12"/><path d="M16.2 7.8A6 6 0 1 0 18 12"/><path d="M12 12l7-7"/><circle cx="12" cy="12" r="1.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M4 21h16"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    arrowDown: '<path d="M12 4v16M6 14l6 6 6-6"/>',
    arrowUp: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    callIn: '<path d="M17 3 11 9M11 4v5h5"/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    callOut: '<path d="m12 8 6-6M13 2h5v5"/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    callMissed: '<path d="m12 2 6 6M18 2l-6 6"/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3M16 7l3 3M14 9l2 2"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    ethernet: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 9v2M12 9v2M16 9v2M12 16v5"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    external: '<path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    forward: '<path d="m15 5 6 6-6 6"/><path d="M21 11H9a6 6 0 0 0-6 6v2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-4-6.3"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    smartphone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    laptop: '<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
    tv: '<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8"/>',
    speaker: '<rect x="5" y="2" width="14" height="20" rx="2.5"/><circle cx="12" cy="14" r="3.5"/><path d="M12 6.5h.01"/>',
    printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    gamepad: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4M15 11h.01M18 13h.01"/>',
    server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 9.5V20h14V9.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  };
  const ic = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;

  // ------------------------------------------------------------- formatting
  function fmtBytes(b) {
    if (b == null) return '–';
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0; let v = Number(b);
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i += 1; }
    return `${nf(v, i === 0 ? 0 : v < 10 ? 2 : 1)} ${u[i]}`;
  }
  function fmtBits(bps, digits) {
    if (bps == null) return '–';
    const u = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s'];
    let i = 0; let v = Number(bps);
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i += 1; }
    return `${nf(v, digits ?? (v < 10 && i > 0 ? 1 : 0))} ${u[i]}`;
  }
  const fmtKbit = (k) => (k == null ? '–' : fmtBits(k * 1000));
  function fmtUptime(s) {
    if (s == null) return '–';
    const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
    if (d) return `${d} T ${h} Std`;
    if (h) return `${h} Std ${m} Min`;
    return `${m} Min`;
  }
  function parseFritzDate(s) {
    const m = /^(\d{2})\.(\d{2})\.(\d{2,4}) (\d{2}):(\d{2})/.exec(s || '');
    if (!m) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(y, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
  }
  function fmtCallDuration(s) {
    const m = /^(\d+):(\d{2})$/.exec(s || '');
    if (!m) return s || '';
    const min = Number(m[1]) * 60 + Number(m[2]);
    if (min === 0) return '< 1 Min';
    return min >= 60 ? `${Math.floor(min / 60)} Std ${min % 60} Min` : `${min} Min`;
  }
  function dayLabel(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / 86400000);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Gestern';
    return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: diff > 300 ? 'numeric' : undefined });
  }
  const fmtTime = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  function fmtAgo(ts) {
    const s = Date.now() / 1000 - ts;
    if (s < 90) return 'gerade eben';
    if (s < 3600) return `vor ${Math.round(s / 60)} Min`;
    if (s < 86400) return `vor ${Math.round(s / 3600)} Std`;
    const d = Math.round(s / 86400);
    if (d === 1) return 'gestern';
    if (d < 60) return `vor ${d} Tagen`;
    return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  const fmtDateTime = (ts) => new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const ago = (ts) => {
    if (!ts) return '';
    const s = Math.round(Date.now() / 1000 - ts);
    return s < 5 ? 'gerade eben' : s < 60 ? `vor ${s} s` : `vor ${Math.round(s / 60)} Min`;
  };

  // -------------------------------------------------------------------- api
  // Direct access (own port): the session token is kept in localStorage and sent
  // as header – cookies are often blocked when FritzHub is embedded in an iframe
  // (dashboard webpage card). Plain links (audio, downloads) carry it as ?t=.
  const authToken = () => {
    const t = store.get('token', null);
    if (t) return t;
    try { return JSON.parse(sessionStorage.getItem('fritzhub.token')); } catch { return null; }
  };
  const withToken = (url) => (authToken() ? `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(authToken())}` : url);
  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (authToken()) init.headers['X-FritzHub-Token'] = authToken();
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try { res = await fetch('api/' + path, init); } catch (e) { throw new Error('Keine Verbindung zum Add-on.'); }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (res.status === 401 && data && data.login) { showLogin(); throw new Error('Bitte anmelden.'); }
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data.data;
  }

  // Login screen for direct access
  function showLogin(msg = '') {
    if ($('#login')) return;
    S.cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    S.cleanup = [];
    store.set('token', null);
    $('#app').classList.add('hidden');
    const el = document.createElement('div');
    el.id = 'login';
    el.className = 'login-screen';
    el.innerHTML = `<form class="card login-card" autocomplete="on">
        <div class="login-brand"><img src="static/favicon.svg" alt=""><div><div class="brand-name">FritzHub</div><div class="faint" style="font-size:12.5px">Direktzugriff</div></div></div>
        <div class="field"><label for="lgUser">Benutzername</label><input class="input" id="lgUser" name="username" autocomplete="username" autocapitalize="none" required></div>
        <div class="field"><label for="lgPass">Passwort</label><input class="input" id="lgPass" name="password" type="password" autocomplete="current-password" required></div>
        <label class="check" style="margin:2px 0 16px"><input type="checkbox" id="lgRemember" checked>Angemeldet bleiben</label>
        <div class="notice err ${msg ? '' : 'hidden'}" id="lgErr" style="margin-bottom:14px">${ic('alert')}<div>${esc(msg)}</div></div>
        <button class="btn primary" style="width:100%" type="submit">Anmelden</button>
        <p class="faint" style="font-size:12px;margin:14px 0 0;text-align:center">Zugangsdaten stehen in den Add-on-Optionen von FritzHub.</p>
      </form>`;
    document.body.appendChild(el);
    const form = el.querySelector('form');
    const err = (m) => { const n = $('#lgErr'); n.classList.remove('hidden'); n.querySelector('div').textContent = m; };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const res = await fetch('api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: $('#lgUser').value.trim(), password: $('#lgPass').value, remember: $('#lgRemember').checked }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.ok) { err((data && data.error) || `HTTP ${res.status}`); $('#lgPass').select(); return; }
        // "remember": token survives closing the browser; otherwise only this tab
        if ($('#lgRemember').checked) store.set('token', data.data.token);
        else { store.set('token', null); try { sessionStorage.setItem('fritzhub.token', JSON.stringify(data.data.token)); } catch { /* ignore */ } }
        location.reload();
      } catch { err('Keine Verbindung zum Add-on.'); } finally { btn.disabled = false; }
    });
    $('#lgUser').focus();
  }

  async function logout() {
    try { await api('logout', { method: 'POST' }); } catch { /* ignore */ }
    store.set('token', null);
    try { sessionStorage.removeItem('fritzhub.token'); } catch { /* ignore */ }
    location.reload();
  }

  // -------------------------------------------------------------- UI pieces
  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${ic(type === 'err' ? 'alert' : type === 'info' ? 'info' : 'checkCircle')}<div>${esc(msg)}</div>`;
    // the check mark draws itself
    if (type === 'ok') el.querySelectorAll('svg path').forEach((p) => p.setAttribute('pathLength', '1'));
    $('#toasts').appendChild(el);
    const hide = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), reducedMotion() ? 0 : 220); };
    const t = setTimeout(hide, type === 'err' ? 7000 : 3500);
    el.addEventListener('click', () => { clearTimeout(t); hide(); });
  }

  function modal({ title, body, foot = '', wide = false, cls = '', onMount, onClose }) {
    const root = document.createElement('div');
    root.className = 'modal-back';
    root.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Schließen">${ic('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
    const close = () => {
      if (!root.isConnected || root.classList.contains('closing')) return;
      root.classList.add('closing'); document.removeEventListener('keydown', onKey);
      setTimeout(() => root.remove(), reducedMotion() ? 0 : 170);
      if (onClose) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    $('#modalRoot').appendChild(root);
    const m = root.querySelector('.modal');
    if (onMount) onMount(m, close);
    const first = m.querySelector('input:not([type=hidden]), select, textarea');
    if (first) first.focus();
    return close;
  }

  function confirmDialog(title, text, { ok = 'Bestätigen', danger = false } = {}) {
    return new Promise((resolve) => {
      let result = false;
      modal({
        title,
        body: `<p class="muted" style="margin:0 0 6px">${text}</p>`,
        foot: `<button class="btn" data-close>Abbrechen</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(ok)}</button>`,
        onMount(m, closeFn) {
          m.querySelector('[data-ok]').addEventListener('click', () => { result = true; closeFn(); });
          m.querySelector('[data-ok]').focus();
        },
        onClose: () => resolve(result),
      });
    });
  }

  async function withBusy(btn, fn) {
    const old = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; const svg = btn.querySelector('svg'); if (svg) svg.classList.add('spin'); }
    try { return await fn(); } finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = old; } }
  }

  const sw = (checked, attrs = '', disabled = false) => `<label class="switch"><input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} ${attrs}><span></span></label>`;
  const empty = (icon, title, text, action = '') => `<div class="empty"><div class="avatar accent">${ic(icon)}</div><h3>${esc(title)}</h3><p>${text}</p>${action}</div>`;
  const errorBox = (msg) => `<div class="notice err">${ic('alert')}<div>${esc(msg)}</div></div>`;
  const loading = (rows = 4) => `<div class="card"><div class="card-body">${Array.from({ length: rows }, () => '<div class="skeleton" style="height:18px;margin:10px 0"></div>').join('')}</div></div>`;

  function deviceIcon(h) {
    const n = `${h.name || ''} ${h.model || ''} ${h.vendor || ''}`.toLowerCase();
    if (/fritz.*(repeater|box|powerline)|repeater|router|mesh/.test(n)) return 'repeater';
    if (/iphone|android|galaxy|pixel|handy|phone|redmi|xiaomi|oneplus|huawei|nokia|moto/.test(n)) return 'smartphone';
    if (/ipad|tab|kindle/.test(n)) return 'smartphone';
    if (/macbook|laptop|notebook|thinkpad|surface|book/.test(n)) return 'laptop';
    if (/tv|fire|chromecast|roku|apple-?tv|shield|bravia|webos|tizen|receiver/.test(n)) return 'tv';
    if (/sonos|echo|alexa|speaker|homepod|nest|google-?home|audio/.test(n)) return 'speaker';
    if (/print|drucker|epson|brother|canon|hp[-_ ]/.test(n)) return 'printer';
    if (/playstation|ps[45]|xbox|switch|nintendo/.test(n)) return 'gamepad';
    if (/nas|synology|qnap|server|pi|raspberry|homeassistant|hassio|proxmox/.test(n)) return 'server';
    if (/esp|shelly|tasmota|tuya|hue|bulb|plug|sensor|zigbee|tado|wled|dect|sonoff/.test(n)) return 'chip';
    if (/pc|desktop|win|imac/.test(n)) return 'devices';
    return (h.interface || '').includes('802.11') ? 'smartphone' : 'devices';
  }
  // WLAN uplink of a repeater / mesh client ------------------------------------
  const mbit = (v) => (v ? fmtBits(v * 1e6) : '–');
  // LAN links between FRITZ! devices should run at 1 Gbit/s or more
  const LAN_MIN = 1000;
  const lanSlow = (u) => !!u && u.type === 'lan' && !!u.speed && u.speed < LAN_MIN;
  const uplinkClass = (u) => (!u ? '' : u.type === 'lan' ? (lanSlow(u) ? 'warn' : '') : signalClass(u.signal));
  const LAN_CAUSES = 'Häufige Ursachen: ein Kabel mit nur 4 statt 8 Adern oder einer beschädigten Ader, ein alter Switch bzw. eine Netzwerkdose mit nur 100 Mbit/s, oder ein LAN-Anschluss im Energiesparmodus „Green Mode“ (FRITZ!Box: Heimnetz › Netzwerk › Netzwerkeinstellungen › LAN-Einstellungen).';
  function lanNotice() {
    const slow = boxes().filter((b) => b.online && lanSlow(b.uplink));
    if (!slow.length) return '';
    return `<div class="notice" style="margin-top:16px">${ic('alert')}<div><b>Langsame LAN-Anbindung:</b> ${slow.map((b) => `${esc(boxName(b))} mit ${mbit(b.uplink.speed)}${b.uplink.parent ? ` zu ${esc(b.uplink.parent)}` : ''}`).join(', ')}. Zwischen FRITZ!-Geräten sind mindestens 1 Gbit/s üblich – alle Geräte dahinter sind entsprechend ausgebremst. ${LAN_CAUSES}</div></div>`;
  }
  function uplinkSummary(b) {
    if (b.uplink && b.uplink.type === 'lan') {
      const u = b.uplink;
      return `<span class="row nowrap" style="gap:6px;display:inline-flex">${ic(lanSlow(u) ? 'alert' : 'ethernet')}<span>LAN${u.speed ? ` · ${mbit(u.speed)}` : ''}</span></span>`;
    }
    if (b.uplink) {
      const u = b.uplink;
      return `<span class="row nowrap" style="gap:6px;display:inline-flex">${signalBars(u.signal, false)}<span>${esc(u.band || 'WLAN')} · ${u.signal} % · ${mbit(u.speed_tx)}</span></span>`;
    }
    return b.uplink_known ? `<span class="row nowrap" style="gap:6px;display:inline-flex">${ic('ethernet')}<span>LAN</span></span>` : '';
  }
  function sparkline(hist, idx, cls) {
    const pts = (hist || []).filter((h) => h[idx] != null);
    if (pts.length < 2) return '<div class="faint" style="font-size:12px">Verlauf wird gesammelt …</div>';
    const W = 300; const H = 44; const t0 = pts[0][0]; const t1 = pts[pts.length - 1][0];
    const max = idx === 1 ? 100 : Math.max(...pts.map((p) => p[idx])) * 1.1 || 1;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(((p[0] - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)},${(H - (p[idx] / max) * (H - 4) - 2).toFixed(1)}`).join('');
    return `<svg class="spark ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
  }
  function uplinkDetail(n) {
    const u = n.uplink;
    if (!u) return '';
    if (u.type === 'lan') {
      return `<div class="list-group">LAN-Anbindung</div><div class="card-body" style="padding-top:10px"><dl class="kv">
          <dt>Geschwindigkeit</dt><dd${lanSlow(u) ? ' style="color:var(--warn)"' : ''}>${u.speed ? mbit(u.speed) : 'unbekannt'}</dd>
          ${u.max && u.max !== u.speed ? `<dt>Max. möglich</dt><dd>${mbit(u.max)}</dd>` : ''}
          ${u.parent ? `<dt>Verbunden mit</dt><dd>${esc(u.parent)}</dd>` : ''}
        </dl>${lanSlow(u) ? `<div class="notice" style="margin-top:10px;font-size:12.5px">${ic('alert')}<div>Nur ${mbit(u.speed)} – zwischen FRITZ!-Geräten sind mindestens 1 Gbit/s üblich. ${LAN_CAUSES}</div></div>` : ''}</div>`;
    }
    const hist = n.uplink_history || [];
    const sig = hist.map((h) => h[1]).filter((v) => v != null);
    const minSig = sig.length ? Math.min(...sig) : null;
    const cls = signalClass(u.signal);
    const warn = u.signal < WEAK_SIGNAL
      ? `<div class="notice err" style="margin-top:10px;font-size:12.5px">${ic('alert')}<div>Schwache Anbindung – alle Geräte an diesem Repeater sind dadurch langsamer. Abhilfe: Repeater näher an ${esc(n.parentName || 'den Mesh Master')} stellen oder per LAN anbinden.</div></div>` : '';
    return `<div class="list-group">WLAN-Anbindung</div><div class="card-body" style="padding-top:10px">
      <dl class="kv">
        <dt>Signal</dt><dd><span class="row" style="gap:6px;justify-content:flex-end">${signalBars(u.signal)}</span></dd>
        <dt>Senden</dt><dd>${mbit(u.speed_tx)} <span class="faint">/ max ${mbit(u.max_tx)}</span></dd>
        <dt>Empfangen</dt><dd>${mbit(u.speed_rx)} <span class="faint">/ max ${mbit(u.max_rx)}</span></dd>
        <dt>Band</dt><dd>${esc(u.band || '–')}${u.channel ? ` · Kanal ${u.channel}` : ''}${u.width ? ` · ${u.width} MHz` : ''}</dd>
        ${u.standard ? `<dt>Standard</dt><dd>802.11${esc(u.standard)}</dd>` : ''}
        ${(u.links || []).length > 1 ? `<dt>Multi-Link (MLO)</dt><dd>${u.links.map((l) => `${esc(l.band)} ${l.signal} %`).join(' + ')}</dd>` : u.mlo ? `<dt>Multi-Link (MLO)</dt><dd>${esc(u.mlo)}</dd>` : ''}
      </dl>
      <div class="spark-head"><span>Signal – letzte Stunde</span>${minSig != null ? `<span class="faint">min. ${minSig} %</span>` : ''}</div>
      ${sparkline(hist, 1, cls)}
      <div class="spark-head"><span>Senderate</span></div>
      ${sparkline(hist, 2, 'rate')}
      ${warn}</div>`;
  }

  // Links to a device's web interface(s): the first is "Web", further ones show their port
  function webBadges(web) {
    return (web || []).map((w, i) => {
      const tip = `${w.title ? `${w.title} – ` : ''}${w.url}${w.login ? ' (Anmeldung erforderlich)' : ''}`;
      return ` <a class="badge weblink" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer" title="Weboberfläche öffnen: ${esc(tip)}" data-stop>${ic(i === 0 ? 'globe' : 'external')}${i === 0 ? 'Web' : `:${w.port}`}</a>`;
    }).join('');
  }
  function webButtons(web) {
    // title plus the address, so several interfaces of one device can be told apart
    return (web || []).map((w) => `<a class="btn sm" style="margin-top:10px;width:100%" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${ic('globe')}${esc(w.title || 'Weboberfläche')}<span class="faint" style="font-weight:400">${esc(w.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}${w.scheme === 'https' ? ' · HTTPS' : ''}</span></a>`).join('');
  }

  // detected for the first time within the last 7 days (not part of the initial inventory)
  const NEW_DAYS = 7;
  const isNew = (h) => !!h.new_since && Date.now() / 1000 - h.new_since < NEW_DAYS * 86400;
  // offline for more than 30 days (or never seen since tracking started 30+ days ago)
  const STALE_DAYS = 30;
  function isStale(h) {
    if (h.active || !S.overview) return false;
    const now = Date.now() / 1000;
    const ref = h.last_seen || S.overview.tracking_since;
    return now - ref > STALE_DAYS * 86400;
  }
  const isWlan = (h) => /802\.11|wlan|wi-?fi/i.test(h.interface || h.link_type || '');

  // WLAN signal strength (percent, as reported by the access point)
  const WEAK_SIGNAL = 40;
  const signalClass = (s) => (s >= 60 ? 'ok' : s >= WEAK_SIGNAL ? 'warn' : 'err');
  function signalBars(s, withValue = true) {
    if (s == null) return '<span class="faint">–</span>';
    const n = s >= 75 ? 4 : s >= 50 ? 3 : s >= 25 ? 2 : 1;
    const bars = [1, 2, 3, 4].map((k) => `<i class="${k <= n ? 'on' : ''}"></i>`).join('');
    return `<span class="sig ${signalClass(s)}" title="Signalstärke ${s} %">${bars}</span>${withValue ? `<span class="sig-v num">${s} %</span>` : ''}`;
  }

  // ------------------------------------------------------------------ state
  const S = {
    overview: null,
    hosts: null,
    topo: null,
    cleanup: [],
    sel: store.get('sel', {}),
  };
  const boxes = () => (S.overview ? S.overview.boxes : []);
  const onlineBoxes = () => boxes().filter((b) => b.online && b.config.enabled);
  const boxName = (b) => b.config.name || (b.info && b.info.model) || b.config.host;
  const boxesWith = (service) => onlineBoxes().filter((b) => b.info && b.info.services && b.info.services[service]);
  const findBox = (id) => boxes().find((b) => b.config.id === id);

  // ---- mesh roles: master / slave (mesh client that takes over the master's settings)
  const isSlave = (i) => (i || {}).mesh_role === 'slave';
  const isMaster = (i) => (i || {}).mesh_role === 'master' || (!(i || {}).mesh_role && (i || {}).is_router);
  function boxAvatar(b) {
    const i = b.info || {};
    const icon = /repeater|powerline/i.test(i.model || '') ? 'repeater' : 'router';
    return `<div class="avatar ${b.online === false ? 'err' : isMaster(i) ? 'accent' : 'wlan'}">${ic(icon)}</div>`;
  }
  function roleBadge(i) {
    if ((i || {}).mesh_role === 'master') return '<span class="badge accent">Mesh Master</span>';
    if (isSlave(i)) return '<span class="badge wlan">Mesh Repeater</span>';
    return '';
  }
  function roleText(i) {
    if ((i || {}).mesh_role === 'master') return 'Mesh Master · Internet';
    if (isSlave(i)) return 'Mesh Repeater';
    return i.is_router ? 'Router / Internet' : 'Repeater';
  }
  function meshNotice(i, what) {
    if (!isSlave(i)) return '';
    const master = i.mesh_master ? ` <b>„${esc(i.mesh_master)}“</b>` : '';
    return `<div class="notice info" style="font-size:12.5px">${ic('info')}<div>Mesh Repeater: ${what} werden vom Mesh Master${master} übernommen. Änderungen bitte dort vornehmen.</div></div>`;
  }

  function mainRouter() {
    const r = onlineBoxes().filter((b) => b.wan);
    return r.find((b) => b.wan.connected) || r[0] || null;
  }

  // ------------------------------------------------------------------ pages
  const PAGES = [
    { id: 'dashboard', title: 'Übersicht', icon: 'grid', section: 'Netzwerk' },
    { id: 'devices', title: 'Geräte', icon: 'devices' },
    { id: 'topology', title: 'Mesh-Topologie', icon: 'topology' },
    { id: 'wlan', title: 'WLAN', icon: 'wifi' },
    { id: 'netcheck', title: 'Netzwerk-Check', icon: 'checkCircle' },
    { id: 'calls', title: 'Anrufe', icon: 'phone', section: 'Telefonie' },
    { id: 'tam', title: 'Anrufbeantworter', icon: 'voicemail' },
    { id: 'nas', title: 'FRITZ!NAS', icon: 'folder', section: 'Speicher' },
    { id: 'system', title: 'System', icon: 'sliders', section: 'Verwaltung' },
    { id: 'settings', title: 'Einstellungen', icon: 'gear' },
  ];

  function renderNav() {
    const cur = currentPage();
    let missed = 0; let msgs = 0;
    boxes().forEach((b) => { if (b.phone) { missed += b.phone.missed_24h || 0; msgs += b.phone.new_messages || 0; } });
    const badge = { calls: missed, tam: msgs };
    $('#nav').innerHTML = PAGES.map((p) => `${p.section ? `<div class="nav-section">${p.section}</div>` : ''}
      <a href="#/${p.id}" class="${p.id === cur ? 'active' : ''}">${ic(p.icon)}<span>${p.title}</span>${badge[p.id] ? `<span class="badge count">${badge[p.id]}</span>` : ''}</a>`).join('');
  }

  function currentPage() {
    const id = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
    return PAGES.some((p) => p.id === id) ? id : 'dashboard';
  }

  // keep = periodic redraw of the same page: buttons stay (listeners via on())
  function setHeader(title, sub = '', actions = '', keep = false) {
    $('#pageTitle').textContent = title;
    morph($('#pageSub'), sub);
    if (keep) morph($('#pageActions'), actions); else $('#pageActions').innerHTML = actions;
  }

  // Page transitions: new content fades/slides in, list items and cards staggered.
  // Triggered when real content (not the loading skeleton) lands in #content.
  const STAGGER = ':scope > .grid > .card, :scope > .grid > a.card, .list > .list-item, tbody > tr, .nc-item, .box-card';
  let pageAnimT = 0;
  function pageIn(content) {
    const skel = content.children.length === 1 && content.querySelector(':scope > .card > .card-body > .skeleton');
    content.classList.remove('page-in');
    void content.offsetWidth;
    $$(STAGGER, content).slice(0, 20).forEach((n, i) => n.style.setProperty('--i', i));
    content.classList.add('page-in');
    clearTimeout(pageAnimT);
    pageAnimT = setTimeout(() => content.classList.remove('page-in'), 1500);
    return !skel;
  }
  function watchPageIn() {
    const content = $('#content');
    new MutationObserver(() => {
      if (!S.pageAnim || !content.firstElementChild) return;
      if (pageIn(content)) S.pageAnim = false;
    }).observe(content, { childList: true });
  }

  function boxSelect(page, list) {
    if (list.length < 2) return '';
    const cur = S.sel[page];
    return `<select class="input" id="boxSel" style="width:auto;min-width:180px">${list.map((b) => `<option value="${b.config.id}" ${b.config.id === cur ? 'selected' : ''}>${esc(boxName(b))}</option>`).join('')}</select>`;
  }
  function selectedBox(page, list) {
    let b = list.find((x) => x.config.id === S.sel[page]);
    if (!b) { b = list[0]; if (b) { S.sel[page] = b.config.id; store.set('sel', S.sel); } }
    return b;
  }
  function bindBoxSelect(page, rerender) {
    const sel = $('#boxSel');
    if (sel) sel.addEventListener('change', () => { S.sel[page] = sel.value; store.set('sel', S.sel); rerender(); });
  }

  let renderToken = 0;
  async function navigate() {
    S.cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    S.cleanup = [];
    renderToken += 1;
    // old links (#/boxes?scan=1 …) now live in the settings
    const legacy = /^#\/?boxes(?:\?(.*))?$/.exec(location.hash);
    if (legacy) history.replaceState(null, '', `#/settings?tab=boxes${legacy[1] ? `&${legacy[1]}` : ''}`);
    const page = currentPage();
    renderNav();
    $('#app').classList.remove('nav-open');
    const content = $('#content');
    S.pageAnim = true;
    counts.clear();              // numbers count up from zero on a fresh page
    S.chartAnimUntil = 0; S.volGrowUntil = null;
    content.innerHTML = '';
    window.scrollTo(0, 0);
    if (!S.overview) {
      setHeader(PAGES.find((p) => p.id === page).title);
      content.innerHTML = loading();
      try { await loadOverview(); } catch (e) { content.innerHTML = errorBox(e.message); return; }
    }
    if (!boxes().length && page !== 'settings') { renderWelcome(); return; }
    const fn = RENDER[page];
    try { await fn(content, renderToken); } catch (e) { content.innerHTML = errorBox(e.message); }
  }
  const stale = (token) => token !== renderToken;

  async function loadOverview(force = false) {
    S.overview = await api(force ? 'refresh' : 'overview', force ? { method: 'POST' } : {});
    renderNav();
    return S.overview;
  }

  // ---------------------------------------------------------------- welcome
  function renderWelcome() {
    setHeader('Willkommen');
    $('#content').innerHTML = `<div class="welcome card">
      <div class="hero"><img src="static/favicon.svg" alt=""><h2>Willkommen bei FritzHub</h2>
      <p>Verbinde deine FRITZ!Box und alle FRITZ!Repeater deines Mesh-Netzes, um Geräte, WLAN, Telefonie und FRITZ!NAS an einem Ort zu verwalten.</p></div>
      <div class="steps">
        <div class="step"><b>1 · Suchen</b>FritzHub findet FRITZ!Boxen und Repeater im Heimnetz automatisch.</div>
        <div class="step"><b>2 · Anmelden</b>Für jedes Gerät die Zugangsdaten eintragen. Repeater können sie von der Box übernehmen.</div>
        <div class="step"><b>3 · Loslegen</b>Übersicht, Topologie, Anrufe, Anrufbeantworter und NAS stehen sofort bereit.</div>
      </div>
      <div style="text-align:center;padding:0 20px 28px" class="row wrap" >
        <div style="margin:0 auto" class="row wrap">
          <a class="btn primary" href="#/settings?tab=boxes&scan=1">${ic('radar')}Netzwerk durchsuchen</a>
          <a class="btn" href="#/settings?tab=boxes&add=1">${ic('plus')}Manuell hinzufügen</a>
        </div>
      </div>
    </div>`;
  }

  // -------------------------------------------------------------- dashboard
  async function renderDashboard(el, token) {
    const refreshBtn = `<button class="btn" id="refreshBtn">${ic('refresh')}<span class="hide-sm">Aktualisieren</span></button>`;
    const draw = () => {
      if (stale(token)) return;
      const ov = S.overview;
      const router = mainRouter();
      const wan = router && router.wan;
      setHeader('Übersicht', `${onlineBoxes().length} von ${boxes().length} Geräten erreichbar · aktualisiert ${ago(Math.max(...boxes().map((b) => b.updated || 0)))}`, refreshBtn, true);
      on($('#refreshBtn'), 'click', (e) => withBusy(e.currentTarget, async () => { await loadOverview(true); draw(); }));
      let missed = 0; let msgs = 0; let hasPhone = false; let hasTam = false;
      boxes().forEach((b) => { if (b.phone) { hasPhone = true; missed += b.phone.missed_24h || 0; if ('new_messages' in b.phone) { hasTam = true; msgs += b.phone.new_messages || 0; } } });
      const kpi = (icon, cls, label, value, foot, href, fl) => `<${href ? `a href="${href}"` : 'div'} class="card kpi" style="color:inherit;text-decoration:none"${fl != null ? ` data-flash="${fl}"` : ''}>
        <div class="kpi-label"><span class="kpi-icon ${cls}">${ic(icon)}</span>${label}</div>
        <div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></${href ? 'a' : 'div'}>`;
      const rateParts = (key, b) => { const s = fmtBits(b * 8).split(' '); return `${cnt(key, s[0], s[1])}<small>${s[1]}</small>`; };
      const wlanClients = onlineBoxes().reduce((n, b) => n + (b.wlan || []).reduce((m, w) => m + (w.clients || 0), 0), 0);
      const kpis = [
        wan ? kpi('globe', wan.connected ? 'ok' : 'err', 'Internet', wan.connected ? 'Online' : 'Offline', esc(wan.external_ip || wan.status || '–'), '', wan.connected ? 1 : 0) : kpi('globe', '', 'Internet', '–', 'Keine Router-Box'),
        wan ? kpi('arrowDown', '', 'Download', rateParts('down', wan.rate_down), `Leitung ${fmtBits(wan.dsl ? wan.dsl.down_kbit * 1000 : wan.max_down_bit)}`) : '',
        wan ? kpi('arrowUp', 'up', 'Upload', rateParts('up', wan.rate_up), `Leitung ${fmtBits(wan.dsl ? wan.dsl.up_kbit * 1000 : wan.max_up_bit)}`) : '',
        kpi('devices', '', 'Geräte online', ov.hosts_online != null ? `${cnt('hosts', String(ov.hosts_online))}<small>/ ${ov.hosts_total}</small>` : '…', `${wlanClients} davon im WLAN`, '#/devices'),
        hasPhone ? kpi('callMissed', missed ? 'err' : '', 'Verpasste Anrufe', cnt('missed', String(missed)), 'letzte 24 Stunden', '#/calls') : '',
        hasTam ? kpi('voicemail', msgs ? 'warn' : '', 'Neue Nachrichten', cnt('msgs', String(msgs)), 'Anrufbeantworter', '#/tam') : '',
      ].join('');

      const conn = wan ? `<div class="card"><div class="card-head"><h2>Internetverbindung</h2>${wan.connected ? '<span class="badge ok">Verbunden</span>' : `<span class="badge err">${esc(wan.status || 'Getrennt')}</span>`}</div>
        <div class="card-body"><dl class="kv">
          <dt>Anschluss</dt><dd>${esc(wan.access_type || '–')}${wan.connection_type ? ` · ${esc(wan.connection_type)}` : ''}</dd>
          <dt>Verbunden seit</dt><dd>${fmtUptime(wan.uptime)}</dd>
          <dt>IPv4</dt><dd class="mono">${esc(wan.external_ip || '–')}</dd>
          ${wan.external_ipv6 ? `<dt>IPv6</dt><dd class="mono">${esc(wan.external_ipv6)}</dd>` : ''}
          ${wan.ipv6_prefix ? `<dt>IPv6-Präfix</dt><dd class="mono">${esc(wan.ipv6_prefix)}</dd>` : ''}
          ${wan.dsl ? `<dt>DSL-Sync</dt><dd>↓ ${fmtKbit(wan.dsl.down_kbit)} · ↑ ${fmtKbit(wan.dsl.up_kbit)}</dd>
          <dt>Max. möglich</dt><dd>↓ ${fmtKbit(wan.dsl.down_max_kbit)} · ↑ ${fmtKbit(wan.dsl.up_max_kbit)}</dd>
          <dt>Störabstand</dt><dd>↓ ${nf(wan.dsl.down_snr, 1)} dB · ↑ ${nf(wan.dsl.up_snr, 1)} dB</dd>
          <dt>Dämpfung</dt><dd>↓ ${nf(wan.dsl.down_attenuation, 1)} dB · ↑ ${nf(wan.dsl.up_attenuation, 1)} dB</dd>`
          : `<dt>Leitung</dt><dd>↓ ${fmtBits(wan.max_down_bit)} · ↑ ${fmtBits(wan.max_up_bit)}</dd>`}
          <dt>Datenvolumen</dt><dd>↓ ${fmtBytes(wan.total_down)} · ↑ ${fmtBytes(wan.total_up)}</dd>
          ${wan.dns && wan.dns.length ? `<dt>DNS</dt><dd class="mono">${wan.dns.map(esc).join('<br>')}</dd>` : ''}
        </dl></div></div>` : '';

      const range = store.get('chartRange', '1h');
      const chartCard = router ? `<div class="card"><div class="card-head" style="flex-wrap:wrap"><h2>Datendurchsatz <span class="sub">${esc(boxName(router))}</span>${range === '1h' ? '<span class="live" title="Wird laufend aktualisiert"><i></i>Live</span>' : ''}</h2>
          <div class="legend hide-sm"><span><i style="background:var(--down)"></i>Download</span><span><i style="background:var(--up)"></i>Upload</span></div>
          <div class="seg" id="chartRange">${[['1h', '1 Std'], ['24h', '24 Std'], ['7d', '7 Tage']].map(([k, l]) => `<button data-range="${k}" class="${range === k ? 'active' : ''}">${l}</button>`).join('')}</div></div>
          <div class="card-body"><div class="chart" id="chart" data-keep></div></div></div>` : '';

      const boxCards = boxes().map((b) => {
        const info = b.info || {};
        const clients = (b.wlan || []).reduce((n, w) => n + (w.clients || 0), 0);
        const status = !b.config.enabled ? '<span class="badge">Deaktiviert</span>' : b.online ? '<span class="badge ok"><span class="dot ok" style="box-shadow:none;width:6px;height:6px"></span>Online</span>' : b.online === false ? '<span class="badge err">Offline</span>' : '<span class="badge">…</span>';
        return `<div class="card box-card" data-key="box-${esc(b.config.id)}" data-flash="${b.online ? 1 : 0}">
          <div class="head">${boxAvatar(b)}
            <div class="grow" style="min-width:0;flex:1"><div class="title">${esc(boxName(b))} ${roleBadge(info)}</div><div class="meta muted" style="font-size:12.5px">${esc(info.model || b.config.host)}${info.firmware ? ` · FRITZ!OS ${esc(info.firmware)}` : ''}</div></div>${status}</div>
          ${b.online ? `<div class="stats">
            <div><div class="l">Laufzeit</div><div class="v">${fmtUptime(info.uptime)}</div></div>
            <div><div class="l">WLAN-Geräte</div><div class="v">${clients}</div></div>
            <div><div class="l">Firmware</div><div class="v">${info.update_available ? `<span class="badge warn">Update ${esc(info.update_version || '')}</span>` : '<span style="color:var(--ok)">Aktuell</span>'}</div></div>
          </div>${!isMaster(info) && (b.uplink || b.uplink_known) ? `<div class="uplink-row ${uplinkClass(b.uplink)}"><span class="l">Anbindung</span>${uplinkSummary(b)}</div>` : ''}` : b.error ? `<div style="padding:0 18px 16px">${errorBox(b.error)}</div>` : ''}
        </div>`;
      }).join('');

      render(el, `<div class="grid kpis">${kpis}</div>
        ${router ? `<div class="grid dash">${chartCard}${conn}</div>` : ''}
        ${router ? `<div class="card" style="margin-top:16px" id="volCard">${volumeHTML(S.vol && S.vol.id === router.config.id ? S.vol.data : null, router)}</div>` : ''}
        ${weakCard(ov)}
        ${lanNotice()}
        <div class="card-head" style="padding:26px 2px 12px"><h2>Mesh-Geräte</h2><a class="btn sm ghost" href="#/topology">${ic('topology')}Topologie</a></div>
        <div class="grid cols-3">${boxCards}</div>`);
      if (router) {
        routerChart(router);
        loadVolume(router);
        $$('#chartRange button').forEach((b) => on(b, 'click', () => { store.set('chartRange', b.dataset.range); S.chartAnimUntil = Date.now() + 1500; draw(); }));
      }
      on($('[data-weak-filter]'), 'click', () => { store.set('devFilter', { ...store.get('devFilter', { q: '', sort: 'name', dir: 1 }), kind: 'weak', q: '', sort: 'signal', dir: 1 }); });
    };
    S.chartAnimUntil = Date.now() + 1500;
    draw();
    // Host count for the KPI tile
    if (S.overview.hosts_online == null) {
      api('hosts').then((h) => { S.hosts = h; S.overview.hosts_online = h.filter((x) => x.active).length; S.overview.hosts_total = h.length; keepScroll(draw); }).catch(() => {});
    }
    const timer = setInterval(async () => { try { await loadOverview(); keepScroll(draw); } catch { /* keep old */ } }, Math.max(5, S.overview.scan_interval) * 1000);
    const onResize = () => { const r = mainRouter(); if (r) routerChart(r); };
    window.addEventListener('resize', onResize);
    S.cleanup.push(() => clearInterval(timer), () => window.removeEventListener('resize', onResize));
  }

  // Throughput chart: last hour from the live data, 24 h / 7 days from the stored history
  function routerChart(router) {
    const el = $('#chart');
    if (!el) return;
    const range = store.get('chartRange', '1h');
    if (range === '1h') { drawChart(el, router.history || []); return; }
    S.hist = S.hist || {};
    const cache = S.hist[range];
    const fresh = cache && cache.id === router.config.id;
    if (fresh) drawChart(el, cache.data); else morph(el, '<div class="empty" style="padding:90px 0">Verlauf wird geladen …</div>');
    if ((fresh && Date.now() - cache.at < 60000) || S.histLoading) return;
    S.histLoading = true;
    api(`history/${router.config.id}?range=${range}`)
      .then((data) => {
        S.hist[range] = { id: router.config.id, at: Date.now(), data };
        const target = $('#chart');
        if (target && store.get('chartRange', '1h') === range) keepScroll(() => drawChart(target, data));
      })
      .catch(() => {})
      .finally(() => { S.histLoading = false; });
  }

  function loadVolume(router) {
    if (S.vol && S.vol.id === router.config.id && Date.now() - S.vol.at < 60000) return;
    if (S.volLoading) return;
    S.volLoading = true;
    api(`volume/${router.config.id}`)
      .then((data) => {
        S.vol = { id: router.config.id, at: Date.now(), data };
        const card = $('#volCard');
        if (card) keepScroll(() => morph(card, volumeHTML(data, router)));
      })
      .catch(() => {})
      .finally(() => { S.volLoading = false; });
  }

  function volumeHTML(v, router) {
    const head = (sub) => `<div class="card-head"><h2>Datenvolumen <span class="sub">${sub}</span></h2></div>`;
    if (!v) return `${head(esc(boxName(router)))}<div class="card-body"><div class="skeleton" style="height:150px"></div></div>`;
    const now = new Date();
    const monthName = (d) => d.toLocaleDateString('de-DE', { month: 'long' });
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // bars grow in once when the data first appears on the page
    if (S.volGrowUntil == null) S.volGrowUntil = Date.now() + 1400;
    const grow = Date.now() < S.volGrowUntil;
    const tile = (label, d, key) => { const [n, u] = fmtBytes(d[0] + d[1]).split(' '); return `<div class="vol-tile"><div class="l">${label}</div><div class="v">${cnt(`vol-${key}`, n, u)} ${esc(u || '')}</div>
      <div class="s"><span style="color:var(--down)">↓ ${fmtBytes(d[0])}</span> · <span style="color:var(--up)">↑ ${fmtBytes(d[1])}</span></div></div>`; };
    const days = v.days || [];
    const max = Math.max(1, ...days.map((d) => d[1] + d[2]));
    const bars = days.map(([day, down, up], i) => {
      const date = new Date(`${day}T12:00:00`);
      const label = date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
      const tip = `${label}: ${fmtBytes(down + up)} (↓ ${fmtBytes(down)} · ↑ ${fmtBytes(up)})`;
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const showLabel = i === 0 || i === days.length - 1 || date.getDate() === 1 || date.getDay() === 1;
      return `<div class="vb ${weekend ? 'we' : ''}" title="${esc(tip)}" style="--i:${i}"><div class="stack" style="height:${((down + up) / max) * 100}%">
          <i class="u" style="flex:${up}"></i><i class="d" style="flex:${down}"></i></div>
        <span class="lbl">${showLabel ? date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''}</span></div>`;
    }).join('');
    const since = v.since ? new Date(`${v.since}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null;
    return `${head(`${esc(boxName(router))}${since ? ` · gezählt seit ${since}` : ''}`)}
      <div class="card-body">
        <div class="vol-tiles">${tile('Heute', v.today, 'd')}${tile(`${monthName(now)}`, v.month, 'm')}${tile(`${monthName(prev)}`, v.prev_month, 'p')}</div>
        ${days.length ? `<div class="vol-bars ${grow ? 'grow' : ''}">${bars}</div>` : '<div class="empty" style="padding:30px 0">Daten werden gesammelt …</div>'}
        <div class="faint" style="font-size:12px;margin-top:10px">Gezählt wird, solange FritzHub läuft. Die FRITZ!Box selbst zählt nur seit der letzten Neuverbindung.</div>
      </div>`;
  }

  function weakCard(ov) {
    const list = ov.weak_wlan || [];
    if (!list.length) return '';
    const weak = list.filter((d) => d.signal < WEAK_SIGNAL).length;
    return `<div class="card" style="margin-top:16px">
      <div class="card-head"><h2>Schwächste WLAN-Verbindungen <span class="sub">${weak ? `${weak} mit schwachem Signal` : 'alle Verbindungen in Ordnung'}</span></h2>
        <a class="btn sm ghost" href="#/devices" data-weak-filter>${ic('devices')}Alle anzeigen</a></div>
      <div class="card-body flush"><div class="list weak-list">${list.map((d) => `<div class="list-item">
        <div class="avatar ${signalClass(d.signal) === 'ok' ? 'ok' : signalClass(d.signal)}">${ic(deviceIcon({ name: d.name, model: d.model, interface: '802.11' }))}</div>
        <div class="grow"><div class="title">${esc(d.name)}${d.guest ? ' <span class="badge">Gast</span>' : ''}</div>
          <div class="meta">über ${esc(d.ap)}${d.band ? ` · ${esc(d.band)}` : ''}${d.ip ? ` · ${esc(d.ip)}` : ''}</div></div>
        <div class="nowrap" style="text-align:right"><div class="row" style="gap:6px;justify-content:flex-end">${signalBars(d.signal)}</div>
          <div class="faint num" style="font-size:12px">${d.speed ? fmtBits(d.speed * 1e6) : ''}</div></div>
      </div>`).join('')}</div></div></div>`;
  }

  function niceMax(v) {
    if (!v || v <= 0) return 1e6;
    const e = 10 ** Math.floor(Math.log10(v)); const f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }

  function drawChart(el, pts) {
    if (!el) return;
    if (pts.length < 2) { morph(el, '<div class="empty" style="padding:70px 0">Daten werden gesammelt …</div>'); return; }
    const W = Math.max(300, el.clientWidth); const H = 220; const pad = { l: 64, r: 10, t: 10, b: 26 };
    const t0 = pts[0][0]; const t1 = pts[pts.length - 1][0];
    const max = niceMax(Math.max(...pts.map((p) => Math.max(p[1], p[2]) * 8)) * 1.1);
    const x = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const line = (i) => pts.map((p, k) => `${k ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[i] * 8).toFixed(1)}`).join('');
    const area = (i) => `${line(i)}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
    let grid = '';
    // 2.5·10ⁿ and 5·10ⁿ divide evenly into 5 steps, 1·10ⁿ and 2·10ⁿ into 4
    const mant = max / 10 ** Math.floor(Math.log10(max));
    const steps = mant === 2.5 || mant === 5 ? 5 : 4;
    for (let k = 0; k <= steps; k += 1) {
      const v = (max / steps) * k; const yy = y(v).toFixed(1);
      grid += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="axis" x="${pad.l - 8}" y="${Number(yy) + 4}" text-anchor="end">${fmtBits(v)}</text>`;
    }
    const nT = Math.min(5, Math.floor(W / 120));
    for (let k = 0; k <= nT; k += 1) {
      const t = t0 + ((t1 - t0) / nT) * k;
      const d = new Date(t * 1000);
      const label = t1 - t0 < 600
        ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : t1 - t0 > 2 * 86400
          ? `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`
          : fmtTime(d);
      grid += `<text class="axis" x="${x(t)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === nT ? 'end' : 'middle'}">${label}</text>`;
    }
    // lines draw themselves when the chart first appears (page load, range switch);
    // later updates are morphed, so the paths glide to their new shape
    const drawIn = !el.querySelector('svg') || Date.now() < (S.chartAnimUntil || 0);
    if (drawIn && !el.querySelector('svg')) S.chartAnimUntil = Date.now() + 1500;
    morph(el, `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" class="${drawIn ? 'draw-in' : ''}">
      <defs>
        <linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--down)" stop-opacity=".28"/><stop offset="1" stop-color="var(--down)" stop-opacity="0"/></linearGradient>
        <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--up)" stop-opacity=".25"/><stop offset="1" stop-color="var(--up)" stop-opacity="0"/></linearGradient>
      </defs>
      <g class="gl">${grid}</g>
      <g class="series"><path class="ar" d="${area(1)}" fill="url(#gDown)"/><path class="ar" d="${area(2)}" fill="url(#gUp)"/>
      <path class="ln" pathLength="1" d="${line(1)}" fill="none" stroke="var(--down)" stroke-width="2" stroke-linejoin="round"/>
      <path class="ln" pathLength="1" d="${line(2)}" fill="none" stroke="var(--up)" stroke-width="2" stroke-linejoin="round"/></g>
      <g class="hover" style="display:none" data-keep><line y1="${pad.t}" y2="${H - pad.b}" stroke="var(--border-strong)" stroke-dasharray="3 3"/>
      <circle r="4" fill="var(--down)" stroke="var(--surface)" stroke-width="2" class="c1"/><circle r="4" fill="var(--up)" stroke="var(--surface)" stroke-width="2" class="c2"/></g>
      <rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent" class="hit"/>
    </svg><div class="tip" style="display:none" data-keep></div>`);
    const svg = el.querySelector('svg'); const g = svg.querySelector('.hover'); const tip = el.querySelector('.tip');
    on(svg.querySelector('.hit'), 'mousemove', (ev) => {
      const r = svg.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * W;
      const t = t0 + ((px - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
      let best = pts[0]; pts.forEach((p) => { if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; });
      const bx = x(best[0]);
      g.style.display = ''; g.querySelector('line').setAttribute('x1', bx); g.querySelector('line').setAttribute('x2', bx);
      g.querySelector('.c1').setAttribute('cx', bx); g.querySelector('.c1').setAttribute('cy', y(best[1] * 8));
      g.querySelector('.c2').setAttribute('cx', bx); g.querySelector('.c2').setAttribute('cy', y(best[2] * 8));
      tip.style.display = ''; tip.style.left = `${(bx / W) * r.width}px`; tip.style.top = `${(y(Math.max(best[1], best[2]) * 8) / H) * r.height}px`;
      const bd = new Date(best[0] * 1000);
      tip.innerHTML = `<b>${t1 - t0 > 86400 ? `${bd.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} ` : ''}${fmtTime(bd)}</b><br><span style="color:var(--down)">↓ ${fmtBits(best[1] * 8, 1)}</span> · <span style="color:var(--up)">↑ ${fmtBits(best[2] * 8, 1)}</span>`;
    });
    on(svg.querySelector('.hit'), 'mouseleave', () => { g.style.display = 'none'; tip.style.display = 'none'; });
  }

  // ---------------------------------------------------------------- devices
  async function renderDevices(el, token) {
    const f = store.get('devFilter', { q: '', kind: 'all', sort: 'name', dir: 1 });
    setHeader('Geräte', '<span id="devSub">Alle bekannten Geräte im Heimnetz</span>', `<button class="btn" id="webScanBtn" title="Alle Geräte nach Weboberflächen durchsuchen">${ic('globe')}<span class="hide-sm">Weboberflächen suchen</span></button><button class="btn" id="reloadBtn">${ic('refresh')}<span class="hide-sm">Aktualisieren</span></button>`);
    el.innerHTML = loading(8);
    const load = async (force) => { S.hosts = await api(`hosts${force ? '?force=1' : ''}`); };
    try { await load(); } catch (e) { el.innerHTML = errorBox(e.message); return; }
    if (stale(token)) return;

    const kinds = {
      all: ['Alle', () => true],
      online: ['Online', (h) => h.active],
      offline: ['Offline', (h) => !h.active],
      wlan: ['WLAN', (h) => h.active && isWlan(h)],
      lan: ['LAN', (h) => h.active && !isWlan(h)],
      guest: ['Gäste', (h) => h.guest],
      web: ['Weboberfläche', (h) => h.active && (h.web || []).length > 0],
      watched: ['Beobachtet', (h) => h.watched],
      new: ['Neu', (h) => isNew(h)],
      stale: ['Lange offline', (h) => isStale(h)],
      weak: ['Schwaches WLAN', (h) => h.active && h.signal != null && h.signal < WEAK_SIGNAL],
      blocked: ['Gesperrt', (h) => h.wan_blocked],
    };
    const ipNum = (ip) => (ip || '999.999.999.999').split('.').reduce((a, p) => a * 256 + Number(p), 0);
    const sorters = {
      name: (a, b) => (a.name || '').localeCompare(b.name || '', 'de', { sensitivity: 'base' }),
      ip: (a, b) => ipNum(a.ip) - ipNum(b.ip),
      conn: (a, b) => (a.connected_to || '').localeCompare(b.connected_to || ''),
      speed: (a, b) => (a.link_rate || a.speed * 1000 || 0) - (b.link_rate || b.speed * 1000 || 0),
      seen: (a, b) => (b.active ? 2e12 : b.last_seen || 0) - (a.active ? 2e12 : a.last_seen || 0),
      vendor: (a, b) => (a.vendor || (a.private ? '~' : '~~')).localeCompare(b.vendor || (b.private ? '~' : '~~'), 'de', { sensitivity: 'base' }),
      signal: (a, b) => (a.active && a.signal != null ? a.signal : 999) - (b.active && b.signal != null ? b.signal : 999),
    };

    const draw = () => {
      if (stale(token)) return;
      const hosts = S.hosts || [];
      const q = f.q.trim().toLowerCase();
      let list = hosts.filter(kinds[f.kind][1]).filter((h) => !q || [h.name, h.ip, h.mac, h.model, h.vendor, h.connected_to].some((v) => (v || '').toLowerCase().includes(q)));
      list = list.sort((a, b) => (b.active - a.active) || sorters[f.sort](a, b) * f.dir);
      const counts = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, hosts.filter(v[1]).length]));
      const th = (key, label, cls = '') => `<th data-sort="${key}" class="${cls}">${label}${f.sort === key ? `<span class="sort">${f.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
      const rows = list.map((h) => {
        const wl = isWlan(h);
        const conn = h.active ? `<div class="row nowrap" style="gap:8px">
            <span class="badge ${wl ? 'wlan' : 'lan'}">${ic(wl ? 'wifi' : 'ethernet')}${wl ? (h.band || 'WLAN') : 'LAN'}</span>
            ${h.connected_to ? `<span class="muted" style="font-size:12.5px">${esc(h.connected_to)}</span>` : ''}</div>` : '<span class="faint">–</span>';
        const rate = h.active ? (h.wlan_speed ? fmtBits(h.wlan_speed * 1e6) : h.link_rate ? fmtKbit(h.link_rate) : h.speed ? fmtBits(h.speed * 1e6) : '–') : '–';
        const canBlock = h.ip && h.wan_blocked !== null && h.wan_blocked !== undefined;
        return `<tr class="${h.active ? '' : 'offline'}" data-key="${esc(h.mac || `ip-${h.ip}`)}" data-flash="${h.active ? 1 : 0}">
          <td><div class="cell-main clickable" data-detail="${esc(h.mac)}" title="Details anzeigen"><div class="avatar ${h.active ? (wl ? 'wlan' : 'lan') : ''}">${ic(deviceIcon(h))}</div>
            <div style="min-width:0"><div class="t">${esc(h.name || h.mac || 'Unbekannt')}${webBadges(h.web)}${h.roams_24h >= PINGPONG ? ` <span class="badge warn" title="${h.roams_24h} Wechsel zwischen Zugangspunkten in 24 Stunden">springt</span>` : ''}${isNew(h) ? ` <span class="badge accent" title="Erstmals erkannt ${fmtDateTime(h.new_since)}">Neu</span>` : ''}${h.guest ? ' <span class="badge">Gast</span>' : ''}${h.wan_blocked ? ' <span class="badge err">Gesperrt</span>' : ''}</div>
            <div class="faint" style="font-size:12px">${h.active ? '<span class="dot ok" style="width:6px;height:6px;box-shadow:none;margin-right:5px;vertical-align:1px"></span>Online' : 'Offline'}${h.model ? ` · ${esc(h.model)}` : ''}</div></div></div></td>
          <td class="mono nowrap">${esc(h.ip || '–')}</td>
          <td class="mono nowrap hide-md">${esc(h.mac || '–')}</td>
          <td class="hide-sm vendor-cell">${h.private
            ? '<span class="badge" title="Das Gerät verwendet eine zufällige (private) MAC-Adresse – typisch für Smartphones, Tablets und Laptops. Ein Hersteller lässt sich daraus nicht ermitteln.">Private MAC</span>'
            : h.vendor ? `<span title="${esc(h.vendor_full || h.vendor)}">${esc(h.vendor)}</span>` : '<span class="faint">Unbekannt</span>'}</td>
          <td>${conn}</td>
          <td class="nowrap">${h.active && h.signal != null ? `<div class="row" style="gap:6px">${signalBars(h.signal)}</div>` : '<span class="faint">–</span>'}</td>
          <td class="nowrap num hide-lg">${rate}</td>
          <td class="nowrap hide-sm" title="${h.last_seen ? `Zuletzt gesehen: ${fmtDateTime(h.last_seen)}` : ''}">${h.active
            ? '<span style="color:var(--ok)">jetzt</span>'
            : h.last_seen ? `<span class="${isStale(h) ? 'stale' : ''}">${fmtAgo(h.last_seen)}</span>`
              : `<span class="faint" title="FritzHub zeichnet seit ${fmtDateTime(S.overview.tracking_since)} auf">vor ${new Date(S.overview.tracking_since * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>`}</td>
          <td class="nowrap">${canBlock ? `<label class="row" style="gap:8px" title="Internetzugang erlauben">${sw(!h.wan_blocked, `data-wan="${esc(h.ip)}"`)}</label>` : '<span class="faint">–</span>'}</td>
          <td class="sticky-end"><div class="actions">${h.mac ? `<button class="icon-btn ${h.watched ? 'watch-on' : ''}" title="${h.watched ? 'Wird beobachtet – klicken zum Beenden' : 'Beobachten: Meldung, wenn das Gerät offline geht'}" data-watch="${esc(h.mac)}">${ic('bell')}</button><button class="icon-btn" title="Umbenennen" data-rename-host="${esc(h.mac)}">${ic('edit')}</button>` : ''}</div></td>
        </tr>`;
      }).join('');
      render(el, `<div class="toolbar">
          <div class="input-icon search">${ic('search')}<input class="input" id="q" placeholder="Name, IP, MAC, Hersteller …" value="${esc(f.q)}"></div>
          <div class="seg" id="kinds">${Object.entries(kinds).filter(([k]) => counts[k] || k === 'all' || k === 'online').map(([k, v]) => `<button data-kind="${k}" class="${f.kind === k ? 'active' : ''}">${v[0]} <span class="n">${counts[k]}</span></button>`).join('')}</div>
        </div>
        <div class="card"><div class="table-wrap"><table class="table">
          <thead><tr>${th('name', 'Gerät')}${th('ip', 'IP-Adresse')}<th class="hide-md" style="cursor:default">MAC</th>${th('vendor', 'Hersteller', 'hide-sm')}${th('conn', 'Verbunden über')}${th('signal', 'Signal')}${th('speed', 'Rate', 'hide-lg')}${th('seen', 'Zuletzt gesehen', 'hide-sm')}<th style="cursor:default">Internet</th><th class="sticky-end"></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="10">${empty('search', 'Keine Geräte gefunden', 'Passe Suche oder Filter an.')}</td></tr>`}</tbody>
        </table></div></div>`);
      const qi = $('#q');
      on(qi, 'input', () => { f.q = qi.value; store.set('devFilter', f); draw(); });
      $$('#kinds button').forEach((b) => on(b, 'click', () => { f.kind = b.dataset.kind; store.set('devFilter', f); draw(); }));
      $$('th[data-sort]').forEach((t) => on(t, 'click', () => { if (f.sort === t.dataset.sort) f.dir *= -1; else { f.sort = t.dataset.sort; f.dir = 1; } store.set('devFilter', f); draw(); }));
      $$('[data-detail]').forEach((c) => on(c, 'click', (e) => {
        if (e.target.closest('a, button, [data-stop]')) return;
        openDeviceDetail(c.dataset.detail, draw);
      }));
      $$('[data-watch]').forEach((b) => on(b, 'click', async () => {
        const h = S.hosts.find((x) => x.mac === b.dataset.watch);
        if (!h) return;
        try {
          await setWatched(h, !h.watched);
          toast(h.watched ? `${h.name || h.mac} wird beobachtet.` : `Beobachtung von ${h.name || h.mac} beendet.`);
          draw();
          if (h.watched) ring($(`[data-watch="${CSS.escape(h.mac)}"]`));
        } catch (e) { toast(e.message, 'err'); }
      }));
      $$('[data-rename-host]').forEach((b) => on(b, 'click', () => {
        const h = S.hosts.find((x) => x.mac === b.dataset.renameHost);
        if (!h) return;
        modal({
          title: 'Gerät umbenennen',
          body: `<div class="field"><label>Name in der FRITZ!Box</label><input class="input" id="hostName" maxlength="63" value="${esc(h.name || '')}">
            <span class="hint">${esc(h.mac)}${h.vendor ? ` · ${esc(h.vendor)}` : ''}${h.ip ? ` · ${esc(h.ip)}` : ''}. Der Name gilt auch als Hostname im Heimnetz – Buchstaben, Ziffern und Bindestrich funktionieren überall.</span></div>`,
          foot: '<button class="btn" data-close>Abbrechen</button><button class="btn primary" id="saveName">Speichern</button>',
          onMount(m, close) {
            const inp = m.querySelector('#hostName'); inp.select();
            const save = () => withBusy(m.querySelector('#saveName'), async () => {
              const name = inp.value.trim();
              if (!name) { toast('Bitte einen Namen eingeben.', 'err'); return; }
              if (name === h.name) { close(); return; }
              try {
                await api('hosts/rename', { method: 'POST', body: { mac: h.mac, name } });
                h.name = name; close(); toast(`Umbenannt in „${name}“.`); draw();
              } catch (e) { toast(e.message, 'err'); }
            });
            m.querySelector('#saveName').addEventListener('click', save);
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
          },
        });
      }));
      $$('[data-wan]').forEach((c) => on(c, 'change', async () => {
        const allow = c.checked; const ip = c.dataset.wan;
        if (!allow && !(await confirmDialog('Internetzugang sperren?', `Das Gerät <b>${esc(ip)}</b> kann danach nicht mehr ins Internet. Das Heimnetz bleibt erreichbar.`, { ok: 'Sperren', danger: true }))) { c.checked = true; return; }
        c.disabled = true;
        try {
          await api('hosts/wan', { method: 'POST', body: { ip, blocked: !allow } });
          const h = S.hosts.find((x) => x.ip === ip); if (h) h.wan_blocked = !allow;
          toast(allow ? 'Internetzugang erlaubt.' : 'Internetzugang gesperrt.');
          draw();
        } catch (e) { toast(e.message, 'err'); c.checked = !allow; c.disabled = false; }
      }));
    };
    draw();
    $('#reloadBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => { try { await load(true); draw(); } catch (err) { toast(err.message, 'err'); } }));
    const showScanState = (st) => {
      const sub = $('#devSub');
      if (!sub || stale(token)) return;
      sub.textContent = st.running ? 'Suche nach Weboberflächen läuft …'
        : st.last ? `Alle bekannten Geräte im Heimnetz · Weboberflächen geprüft ${fmtAgo(st.last)}` : 'Alle bekannten Geräte im Heimnetz';
    };
    api('webscan').then(showScanState).catch(() => {});
    $('#webScanBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try {
        let st = await api('webscan', { method: 'POST' });
        showScanState(st);
        for (let i = 0; i < 90 && st.running; i += 1) {
          await new Promise((r) => setTimeout(r, 2000));
          st = await api('webscan');
        }
        showScanState(st);
        await load(true); keepScroll(draw);
        const n = (S.hosts || []).filter((h) => h.active && (h.web || []).length).length;
        toast(`${n} ${n === 1 ? 'Gerät hat' : 'Geräte haben'} eine Weboberfläche.`, 'info');
      } catch (err) { toast(err.message, 'err'); }
    }));
    const timer = setInterval(async () => { if (document.activeElement && document.activeElement.id === 'q') return; try { await load(); keepScroll(draw); } catch { /* ignore */ } }, 30000);
    S.cleanup.push(() => clearInterval(timer));
  }

  // --------------------------------------------------------------- topology
  // Compact by default: only mesh nodes (box / repeater) with a summary of their
  // clients. Clicking a node lists its clients in the side panel. The full map
  // with every client can be switched on ("Endgeräte anzeigen").
  const NODE_W = 300; const NODE_H = 84; const CL_W = 196; const CL_H = 42;
  const GAP = 40; const VGAP = 96; const CGAP = 10; const HEAD_H = 24;
  const GROUP_ORDER = ['LAN', '2,4 GHz', '5 GHz', '6 GHz', 'WLAN'];

  const isWlanLink = (l) => !!l && (l.type || '').toUpperCase() === 'WLAN';
  const clientGroup = (c) => (isWlanLink(c.link) ? (c.link.band || 'WLAN') : 'LAN');

  function buildTree(topo) {
    const nodes = new Map(topo.nodes.map((n) => [n.id, n]));
    const adj = new Map();
    topo.links.forEach((l) => {
      if (!nodes.has(l.source) || !nodes.has(l.target)) return;
      (adj.get(l.source) || adj.set(l.source, []).get(l.source)).push([l.target, l]);
      (adj.get(l.target) || adj.set(l.target, []).get(l.target)).push([l.source, l]);
    });
    const infra = topo.nodes.filter((n) => n.infrastructure);
    const root = infra.find((n) => n.role === 'master') || infra[0] || topo.nodes[0];
    if (!root) return null;
    const T = new Map(); // id -> {node, children, all (clients), link}
    const mk = (n, link) => { const t = { node: n, children: [], all: [], link }; T.set(n.id, t); return t; };
    const rootT = mk(root, null);
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift();
      (adj.get(id) || []).forEach(([other, link]) => {
        const on = nodes.get(other);
        if (!on.infrastructure || T.has(other)) return;
        T.get(id).children.push(mk(on, link));
        queue.push(other);
      });
    }
    infra.forEach((n) => { if (!T.has(n.id)) rootT.children.push(mk(n, null)); });
    topo.nodes.filter((n) => !n.infrastructure).forEach((n) => {
      const parents = (adj.get(n.id) || []).filter(([o]) => T.has(o));
      if (parents.length) T.get(parents[0][0]).all.push({ node: n, link: parents[0][1] });
    });
    // grouped by connection (LAN, 2,4 GHz, 5 GHz …), alphabetical within each group
    const byName = (a, b) => (a.node.name || '').localeCompare(b.node.name || '', 'de', { sensitivity: 'base', numeric: true });
    const order = (c) => { const i = GROUP_ORDER.indexOf(clientGroup(c)); return i < 0 ? 9 : i; };
    T.forEach((t) => {
      t.all.sort((a, b) => order(a) - order(b) || byName(a, b));
      t.children.sort(byName);
    });
    return { root: rootT, T };
  }

  function clientStats(t) {
    const wlan = t.all.filter((c) => isWlanLink(c.link)).length;
    const weak = t.all.filter((c) => c.node.signal != null && c.node.signal < WEAK_SIGNAL).length;
    return { total: t.all.length, wlan, lan: t.all.length - wlan, weak };
  }

  function layoutTree(t, showClients) {
    t.items = []; t.cbW = 0; t.cbH = 0;
    const clients = showClients ? t.all : [];
    if (clients.length) {
      const cols = clients.length <= 6 ? 1 : clients.length <= 16 ? 2 : 3;
      t.cbW = cols * CL_W + (cols - 1) * CGAP;
      let y = 0;
      GROUP_ORDER.concat(['?']).forEach((g) => {
        const members = clients.filter((c) => (GROUP_ORDER.includes(clientGroup(c)) ? clientGroup(c) : '?') === g);
        if (!members.length) return;
        t.items.push({ head: `${g === '?' ? 'Sonstige' : g} · ${members.length}`, x: 0, y });
        y += HEAD_H;
        members.forEach((c, i) => {
          t.items.push({ c, x: (i % cols) * (CL_W + CGAP), y: y + Math.floor(i / cols) * (CL_H + CGAP) });
        });
        y += Math.ceil(members.length / cols) * (CL_H + CGAP) + 6;
      });
      t.cbH = y - CGAP - 6;
    }
    t.children.forEach((c) => layoutTree(c, showClients));
    const kids = t.children.reduce((s, c) => s + c.w, 0) + Math.max(0, t.children.length - 1) * GAP;
    t.rowW = t.cbW + (t.cbW && t.children.length ? GAP : 0) + kids;
    t.w = Math.max(NODE_W, t.rowW);
  }

  function placeTree(t, left, top) {
    t.cx = left + t.w / 2; t.y = top;
    let cursor = left + (t.w - t.rowW) / 2;
    const rowTop = top + NODE_H + VGAP;
    if (t.cbW) { t.cbX = cursor; t.cbY = rowTop; cursor += t.cbW + (t.children.length ? GAP : 0); }
    t.children.forEach((c) => { placeTree(c, cursor, rowTop); cursor += c.w + GAP; });
  }

  function linkLabel(l) {
    if (!l) return '';
    const rate = Math.max(l.rate_rx || 0, l.rate_tx || 0);
    return `${isWlanLink(l) ? (l.band || 'WLAN') : 'LAN'}${rate ? ` · ${fmtKbit(rate)}` : ''}`;
  }
  const trunc = (s, n) => { s = String(s || ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

  function topoSVG(rootT, selected) {
    let links = ''; let nodes = ''; let labels = '';
    const bounds = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    const grow = (x1, y1, x2, y2) => { bounds.x1 = Math.min(bounds.x1, x1); bounds.y1 = Math.min(bounds.y1, y1); bounds.x2 = Math.max(bounds.x2, x2); bounds.y2 = Math.max(bounds.y2, y2); };
    const curve = (x1, y1, x2, y2) => { const my = (y1 + y2) / 2; return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`; };
    const iconG = (name, x, y, s = 22) => `<g transform="translate(${x},${y}) scale(${s / 24})" class="ico-g">${P[name]}</g>`;
    const walk = (t) => {
      const n = t.node; const x = t.cx - NODE_W / 2; const y = t.y;
      grow(x, y, x + NODE_W, y + NODE_H);
      t.children.forEach((c) => {
        const up = c.node.uplink;
        const wlanUp = up && up.type !== 'lan';
        links += `<path class="t-link ${isWlanLink(c.link) || wlanUp ? 'wlan' : 'lan'} ${wlanUp ? `q-${signalClass(up.signal)}` : lanSlow(up) ? 'q-slow' : ''}" d="${curve(t.cx, y + NODE_H, c.cx, c.y)}"/>`;
        if (c.link) {
          // label on the bezier curve at t=0.68 – close to the child, so siblings don't overlap
          const s = 0.68; const u = 1 - s; const y0 = y + NODE_H; const my = (y0 + c.y) / 2;
          const lx = t.cx * (u ** 3 + 3 * u * u * s) + c.cx * (3 * u * s * s + s ** 3);
          const ly = y0 * u ** 3 + my * (3 * u * u * s + 3 * u * s * s) + c.y * s ** 3;
          const txt = wlanUp ? `${up.band || 'WLAN'} · ${up.signal} % · ${mbit(up.speed_tx)}` : `${linkLabel(c.link)}${lanSlow(up) ? ' – langsam!' : ''}`; const w = txt.length * 6.3 + 16;
          labels += `<g class="t-label"><rect x="${lx - w / 2}" y="${ly - 11}" width="${w}" height="22" rx="11"/><text x="${lx}" y="${ly + 4}" text-anchor="middle">${esc(txt)}</text></g>`;
        }
        walk(c);
      });
      if (t.items.length) {
        links += `<path class="t-link client" d="${curve(t.cx, y + NODE_H, t.cbX + t.cbW / 2, t.cbY - 14)}"/>`;
        nodes += `<rect class="t-group" x="${t.cbX - 10}" y="${t.cbY - 14}" width="${t.cbW + 20}" height="${t.cbH + 26}" rx="14"/>`;
        grow(t.cbX - 10, t.cbY - 14, t.cbX + t.cbW + 10, t.cbY + t.cbH + 12);
        t.items.forEach((it) => {
          const cx = t.cbX + it.x; const cy = t.cbY + it.y;
          if (it.head) { nodes += `<text class="t-head" x="${cx + 2}" y="${cy + 15}">${esc(it.head)}</text>`; return; }
          const c = it.c; const sig = c.node.signal;
          const stripe = sig != null ? signalClass(sig) : isWlanLink(c.link) ? 'wlan' : 'lan';
          const sub = [c.node.ip, sig != null ? `${sig} %` : (c.link && c.link.rate_rx ? fmtKbit(Math.max(c.link.rate_rx, c.link.rate_tx || 0)) : '')].filter(Boolean).join(' · ');
          nodes += `<g class="t-node t-client ${selected === c.node.id ? 'selected' : ''}" data-id="${esc(c.node.id)}">
            <rect class="bg" x="${cx}" y="${cy}" width="${CL_W}" height="${CL_H}" rx="10"/>
            <rect class="stripe ${stripe}" x="${cx}" y="${cy + 8}" width="4" height="${CL_H - 16}" rx="2"/>
            <text class="n" x="${cx + 14}" y="${cy + 18}">${esc(trunc(c.node.name, 24))}</text>
            <text class="s" x="${cx + 14}" y="${cy + 33}">${esc(trunc(sub, 32))}</text></g>`;
        });
      }
      const master = n.role === 'master';
      const st = clientStats(t);
      const icon = /repeater|powerline/i.test(n.model || '') ? 'repeater' : 'router';
      nodes += `<g class="t-node ${master ? 'master' : ''} ${selected === n.id ? 'selected' : ''}" data-id="${esc(n.id)}">
        <rect class="bg" x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="16"/>
        <rect class="ico" x="${x + 14}" y="${y + 20}" width="44" height="44" rx="12"/>
        ${iconG(icon, x + 24, y + 30, 24)}
        <text class="n" x="${x + 72}" y="${y + 27}">${esc(trunc(n.name, 26))}</text>
        <text class="s" x="${x + 72}" y="${y + 45}">${esc(trunc(`${master ? 'Mesh Master' : n.role === 'slave' ? 'Mesh Repeater' : 'Gerät'}${n.model && n.model !== n.name ? ` · ${n.model}` : ''}`, 38))}</text>
        <text class="st" x="${x + 72}" y="${y + 66}"><tspan class="b">${st.total}</tspan> ${st.total === 1 ? 'Gerät' : 'Geräte'}${st.wlan ? ` · ${st.wlan} WLAN` : ''}${st.lan ? ` · ${st.lan} LAN` : ''}${st.weak ? `<tspan class="weak"> · ${st.weak} schwach</tspan>` : ''}</text></g>`;
    };
    walk(rootT);
    return { svg: `<g class="links">${links}</g><g class="nodes">${nodes}</g><g class="labels">${labels}</g>`, bounds };
  }

  async function renderTopology(el, token) {
    // new key: compact view is the default now
    const opts = store.get('topo.v2', { clients: false });
    let selected = null; let view = null; let tree = null;
    setHeader('Mesh-Topologie', 'Aufbau des Mesh-Netzes – Box oder Repeater anklicken für die verbundenen Geräte', `<button class="btn" id="reloadBtn">${ic('refresh')}<span class="hide-sm">Aktualisieren</span></button>`);
    el.innerHTML = loading(6);
    const load = async (force) => { S.topo = await api(`topology${force ? '?force=1' : ''}`); };
    try { await load(); } catch (e) { el.innerHTML = errorBox(e.message); return; }
    if (stale(token)) return;

    el.innerHTML = `<div class="topo-wrap card" id="topo">
      <div class="topo-tools">
        <div class="card"><button class="icon-btn" data-z="in" title="Vergrößern">${ic('plus')}</button><button class="icon-btn" data-z="out" title="Verkleinern">${ic('minus')}</button><button class="icon-btn" data-z="fit" title="Einpassen">${ic('fit')}</button></div>
        <div class="card" style="padding:4px 12px"><label class="check"><input type="checkbox" id="showClients" ${opts.clients ? 'checked' : ''}>Alle Endgeräte in der Karte</label></div>
      </div>
      <svg id="topoSvg"><g id="vp"></g></svg>
      <div class="topo-legend card"><span><i class="ln" style="border-color:var(--lan)"></i>LAN</span><span><i class="ln" style="border-color:var(--wlan);border-top-style:dashed"></i>WLAN</span>
        ${opts.clients ? '<span><i class="sq" style="background:var(--ok)"></i>gut</span><span><i class="sq" style="background:var(--warn)"></i>mittel</span><span><i class="sq" style="background:var(--err)"></i>schwach</span>' : ''}
        <span class="faint" id="topoCount"></span></div>
      <div id="detail"></div>
    </div>`;
    const svg = $('#topoSvg'); const vp = $('#vp');
    let bounds = null;
    // CSS transform, so zoom buttons and "fit" glide (dragging/wheel stay direct)
    const apply = () => { vp.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; };
    let instantT = 0;
    const instant = (ms = 0) => {
      svg.classList.add('no-anim');
      clearTimeout(instantT);
      instantT = setTimeout(() => svg.classList.remove('no-anim'), ms);
    };
    const fit = () => {
      if (!bounds) return;
      const r = svg.getBoundingClientRect(); const pad = 60;
      const bw = bounds.x2 - bounds.x1; const bh = bounds.y2 - bounds.y1;
      const k = Math.min(1.25, (r.width - pad * 2) / bw, (r.height - pad * 2 - 40) / bh);
      view = { k, x: (r.width - bw * k) / 2 - bounds.x1 * k, y: Math.max(pad + 20, (r.height - bh * k) / 2) - bounds.y1 * k };
      apply();
    };
    const draw = (refit) => {
      tree = buildTree(S.topo);
      if (!tree) { vp.innerHTML = ''; return; }
      layoutTree(tree.root, opts.clients); placeTree(tree.root, 0, 0);
      const out = topoSVG(tree.root, selected);
      vp.innerHTML = out.svg; bounds = out.bounds;
      const infra = S.topo.nodes.filter((n) => n.infrastructure).length;
      const clients = S.topo.nodes.length - infra;
      $('#topoCount').textContent = `${infra} Mesh-Knoten · ${clients} Endgeräte`;
      if (!view) { instant(50); fit(); } else if (refit) fit(); else apply();
    };

    const clientRow = (c) => {
      const n = c.node;
      const meta = [n.vendor || (n.private ? 'Private MAC' : ''), n.ip, linkLabel(c.link)].filter(Boolean).join(' · ');
      return `<div class="list-item clickable" data-client="${esc(n.id)}" style="padding:8px 16px">
        <div class="avatar ${isWlanLink(c.link) ? 'wlan' : 'lan'}" style="width:30px;height:30px">${ic(deviceIcon({ name: n.name, model: n.model, vendor: n.vendor, interface: isWlanLink(c.link) ? '802.11' : '' }))}</div>
        <div class="grow"><div class="title" style="font-size:13px">${esc(n.name)}</div><div class="meta">${esc(meta)}</div></div>
        ${n.signal != null ? `<div class="row nowrap" style="gap:5px">${signalBars(n.signal)}</div>` : ''}</div>`;
    };

    const parentOf = (id) => {
      let name = null;
      tree && tree.T.forEach((t) => { if (t.children.some((c) => c.node.id === id)) name = t.node.name; });
      return name;
    };
    const closeDetail = () => {
      const panel = $('#detail .topo-detail');
      if (!panel) return;
      panel.classList.add('leaving');
      setTimeout(() => { if (panel.isConnected && panel.classList.contains('leaving')) panel.remove(); }, reducedMotion() ? 0 : 200);
    };
    const showDetail = (id) => {
      selected = id; draw(false);
      const n = S.topo.nodes.find((x) => x.id === id);
      if (!n) { closeDetail(); return; }
      let body = '';
      if (n.infrastructure) {
        const t = tree && tree.T.get(id);
        const uplinks = S.topo.links.filter((l) => (l.source === id || l.target === id)).map((l) => {
          const other = S.topo.nodes.find((x) => x.id === (l.source === id ? l.target : l.source));
          if (!other || !other.infrastructure) return '';
          return `<div class="list-item" style="padding:8px 16px"><div class="avatar ${isWlanLink(l) ? 'wlan' : 'lan'}" style="width:30px;height:30px">${ic(isWlanLink(l) ? 'wifi' : 'ethernet')}</div>
            <div class="grow"><div class="title" style="font-size:13px">${esc(other.name)}</div><div class="meta">${esc(linkLabel(l))}${l.max_rx ? ` · max ${fmtKbit(Math.max(l.max_rx, l.max_tx || 0))}` : ''}</div></div></div>`;
        }).join('');
        let groups = '';
        if (t && t.all.length) {
          GROUP_ORDER.concat(['?']).forEach((g) => {
            const members = t.all.filter((c) => (GROUP_ORDER.includes(clientGroup(c)) ? clientGroup(c) : '?') === g);
            if (members.length) groups += `<div class="list-group">${g === '?' ? 'Sonstige' : g} · ${members.length}</div><div class="list">${members.map(clientRow).join('')}</div>`;
          });
        }
        const st = t ? clientStats(t) : null;
        body = `<div class="card-body" style="padding-top:8px"><dl class="kv">
            <dt>Rolle</dt><dd>${n.role === 'master' ? 'Mesh Master' : n.role === 'slave' ? 'Mesh Repeater' : 'Gerät'}</dd>
            ${n.model ? `<dt>Modell</dt><dd>${esc(n.model)}</dd>` : ''}
            ${n.ip ? `<dt>IP</dt><dd class="mono">${esc(n.ip)}</dd>` : ''}
            ${st ? `<dt>Endgeräte</dt><dd>${st.total} (${st.wlan} WLAN, ${st.lan} LAN)</dd>` : ''}
            ${st && st.weak ? `<dt>Schwaches Signal</dt><dd style="color:var(--err)">${st.weak} Geräte</dd>` : ''}
          </dl>
          ${(n.web || []).length ? webButtons(n.web) : n.ip ? `<a class="btn sm" style="margin-top:14px;width:100%" href="http://${esc(n.ip)}" target="_blank" rel="noopener">${ic('external')}Oberfläche öffnen</a>` : ''}</div>
          ${uplinkDetail({ ...n, parentName: parentOf(id) })}
          ${uplinks ? `<div class="list-group">Mesh-Verbindungen</div><div class="list">${uplinks}</div>` : ''}
          ${groups || '<div class="card-body faint">Keine Endgeräte verbunden.</div>'}`;
      } else {
        const link = S.topo.links.find((l) => l.source === id || l.target === id);
        const ap = link && S.topo.nodes.find((x) => x.id === (link.source === id ? link.target : link.source));
        body = `<div class="card-body" style="padding-top:8px"><dl class="kv">
            ${n.vendor || n.private ? `<dt>Hersteller</dt><dd>${n.private ? 'Private MAC (zufällig)' : esc(n.vendor)}</dd>` : ''}
            ${n.ip ? `<dt>IP</dt><dd class="mono">${esc(n.ip)}</dd>` : ''}
            ${n.mac ? `<dt>MAC</dt><dd class="mono">${esc(n.mac)}</dd>` : ''}
            ${ap ? `<dt>Verbunden mit</dt><dd>${esc(ap.name)}</dd>` : ''}
            ${link ? `<dt>Verbindung</dt><dd>${esc(linkLabel(link))}</dd>` : ''}
            ${n.signal != null ? `<dt>Signal</dt><dd><span class="row" style="gap:6px;justify-content:flex-end">${signalBars(n.signal)}</span></dd>` : ''}
          </dl>
          ${webButtons(n.web)}
          ${ap ? `<button class="btn sm" style="margin-top:14px;width:100%" data-client="${esc(ap.id)}">${ic(/repeater/i.test(ap.model || '') ? 'repeater' : 'router')}Zu ${esc(ap.name)}</button>` : ''}</div>`;
      }
      const det = $('#detail');
      const fresh = !det.querySelector('.topo-detail:not(.leaving)');
      det.innerHTML = `<div class="card topo-detail ${fresh ? 'slide-in' : ''}">
        <div class="card-head"><h2>${esc(n.name)}</h2><button class="icon-btn" id="closeDetail">${ic('x')}</button></div>${body}</div>`;
      $('#closeDetail').addEventListener('click', () => { selected = null; closeDetail(); draw(false); });
      $$('#detail [data-client]').forEach((r) => r.addEventListener('click', () => showDetail(r.dataset.client)));
    };
    draw(true);

    // pan & zoom
    let drag = null; let moved = false;
    svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; moved = false; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      view.x = drag.vx + dx; view.y = drag.vy + dy; apply();
    });
    const end = (e) => {
      if (!drag) return;
      svg.classList.remove('dragging'); drag = null;
      if (!moved) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const g = target && target.closest('.t-node');
        if (g) showDetail(g.dataset.id);
      }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', () => { drag = null; svg.classList.remove('dragging'); });
    const zoomAt = (factor, cx, cy) => {
      const k = Math.min(3, Math.max(0.15, view.k * factor)); const f = k / view.k;
      view.x = cx - (cx - view.x) * f; view.y = cy - (cy - view.y) * f; view.k = k; apply();
    };
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      instant(150);
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    $$('[data-z]').forEach((b) => b.addEventListener('click', () => {
      const r = svg.getBoundingClientRect();
      if (b.dataset.z === 'fit') fit(); else zoomAt(b.dataset.z === 'in' ? 1.25 : 0.8, r.width / 2, r.height / 2);
    }));
    $('#showClients').addEventListener('change', (e) => { opts.clients = e.target.checked; store.set('topo.v2', opts); navigate(); });
    $('#reloadBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try { await load(true); draw(false); if (selected) showDetail(selected); } catch (err) { toast(err.message, 'err'); }
    }));
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    S.cleanup.push(() => window.removeEventListener('resize', onResize));
  }

  // ------------------------------------------------------------------- WLAN
  async function renderWlan(el, token) {
    setHeader('WLAN', 'Funknetze aller Mesh-Geräte', `<button class="btn" id="reloadBtn">${ic('refresh')}<span class="hide-sm">Aktualisieren</span></button>`);
    const draw = () => {
      if (stale(token)) return;
      const list = onlineBoxes().filter((b) => (b.wlan || []).length)
        .sort((a, b) => isSlave(a.info) - isSlave(b.info));
      if (!list.length) { el.innerHTML = `<div class="card">${empty('wifiOff', 'Keine WLAN-Daten', 'Keine erreichbare Box liefert WLAN-Informationen.')}</div>`; return; }
      el.innerHTML = `${channelCard(list)}<div class="grid cols-2" style="margin-top:16px">${list.map((b) => `<div class="card">
        <div class="card-head" style="padding-bottom:10px">${boxAvatar(b)}
          <h2>${esc(boxName(b))} ${roleBadge(b.info)}<div class="faint" style="font-weight:400;font-size:12.5px">${esc(b.info.model || '')}</div></h2>
          <span class="badge">${b.wlan.reduce((n, w) => n + (w.clients || 0), 0)} Geräte</span></div>
        ${isSlave(b.info) ? `<div style="padding:0 18px 12px">${meshNotice(b.info, 'WLAN-Name, Passwort, Gastnetz und Funkeinstellungen')}</div>` : ''}
        <div>${b.wlan.map((w) => `<div class="wlan-band">
          <div class="avatar ${w.enabled ? (w.guest ? 'warn' : 'ok') : ''}">${ic(w.guest ? 'users' : w.enabled ? 'wifi' : 'wifiOff')}</div>
          <div class="grow"><div class="row" style="gap:8px;flex-wrap:wrap"><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.ssid || '–')}</b>${w.guest ? '<span class="badge warn">Gastnetz</span>' : `<span class="badge">${esc(w.band)}</span>`}</div>
            <div class="muted" style="font-size:12.5px">${w.enabled ? `${w.guest ? `${esc(w.band)} · ` : ''}Kanal ${w.channel ?? '–'} · ${esc(w.standard || '')} · ${w.clients} ${w.clients === 1 ? 'Gerät' : 'Geräte'}` : 'Ausgeschaltet'}</div></div>
          <button class="icon-btn" title="Passwort & QR-Code" data-cred="${b.config.id}:${w.index}">${ic('qr')}</button>
          <button class="icon-btn" title="${isSlave(b.info) ? 'Wird vom Mesh Master verwaltet' : 'Bearbeiten'}" data-edit="${b.config.id}:${w.index}" ${isSlave(b.info) ? 'disabled' : ''}>${ic('edit')}</button>
          <span title="${isSlave(b.info) ? 'Wird vom Mesh Master verwaltet' : ''}">${sw(w.enabled, `data-toggle="${b.config.id}:${w.index}" data-guest="${w.guest ? 1 : 0}"`, isSlave(b.info))}</span>
        </div>`).join('')}</div></div>`).join('')}</div>`;

      $$('[data-toggle]').forEach((c) => c.addEventListener('change', async () => {
        const [bid, idx] = c.dataset.toggle.split(':'); const on = c.checked;
        if (!on && c.dataset.guest !== '1' && !(await confirmDialog('WLAN ausschalten?', 'Alle Geräte in diesem Funknetz verlieren sofort die Verbindung.', { ok: 'Ausschalten', danger: true }))) { c.checked = true; return; }
        c.disabled = true;
        try { await api(`wlan/${bid}/${idx}/enable`, { method: 'POST', body: { enabled: on } }); toast(on ? 'WLAN eingeschaltet.' : 'WLAN ausgeschaltet.'); await loadOverview(); draw(); } catch (e) { toast(e.message, 'err'); c.checked = !on; c.disabled = false; }
      }));
      $$('[data-cred]').forEach((b) => b.addEventListener('click', () => withBusy(b, async () => {
        const [bid, idx] = b.dataset.cred.split(':');
        try {
          const c = await api(`wlan/${bid}/${idx}/credentials`);
          modal({
            title: c.ssid,
            body: `<div class="qr">${c.qr}</div><p class="muted" style="text-align:center;font-size:13px">Mit der Handykamera scannen, um sich zu verbinden.</p>
              <div class="field"><label>Netzwerkname (SSID)</label><div class="secret"><span>${esc(c.ssid)}</span></div></div>
              <div class="field"><label>Passwort</label><div class="secret"><span id="pw" data-v="${esc(c.password || '')}">••••••••••••</span>
              <button class="icon-btn" id="pwShow" title="Anzeigen">${ic('eye')}</button><button class="icon-btn" id="pwCopy" title="Kopieren">${ic('copy')}</button></div></div>`,
            onMount(m) {
              const pw = m.querySelector('#pw');
              m.querySelector('#pwShow').addEventListener('click', () => { pw.textContent = pw.textContent.startsWith('•') ? pw.dataset.v : '••••••••••••'; });
              m.querySelector('#pwCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(pw.dataset.v); toast('Passwort kopiert.'); } catch { toast('Kopieren nicht möglich.', 'err'); } });
            },
          });
        } catch (e) { toast(e.message, 'err'); }
      })));
      $$('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const [bid, idx] = b.dataset.edit.split(':');
        const w = findBox(bid).wlan.find((x) => String(x.index) === idx);
        modal({
          title: `${w.guest ? 'Gastnetz' : `WLAN ${w.band}`} bearbeiten`,
          body: `<div class="notice" style="margin-bottom:14px">${ic('alert')}<div>Nach dem Ändern müssen sich alle Geräte in diesem Netz neu verbinden.</div></div>
            <div class="field"><label>Netzwerkname (SSID)</label><input class="input" id="ssid" value="${esc(w.ssid || '')}" maxlength="32"></div>
            <div class="field"><label>Neues Passwort</label><input class="input" id="wpw" type="password" autocomplete="new-password" placeholder="leer lassen = unverändert" minlength="8" maxlength="63"><span class="hint">8–63 Zeichen</span></div>`,
          foot: '<button class="btn" data-close>Abbrechen</button><button class="btn primary" id="save">Speichern</button>',
          onMount(m, close) {
            m.querySelector('#save').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
              const ssid = m.querySelector('#ssid').value.trim(); const password = m.querySelector('#wpw').value;
              if (password && (password.length < 8 || password.length > 63)) { toast('Das Passwort muss 8–63 Zeichen lang sein.', 'err'); return; }
              try { await api(`wlan/${bid}/${idx}`, { method: 'POST', body: { ssid: ssid !== w.ssid ? ssid : null, password: password || null } }); toast('WLAN-Einstellungen gespeichert.'); close(); await loadOverview(); draw(); } catch (err) { toast(err.message, 'err'); }
            }));
          },
        });
      }));
    };
    draw();
    $('#reloadBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => { await loadOverview(true); draw(); }));
  }

  // WLAN channel check -------------------------------------------------------
  // 2.4 GHz: a 20 MHz channel covers ±2 channels, so only 1 / 6 / 11 don't overlap.
  // 5 GHz: with 80 MHz width the channels are grouped in blocks of four.
  const BLOCKS_5 = [[36, 48], [52, 64], [100, 112], [116, 128], [132, 144], [149, 161]];
  const block5 = (c) => BLOCKS_5.findIndex(([a, b]) => c >= a && c <= b);

  function channelAnalysis(list) {
    const aps = [];
    list.forEach((b) => (b.wlan || []).forEach((w) => {
      if (w.guest || !w.enabled || !w.channel) return;
      aps.push({ name: boxName(b), band: w.band, ch: w.channel, clients: w.clients || 0, auto: w.auto_channel, possible: w.possible_channels || [], slave: isSlave(b.info), level: 'ok' });
    }));
    const two = aps.filter((a) => a.band.startsWith('2'));
    const five = aps.filter((a) => a.band.startsWith('5'));
    const issues = [];
    const worse = (a, lvl) => { if (lvl === 'err' || (lvl === 'warn' && a.level === 'ok')) a.level = lvl; };
    two.forEach((a, i) => two.slice(i + 1).forEach((b) => {
      const d = Math.abs(a.ch - b.ch);
      if (d === 0) {
        issues.push({ level: 'warn', text: `<b>${esc(a.name)}</b> und <b>${esc(b.name)}</b> funken beide auf Kanal ${a.ch} und teilen sich die Sendezeit.` });
        worse(a, 'warn'); worse(b, 'warn');
      } else if (d < 5) {
        issues.push({ level: 'err', text: `<b>${esc(a.name)}</b> (Kanal ${a.ch}) und <b>${esc(b.name)}</b> (Kanal ${b.ch}) überlappen sich teilweise – das stört stärker als ein gemeinsamer Kanal.` });
        worse(a, 'err'); worse(b, 'err');
      }
    }));
    const fiveShared = [];
    five.forEach((a, i) => five.slice(i + 1).forEach((b) => {
      if (block5(a.ch) >= 0 && block5(a.ch) === block5(b.ch)) fiveShared.push(`${a.name} (${a.ch}) / ${b.name} (${b.ch})`);
    }));
    // suggestion: busiest access points get their own non-overlapping channel
    const load = { 1: 0, 6: 0, 11: 0 };
    const suggestion = [...two].sort((a, b) => b.clients - a.clients).map((a) => {
      const options = [1, 6, 11].filter((c) => !a.possible.length || a.possible.includes(c));
      const best = options.sort((x, y) => (load[x] - load[y]) || ((x === a.ch ? 0 : 1) - (y === a.ch ? 0 : 1)))[0];
      load[best] += a.clients + 1;
      return { ...a, suggested: best };
    });
    return { two, five, issues, fiveShared, suggestion };
  }

  function channelCard(list) {
    const r = channelAnalysis(list);
    if (!r.two.length && !r.five.length) return '';
    const errors = r.issues.filter((i) => i.level === 'err').length;
    const badge = r.issues.length
      ? `<span class="badge ${errors ? 'err' : 'warn'}">${r.issues.length} ${r.issues.length === 1 ? 'Hinweis' : 'Hinweise'}</span>`
      : '<span class="badge ok">Keine Konflikte</span>';
    const strip = r.two.map((a) => {
      const lo = Math.max(1, a.ch - 2); const hi = Math.min(13, a.ch + 2);
      return `<div class="ch-row"><div class="ch-name" title="${esc(a.name)}">${esc(a.name)}<span class="faint"> · ${a.clients}</span></div>
        <div class="ch-track"><i class="ch-bar ${a.level}" style="left:${((lo - 1) / 13) * 100}%;width:${((hi - lo + 1) / 13) * 100}%"></i>
        <b class="ch-mark" style="left:${((a.ch - 0.5) / 13) * 100}%">${a.ch}</b></div></div>`;
    }).join('');
    const axis = `<div class="ch-row"><div class="ch-name"></div><div class="ch-axis">${Array.from({ length: 13 }, (_, i) => `<span>${i + 1}</span>`).join('')}</div></div>`;
    const changes = r.suggestion.filter((a) => a.suggested !== a.ch);
    const allAuto = r.two.length && r.two.every((a) => a.auto);
    return `<div class="card"><div class="card-head"><div class="avatar accent">${ic('wifi')}</div><h2>Kanalprüfung<div class="faint" style="font-weight:400;font-size:12.5px">2,4 GHz – je Gerät der belegte Frequenzbereich, dahinter die Anzahl WLAN-Geräte</div></h2>${badge}</div>
      <div class="card-body">
        ${r.two.length ? `<div class="ch-strip">${strip}${axis}</div>` : ''}
        ${r.issues.length ? `<div class="list" style="margin-top:14px">${r.issues.map((i) => `<div class="notice ${i.level === 'err' ? 'err' : ''}" style="margin-bottom:8px">${ic('alert')}<div>${i.text}</div></div>`).join('')}</div>` : '<div class="notice info" style="margin-top:14px;background:var(--ok-soft)">' + ic('checkCircle') + '<div>Die 2,4-GHz-Netze deiner Geräte stören sich nicht gegenseitig.</div></div>'}
        ${r.issues.length && changes.length ? `<div style="margin-top:14px"><b style="font-size:13.5px">Vorschlag</b> <span class="muted" style="font-size:12.5px">– die Geräte mit den meisten WLAN-Geräten bekommen eigene, überlappungsfreie Kanäle (1 / 6 / 11):</span>
          <table class="table" style="margin-top:8px"><thead><tr><th style="cursor:default">Gerät</th><th style="cursor:default">Aktuell</th><th style="cursor:default">Vorschlag</th></tr></thead><tbody>
          ${r.suggestion.map((a) => `<tr><td>${esc(a.name)}</td><td class="num">${a.ch}</td><td class="num">${a.suggested === a.ch ? `<span class="faint">${a.ch} (bleibt)</span>` : `<b>${a.suggested}</b>`}</td></tr>`).join('')}</tbody></table>
          <p class="muted" style="font-size:12.5px;margin:10px 0 0">Ändern in der Oberfläche der jeweiligen Box unter <b>WLAN › Funkkanal</b>: „Funkkanal-Einstellungen anpassen“, 2,4-GHz-Kanal festlegen.${allAuto ? ' Aktuell wählen alle Boxen ihren Kanal per <b>Autokanal</b> selbst – die Box berücksichtigt dabei auch Nachbar-WLANs, die FritzHub nicht sieht. Ein fester Kanal lohnt sich vor allem, wenn es spürbare Probleme gibt.' : ''}</p></div>` : ''}
        ${r.five.length ? `<p class="muted" style="font-size:12.5px;margin:14px 0 0"><b>5 GHz:</b> ${r.five.map((a) => `${esc(a.name)} ${a.ch}`).join(' · ')}.${r.fiveShared.length ? ' Einige Geräte teilen sich einen 80-MHz-Kanalblock – bei Repeatern mit WLAN-Anbindung ist das so gewollt, weil sie auf dem Kanal des Mesh Masters verbunden sind.' : ''}</p>` : ''}
      </div></div>`;
  }

  // Device details -------------------------------------------------------------
  const PINGPONG = 6;  // roams per 24 h (same threshold as the backend)
  function ring(btn) {
    if (!btn) return;
    btn.classList.remove('ring'); void btn.offsetWidth; btn.classList.add('ring');
    setTimeout(() => btn.classList.remove('ring'), 900);
  }
  async function setWatched(h, watched) {
    await api('watch', { method: 'POST', body: { mac: h.mac, watched } });
    h.watched = watched;
  }

  // availability timeline from on/off events: [[start, end, state]] within the window
  function availability(events, active, windowStart, now, trackingSince) {
    const ev = events.filter((e) => e[1] === 'on' || e[1] === 'off').sort((a, b) => a[0] - b[0]);
    const before = ev.filter((e) => e[0] < windowStart);
    let state;
    if (before.length) state = before[before.length - 1][1] === 'on';
    else {
      const first = ev.find((e) => e[0] >= windowStart);
      state = first ? first[1] === 'off' : !!active;
    }
    const start = Math.max(windowStart, trackingSince || windowStart);
    const segs = [];
    if (start > windowStart) segs.push([windowStart, start, null]);
    let t = start;
    ev.filter((e) => e[0] >= start).forEach((e) => {
      const next = e[1] === 'on';
      if (next !== state) { segs.push([t, e[0], state]); t = e[0]; state = next; }
    });
    segs.push([t, now, state]);
    return segs.filter((sg) => sg[1] > sg[0]);
  }

  function eventText(e) {
    if (e[1] === 'roam') return [`Wechsel ${esc(e[2])} → <b>${esc(e[3])}</b>${e[4] ? ` <span class="faint">(${esc(e[4])})</span>` : ''}`, 'repeater', ''];
    if (e[1] === 'band') return [`Bandwechsel ${esc(e[2])} → <b>${esc(e[3])}</b>${e[4] ? ` <span class="faint">an ${esc(e[4])}</span>` : ''}`, 'wifi', ''];
    if (e[1] === 'on') return [`Online${e[2] ? ` <span class="faint">über ${esc(e[2])}</span>` : ''}`, 'checkCircle', 'ok'];
    return ['Offline', 'power', 'err'];
  }

  async function openDeviceDetail(mac, redraw) {
    const h = (S.hosts || []).find((x) => x.mac === mac) || { mac };
    let hist;
    try { hist = await api(`devices/${encodeURIComponent(mac)}/history`); } catch (e) { toast(e.message, 'err'); return; }
    const now = Date.now() / 1000; const weekStart = now - 7 * 86400;
    // recording starts with the first known event or sighting of the device
    const firstEvent = hist.events.length ? Math.min(...hist.events.map((e) => e[0])) : Infinity;
    const since = Math.min(h.first_seen || Infinity, firstEvent, now);
    const segs = availability(hist.events, h.active, weekStart, now, since || weekStart);
    const known = segs.filter((sg) => sg[2] !== null);
    const knownTime = known.reduce((n, sg) => n + sg[1] - sg[0], 0);
    const onTime = known.filter((sg) => sg[2]).reduce((n, sg) => n + sg[1] - sg[0], 0);
    const outages = hist.events.filter((e) => e[1] === 'off' && e[0] >= weekStart).length;
    const bar = segs.map((sg) => `<i class="${sg[2] === null ? 'unk' : sg[2] ? 'on' : 'off'}" style="width:${((sg[1] - sg[0]) / (now - weekStart)) * 100}%" title="${sg[2] === null ? 'Noch nicht aufgezeichnet' : sg[2] ? 'Online' : 'Offline'}: ${fmtDateTime(sg[0])} – ${fmtDateTime(sg[1])}"></i>`).join('');
    const days = Array.from({ length: 7 }, (_, i) => new Date((weekStart + (i + 0.5) * 86400) * 1000).toLocaleDateString('de-DE', { weekday: 'short' }));
    // hourly averages – 10-minute values over 3 days are too noisy to read
    const hourly = {};
    (hist.signal || []).forEach(([t, v]) => { const k = Math.floor(t / 3600) * 3600; (hourly[k] = hourly[k] || []).push(v); });
    const sig = Object.entries(hourly).map(([t, v]) => [Number(t), Math.round(v.reduce((a, b) => a + b, 0) / v.length)]).sort((a, b) => a[0] - b[0]);
    const sigVals = sig.map((x) => x[1]);
    const sigAvg = sigVals.length ? Math.round(sigVals.reduce((a, b) => a + b, 0) / sigVals.length) : null;
    const recent = [...hist.events].reverse().slice(0, 40);
    const wl = isWlan(h) || !!hist.band;
    const vendor = h.private ? 'Private MAC (zufällig)' : h.vendor;
    modal({
      title: h.name || mac,
      wide: true,
      cls: 'device-detail',
      body: `<div class="dd-grid">
        <div><dl class="kv">
          <dt>Status</dt><dd>${h.active ? '<span style="color:var(--ok)">● Online</span>' : `<span class="faint">● Offline</span>${h.last_seen ? ` <span class="faint">seit ${fmtAgo(h.last_seen)}</span>` : ''}`}</dd>
          ${h.ip ? `<dt>IP</dt><dd class="mono">${esc(h.ip)}</dd>` : ''}
          <dt>MAC</dt><dd class="mono">${esc(mac)}</dd>
          ${vendor ? `<dt>Hersteller</dt><dd>${esc(vendor)}</dd>` : ''}
          ${h.active && (hist.ap || h.connected_to) ? `<dt>Verbunden über</dt><dd>${esc(hist.ap || h.connected_to)}${hist.band || h.band ? ` · ${esc(hist.band || h.band)}` : wl ? '' : ' · LAN'}</dd>` : ''}
          ${h.active && h.signal != null ? `<dt>Signal</dt><dd><span class="row" style="gap:6px;justify-content:flex-end">${signalBars(h.signal)}</span></dd>` : ''}
          ${h.first_seen ? `<dt>Erstmals gesehen</dt><dd>${fmtDateTime(h.first_seen)}</dd>` : ''}
        </dl>
        <div class="row wrap" style="gap:8px;margin-top:14px">
          <button class="btn sm ${h.watched ? 'primary' : ''}" id="ddWatch">${ic('bell')}${h.watched ? 'Wird beobachtet' : 'Beobachten'}</button>
          ${(h.web || []).map((w) => `<a class="btn sm" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${ic('globe')}Weboberfläche</a>`).join('')}
        </div></div>
        <div>
          <div class="dd-head"><b>Verfügbarkeit – 7 Tage</b><span class="faint">${knownTime ? `${Math.round((onTime / knownTime) * 100)} % online · ${outages} ${outages === 1 ? 'Ausfall' : 'Ausfälle'}` : ''}</span></div>
          <div class="avail">${bar}</div>
          <div class="avail-axis">${days.map((d) => `<span>${d}</span>`).join('')}</div>
          ${wl ? `<div class="dd-head" style="margin-top:18px"><b>Signalstärke – 3 Tage</b><span class="faint">${sigAvg != null ? `Ø ${sigAvg} % · min. ${Math.min(...sigVals)} %` : ''}</span></div>
          ${sig.length > 1 ? sparkline(sig.map((x) => [x[0], x[1]]), 1, `${signalClass(sigAvg)} big`) : '<div class="faint" style="font-size:12.5px">Noch keine Signalwerte aufgezeichnet.</div>'}` : ''}
        </div>
      </div>
      ${hist.pingpong ? `<div class="notice" style="margin-top:16px">${ic('alert')}<div><b>Springt häufig zwischen Zugangspunkten</b> – ${hist.roams_24h} Wechsel in 24 Stunden. Das passiert, wenn ein Gerät etwa gleich weit von zwei Repeatern entfernt ist, und führt zu kurzen Aussetzern. Abhilfe: das Gerät oder einen Repeater etwas versetzen, sodass ein Zugangspunkt klar stärker ist.</div></div>` : ''}
      <div class="dd-head" style="margin-top:18px"><b>Ereignisse</b><span class="faint">${hist.roams_24h} ${hist.roams_24h === 1 ? 'Wechsel' : 'Wechsel'} in 24 Std</span></div>
      <div class="card"><div class="list">${recent.map((e) => {
        const [text, icon, cls] = eventText(e);
        return `<div class="list-item" style="padding:8px 14px"><div class="avatar ${cls}" style="width:28px;height:28px">${ic(icon)}</div><div class="grow" style="font-size:13px">${text}</div><span class="faint nowrap" style="font-size:12px" title="${fmtDateTime(e[0])}">${fmtAgo(e[0])}</span></div>`;
      }).join('') || '<div class="muted" style="padding:12px 14px;font-size:13px">Noch keine Ereignisse aufgezeichnet – FritzHub protokolliert ab jetzt jeden Wechsel.</div>'}</div></div>`,
      onMount(m) {
        m.querySelector('#ddWatch').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
          try {
            await setWatched(h, !h.watched);
            const b = m.querySelector('#ddWatch');
            b.classList.toggle('primary', h.watched);
            b.innerHTML = `${ic('bell')}${h.watched ? 'Wird beobachtet' : 'Beobachten'}`;
            toast(h.watched ? 'Gerät wird beobachtet.' : 'Beobachtung beendet.');
            if (redraw) redraw();
          } catch (err) { toast(err.message, 'err'); }
        }));
      },
    });
  }

  // Network check ------------------------------------------------------------
  async function renderNetcheck(el, token) {
    setHeader('Netzwerk-Check', 'Empfehlungen aus allen Messwerten des Mesh-Netzes', `<button class="btn" id="reloadBtn">${ic('refresh')}<span class="hide-sm">Neu prüfen</span></button>`);
    el.innerHTML = loading(6);
    let data;
    try { [data, S.hosts] = await Promise.all([api('netcheck'), api('hosts')]); } catch (e) { el.innerHTML = errorBox(e.message); return; }
    if (stale(token)) return;
    $('#reloadBtn').addEventListener('click', () => navigate());

    const findings = []; const ok = [];
    const add = (level, title, text, items = [], link = null) => findings.push({ level, title, text, items, link });
    const list = onlineBoxes();

    // WLAN channels
    const ch = channelAnalysis(list.filter((b) => (b.wlan || []).length));
    if (ch.issues.length) add(ch.issues.some((i) => i.level === 'err') ? 'warn' : 'info', 'WLAN-Kanäle überschneiden sich', 'Zugangspunkte im 2,4-GHz-Band stören sich gegenseitig.', ch.issues.map((i) => i.text), ['#/wlan', 'Zur Kanalprüfung']);
    else if (ch.two.length) ok.push('WLAN-Kanäle ohne Überschneidung');

    // uplinks of repeaters
    const slowLan = list.filter((b) => lanSlow(b.uplink));
    if (slowLan.length) add('warn', 'Langsame LAN-Anbindung', `Zwischen FRITZ!-Geräten sind mindestens 1 Gbit/s üblich. ${LAN_CAUSES}`, slowLan.map((b) => `<b>${esc(boxName(b))}</b> mit ${mbit(b.uplink.speed)}${b.uplink.parent ? ` zu ${esc(b.uplink.parent)}` : ''}`), ['#/topology', 'Zur Topologie']);
    const wlanUp = list.filter((b) => b.uplink && b.uplink.type !== 'lan');
    const weakUp = wlanUp.filter((b) => b.uplink.signal < 60);
    if (weakUp.length) add(weakUp.some((b) => b.uplink.signal < WEAK_SIGNAL) ? 'warn' : 'info', 'Schwache WLAN-Anbindung von Repeatern', 'Alle Geräte an diesen Repeatern sind dadurch langsamer. Abhilfe: Repeater näher an die übergeordnete Box stellen oder per LAN anbinden.', weakUp.map((b) => `<b>${esc(boxName(b))}</b>: ${b.uplink.signal} % · ${mbit(b.uplink.speed_tx)}`), ['#/topology', 'Zur Topologie']);
    if (list.some((b) => b.uplink_known) && !slowLan.length && !weakUp.length) ok.push('Anbindung aller Repeater in Ordnung');

    // load of the access points
    const loads = data.ap_load || [];
    if (loads.length >= 2) {
      const [top, ...rest] = loads;
      const avgRest = rest.reduce((n, a) => n + a.clients, 0) / rest.length;
      if (top.clients >= 15 && top.clients > 2 * Math.max(1, avgRest)) {
        add('info', 'Ein Zugangspunkt trägt die meisten WLAN-Geräte', `<b>${esc(top.ap)}</b> versorgt ${top.clients} von ${loads.reduce((n, a) => n + a.clients, 0)} WLAN-Geräten. Bei vielen gleichzeitig aktiven Geräten teilen sich alle die Sendezeit dieses Zugangspunkts – ein weiterer Repeater in der Nähe oder ein anderer Standort kann entlasten.`, loads.map((a) => `${esc(a.ap)}: ${a.clients} Geräte <span class="faint">(${a['2,4 GHz']} × 2,4 GHz, ${a['5 GHz']} × 5 GHz${a['6 GHz'] ? `, ${a['6 GHz']} × 6 GHz` : ''})</span>`), ['#/topology', 'Zur Topologie']);
      } else ok.push('WLAN-Geräte gleichmäßig auf die Zugangspunkte verteilt');
    }

    // devices
    if (data.weak.length) add('warn', 'Geräte mit dauerhaft schwachem Signal', 'Durchschnitt der letzten 24 Stunden unter 40 %. Solche Geräte verbinden sich langsam und verlieren häufiger die Verbindung – oft hilft ein Repeater in der Nähe oder ein anderer Standort.', data.weak.map((w) => `<b>${esc(w.name)}</b> – Ø ${Math.round(w.avg)} % an ${esc(w.ap)} <span class="faint">(${esc(w.band || '')})</span>`), ['#/devices', 'Zur Geräteliste', 'weak']);
    else ok.push('Kein Gerät mit dauerhaft schwachem Signal');
    if (data.roaming.length) add('warn', 'Geräte springen zwischen Zugangspunkten', 'Häufiger Wechsel entsteht, wenn ein Gerät etwa gleich weit von zwei Zugangspunkten entfernt ist, und führt zu kurzen Aussetzern. Abhilfe: Gerät oder Repeater etwas versetzen.', data.roaming.map((r) => `<b>${esc(r.name)}</b> – ${r.roams} Wechsel in 24 Std zwischen ${r.aps.map(esc).join(' und ')}`), ['#/devices', 'Zur Geräteliste']);
    else ok.push('Kein Gerät springt auffällig zwischen Zugangspunkten');
    if (data.band_hint.length) add('info', 'Geräte im 2,4-GHz-Netz, die auch 5 GHz können', 'Diese Geräte waren schon im schnelleren 5-GHz-Netz, hängen aber gerade im 2,4-GHz-Netz – meist wegen der Entfernung. Näher am Zugangspunkt wechseln sie von selbst zurück.', data.band_hint.map((b) => `<b>${esc(b.name)}</b> an ${esc(b.ap)}${b.signal != null ? ` <span class="faint">(${b.signal} %)</span>` : ''}`), ['#/devices', 'Zur Geräteliste']);
    const staleN = (S.hosts || []).filter(isStale).length;
    if (staleN) add('info', `${staleN} Geräte seit über 30 Tagen offline`, 'Alte Einträge machen die Geräteliste unübersichtlich. In der FRITZ!Box unter Heimnetz › Netzwerk lassen sie sich entfernen.', [], ['#/devices', 'Zur Geräteliste', 'stale']);
    const updates = list.filter((b) => b.info && b.info.update_available);
    if (updates.length) add('info', 'FRITZ!OS-Update verfügbar', 'Updates schließen Sicherheitslücken und verbessern oft das Mesh.', updates.map((b) => `<b>${esc(boxName(b))}</b> → FRITZ!OS ${esc(b.info.update_version || '')}`), ['#/system', 'Zum System']);
    else ok.push('FRITZ!OS auf allen Geräten aktuell');

    const order = { err: 0, warn: 1, info: 2 };
    findings.sort((a, b) => order[a.level] - order[b.level]);
    const counts = { warn: findings.filter((f) => f.level !== 'info').length, info: findings.filter((f) => f.level === 'info').length };
    const since = data.data_since ? new Date(data.data_since * 1000).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : null;
    const head = counts.warn ? ['warn', 'alert', `${counts.warn} ${counts.warn === 1 ? 'Problem' : 'Probleme'} gefunden`]
      : counts.info ? ['accent', 'info', `Keine Probleme – ${counts.info} ${counts.info === 1 ? 'Hinweis' : 'Hinweise'}`] : ['ok', 'checkCircle', 'Alles in Ordnung'];
    el.innerHTML = `<div class="card nc-head"><div class="avatar ${head[0]}" style="width:48px;height:48px">${ic(head[1])}</div>
        <div class="grow"><div style="font-size:18px;font-weight:700">${head[2]}</div>
        <div class="muted" style="font-size:13px">${findings.length + ok.length} Prüfungen · Geräte-Auswertungen über die letzten 24 Stunden${since ? ` (Daten seit ${since})` : ''}</div></div></div>
      ${findings.map((f) => `<div class="card nc-item ${f.level}"><div class="card-head"><div class="avatar ${f.level === 'info' ? 'accent' : f.level}">${ic(f.level === 'info' ? 'info' : 'alert')}</div><h2>${f.title}</h2>${f.link ? `<a class="btn sm ghost" href="${f.link[0]}" ${f.link[2] ? `data-devkind="${f.link[2]}"` : ''}>${f.link[1]} ${ic('chevron')}</a>` : ''}</div>
        <div class="card-body"><p class="muted" style="margin:0 0 ${f.items.length ? 10 : 0}px;font-size:13.5px">${f.text}</p>
        ${f.items.length ? `<ul class="nc-list">${f.items.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}</div></div>`).join('')}
      ${ok.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>In Ordnung <span class="sub">${ok.length}</span></h2></div><div class="card-body"><ul class="nc-ok">${ok.map((o) => `<li>${ic('check')}${o}</li>`).join('')}</ul></div></div>` : ''}`;
    // links to the device list open it with the matching filter
    $$('[data-devkind]').forEach((a) => a.addEventListener('click', () => {
      store.set('devFilter', { ...store.get('devFilter', { q: '', sort: 'name', dir: 1 }), kind: a.dataset.devkind, q: '' });
    }));
  }

  // ------------------------------------------------------------------ calls
  const CALL = {
    incoming: ['callIn', 'Eingehend', 'incoming'],
    active_incoming: ['callIn', 'Aktiv (eingehend)', 'incoming'],
    outgoing: ['callOut', 'Ausgehend', 'outgoing'],
    active_outgoing: ['callOut', 'Aktiv (ausgehend)', 'outgoing'],
    missed: ['callMissed', 'Verpasst', 'missed'],
    rejected: ['ban', 'Abgewiesen', 'rejected'],
    unknown: ['phone', 'Anruf', ''],
  };

  async function renderCalls(el, token) {
    const list = boxesWith('phone');
    const f = store.get('callFilter', { kind: 'all', days: 30, q: '' });
    if (!list.length) { setHeader('Anrufe'); el.innerHTML = `<div class="card">${empty('phone', 'Keine Telefonie verfügbar', 'Keine der verbundenen Boxen stellt eine Anrufliste bereit. Der Benutzer benötigt das Recht „Sprachnachrichten, Faxnachrichten, FRITZ!App Fon und Anrufliste“.')}</div>`; return; }
    const box = selectedBox('calls', list);
    setHeader('Anrufe', esc(boxName(box)), `${boxSelect('calls', list)}<select class="input" id="days" style="width:auto">${[7, 30, 90, 365].map((d) => `<option value="${d}" ${f.days === d ? 'selected' : ''}>${d === 365 ? '1 Jahr' : `${d} Tage`}</option>`).join('')}</select>`);
    bindBoxSelect('calls', () => navigate());
    $('#days').addEventListener('change', (e) => { f.days = Number(e.target.value); store.set('callFilter', f); navigate(); });
    el.innerHTML = loading(8);
    let data;
    try { data = await api(`calls/${box.config.id}?days=${f.days}`); } catch (e) { el.innerHTML = errorBox(e.message); return; }
    if (stale(token)) return;

    // numbers are compared without formatting and country prefix (+49 / 0049 -> 0)
    const normNum = (n) => {
      let d = String(n || '').replace(/[^\d]/g, '');
      if (d.startsWith('0049')) d = `0${d.slice(4)}`;
      else if (d.startsWith('49') && d.length > 10) d = `0${d.slice(2)}`;
      return d;
    };
    const blockedMap = () => new Map((data.barring || []).map((b) => [normNum(b.number), b]));
    const kinds = { all: ['Alle', () => true], incoming: ['Eingehend', (c) => c.type.endsWith('incoming')], outgoing: ['Ausgehend', (c) => c.type.endsWith('outgoing')], missed: ['Verpasst', (c) => c.type === 'missed' || c.type === 'rejected'] };
    const barringCard = () => `<div class="card"><div class="card-head"><h2>Gesperrte Nummern <span class="sub">${(data.barring || []).length}</span></h2></div>
      ${data.barring_error ? `<div class="card-body">${errorBox(`Rufsperren nicht abrufbar: ${data.barring_error}`)}</div>` : `<div class="card-body flush"><div class="list">${(data.barring || []).map((b) => `<div class="list-item">
        <div class="avatar err">${ic('ban')}</div><div class="grow"><div class="title">${esc(b.name || b.number)}</div>${b.name && b.name !== b.number ? `<div class="meta">${esc(b.number)}</div>` : ''}</div>
        <button class="icon-btn" title="Sperre aufheben" data-unblock="${b.uid}">${ic('x')}</button></div>`).join('') || '<div class="muted" style="padding:6px 18px 12px;font-size:13px">Keine Nummern gesperrt. Über das Sperr-Symbol an einem Anruf lässt sich eine Nummer direkt sperren.</div>'}</div></div>
      <form class="card-body row" id="blockAdd" style="gap:8px;border-top:1px solid var(--border);flex-wrap:wrap">
        <input class="input" id="blockNumber" placeholder="Rufnummer" style="flex:1 1 120px" inputmode="tel">
        <input class="input" id="blockName" placeholder="Bezeichnung (optional)" style="flex:1 1 140px">
        <button class="btn danger" type="submit">${ic('ban')}Sperren</button></form>`}</div>`;
    const draw = () => {
      const q = f.q.trim().toLowerCase();
      const calls = data.calls.filter(kinds[f.kind][1]).filter((c) => !q || [c.name, c.number, c.own_number, c.device].some((v) => (v || '').toLowerCase().includes(q)));
      let lastDay = ''; let html = '';
      const blocked = blockedMap();
      calls.forEach((c) => {
        const d = parseFritzDate(c.date);
        const day = d ? dayLabel(d) : '';
        if (day !== lastDay) { html += `<div class="list-group">${esc(day)}</div>`; lastDay = day; }
        const [icon, label, cls] = CALL[c.type] || CALL.unknown;
        const who = c.name || c.number || 'Unbekannt';
        html += `<div class="list-item">
          <div class="avatar ${cls === 'missed' || cls === 'rejected' ? 'err' : cls === 'outgoing' ? 'accent' : 'ok'}">${ic(icon, `call-dir ${cls}`)}</div>
          <div class="grow"><div class="title" ${cls === 'missed' ? 'style="color:var(--err)"' : ''}>${esc(who)}${c.number && blocked.has(normNum(c.number)) ? ' <span class="badge err">Gesperrt</span>' : ''}</div>
          <div class="meta">${c.name && c.number ? `${esc(c.number)} · ` : ''}${label}${c.own_number ? ` · ${cls === 'outgoing' ? 'von' : 'an'} ${esc(c.own_number)}` : ''}${c.device ? ` · ${esc(c.device)}` : ''}</div></div>
          <div style="text-align:right" class="nowrap"><div class="num" style="font-weight:600">${d ? fmtTime(d) : esc(c.date)}</div><div class="faint" style="font-size:12px">${c.type === 'missed' ? '' : esc(fmtCallDuration(c.duration))}</div></div>
          ${c.number && normNum(c.number).length > 2 && !blocked.has(normNum(c.number)) && !c.type.endsWith('outgoing')
            ? `<button class="icon-btn danger" title="Nummer sperren" data-block="${esc(c.number)}" data-name="${esc(c.name || '')}">${ic('ban')}</button>`
            : '<span style="width:34px;flex:none"></span>'}
        </div>`;
      });
      const counts = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, data.calls.filter(v[1]).length]));
      const defl = data.deflections.length ? `<div class="card"><div class="card-head"><h2>Rufumleitungen</h2></div><div class="card-body flush"><div class="list">${data.deflections.map((d) => `<div class="list-item">
          <div class="avatar">${ic('forward')}</div><div class="grow"><div class="title">${esc(d.number || 'Alle Anrufe')} → ${esc(d.target || '–')}</div><div class="meta">${esc(d.mode || '')}${d.type ? ` · ${esc(d.type)}` : ''}</div></div>
          ${sw(d.enabled, `data-defl="${d.id}"`)}</div>`).join('')}</div></div></div>` : '';
      el.innerHTML = `<div class="toolbar">
          <div class="input-icon search">${ic('search')}<input class="input" id="q" placeholder="Name oder Nummer …" value="${esc(f.q)}"></div>
          <div class="seg" id="kinds">${Object.entries(kinds).map(([k, v]) => `<button data-kind="${k}" class="${f.kind === k ? 'active' : ''}">${v[0]} <span class="n">${counts[k]}</span></button>`).join('')}</div>
        </div>
        <div class="grid dash"><div class="card">${html ? `<div class="list">${html}</div>` : empty('phone', 'Keine Anrufe', 'Im gewählten Zeitraum wurden keine passenden Anrufe gefunden.')}</div>
          <div>${barringCard()}${defl ? `<div style="height:16px"></div>${defl}` : ''}</div></div>`;
      const qi = $('#q');
      qi.addEventListener('input', () => { f.q = qi.value; store.set('callFilter', f); const pos = qi.selectionStart; draw(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
      $$('#kinds button').forEach((b) => b.addEventListener('click', () => { f.kind = b.dataset.kind; store.set('callFilter', f); draw(); }));
      const block = async (number, name) => {
        if (!(await confirmDialog('Nummer sperren?', `Anrufe von <b>${esc(name || number)}</b>${name ? ` (${esc(number)})` : ''} werden künftig von der FRITZ!Box abgewiesen. Die Sperre steht danach auch in der Box unter <b>Telefonie › Rufbehandlung › Rufsperren</b>.`, { ok: 'Sperren', danger: true }))) return;
        try {
          const r = await api(`callbarring/${box.config.id}`, { method: 'POST', body: { number, name: name || null } });
          data.barring = [...(data.barring || []), { uid: r.uid, name: name || number, number }];
          toast(`${name || number} ist gesperrt.`); draw();
        } catch (e) { toast(e.message, 'err'); }
      };
      $$('[data-block]').forEach((b) => b.addEventListener('click', () => block(b.dataset.block, b.dataset.name)));
      $$('[data-unblock]').forEach((b) => b.addEventListener('click', async () => {
        const entry = data.barring.find((x) => String(x.uid) === b.dataset.unblock);
        if (!(await confirmDialog('Sperre aufheben?', `Anrufe von <b>${esc(entry.name || entry.number)}</b> werden wieder durchgestellt.`, { ok: 'Entsperren' }))) return;
        try {
          await api(`callbarring/${box.config.id}/${entry.uid}`, { method: 'DELETE' });
          data.barring = data.barring.filter((x) => x !== entry); toast('Sperre aufgehoben.'); draw();
        } catch (e) { toast(e.message, 'err'); }
      }));
      const addForm = $('#blockAdd');
      if (addForm) addForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const number = $('#blockNumber').value.trim();
        if (normNum(number).length < 3) { toast('Bitte eine Rufnummer eingeben.', 'err'); return; }
        block(number, $('#blockName').value.trim());
      });
      $$('[data-defl]').forEach((c) => c.addEventListener('change', async () => {
        c.disabled = true;
        try { await api(`deflections/${box.config.id}/${c.dataset.defl}`, { method: 'POST', body: { enabled: c.checked } }); toast(c.checked ? 'Rufumleitung aktiviert.' : 'Rufumleitung deaktiviert.'); const d = data.deflections.find((x) => String(x.id) === c.dataset.defl); if (d) d.enabled = c.checked; } catch (e) { toast(e.message, 'err'); c.checked = !c.checked; }
        c.disabled = false;
      }));
    };
    draw();
  }

  // -------------------------------------------------------------------- TAM
  async function renderTam(el, token) {
    const list = boxesWith('tam');
    if (!list.length) { setHeader('Anrufbeantworter'); el.innerHTML = `<div class="card">${empty('voicemail', 'Kein Anrufbeantworter', 'Keine der verbundenen Boxen hat einen aktiven Anrufbeantworter.')}</div>`; return; }
    const box = selectedBox('tam', list);
    setHeader('Anrufbeantworter', esc(boxName(box)), `${boxSelect('tam', list)}<button class="btn" id="reloadBtn">${ic('refresh')}<span class="hide-sm">Aktualisieren</span></button>`);
    bindBoxSelect('tam', () => navigate());
    $('#reloadBtn').addEventListener('click', () => navigate());
    el.innerHTML = loading(6);
    let tams;
    try { tams = await api(`tam/${box.config.id}`); } catch (e) { el.innerHTML = errorBox(e.message); return; }
    if (stale(token)) return;

    const audio = new Audio(); let playing = null;
    S.cleanup.push(() => { audio.pause(); audio.src = ''; });
    const bid = box.config.id;
    const fmtS = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
    const draw = () => {
      if (!tams.length) { el.innerHTML = `<div class="card">${empty('voicemail', 'Kein Anrufbeantworter eingerichtet', 'In der FRITZ!Box ist unter Telefonie › Telefoniegeräte kein Anrufbeantworter angelegt.')}</div>`; return; }
      el.innerHTML = tams.map((t) => {
        const nNew = t.messages.filter((m) => m.new).length;
        return `<div class="card">
          <div class="card-head" style="padding-bottom:12px"><div class="avatar ${t.enabled ? 'accent' : ''}">${ic('voicemail')}</div>
            <h2>${esc(t.name)}<div class="faint" style="font-weight:400;font-size:12.5px">${t.messages.length} Nachrichten${nNew ? ` · <span style="color:var(--accent)">${nNew} neu</span>` : ''}</div></h2>
            <span class="muted hide-sm" style="font-size:13px">${t.enabled ? 'Aktiv' : 'Aus'}</span>${sw(t.enabled, `data-tam="${t.index}"`)}</div>
          ${t.error ? `<div style="padding:0 18px 16px">${errorBox(t.error)}</div>` : ''}
          <div class="list">${t.messages.map((m) => {
            const d = parseFritzDate(m.date); const key = `${t.index}:${m.index}`;
            return `<div class="list-item" data-msg="${key}">
              <button class="icon-btn" data-play="${key}" title="Abspielen" ${m.has_audio ? '' : 'disabled'} style="background:var(--accent-soft);color:var(--accent);border-radius:50%">${ic(playing === key && !audio.paused ? 'pause' : 'play')}</button>
              <div class="grow" style="max-width:320px"><div class="title ${m.new ? 'msg-new' : ''}">${esc(m.name || m.number || 'Unbekannt')}</div>
                <div class="meta">${m.name && m.number ? `${esc(m.number)} · ` : ''}${d ? `${dayLabel(d)}, ${fmtTime(d)}` : esc(m.date)} · ${esc(fmtCallDuration(m.duration))}</div></div>
              <div class="player hide-sm" data-player="${key}">${playing === key ? '<div class="track"><i style="width:0"></i></div><span class="time">0:00</span>' : ''}</div>
              <div class="actions row" style="gap:2px;margin-left:auto">
                ${m.new ? `<button class="icon-btn" data-read="${key}" title="Als gehört markieren">${ic('check')}</button>` : ''}
                <a class="icon-btn" href="${esc(withToken(`api/tam/${bid}/${t.index}/${m.index}/audio?download=1`))}" title="Herunterladen">${ic('download')}</a>
                <button class="icon-btn danger" data-del="${key}" title="Löschen">${ic('trash')}</button>
              </div></div>`;
          }).join('') || `<div style="padding:0 18px 18px" class="muted">Keine Nachrichten.</div>`}</div></div>`;
      }).join('<div style="height:16px"></div>');
      bind();
    };
    const msgOf = (key) => { const [ti, mi] = key.split(':').map(Number); const t = tams.find((x) => x.index === ti); return [t, t && t.messages.find((x) => x.index === mi)]; };
    const markRead = async (key) => {
      const [t, m] = msgOf(key); if (!m || !m.new) return;
      try {
        await api(`tam/${bid}/${t.index}/${m.index}/read`, { method: 'POST', body: { read: true } });
        m.new = false;
        if (box.phone && box.phone.new_messages) { box.phone.new_messages -= 1; renderNav(); }
      } catch (e) { toast(e.message, 'err'); }
    };
    const updatePlayer = () => {
      if (!playing) return;
      const p = $(`[data-player="${playing}"]`); if (!p) return;
      const i = p.querySelector('i'); const tm = p.querySelector('.time');
      if (i && audio.duration) i.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
      if (tm) tm.textContent = `${fmtS(audio.currentTime)} / ${fmtS(audio.duration)}`;
    };
    audio.addEventListener('timeupdate', updatePlayer);
    audio.addEventListener('ended', () => { playing = null; draw(); });
    audio.addEventListener('error', () => { if (playing) { toast('Nachricht konnte nicht abgespielt werden.', 'err'); playing = null; draw(); } });
    const bind = () => {
      $$('[data-play]').forEach((b) => b.addEventListener('click', async () => {
        const key = b.dataset.play;
        if (playing === key) { if (audio.paused) audio.play(); else audio.pause(); draw(); return; }
        const [t, m] = msgOf(key);
        playing = key; audio.src = withToken(`api/tam/${bid}/${t.index}/${m.index}/audio`);
        draw();
        try { await audio.play(); } catch { /* error event handles it */ }
        await markRead(key); draw(); updatePlayer();
      }));
      $$('.player').forEach((p) => p.addEventListener('click', (e) => {
        const tr = p.querySelector('.track'); if (!tr || !audio.duration) return;
        const r = tr.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
      }));
      $$('[data-read]').forEach((b) => b.addEventListener('click', async () => { await markRead(b.dataset.read); draw(); }));
      $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        const [t, m] = msgOf(b.dataset.del);
        if (!(await confirmDialog('Nachricht löschen?', `Die Nachricht von <b>${esc(m.name || m.number || 'Unbekannt')}</b> wird endgültig von der FRITZ!Box gelöscht.`, { ok: 'Löschen', danger: true }))) return;
        try {
          await api(`tam/${bid}/${t.index}/${m.index}`, { method: 'DELETE' });
          if (playing === b.dataset.del) { audio.pause(); playing = null; }
          t.messages = t.messages.filter((x) => x !== m); toast('Nachricht gelöscht.'); draw();
        } catch (e) { toast(e.message, 'err'); }
      }));
      $$('[data-tam]').forEach((c) => c.addEventListener('change', async () => {
        c.disabled = true;
        try { await api(`tam/${bid}/${c.dataset.tam}/enable`, { method: 'POST', body: { enabled: c.checked } }); const t = tams.find((x) => String(x.index) === c.dataset.tam); t.enabled = c.checked; toast(c.checked ? 'Anrufbeantworter eingeschaltet.' : 'Anrufbeantworter ausgeschaltet.'); draw(); } catch (e) { toast(e.message, 'err'); c.checked = !c.checked; c.disabled = false; }
      }));
    };
    draw();
  }

  // -------------------------------------------------------------------- NAS
  const PREVIEW = {
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'],
    pdf: ['pdf'],
    video: ['mp4', 'webm', 'm4v', 'mov', 'ogv'],
    audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'],
    text: ['txt', 'log', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'ini', 'conf', 'cfg', 'sh', 'py', 'js', 'ts',
      'css', 'html', 'htm', 'sql', 'toml', 'properties', 'nfo', 'srt'],
  };
  const TEXT_LIMIT = 2 * 1024 * 1024;
  function previewKind(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return Object.keys(PREVIEW).find((k) => PREVIEW[k].includes(ext)) || null;
  }

  // Preview dialog for NAS files; ←/→ step through all previewable files of the folder
  function openPreview(files, index, urlFor) {
    let i = index;
    let onKey = null;
    modal({
      title: files[i].name,
      cls: 'preview',
      body: '<div class="pv-stage" id="pvStage"></div>',
      foot: `<span class="faint left" id="pvInfo" style="font-size:12.5px;align-self:center"></span>
        <button class="btn" id="pvPrev" title="Vorherige (←)">${ic('chevron', 'flip')}</button>
        <button class="btn" id="pvNext" title="Nächste (→)">${ic('chevron')}</button>
        <a class="btn primary" id="pvDl">${ic('download')}Herunterladen</a>`,
      onMount(m) {
        const stage = m.querySelector('#pvStage');
        const show = async () => {
          const f = files[i];
          const kind = previewKind(f.name);
          const src = urlFor(f, true);
          m.querySelector('.modal-head h3').textContent = f.name;
          m.querySelector('#pvInfo').textContent = `${i + 1} / ${files.length} · ${fmtBytes(f.size)}`;
          m.querySelector('#pvDl').href = urlFor(f, false);
          m.querySelector('#pvPrev').disabled = i === 0;
          m.querySelector('#pvNext').disabled = i === files.length - 1;
          if (kind === 'image') stage.innerHTML = `<img src="${src}" alt="${esc(f.name)}">`;
          else if (kind === 'pdf') stage.innerHTML = `<iframe src="${src}" title="${esc(f.name)}"></iframe>`;
          else if (kind === 'video') stage.innerHTML = `<video src="${src}" controls autoplay playsinline></video>`;
          else if (kind === 'audio') stage.innerHTML = `<div class="pv-audio">${ic('music')}<audio src="${src}" controls autoplay></audio></div>`;
          else if (kind === 'text') {
            if (f.size > TEXT_LIMIT) { stage.innerHTML = `<div class="empty">Die Datei ist zu groß für die Vorschau (${fmtBytes(f.size)}).</div>`; return; }
            stage.innerHTML = `<div class="empty">${ic('refresh', 'spin')} Wird geladen …</div>`;
            try {
              const res = await fetch(src);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const text = await res.text();
              if (files[i] === f) stage.innerHTML = `<pre class="pv-text">${esc(text)}</pre>`;
            } catch (err) { stage.innerHTML = errorBox(`Vorschau nicht möglich: ${err.message}`); }
          }
          const media = stage.querySelector('img, video, audio');
          if (media) media.addEventListener('error', () => { stage.innerHTML = errorBox('Die Datei kann im Browser nicht angezeigt werden.'); });
        };
        const step = (d) => { if (files[i + d]) { i += d; show(); } };
        m.querySelector('#pvPrev').addEventListener('click', () => step(-1));
        m.querySelector('#pvNext').addEventListener('click', () => step(1));
        onKey = (e) => {
          if (e.key === 'ArrowLeft') step(-1);
          else if (e.key === 'ArrowRight') step(1);
        };
        document.addEventListener('keydown', onKey);
        show();
      },
      onClose: () => { if (onKey) document.removeEventListener('keydown', onKey); },
    });
  }

  function fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'svg'].includes(ext)) return 'image';
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) return 'music';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'ts'].includes(ext)) return 'video';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return 'archive';
    return 'file';
  }

  async function renderNas(el, token) {
    const list = onlineBoxes().filter((b) => b.info && b.info.is_router).concat(onlineBoxes().filter((b) => b.info && !b.info.is_router && b.info.services.storage));
    if (!list.length) { setHeader('FRITZ!NAS'); el.innerHTML = `<div class="card">${empty('folder', 'Kein FRITZ!NAS verfügbar', 'Keine erreichbare FRITZ!Box gefunden.')}</div>`; return; }
    const box = selectedBox('nas', list); const bid = box.config.id;
    let path = store.get(`nasPath.${bid}`, '/');
    setHeader('FRITZ!NAS', esc(boxName(box)), `${boxSelect('nas', list)}
      <button class="btn" id="mkdirBtn">${ic('folderPlus')}<span class="hide-sm">Neuer Ordner</span></button>
      <button class="btn primary" id="uploadBtn">${ic('upload')}<span class="hide-sm">Hochladen</span></button>
      <input type="file" id="fileInput" multiple hidden>`);
    bindBoxSelect('nas', () => navigate());
    let entries = []; let loadingNow = false;
    const join = (a, b) => (a.endsWith('/') ? a : `${a}/`) + b;

    const draw = (err) => {
      if (stale(token)) return;
      const parts = path.split('/').filter(Boolean);
      const crumbs = [`<button data-path="/">${ic('home')}</button>`].concat(parts.map((p, i) => `<span class="sep">${ic('chevron')}</span><button data-path="/${parts.slice(0, i + 1).map(esc).join('/')}">${esc(p)}</button>`)).join('');
      const rows = entries.map((e) => {
        const full = join(path, e.name);
        const pv = !e.dir && previewKind(e.name);
        return `<div class="list-item ${e.dir || pv ? 'clickable' : ''}" ${e.dir ? `data-open="${esc(full)}"` : pv ? `data-preview="${esc(e.name)}"` : ''}>
          <div class="avatar ${e.dir ? 'accent' : ''}">${ic(e.dir ? 'folder' : fileIcon(e.name))}</div>
          <div class="grow"><div class="title">${esc(e.name)}</div><div class="meta">${e.dir ? 'Ordner' : fmtBytes(e.size)}${e.modified ? ` · ${new Date(e.modified).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</div></div>
          <div class="actions row" style="gap:2px">
            ${pv ? `<button class="icon-btn hide-sm" title="Vorschau" data-preview-btn="${esc(e.name)}" data-stop>${ic('eye')}</button>` : ''}
            ${e.dir ? '' : `<a class="icon-btn" title="Herunterladen" href="${esc(withToken(`api/nas/${bid}/download?path=${encodeURIComponent(full)}`))}" data-stop>${ic('download')}</a>`}
            <button class="icon-btn" title="Umbenennen" data-rename="${esc(full)}" data-stop>${ic('edit')}</button>
            <button class="icon-btn danger" title="Löschen" data-del="${esc(full)}" data-dir="${e.dir ? 1 : 0}" data-stop>${ic('trash')}</button>
          </div></div>`;
      }).join('');
      el.innerHTML = `<div class="toolbar"><div class="crumbs">${crumbs}</div><div style="margin-left:auto" class="row">
          <span class="faint hide-sm" style="font-size:12.5px">${entries.length} Einträge</span>
          <button class="icon-btn" id="nasRefresh" title="Aktualisieren">${ic('refresh', loadingNow ? 'spin' : '')}</button></div></div>
        <div class="progress-list" id="progress"></div>
        <div class="card dropzone" id="drop">
          ${err ? `<div style="padding:18px">${errorBox(err)}<p class="muted" style="font-size:13px;margin:12px 0 0">Tipp: In der FRITZ!Box unter <b>Heimnetz › Speicher (NAS)</b> den Speicher aktivieren und unter <b>Heimnetz › Speicher (NAS) › Einstellungen › Heimnetzfreigabe</b> den <b>Zugriff über FTP</b> erlauben. Der Benutzer benötigt das Recht „Zugang zu NAS-Inhalten“.</p></div>`
            : rows ? `<div class="list">${rows}</div>` : loadingNow ? loading(4) : empty('folder', 'Ordner ist leer', 'Dateien hierher ziehen oder über „Hochladen“ hinzufügen.')}
        </div>`;
      $$('[data-path]').forEach((b) => b.addEventListener('click', () => go(b.dataset.path)));
      $$('[data-open]').forEach((r) => r.addEventListener('click', (e) => { if (!e.target.closest('[data-stop]')) go(r.dataset.open); }));
      const previewable = entries.filter((x) => !x.dir && previewKind(x.name));
      const urlFor = (f, inline) => withToken(`api/nas/${bid}/download?path=${encodeURIComponent(join(path, f.name))}${inline ? '&inline=1' : ''}`);
      const openByName = (name) => openPreview(previewable, previewable.findIndex((x) => x.name === name), urlFor);
      $$('[data-preview]').forEach((r) => r.addEventListener('click', (e) => { if (!e.target.closest('[data-stop]')) openByName(r.dataset.preview); }));
      $$('[data-preview-btn]').forEach((b) => b.addEventListener('click', () => openByName(b.dataset.previewBtn)));
      $('#nasRefresh').addEventListener('click', () => go(path));
      $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        const p = b.dataset.del; const isDir = b.dataset.dir === '1'; const name = p.split('/').pop();
        if (!(await confirmDialog(`${isDir ? 'Ordner' : 'Datei'} löschen?`, `<b>${esc(name)}</b>${isDir ? ' und sein gesamter Inhalt werden' : ' wird'} endgültig vom FRITZ!NAS gelöscht.`, { ok: 'Löschen', danger: true }))) return;
        try { await api(`nas/${bid}/delete`, { method: 'POST', body: { path: p, dir: isDir } }); toast(`„${name}“ gelöscht.`); go(path); } catch (e) { toast(e.message, 'err'); }
      }));
      $$('[data-rename]').forEach((b) => b.addEventListener('click', () => {
        const p = b.dataset.rename; const name = p.split('/').pop();
        modal({
          title: 'Umbenennen',
          body: `<div class="field"><label>Neuer Name</label><input class="input" id="newName" value="${esc(name)}"></div>`,
          foot: '<button class="btn" data-close>Abbrechen</button><button class="btn primary" id="ok">Umbenennen</button>',
          onMount(m, close) {
            const inp = m.querySelector('#newName'); inp.select();
            const submit = async () => {
              const nn = inp.value.trim(); if (!nn || nn === name || nn.includes('/')) { close(); return; }
              try { await api(`nas/${bid}/rename`, { method: 'POST', body: { from: p, to: join(path, nn) } }); close(); toast('Umbenannt.'); go(path); } catch (e) { toast(e.message, 'err'); }
            };
            m.querySelector('#ok').addEventListener('click', submit);
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
          },
        });
      }));
      const drop = $('#drop');
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || !drop.contains(e.relatedTarget)) drop.classList.remove('drag'); }));
      drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) upload(Array.from(e.dataTransfer.files)); });
    };

    const go = async (p) => {
      path = p || '/'; store.set(`nasPath.${bid}`, path); loadingNow = true; draw();
      try { entries = await api(`nas/${bid}/list?path=${encodeURIComponent(path)}`); loadingNow = false; draw(); } catch (e) {
        loadingNow = false; entries = [];
        if (path !== '/') { toast(e.message, 'err'); go('/'); return; }
        draw(e.message);
      }
    };

    const upload = async (files) => {
      const prog = $('#progress');
      for (const file of files) {
        const row = document.createElement('div'); row.className = 'card';
        row.innerHTML = `<div class="list-item"><div class="avatar accent">${ic('upload')}</div><div class="grow"><div class="title">${esc(file.name)}</div><div class="bar" style="margin-top:6px"><i style="width:0"></i></div></div><span class="faint num pct">0 %</span></div>`;
        prog.appendChild(row);
        await new Promise((resolve) => {
          const xhr = new XMLHttpRequest(); const fd = new FormData(); fd.append('file', file, file.name);
          xhr.open('POST', `api/nas/${bid}/upload?path=${encodeURIComponent(path)}`);
          if (authToken()) xhr.setRequestHeader('X-FritzHub-Token', authToken());
          xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const pc = Math.round((e.loaded / e.total) * 100); row.querySelector('i').style.width = `${pc}%`; row.querySelector('.pct').textContent = `${pc} %`; } };
          xhr.onload = () => {
            let ok = false; let msg = `HTTP ${xhr.status}`;
            try { const r = JSON.parse(xhr.responseText); ok = r.ok; msg = r.error || msg; } catch { /* ignore */ }
            if (ok) toast(`„${file.name}“ hochgeladen.`); else toast(`${file.name}: ${msg}`, 'err');
            row.remove(); resolve();
          };
          xhr.onerror = () => { toast(`${file.name}: Upload fehlgeschlagen`, 'err'); row.remove(); resolve(); };
          xhr.send(fd);
        });
      }
      go(path);
    };

    $('#uploadBtn').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) upload(files); });
    $('#mkdirBtn').addEventListener('click', () => modal({
      title: 'Neuer Ordner',
      body: '<div class="field"><label>Name</label><input class="input" id="dirName" placeholder="Neuer Ordner"></div>',
      foot: '<button class="btn" data-close>Abbrechen</button><button class="btn primary" id="ok">Erstellen</button>',
      onMount(m, close) {
        const inp = m.querySelector('#dirName');
        const submit = async () => {
          const nn = inp.value.trim(); if (!nn || nn.includes('/')) return;
          try { await api(`nas/${bid}/mkdir`, { method: 'POST', body: { path: join(path, nn) } }); close(); toast('Ordner erstellt.'); go(path); } catch (e) { toast(e.message, 'err'); }
        };
        m.querySelector('#ok').addEventListener('click', submit);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      },
    }));
    go(path);
  }

  // ----------------------------------------------------------------- system
  // Reboot several boxes one after another and follow them live:
  // Wartet -> Befehl gesendet -> Startet neu -> Wieder online (or error / timeout)
  const REBOOT_TIMEOUT = 10 * 60 * 1000;
  const STATES = {
    wait: ['clock', '', 'Wartet'],
    sending: ['refresh', 'accent', 'Befehl wird gesendet …'],
    sent: ['power', 'warn', 'Neustart ausgelöst – fährt herunter …'],
    down: ['refresh', 'warn', 'Startet neu …'],
    up: ['checkCircle', 'ok', 'Wieder online'],
    error: ['alert', 'err', 'Fehler'],
    timeout: ['alert', 'err', 'Keine Rückmeldung'],
  };
  const DONE = ['up', 'error', 'timeout'];
  const mmss = (ms) => { const t = Math.round(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  function rebootProgress(list, title = 'Alle Geräte werden neu gestartet') {
    const rows = list.map((b) => ({ id: b.config.id, name: boxName(b), master: isMaster(b.info), state: 'wait', t: null, end: null, error: null }));
    let closed = false; let offline = false; let timer = null;
    const started = Date.now();

    const render = (m) => {
      const done = rows.filter((r) => DONE.includes(r.state)).length;
      const ok = rows.filter((r) => r.state === 'up').length;
      const finished = done === rows.length;
      m.querySelector('#rbList').innerHTML = rows.map((r) => {
        const [icon, cls, label] = STATES[r.state];
        const spin = r.state === 'sending' || r.state === 'down';
        let detail = '';
        if (r.state === 'up') detail = `nach ${mmss(r.end - r.t)}`;
        else if (r.state === 'error') detail = r.error || '';
        else if (r.t && !DONE.includes(r.state)) detail = mmss(Date.now() - r.t);
        return `<div class="list-item" style="padding:10px 4px">
          <div class="avatar ${cls}" style="width:34px;height:34px">${ic(icon, spin ? 'spin' : '')}</div>
          <div class="grow"><div class="title">${esc(r.name)}${r.master ? ' <span class="badge accent">Mesh Master</span>' : ''}</div>
            <div class="meta" style="white-space:normal">${label}${detail ? ` · <span class="num">${esc(detail)}</span>` : ''}</div></div></div>`;
      }).join('');
      m.querySelector('#rbBar').style.width = `${(done / rows.length) * 100}%`;
      m.querySelector('#rbHead').innerHTML = finished
        ? `<b>${ok === rows.length ? (rows.length === 1 ? 'Das Gerät ist wieder online.' : 'Alle Geräte sind wieder online.') : `${ok} von ${rows.length} Geräten wieder online.`}</b> Dauer ${mmss(Date.now() - started)}`
        : `${done} von ${rows.length} abgeschlossen · ${mmss(Date.now() - started)}`;
      m.querySelector('#rbOffline').style.display = offline ? '' : 'none';
      m.querySelector('#rbClose').textContent = finished ? 'Fertig' : 'Ausblenden';
      if (finished && timer) { clearInterval(timer); timer = null; loadOverview(true).catch(() => {}); }
    };

    modal({
      title,
      body: `<div class="muted" style="font-size:13px;margin-bottom:8px" id="rbHead"></div>
        <div class="bar" style="margin-bottom:6px"><i id="rbBar" style="width:0"></i></div>
        <div class="notice" id="rbOffline" style="display:none;margin:10px 0;font-size:12.5px">${ic('alert')}<div>Verbindung zu Home Assistant ist gerade unterbrochen – vermutlich startet die Box neu, über die Home Assistant verbunden ist. Die Anzeige wird automatisch fortgesetzt.</div></div>
        <div class="list" id="rbList"></div>`,
      foot: '<span class="faint left" style="font-size:12px;align-self:center">Ausblenden beendet nur die Anzeige, nicht den Neustart.</span><button class="btn primary" data-close id="rbClose">Ausblenden</button>',
      onMount(m) {
        render(m);
        // send the commands one after another: repeaters first, mesh master last
        (async () => {
          for (const r of rows) {
            if (closed) return;
            r.state = 'sending'; render(m);
            try {
              await api(`system/${r.id}/reboot`, { method: 'POST' });
              r.state = 'sent'; r.t = Date.now();
            } catch (err) { r.state = 'error'; r.error = err.message; }
            render(m);
            await new Promise((res) => setTimeout(res, 1500));
          }
        })();
        // follow the boxes: reachable -> unreachable -> reachable again
        timer = setInterval(async () => {
          if (closed) return;
          let ping = null;
          try { ping = await api('system/ping'); offline = false; } catch { offline = true; }
          rows.forEach((r) => {
            if (!r.t || DONE.includes(r.state)) return;
            if (Date.now() - r.t > REBOOT_TIMEOUT) { r.state = 'timeout'; return; }
            if (!ping) return;
            if (r.state === 'sent' && ping[r.id] === false) r.state = 'down';
            else if (r.state === 'down' && ping[r.id] === true) { r.state = 'up'; r.end = Date.now(); }
          });
          if (!closed) render(m);
        }, 3000);
      },
      onClose: () => { closed = true; if (timer) clearInterval(timer); },
    });
  }

  async function renderSystem(el) {
    setHeader('System', 'Geräteinformationen, Neustart und Ereignisse', `<button class="btn danger" id="rebootAll">${ic('power')}<span class="hide-sm">Alle neu starten</span></button><button class="btn" id="reloadBtn">${ic('refresh')}<span class="hide-sm">Aktualisieren</span></button>`);
    $('#rebootAll').addEventListener('click', async () => {
      const list = onlineBoxes();
      if (!list.length) { toast('Keine erreichbaren Geräte.', 'err'); return; }
      const slaves = list.filter((b) => isSlave(b.info));
      const masters = list.filter((b) => !isSlave(b.info));
      const names = slaves.concat(masters).map((b) => `<li>${esc(boxName(b))}${isMaster(b.info) ? ' <span class="faint">(zuletzt)</span>' : ''}</li>`).join('');
      if (!(await confirmDialog(`Alle ${list.length} Geräte neu starten?`,
        `Es werden nacheinander neu gestartet – erst die Repeater, zuletzt der Mesh Master:<ul style="margin:8px 0 10px;padding-left:20px">${names}</ul>`
        + '<b>Internet, WLAN und Telefonie sind danach für ca. 3–5 Minuten nicht verfügbar.</b> Auch Home Assistant verliert währenddessen die Verbindung zu WLAN-Geräten.',
        { ok: 'Alle neu starten', danger: true }))) return;
      rebootProgress(slaves.concat(masters));
    });
    const draw = () => {
      el.innerHTML = `<div class="grid cols-3">${boxes().map((b) => {
        const i = b.info || {};
        return `<div class="card">
          <div class="card-head" style="padding-bottom:12px">${boxAvatar(b)}
            <h2>${esc(boxName(b))} ${roleBadge(i)}<div class="faint" style="font-weight:400;font-size:12.5px">${esc(b.config.host)}</div></h2>
            ${b.online ? '<span class="badge ok">Online</span>' : '<span class="badge err">Offline</span>'}</div>
          <div class="card-body" style="padding-top:4px">
          ${isSlave(i) ? `<div style="margin-bottom:14px">${meshNotice(i, 'WLAN, Gastzugang, Zeitschaltungen und weitere Mesh-Einstellungen')}</div>` : ''}
          ${i.update_available ? `<div class="notice" style="margin-bottom:14px">${ic('info')}<div><b>FRITZ!OS ${esc(i.update_version || '')}</b> ist verfügbar.${i.update_info_url ? ` <a href="${esc(i.update_info_url)}" target="_blank" rel="noopener">Details</a>` : ''}<br><span class="muted">Das Update kann in der Oberfläche der Box installiert werden.</span></div></div>` : ''}
          ${b.online ? `<dl class="kv">
            <dt>Modell</dt><dd>${esc(i.model || '–')}</dd>
            <dt>FRITZ!OS</dt><dd>${esc(i.firmware || '–')}</dd>
            ${i.hardware ? `<dt>Hardware</dt><dd>${esc(i.hardware)}</dd>` : ''}
            ${i.serial ? `<dt>Seriennummer</dt><dd class="mono">${esc(i.serial)}</dd>` : ''}
            <dt>Laufzeit</dt><dd>${fmtUptime(i.uptime)}</dd>
            <dt>Rolle</dt><dd>${roleText(i)}</dd>
            ${!isMaster(i) && (b.uplink || b.uplink_known) ? `<dt>Anbindung</dt><dd>${uplinkSummary(b)}</dd>` : ''}
          </dl>` : errorBox(b.error || 'Nicht erreichbar')}
          <div class="row wrap" style="margin-top:16px;gap:8px">
            <a class="btn sm" href="http://${esc(b.config.host)}" target="_blank" rel="noopener">${ic('external')}Oberfläche</a>
            ${b.online ? `<button class="btn sm" data-log="${b.config.id}">${ic('list')}Ereignisse</button>` : ''}
            ${b.online && i.is_router ? `<button class="btn sm" data-reconnect="${b.config.id}">${ic('zap')}Neu verbinden</button>` : ''}
            ${b.online ? `<button class="btn sm danger" data-reboot="${b.config.id}">${ic('power')}Neustart</button>` : ''}
          </div></div></div>`;
      }).join('')}</div>`;
      $$('[data-reboot]').forEach((btn) => btn.addEventListener('click', async () => {
        const b = findBox(btn.dataset.reboot);
        if (!(await confirmDialog(`${boxName(b)} neu starten?`, 'Während des Neustarts (ca. 2–4 Minuten) sind Internet, WLAN und Telefonie über dieses Gerät nicht verfügbar.', { ok: 'Neu starten', danger: true }))) return;
        rebootProgress([b], `${boxName(b)} wird neu gestartet`);
      }));
      $$('[data-reconnect]').forEach((btn) => btn.addEventListener('click', async () => {
        const b = findBox(btn.dataset.reconnect);
        if (!(await confirmDialog('Internetverbindung neu aufbauen?', 'Die Verbindung wird kurz getrennt. Du erhältst in der Regel eine neue öffentliche IP-Adresse.', { ok: 'Neu verbinden' }))) return;
        try { await api(`system/${b.config.id}/reconnect`, { method: 'POST' }); toast('Verbindung wird neu aufgebaut.'); } catch (e) { toast(e.message, 'err'); }
      }));
      $$('[data-log]').forEach((btn) => btn.addEventListener('click', () => withBusy(btn, async () => {
        const b = findBox(btn.dataset.log);
        try {
          const log = await api(`system/${b.config.id}/log`);
          modal({ title: `Ereignisse – ${boxName(b)}`, wide: true, body: `<div class="input-icon" style="margin-bottom:10px">${ic('search')}<input class="input" id="logQ" placeholder="Filtern …"></div><div class="card"><div class="log" id="logList">${log.map((l) => `<div>${esc(l)}</div>`).join('') || '<div>Keine Ereignisse.</div>'}</div></div>`,
            onMount(m) { m.querySelector('#logQ').addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('#logList div', m).forEach((d) => { d.style.display = d.textContent.toLowerCase().includes(q) ? '' : 'none'; }); }); } });
        } catch (e) { toast(e.message, 'err'); }
      })));
    };
    draw();
    $('#reloadBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => { await loadOverview(true); draw(); }));
  }

  // --------------------------------------------------------------- settings
  // Settings page with tabs: devices/credentials and notifications
  async function renderSettings(el, token) {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    let tab = q.get('tab') || store.get('settingsTab', 'boxes');
    if (!['boxes', 'notify', 'look'].includes(tab)) tab = 'boxes';
    store.set('settingsTab', tab);
    el.innerHTML = `<div class="seg" id="setTabs" style="margin-bottom:16px">${[['boxes', 'router', 'Boxen & Zugänge'], ['notify', 'bell', 'Benachrichtigungen'], ['look', 'palette', 'Darstellung']]
      .map(([k, icon, label]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${ic(icon)}${label}</button>`).join('')}</div><div id="setBody"></div>`;
    $$('#setTabs button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tab !== tab) location.hash = `#/settings?tab=${b.dataset.tab}`; }));
    const body = $('#setBody');
    if (tab === 'boxes') await renderBoxes(body); else if (tab === 'look') renderLook(body); else await renderNotifications(body, token);
  }

  // Appearance: light/dark and accent colour (stored per browser)
  function renderLook(el) {
    setHeader('Einstellungen', 'Design und Akzentfarbe');
    const draw = () => {
      const theme = store.get('theme', 'auto'); const accent = store.get('accent', 'blue');
      morph(el, `<div class="card"><div class="card-head"><h2>Design</h2></div><div class="card-body">
          <div class="seg" id="lookTheme">${THEMES.map(([k, icon, label]) => `<button data-theme-set="${k}" class="${theme === k ? 'active' : ''}">${ic(icon)}${esc(label.replace('Design: ', '').replace(/^./, (c) => c.toUpperCase()))}</button>`).join('')}</div>
          <p class="faint" style="font-size:12.5px;margin:10px 0 0">„Automatisch“ folgt der Einstellung von Betriebssystem bzw. Browser.</p></div></div>
        <div class="card" style="margin-top:16px"><div class="card-head"><h2>Akzentfarbe</h2></div><div class="card-body">
          <div class="swatches">${Object.entries(ACCENTS).map(([k, a]) => `<button class="swatch ${accent === k ? 'active' : ''}" data-accent="${k}" style="--sw:${a[1]}" title="${esc(a[0])}" aria-pressed="${accent === k}"><i>${ic('check')}</i><span>${esc(a[0])}</span></button>`).join('')}</div>
          <p class="faint" style="font-size:12.5px;margin:12px 0 0">Gilt für Schaltflächen, Markierungen und Hervorhebungen. Die Einstellung wird in diesem Browser gespeichert.</p></div></div>`);
      $$('[data-theme-set]', el).forEach((b) => on(b, 'click', () => { setTheme(b.dataset.themeSet); draw(); }));
      $$('[data-accent]', el).forEach((b) => on(b, 'click', () => { store.set('accent', b.dataset.accent); withTransition(applyAccent); draw(); }));
    };
    draw();
  }

  async function renderNotifications(el, token) {
    setHeader('Einstellungen', 'Benachrichtigungen bei neuen Geräten');
    el.innerHTML = loading(4);
    let data;
    try { data = await api('settings'); } catch (e) { el.innerHTML = errorBox(e.message); return; }
    if (stale(token)) return;
    const save = async (values, msg) => {
      try { data = await api('settings', { method: 'POST', body: values }); if (msg) toast(msg); draw(); } catch (e) { toast(e.message, 'err'); }
    };
    const draw = () => {
      const s = data.settings;
      const since = new Date(data.tracking_since * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const rows = data.new_devices.map((d) => `<div class="list-item">
        <div class="avatar accent">${ic(deviceIcon({ name: d.name, vendor: d.vendor }))}</div>
        <div class="grow"><div class="title">${esc(d.name || 'Unbekanntes Gerät')}</div>
          <div class="meta">${d.private ? 'Private MAC' : esc(d.vendor || 'Hersteller unbekannt')}${d.ip ? ` · ${esc(d.ip)}` : ''} · <span class="mono">${esc(d.mac)}</span></div></div>
        <div class="faint nowrap" style="font-size:12.5px" title="${fmtDateTime(d.ts)}">${fmtAgo(d.ts)}</div></div>`).join('');
      el.innerHTML = `<div class="grid cols-2">
        <div class="card"><div class="card-head" style="padding-bottom:6px"><div class="avatar accent">${ic('bell')}</div>
          <h2>Alarm bei neuen Geräten<div class="faint" style="font-weight:400;font-size:12.5px">Meldet Geräte, die zum ersten Mal im Heimnetz auftauchen</div></h2>${sw(s.new_device_alarm, 'id="setAlarm"')}</div>
          <div class="card-body">
            ${data.ha_available ? '' : `<div class="notice" style="margin-bottom:14px">${ic('alert')}<div>Keine Verbindung zur Home-Assistant-API – Meldungen können nicht zugestellt werden.</div></div>`}
            <fieldset class="plain" ${s.new_device_alarm ? '' : 'disabled'}>
              <label class="check" style="margin-bottom:14px"><input type="checkbox" id="setPersistent" ${s.notify_persistent ? 'checked' : ''}>Meldung in Home Assistant anzeigen (Glocke in der Seitenleiste)</label>
              <div class="field"><label>Push-Benachrichtigung aufs Handy <span class="faint">(optional)</span></label>
                <input class="input mono" id="setService" value="${esc(s.notify_service || '')}" placeholder="notify.mobile_app_dein_handy">
                <span class="hint">Name des Benachrichtigungsdienstes aus Home Assistant (Entwicklerwerkzeuge › Aktionen, Suche nach „notify“). Leer = keine Push-Nachricht.</span></div>
              <div class="row wrap" style="gap:8px"><button class="btn primary" id="saveSet">${ic('check')}Speichern</button><button class="btn" id="testSet">${ic('bell')}Testmeldung senden</button></div>
            </fieldset>
            <details style="margin-top:18px"><summary class="muted" style="cursor:pointer;font-size:13px">Für eigene Automationen</summary>
              <p class="muted" style="font-size:13px;margin:10px 0 8px">Bei jedem neuen Gerät löst FritzHub (bei eingeschaltetem Alarm) das Ereignis <code>fritzhub_new_device</code> aus – mit <code>name</code>, <code>ip</code>, <code>mac</code>, <code>vendor</code> und <code>connected_to</code>. Beispiel:</p>
              <pre class="code">triggers:
  - trigger: event
    event_type: fritzhub_new_device
actions:
  - action: light.turn_on
    target:
      entity_id: light.flur
    data:
      flash: short</pre></details>
          </div></div>
        <div class="card"><div class="card-head" style="padding-bottom:6px"><div class="avatar accent">${ic('bell')}</div>
          <h2>Beobachtete Geräte<div class="faint" style="font-weight:400;font-size:12.5px">Meldung, wenn eines länger als 3 Minuten offline ist – und wenn es wieder da ist</div></h2>${sw(s.watch_alarm, 'id="setWatch"')}</div>
          <div class="card-body flush"><div class="list">${(data.watched || []).map((w) => `<div class="list-item">
            <span class="dot ${w.active ? 'ok' : 'err'}"></span>
            <div class="grow"><div class="title">${esc(w.name || w.mac)}</div><div class="meta">${w.active ? 'Online' : `Offline${w.last_seen ? ` seit ${fmtAgo(w.last_seen)}` : ''}`}${w.ip ? ` · ${esc(w.ip)}` : ''}</div></div>
            <button class="icon-btn" title="Nicht mehr beobachten" data-unwatch="${esc(w.mac)}">${ic('x')}</button></div>`).join('')
            || '<div class="muted" style="padding:6px 18px 14px;font-size:13px">Noch keine Geräte. Über das Glocken-Symbol in der Geräteliste (oder in den Geräte-Details) lässt sich jedes Gerät beobachten.</div>'}</div>
          <div class="muted" style="padding:10px 18px 14px;font-size:12.5px;border-top:1px solid var(--border)">Die Meldung geht an dieselben Ziele wie der Neue-Geräte-Alarm (Home Assistant / Push). Ereignisse für Automationen: <code>fritzhub_device_offline</code> und <code>fritzhub_device_online</code>.</div></div></div>
        <div class="card"><div class="card-head"><h2>Zuletzt erkannte neue Geräte <span class="sub">${data.new_devices.length}</span></h2></div>
          <div class="card-body flush"><div class="list">${rows || `<div class="muted" style="padding:6px 18px 14px;font-size:13px">Seit ${since} ist kein neues Gerät aufgetaucht. Alle Geräte, die die FRITZ!Box beim ersten Start kannte, gelten als bekannt.</div>`}</div></div></div>
      </div>`;
      $('#setAlarm').addEventListener('change', (e) => save({ new_device_alarm: e.target.checked }, e.target.checked ? 'Alarm eingeschaltet.' : 'Alarm ausgeschaltet.'));
      $('#setWatch').addEventListener('change', (e) => save({ watch_alarm: e.target.checked }, e.target.checked ? 'Meldungen für beobachtete Geräte eingeschaltet.' : 'Meldungen für beobachtete Geräte ausgeschaltet.'));
      $$('[data-unwatch]').forEach((b) => b.addEventListener('click', async () => {
        try { await api('watch', { method: 'POST', body: { mac: b.dataset.unwatch, watched: false } }); data = await api('settings'); toast('Beobachtung beendet.'); draw(); } catch (e) { toast(e.message, 'err'); }
      }));
      $('#saveSet').addEventListener('click', (e) => withBusy(e.currentTarget, () => save({ notify_persistent: $('#setPersistent').checked, notify_service: $('#setService').value.trim() }, 'Einstellungen gespeichert.')));
      $('#testSet').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
        await save({ notify_persistent: $('#setPersistent').checked, notify_service: $('#setService').value.trim() });
        try { await api('settings/test-notification', { method: 'POST' }); toast('Testmeldung gesendet – schau in Home Assistant bzw. aufs Handy.'); } catch (err) { toast(err.message, 'err'); }
      }));
    };
    draw();
  }

  // ------------------------------------------------------------------ boxes
  let discovered = null;
  async function renderBoxes(el) {
    setHeader('Einstellungen', 'FRITZ!Box und FRITZ!Repeater verwalten', `<button class="btn" id="addBtn">${ic('plus')}<span class="hide-sm">Manuell hinzufügen</span></button><button class="btn primary" id="scanBtn">${ic('radar')}Netzwerk durchsuchen</button>`);
    const draw = () => {
      const list = boxes();
      const cfgRows = list.map((b) => `<div class="list-item">
          ${boxAvatar(b)}
          <div class="grow"><div class="title">${esc(boxName(b))} ${roleBadge(b.info)}</div><div class="meta">${esc(b.config.host)}${b.config.username ? ` · Benutzer ${esc(b.config.username)}` : ' · ohne Benutzername'}${b.info && b.info.model ? ` · ${esc(b.info.model)}` : ''}</div>
            ${b.online === false && b.error ? `<div class="meta" style="color:var(--err);white-space:normal">${esc(b.error)}</div>` : ''}</div>
          ${!b.config.enabled ? '<span class="badge">Deaktiviert</span>' : b.online ? '<span class="badge ok">Verbunden</span>' : b.online === false ? '<span class="badge err">Fehler</span>' : '<span class="badge">…</span>'}
          <button class="icon-btn" data-edit="${b.config.id}" title="Bearbeiten">${ic('edit')}</button>
          <button class="icon-btn danger" data-del="${b.config.id}" title="Entfernen">${ic('trash')}</button></div>`).join('');
      const disc = discovered ? `<div class="card"><div class="card-head"><h2>Gefundene Geräte <span class="sub">${discovered.length}</span></h2></div><div class="card-body flush"><div class="list">
        ${discovered.map((d) => `<div class="list-item"><div class="avatar ${d.configured ? 'ok' : 'accent'}">${ic(/repeater|powerline/i.test(d.model || '') ? 'repeater' : 'router')}</div>
          <div class="grow"><div class="title">${esc(d.model || d.name || 'FRITZ!-Gerät')}</div><div class="meta">${esc(d.host)}${d.firmware ? ` · FRITZ!OS ${esc(d.firmware)}` : ''}${d.name && d.name !== d.model ? ` · ${esc(d.name)}` : ''}</div></div>
          ${d.configured ? '<span class="badge ok">Eingerichtet</span>' : `<button class="btn sm primary" data-adddisc="${esc(d.host)}">${ic('plus')}Hinzufügen</button>`}</div>`).join('') || `<div style="padding:10px 18px 16px" class="muted">Keine FRITZ!-Geräte gefunden. Prüfe, ob „Heimnetz › Netzwerk › Netzwerkeinstellungen › Zugriff für Apps erlauben (TR-064; ältere FRITZ!OS: „Zugriff für Anwendungen zulassen“)“ aktiviert ist, und füge die Box ggf. manuell hinzu.</div>`}
        </div></div></div>` : '';
      el.innerHTML = `<div class="notice info" style="margin-bottom:16px">${ic('info')}<div><b>Mesh mit mehreren Geräten:</b> Füge die FRITZ!Box (Mesh Master) und jeden Repeater einzeln hinzu – jedes Gerät hat eigene Zugangsdaten. Repeater im Mesh verwenden meist dasselbe Kennwort wie die FRITZ!Box; nutze dafür „Zugangsdaten übernehmen“. In der FRITZ!Box muss <b>TR-064</b> („Zugriff für Apps erlauben“, bei älterem FRITZ!OS „Zugriff für Anwendungen zulassen“) aktiv sein.</div></div>
        <div class="grid cols-2"><div class="card"><div class="card-head"><h2>Eingerichtete Geräte <span class="sub">${list.length}</span></h2></div>
          <div class="card-body flush"><div class="list">${cfgRows || `<div style="padding:10px 18px 16px" class="muted">Noch keine Geräte eingerichtet.</div>`}</div></div></div>
          ${disc || `<div class="card">${empty('radar', 'Automatische Suche', 'FritzHub sucht per UPnP/SSDP und Subnetz-Scan nach FRITZ!Boxen und Repeatern im Heimnetz.', `<button class="btn primary" id="scanBtn2">${ic('radar')}Jetzt suchen</button>`)}</div>`}</div>`;
      $$('[data-edit]').forEach((b) => b.addEventListener('click', () => boxForm(findBox(b.dataset.edit).config)));
      $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        const box = findBox(b.dataset.del);
        if (!(await confirmDialog('Gerät entfernen?', `<b>${esc(boxName(box))}</b> und die gespeicherten Zugangsdaten werden aus FritzHub entfernt.`, { ok: 'Entfernen', danger: true }))) return;
        try { await api(`boxes/${box.config.id}`, { method: 'DELETE' }); toast('Gerät entfernt.'); await loadOverview(); if (discovered) discovered.forEach((d) => { if (d.host === box.config.host) d.configured = false; }); draw(); } catch (e) { toast(e.message, 'err'); }
      }));
      $$('[data-adddisc]').forEach((b) => b.addEventListener('click', () => {
        const d = discovered.find((x) => x.host === b.dataset.adddisc);
        boxForm({ host: d.host, name: d.name && d.name !== d.model ? d.name : d.model });
      }));
      const s2 = $('#scanBtn2'); if (s2) s2.addEventListener('click', () => scan(s2));
    };
    const scan = (btn) => withBusy(btn, async () => {
      try { discovered = await api('discover', { method: 'POST' }); draw(); toast(`${discovered.length} FRITZ!-Gerät(e) gefunden.`, 'info'); } catch (e) { toast(e.message, 'err'); }
    });

    function boxForm(cfg = {}) {
      const isNew = !cfg.id;
      const others = boxes().filter((b) => b.config.id !== cfg.id && b.config.has_password);
      const master = others.find((b) => b.info && b.info.is_router);
      modal({
        title: isNew ? 'Gerät hinzufügen' : 'Gerät bearbeiten',
        body: `<div class="form-grid">
          <div class="field"><label>Adresse</label><input class="input" id="f_host" value="${esc(cfg.host || '')}" placeholder="192.168.178.1 oder fritz.box"></div>
          <div class="field"><label>Anzeigename <span class="faint">(optional)</span></label><input class="input" id="f_name" value="${esc(cfg.name || '')}" placeholder="z. B. Repeater Obergeschoss"></div>
          ${others.length ? `<div class="field span-2"><label>Zugangsdaten</label><select class="input" id="f_copy"><option value="">Eigene Zugangsdaten eingeben</option>${others.map((b) => `<option value="${b.config.id}" ${isNew && master && b === master && cfg.host && !/^(fritz\.box|192\.168\.178\.1)$/.test(cfg.host) ? 'selected' : ''}>Übernehmen von „${esc(boxName(b))}“</option>`).join('')}</select></div>` : ''}
          <div class="field cred"><label>Benutzername</label><input class="input" id="f_user" list="f_users" value="${esc(cfg.username || '')}" autocomplete="off" placeholder="leer = automatisch"><datalist id="f_users"></datalist><span class="hint" id="f_userhint"></span></div>
          <div class="field cred"><label>Kennwort</label><input class="input" id="f_pass" type="password" autocomplete="new-password" placeholder="${cfg.has_password ? 'unverändert' : ''}"></div>
        </div>
        <details style="margin-bottom:12px"><summary class="muted" style="cursor:pointer;font-size:13px">Erweitert</summary>
          <div class="form-grid" style="margin-top:12px">
            <div class="field"><label>TR-064-Port <span class="faint">(optional)</span></label><input class="input" id="f_port" type="number" value="${esc(cfg.port || '')}" placeholder="${cfg.use_tls ? '49443' : '49000'}"></div>
            <div class="field" style="justify-content:flex-end;gap:10px">
              <label class="check"><input type="checkbox" id="f_tls" ${cfg.use_tls ? 'checked' : ''}>Verschlüsselt (TLS)</label>
              <label class="check"><input type="checkbox" id="f_enabled" ${cfg.enabled === false ? '' : 'checked'}>Aktiviert</label></div>
          </div></details>
        <div class="notice info" style="font-size:12.5px">${ic('info')}<div>Tipp: Lege in der FRITZ!Box unter <b>System › FRITZ!Box-Benutzer</b> einen eigenen Benutzer an – mit den Rechten „FRITZ!Box Einstellungen“, „Sprachnachrichten, Faxnachrichten, FRITZ!App Fon und Anrufliste“ sowie „Zugang zu NAS-Inhalten“.</div></div>
        <div id="formMsg" style="margin-top:12px"></div>`,
        foot: `<button class="btn left" id="testBtn">${ic('zap')}Verbindung testen</button><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="saveBtn">${ic('check')}Speichern</button>`,
        onMount(m, close) {
          const v = (id) => m.querySelector(id);
          const copySel = v('#f_copy');
          const syncCopy = () => { const on = copySel && copySel.value; $$('.cred', m).forEach((f) => { f.style.display = on ? 'none' : ''; }); };
          if (copySel) { copySel.addEventListener('change', syncCopy); syncCopy(); }
          // user names that exist on the box (readable without login)
          let usersFor = null;
          const loadUsers = async () => {
            const host = v('#f_host').value.trim();
            if (!host || host === usersFor) return;
            usersFor = host;
            try {
              const users = await api(`boxes/users?host=${encodeURIComponent(host)}${v('#f_port').value ? `&port=${v('#f_port').value}` : ''}${v('#f_tls').checked ? '&tls=1' : ''}`);
              if (usersFor !== host) return;
              v('#f_users').innerHTML = users.map((u) => `<option value="${esc(u)}">`).join('');
              v('#f_userhint').textContent = users.length ? `Benutzer auf diesem Gerät: ${users.join(', ')}` : '';
              if (users.length) v('#f_user').placeholder = `leer = automatisch (${users[0]})`;
            } catch { v('#f_userhint').textContent = ''; }
          };
          v('#f_host').addEventListener('change', loadUsers);
          loadUsers();
          const payload = () => {
            const copy = copySel && copySel.value;
            return {
              id: cfg.id, host: v('#f_host').value.trim(), name: v('#f_name').value.trim(),
              username: copy ? '' : v('#f_user').value.trim(), password: copy ? '' : v('#f_pass').value,
              copy_from: copy || undefined,
              port: v('#f_port').value ? Number(v('#f_port').value) : null,
              use_tls: v('#f_tls').checked, enabled: v('#f_enabled').checked,
            };
          };
          const msg = (html) => { v('#formMsg').innerHTML = html; };
          const test = async () => {
            const p = payload();
            if (!p.host) { msg(errorBox('Bitte eine Adresse eingeben.')); return false; }
            msg(`<div class="notice info">${ic('refresh', 'spin')}<div>Verbinde mit ${esc(p.host)} …</div></div>`);
            try {
              const r = await api('boxes/test', { method: 'POST', body: p });
              msg(`<div class="notice info" style="background:var(--ok-soft)">${ic('checkCircle')}<div>Verbunden mit <b>${esc(r.model || 'FRITZ!')}</b>${r.firmware ? ` (FRITZ!OS ${esc(r.firmware)})` : ''}${r.user ? ` als Benutzer <b>${esc(r.user)}</b>` : ''}.</div></div>`);
              if (!v('#f_name').value.trim() && r.model) v('#f_name').placeholder = r.model;
              return true;
            } catch (e) { msg(errorBox(e.message)); return false; }
          };
          const save = async (skipTest) => {
            if (!skipTest && !(await test())) {
              v('#formMsg').insertAdjacentHTML('beforeend', '<button class="btn sm" style="margin-top:10px" id="forceSave">Trotzdem speichern</button>');
              v('#forceSave').addEventListener('click', () => save(true));
              return;
            }
            try {
              await api('boxes', { method: 'POST', body: payload() });
              close(); toast(isNew ? 'Gerät hinzugefügt.' : 'Änderungen gespeichert.');
              await loadOverview(true);
              if (discovered) discovered.forEach((d) => { if (d.host === payload().host) d.configured = true; });
              draw();
            } catch (e) { msg(errorBox(e.message)); }
          };
          v('#testBtn').addEventListener('click', (e) => withBusy(e.currentTarget, test));
          v('#saveBtn').addEventListener('click', (e) => withBusy(e.currentTarget, () => save(false)));
        },
      });
    }

    $('#scanBtn').addEventListener('click', (e) => scan(e.currentTarget));
    $('#addBtn').addEventListener('click', () => boxForm());
    draw();
    const q = location.hash.split('?')[1] || '';
    if (q.includes('scan=1')) { history.replaceState(null, '', '#/settings?tab=boxes'); scan($('#scanBtn')); }
    if (q.includes('add=1')) { history.replaceState(null, '', '#/settings?tab=boxes'); boxForm(); }
  }

  const RENDER = {
    dashboard: renderDashboard, devices: renderDevices, topology: renderTopology, wlan: renderWlan, netcheck: renderNetcheck,
    calls: renderCalls, tam: renderTam, nas: renderNas, system: renderSystem, settings: renderSettings,
  };

  // ------------------------------------------------------------------ theme
  const THEMES = [['auto', 'contrast', 'Design: automatisch'], ['light', 'sun', 'Design: hell'], ['dark', 'moon', 'Design: dunkel']];
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    const def = THEMES.find((x) => x[0] === t);
    $('#themeToggle').innerHTML = `${ic(def[1])}<span>${def[2]}</span>`;
    applyAccent();
  }
  // smooth cross-fade between old and new look where the browser supports it
  function withTransition(fn) {
    if (document.startViewTransition && !reducedMotion()) document.startViewTransition(fn); else fn();
  }
  function setTheme(t) {
    store.set('theme', t);
    withTransition(() => applyTheme(t));
  }

  // name, light accent, light hover, dark accent, dark hover
  const ACCENTS = {
    blue: ['Blau', '#2563eb', '#1d4ed8', '#5b8cff', '#7aa2ff'],
    teal: ['Türkis', '#0d9488', '#0f766e', '#2dd4bf', '#5eead4'],
    green: ['Grün', '#16a34a', '#15803d', '#4ade80', '#86efac'],
    violet: ['Violett', '#7c3aed', '#6d28d9', '#a78bfa', '#c4b5fd'],
    orange: ['Orange', '#ea580c', '#c2410c', '#fb923c', '#fdba74'],
    pink: ['Pink', '#db2777', '#be185d', '#f472b6', '#f9a8d4'],
  };
  const isDark = () => {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  function applyAccent() {
    const name = store.get('accent', 'blue');
    const st = document.documentElement.style;
    const a = ACCENTS[name];
    if (!a || name === 'blue') { ['--accent', '--accent-2', '--accent-soft'].forEach((v) => st.removeProperty(v)); return; }
    const dark = isDark();
    const c = dark ? a[3] : a[1];
    st.setProperty('--accent', c);
    st.setProperty('--accent-2', dark ? a[4] : a[2]);
    st.setProperty('--accent-soft', `color-mix(in srgb, ${c} ${dark ? 16 : 11}%, transparent)`);
  }

  // ------------------------------------------------------------------- boot
  function boot() {
    // ?theme=dark|light overrides the stored preference (used for screenshots)
    const forced = new URLSearchParams(location.search).get('theme');
    applyTheme(THEMES.some((x) => x[0] === forced) ? forced : store.get('theme', 'auto'));
    $('#themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'auto';
      const i = THEMES.findIndex((x) => x[0] === cur);
      const next = THEMES[(i + 1) % THEMES.length][0];
      setTheme(next);
      $$('[data-theme-set]').forEach((b) => b.classList.toggle('active', b.dataset.themeSet === next));
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAccent);
    watchPageIn();
    $('#menuBtn').innerHTML = ic('menu');
    $('#starLink').innerHTML = `${ic('star')}<span>Auf GitHub bewerten</span>`;
    $('#feedbackLink').innerHTML = `${ic('message')}<span>Feedback &amp; Fehler melden</span>`;
    $('#menuBtn').addEventListener('click', () => $('#app').classList.toggle('nav-open'));
    $('#scrim').addEventListener('click', () => $('#app').classList.remove('nav-open'));
    window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
    window.addEventListener('hashchange', navigate);
    // keep nav badges fresh on all pages
    setInterval(() => { if (currentPage() !== 'dashboard' && !$('#login')) loadOverview().catch(() => {}); }, 60000);
    start();
  }
  async function start() {
    let ses = { direct: false, authenticated: true };
    try {
      const res = await fetch('api/session', { headers: authToken() ? { 'X-FritzHub-Token': authToken() } : {} });
      const data = await res.json();
      if (data.ok) ses = data.data;
    } catch { /* offline – navigate() shows the error */ }
    if (ses.direct) {
      const btn = $('#logoutBtn');
      btn.classList.remove('hidden');
      btn.innerHTML = `${ic('logout')}<span>Abmelden (${esc(ses.user)})</span>`;
      btn.addEventListener('click', logout);
      if (!ses.authenticated) { showLogin(); return; }
    }
    navigate();
  }
  boot();
})();
