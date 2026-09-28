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
  const ago = (ts) => {
    if (!ts) return '';
    const s = Math.round(Date.now() / 1000 - ts);
    return s < 5 ? 'gerade eben' : s < 60 ? `vor ${s} s` : `vor ${Math.round(s / 60)} Min`;
  };

  // -------------------------------------------------------------------- api
  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try { res = await fetch('api/' + path, init); } catch (e) { throw new Error('Keine Verbindung zum Add-on.'); }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data.data;
  }

  // -------------------------------------------------------------- UI pieces
  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${ic(type === 'err' ? 'alert' : type === 'info' ? 'info' : 'checkCircle')}<div>${esc(msg)}</div>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'err' ? 7000 : 3500);
  }

  function modal({ title, body, foot = '', wide = false, onMount, onClose }) {
    const root = document.createElement('div');
    root.className = 'modal-back';
    root.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Schließen">${ic('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
    const close = () => {
      if (!root.isConnected) return;
      root.remove(); document.removeEventListener('keydown', onKey);
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
    const n = `${h.name || ''} ${h.model || ''}`.toLowerCase();
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
  const isWlan = (h) => /802\.11|wlan|wi-?fi/i.test(h.interface || h.link_type || '');

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
    { id: 'calls', title: 'Anrufe', icon: 'phone', section: 'Telefonie' },
    { id: 'tam', title: 'Anrufbeantworter', icon: 'voicemail' },
    { id: 'nas', title: 'FRITZ!NAS', icon: 'folder', section: 'Speicher' },
    { id: 'system', title: 'System', icon: 'sliders', section: 'Verwaltung' },
    { id: 'boxes', title: 'Boxen & Zugänge', icon: 'router' },
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

  function setHeader(title, sub = '', actions = '') {
    $('#pageTitle').textContent = title;
    $('#pageSub').innerHTML = sub;
    $('#pageActions').innerHTML = actions;
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
    const page = currentPage();
    renderNav();
    $('#app').classList.remove('nav-open');
    const content = $('#content');
    content.innerHTML = '';
    window.scrollTo(0, 0);
    if (!S.overview) {
      setHeader(PAGES.find((p) => p.id === page).title);
      content.innerHTML = loading();
      try { await loadOverview(); } catch (e) { content.innerHTML = errorBox(e.message); return; }
    }
    if (!boxes().length && page !== 'boxes') { renderWelcome(); return; }
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
          <a class="btn primary" href="#/boxes?scan=1">${ic('radar')}Netzwerk durchsuchen</a>
          <a class="btn" href="#/boxes?add=1">${ic('plus')}Manuell hinzufügen</a>
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
      setHeader('Übersicht', `${onlineBoxes().length} von ${boxes().length} Geräten erreichbar · aktualisiert ${ago(Math.max(...boxes().map((b) => b.updated || 0)))}`, refreshBtn);
      $('#refreshBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => { await loadOverview(true); draw(); }));
      let missed = 0; let msgs = 0; let hasPhone = false; let hasTam = false;
      boxes().forEach((b) => { if (b.phone) { hasPhone = true; missed += b.phone.missed_24h || 0; if ('new_messages' in b.phone) { hasTam = true; msgs += b.phone.new_messages || 0; } } });
      const kpi = (icon, cls, label, value, foot, href) => `<${href ? `a href="${href}"` : 'div'} class="card kpi" style="color:inherit;text-decoration:none">
        <div class="kpi-label"><span class="kpi-icon ${cls}">${ic(icon)}</span>${label}</div>
        <div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></${href ? 'a' : 'div'}>`;
      const rateParts = (b) => { const s = fmtBits(b * 8).split(' '); return `${s[0]}<small>${s[1]}</small>`; };
      const wlanClients = onlineBoxes().reduce((n, b) => n + (b.wlan || []).reduce((m, w) => m + (w.clients || 0), 0), 0);
      const kpis = [
        wan ? kpi('globe', wan.connected ? 'ok' : 'err', 'Internet', wan.connected ? 'Online' : 'Offline', esc(wan.external_ip || wan.status || '–')) : kpi('globe', '', 'Internet', '–', 'Keine Router-Box'),
        wan ? kpi('arrowDown', '', 'Download', rateParts(wan.rate_down), `Leitung ${fmtBits(wan.dsl ? wan.dsl.down_kbit * 1000 : wan.max_down_bit)}`) : '',
        wan ? kpi('arrowUp', 'up', 'Upload', rateParts(wan.rate_up), `Leitung ${fmtBits(wan.dsl ? wan.dsl.up_kbit * 1000 : wan.max_up_bit)}`) : '',
        kpi('devices', '', 'Geräte online', ov.hosts_online != null ? `${ov.hosts_online}<small>/ ${ov.hosts_total}</small>` : '…', `${wlanClients} davon im WLAN`, '#/devices'),
        hasPhone ? kpi('callMissed', missed ? 'err' : '', 'Verpasste Anrufe', missed, 'letzte 24 Stunden', '#/calls') : '',
        hasTam ? kpi('voicemail', msgs ? 'warn' : '', 'Neue Nachrichten', msgs, 'Anrufbeantworter', '#/tam') : '',
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

      const chartCard = router ? `<div class="card"><div class="card-head"><h2>Datendurchsatz <span class="sub">${esc(boxName(router))}</span></h2>
          <div class="legend"><span><i style="background:var(--down)"></i>Download</span><span><i style="background:var(--up)"></i>Upload</span></div></div>
          <div class="card-body"><div class="chart" id="chart"></div></div></div>` : '';

      const boxCards = boxes().map((b) => {
        const info = b.info || {};
        const clients = (b.wlan || []).reduce((n, w) => n + (w.clients || 0), 0);
        const status = !b.config.enabled ? '<span class="badge">Deaktiviert</span>' : b.online ? '<span class="badge ok"><span class="dot ok" style="box-shadow:none;width:6px;height:6px"></span>Online</span>' : b.online === false ? '<span class="badge err">Offline</span>' : '<span class="badge">…</span>';
        return `<div class="card box-card">
          <div class="head">${boxAvatar(b)}
            <div class="grow" style="min-width:0;flex:1"><div class="title">${esc(boxName(b))} ${roleBadge(info)}</div><div class="meta muted" style="font-size:12.5px">${esc(info.model || b.config.host)}${info.firmware ? ` · FRITZ!OS ${esc(info.firmware)}` : ''}</div></div>${status}</div>
          ${b.online ? `<div class="stats">
            <div><div class="l">Laufzeit</div><div class="v">${fmtUptime(info.uptime)}</div></div>
            <div><div class="l">WLAN-Geräte</div><div class="v">${clients}</div></div>
            <div><div class="l">Firmware</div><div class="v">${info.update_available ? `<span class="badge warn">Update ${esc(info.update_version || '')}</span>` : '<span style="color:var(--ok)">Aktuell</span>'}</div></div>
          </div>` : b.error ? `<div style="padding:0 18px 16px">${errorBox(b.error)}</div>` : ''}
        </div>`;
      }).join('');

      el.innerHTML = `<div class="grid kpis">${kpis}</div>
        ${router ? `<div class="grid dash">${chartCard}${conn}</div>` : ''}
        <div class="card-head" style="padding:26px 2px 12px"><h2>Mesh-Geräte</h2><a class="btn sm ghost" href="#/topology">${ic('topology')}Topologie</a></div>
        <div class="grid cols-3">${boxCards}</div>`;
      if (router) drawChart($('#chart'), router.history || []);
    };
    draw();
    // Host count for the KPI tile
    if (S.overview.hosts_online == null) {
      api('hosts').then((h) => { S.hosts = h; S.overview.hosts_online = h.filter((x) => x.active).length; S.overview.hosts_total = h.length; keepScroll(draw); }).catch(() => {});
    }
    const timer = setInterval(async () => { try { await loadOverview(); keepScroll(draw); } catch { /* keep old */ } }, Math.max(5, S.overview.scan_interval) * 1000);
    const onResize = () => { const r = mainRouter(); if (r && $('#chart')) drawChart($('#chart'), r.history || []); };
    window.addEventListener('resize', onResize);
    S.cleanup.push(() => clearInterval(timer), () => window.removeEventListener('resize', onResize));
  }

  function niceMax(v) {
    if (!v || v <= 0) return 1e6;
    const e = 10 ** Math.floor(Math.log10(v)); const f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }

  function drawChart(el, pts) {
    if (!el) return;
    if (pts.length < 2) { el.innerHTML = '<div class="empty" style="padding:70px 0">Daten werden gesammelt …</div>'; return; }
    const W = Math.max(300, el.clientWidth); const H = 220; const pad = { l: 64, r: 10, t: 10, b: 26 };
    const t0 = pts[0][0]; const t1 = pts[pts.length - 1][0];
    const max = niceMax(Math.max(...pts.map((p) => Math.max(p[1], p[2]) * 8)) * 1.1);
    const x = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const line = (i) => pts.map((p, k) => `${k ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[i] * 8).toFixed(1)}`).join('');
    const area = (i) => `${line(i)}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
    let grid = '';
    for (let k = 0; k <= 4; k += 1) {
      const v = (max / 4) * k; const yy = y(v).toFixed(1);
      grid += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="axis" x="${pad.l - 8}" y="${Number(yy) + 4}" text-anchor="end">${fmtBits(v)}</text>`;
    }
    const nT = Math.min(5, Math.floor(W / 120));
    for (let k = 0; k <= nT; k += 1) {
      const t = t0 + ((t1 - t0) / nT) * k;
      const label = t1 - t0 < 600
        ? new Date(t * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : fmtTime(new Date(t * 1000));
      grid += `<text class="axis" x="${x(t)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === nT ? 'end' : 'middle'}">${label}</text>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">
      <defs>
        <linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--down)" stop-opacity=".28"/><stop offset="1" stop-color="var(--down)" stop-opacity="0"/></linearGradient>
        <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--up)" stop-opacity=".25"/><stop offset="1" stop-color="var(--up)" stop-opacity="0"/></linearGradient>
      </defs>
      ${grid}
      <path d="${area(1)}" fill="url(#gDown)"/><path d="${area(2)}" fill="url(#gUp)"/>
      <path d="${line(1)}" fill="none" stroke="var(--down)" stroke-width="2" stroke-linejoin="round"/>
      <path d="${line(2)}" fill="none" stroke="var(--up)" stroke-width="2" stroke-linejoin="round"/>
      <g class="hover" style="display:none"><line y1="${pad.t}" y2="${H - pad.b}" stroke="var(--border-strong)" stroke-dasharray="3 3"/>
      <circle r="4" fill="var(--down)" stroke="var(--surface)" stroke-width="2" class="c1"/><circle r="4" fill="var(--up)" stroke="var(--surface)" stroke-width="2" class="c2"/></g>
      <rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent" class="hit"/>
    </svg><div class="tip" style="display:none"></div>`;
    const svg = el.querySelector('svg'); const g = svg.querySelector('.hover'); const tip = el.querySelector('.tip');
    svg.querySelector('.hit').addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * W;
      const t = t0 + ((px - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
      let best = pts[0]; pts.forEach((p) => { if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; });
      const bx = x(best[0]);
      g.style.display = ''; g.querySelector('line').setAttribute('x1', bx); g.querySelector('line').setAttribute('x2', bx);
      g.querySelector('.c1').setAttribute('cx', bx); g.querySelector('.c1').setAttribute('cy', y(best[1] * 8));
      g.querySelector('.c2').setAttribute('cx', bx); g.querySelector('.c2').setAttribute('cy', y(best[2] * 8));
      tip.style.display = ''; tip.style.left = `${(bx / W) * r.width}px`; tip.style.top = `${(y(Math.max(best[1], best[2]) * 8) / H) * r.height}px`;
      tip.innerHTML = `<b>${fmtTime(new Date(best[0] * 1000))}</b><br><span style="color:var(--down)">↓ ${fmtBits(best[1] * 8, 1)}</span> · <span style="color:var(--up)">↑ ${fmtBits(best[2] * 8, 1)}</span>`;
    });
    svg.querySelector('.hit').addEventListener('mouseleave', () => { g.style.display = 'none'; tip.style.display = 'none'; });
  }

  // ---------------------------------------------------------------- devices
  async function renderDevices(el, token) {
    const f = store.get('devFilter', { q: '', kind: 'all', sort: 'name', dir: 1 });
    setHeader('Geräte', 'Alle bekannten Geräte im Heimnetz', `<button class="btn" id="reloadBtn">${ic('refresh')}<span class="hide-sm">Aktualisieren</span></button>`);
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
      blocked: ['Gesperrt', (h) => h.wan_blocked],
    };
    const ipNum = (ip) => (ip || '999.999.999.999').split('.').reduce((a, p) => a * 256 + Number(p), 0);
    const sorters = {
      name: (a, b) => (a.name || '').localeCompare(b.name || '', 'de', { sensitivity: 'base' }),
      ip: (a, b) => ipNum(a.ip) - ipNum(b.ip),
      conn: (a, b) => (a.connected_to || '').localeCompare(b.connected_to || ''),
      speed: (a, b) => (a.link_rate || a.speed * 1000 || 0) - (b.link_rate || b.speed * 1000 || 0),
    };

    const draw = () => {
      if (stale(token)) return;
      const hosts = S.hosts || [];
      const q = f.q.trim().toLowerCase();
      let list = hosts.filter(kinds[f.kind][1]).filter((h) => !q || [h.name, h.ip, h.mac, h.model, h.connected_to].some((v) => (v || '').toLowerCase().includes(q)));
      list = list.sort((a, b) => (b.active - a.active) || sorters[f.sort](a, b) * f.dir);
      const counts = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, hosts.filter(v[1]).length]));
      const th = (key, label, cls = '') => `<th data-sort="${key}" class="${cls}">${label}${f.sort === key ? `<span class="sort">${f.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
      const rows = list.map((h) => {
        const wl = isWlan(h);
        const conn = h.active ? `<div class="row nowrap" style="gap:8px">
            <span class="badge ${wl ? 'wlan' : 'lan'}">${ic(wl ? 'wifi' : 'ethernet')}${wl ? (h.band || 'WLAN') : 'LAN'}</span>
            ${h.connected_to ? `<span class="muted" style="font-size:12.5px">${esc(h.connected_to)}</span>` : ''}</div>` : '<span class="faint">–</span>';
        const rate = h.active ? (h.link_rate ? fmtKbit(h.link_rate) : h.speed ? fmtBits(h.speed * 1e6) : '–') : '–';
        const canBlock = h.ip && h.wan_blocked !== null && h.wan_blocked !== undefined;
        return `<tr class="${h.active ? '' : 'offline'}">
          <td><div class="cell-main"><div class="avatar ${h.active ? (wl ? 'wlan' : 'lan') : ''}">${ic(deviceIcon(h))}</div>
            <div style="min-width:0"><div class="t">${esc(h.name || h.mac || 'Unbekannt')}${h.guest ? ' <span class="badge">Gast</span>' : ''}${h.wan_blocked ? ' <span class="badge err">Gesperrt</span>' : ''}</div>
            <div class="faint" style="font-size:12px">${h.active ? '<span class="dot ok" style="width:6px;height:6px;box-shadow:none;margin-right:5px;vertical-align:1px"></span>Online' : 'Offline'}${h.model ? ` · ${esc(h.model)}` : ''}</div></div></div></td>
          <td class="mono nowrap">${esc(h.ip || '–')}</td>
          <td class="mono nowrap hide-md">${esc(h.mac || '–')}</td>
          <td>${conn}</td>
          <td class="nowrap num hide-sm">${rate}</td>
          <td class="nowrap">${canBlock ? `<label class="row" style="gap:8px" title="Internetzugang erlauben">${sw(!h.wan_blocked, `data-wan="${esc(h.ip)}"`)}</label>` : '<span class="faint">–</span>'}</td>
          <td><div class="actions">${h.mac ? `<button class="icon-btn" title="Wake on LAN" data-wol="${esc(h.mac)}">${ic('power')}</button>` : ''}</div></td>
        </tr>`;
      }).join('');
      el.innerHTML = `<div class="toolbar">
          <div class="input-icon search">${ic('search')}<input class="input" id="q" placeholder="Name, IP, MAC suchen …" value="${esc(f.q)}"></div>
          <div class="seg" id="kinds">${Object.entries(kinds).filter(([k]) => counts[k] || k === 'all' || k === 'online').map(([k, v]) => `<button data-kind="${k}" class="${f.kind === k ? 'active' : ''}">${v[0]} <span class="n">${counts[k]}</span></button>`).join('')}</div>
        </div>
        <div class="card"><div class="table-wrap"><table class="table">
          <thead><tr>${th('name', 'Gerät')}${th('ip', 'IP-Adresse')}<th class="hide-md" style="cursor:default">MAC</th>${th('conn', 'Verbunden über')}${th('speed', 'Rate', 'hide-sm')}<th style="cursor:default">Internet</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7">${empty('search', 'Keine Geräte gefunden', 'Passe Suche oder Filter an.')}</td></tr>`}</tbody>
        </table></div></div>`;
      const qi = $('#q');
      qi.addEventListener('input', () => { f.q = qi.value; store.set('devFilter', f); const pos = qi.selectionStart; draw(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
      $$('#kinds button').forEach((b) => b.addEventListener('click', () => { f.kind = b.dataset.kind; store.set('devFilter', f); draw(); }));
      $$('th[data-sort]').forEach((t) => t.addEventListener('click', () => { if (f.sort === t.dataset.sort) f.dir *= -1; else { f.sort = t.dataset.sort; f.dir = 1; } store.set('devFilter', f); draw(); }));
      $$('[data-wol]').forEach((b) => b.addEventListener('click', () => withBusy(b, async () => {
        try { await api('hosts/wol', { method: 'POST', body: { mac: b.dataset.wol } }); toast('Weckruf (Wake on LAN) gesendet.'); } catch (e) { toast(e.message, 'err'); }
      })));
      $$('[data-wan]').forEach((c) => c.addEventListener('change', async () => {
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
    const timer = setInterval(async () => { if (document.activeElement && document.activeElement.id === 'q') return; try { await load(); keepScroll(draw); } catch { /* ignore */ } }, 30000);
    S.cleanup.push(() => clearInterval(timer));
  }

  // --------------------------------------------------------------- topology
  const NODE_W = 230; const NODE_H = 64; const CL_W = 196; const CL_H = 42; const GAP = 36; const VGAP = 92; const CGAP = 10;

  function buildTree(topo, showClients) {
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
    const T = new Map(); // id -> {node, children:[], clients:[], link}
    const mk = (n, link) => { const t = { node: n, children: [], clients: [], link }; T.set(n.id, t); return t; };
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
    if (showClients) {
      topo.nodes.filter((n) => !n.infrastructure).forEach((n) => {
        const parents = (adj.get(n.id) || []).filter(([o]) => T.has(o));
        if (!parents.length) return;
        const [pid, link] = parents[0];
        T.get(pid).clients.push({ node: n, link });
      });
      T.forEach((t) => t.clients.sort((a, b) => (a.node.name || '').localeCompare(b.node.name || '', 'de')));
    }
    return rootT;
  }

  function layoutTree(t) {
    const n = t.clients.length;
    t.cols = n === 0 ? 0 : n <= 5 ? 1 : n <= 14 ? 2 : 3;
    t.rows = t.cols ? Math.ceil(n / t.cols) : 0;
    t.cbW = t.cols ? t.cols * CL_W + (t.cols - 1) * CGAP : 0;
    t.cbH = t.rows ? t.rows * CL_H + (t.rows - 1) * CGAP : 0;
    t.children.forEach(layoutTree);
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
    const wl = (l.type || '').toUpperCase() === 'WLAN';
    const rate = Math.max(l.rate_rx || 0, l.rate_tx || 0);
    return `${wl ? (l.band || 'WLAN') : 'LAN'}${rate ? ` · ${fmtKbit(rate)}` : ''}`;
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
        const wl = c.link && (c.link.type || '').toUpperCase() === 'WLAN';
        links += `<path class="t-link ${wl ? 'wlan' : 'lan'}" d="${curve(t.cx, y + NODE_H, c.cx, c.y)}"/>`;
        if (c.link) {
          // label sits on the bezier curve at t=0.68 – close to the child, so siblings don't overlap
          const s = 0.68; const u = 1 - s; const y0 = y + NODE_H; const my = (y0 + c.y) / 2;
          const lx = t.cx * (u ** 3 + 3 * u * u * s) + c.cx * (3 * u * s * s + s ** 3);
          const ly = y0 * u ** 3 + my * (3 * u * u * s + 3 * u * s * s) + c.y * s ** 3;
          const txt = linkLabel(c.link); const w = txt.length * 6.3 + 16;
          labels += `<g class="t-label"><rect x="${lx - w / 2}" y="${ly - 11}" width="${w}" height="22" rx="11"/><text x="${lx}" y="${ly + 4}" text-anchor="middle">${esc(txt)}</text></g>`;
        }
        walk(c);
      });
      if (t.clients.length) {
        const bx = t.cbX + t.cbW / 2;
        links += `<path class="t-link client lan" style="stroke:var(--border-strong)" d="${curve(t.cx, y + NODE_H, bx, t.cbY - 12)}"/>`;
        nodes += `<rect class="t-group" x="${t.cbX - 8}" y="${t.cbY - 12}" width="${t.cbW + 16}" height="${t.cbH + 24}" rx="14"/>`;
        grow(t.cbX - 8, t.cbY - 12, t.cbX + t.cbW + 8, t.cbY + t.cbH + 12);
        t.clients.forEach((c, i) => {
          const col = i % t.cols; const row = Math.floor(i / t.cols);
          const cx = t.cbX + col * (CL_W + CGAP); const cy = t.cbY + row * (CL_H + CGAP);
          const wl = c.link && (c.link.type || '').toUpperCase() === 'WLAN';
          const sub = [c.node.ip, linkLabel(c.link)].filter(Boolean).join(' · ');
          nodes += `<g class="t-node t-client ${selected === c.node.id ? 'selected' : ''}" data-id="${esc(c.node.id)}">
            <rect class="bg" x="${cx}" y="${cy}" width="${CL_W}" height="${CL_H}" rx="10"/>
            <rect class="stripe ${wl ? 'wlan' : 'lan'}" x="${cx}" y="${cy + 8}" width="3.5" height="${CL_H - 16}" rx="1.75"/>
            <text class="n" x="${cx + 14}" y="${cy + 18}">${esc(trunc(c.node.name, 24))}</text>
            <text class="s" x="${cx + 14}" y="${cy + 33}">${esc(trunc(sub, 32))}</text></g>`;
        });
      }
      const master = n.role === 'master';
      nodes += `<g class="t-node ${master ? 'master' : ''} ${selected === n.id ? 'selected' : ''}" data-id="${esc(n.id)}">
        <rect class="bg" x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="16"/>
        <rect class="ico" x="${x + 12}" y="${y + 12}" width="40" height="40" rx="11"/>
        ${iconG(master ? 'router' : 'repeater', x + 21, y + 21, 22)}
        <text class="n" x="${x + 64}" y="${y + 28}">${esc(trunc(n.name, 22))}</text>
        <text class="s" x="${x + 64}" y="${y + 46}">${esc(trunc(`${master ? 'Mesh Master' : n.role === 'slave' ? 'Mesh Repeater' : 'Gerät'}${n.model && n.model !== n.name ? ` · ${n.model}` : ''}`, 30))}</text></g>`;
    };
    walk(rootT);
    return { svg: `<g class="links">${links}</g><g class="nodes">${nodes}</g><g class="labels">${labels}</g>`, bounds };
  }

  async function renderTopology(el, token) {
    const opts = store.get('topo', { clients: true });
    let selected = null; let view = null;
    setHeader('Mesh-Topologie', 'Aufbau des Mesh-Netzes mit Verbindungsart und -geschwindigkeit', `<button class="btn" id="reloadBtn">${ic('refresh')}<span class="hide-sm">Aktualisieren</span></button>`);
    el.innerHTML = loading(6);
    const load = async (force) => { S.topo = await api(`topology${force ? '?force=1' : ''}`); };
    try { await load(); } catch (e) { el.innerHTML = errorBox(e.message); return; }
    if (stale(token)) return;

    el.innerHTML = `<div class="topo-wrap card" id="topo">
      <div class="topo-tools">
        <div class="card"><button class="icon-btn" data-z="in" title="Vergrößern">${ic('plus')}</button><button class="icon-btn" data-z="out" title="Verkleinern">${ic('minus')}</button><button class="icon-btn" data-z="fit" title="Einpassen">${ic('fit')}</button></div>
        <div class="card" style="padding:4px 12px"><label class="check"><input type="checkbox" id="showClients" ${opts.clients ? 'checked' : ''}>Endgeräte anzeigen</label></div>
      </div>
      <svg id="topoSvg"><g id="vp"></g></svg>
      <div class="topo-legend card"><span><i class="ln" style="border-color:var(--lan)"></i>LAN</span><span><i class="ln" style="border-color:var(--wlan);border-top-style:dashed"></i>WLAN</span><span class="faint" id="topoCount"></span></div>
      <div id="detail"></div>
    </div>`;
    const svg = $('#topoSvg'); const vp = $('#vp');
    let bounds = null;
    const apply = () => vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    const fit = () => {
      if (!bounds) return;
      const r = svg.getBoundingClientRect(); const pad = 60;
      const bw = bounds.x2 - bounds.x1; const bh = bounds.y2 - bounds.y1;
      const k = Math.min(1.2, (r.width - pad * 2) / bw, (r.height - pad * 2 - 40) / bh);
      view = { k, x: (r.width - bw * k) / 2 - bounds.x1 * k, y: Math.max(pad + 20, (r.height - bh * k) / 2) - bounds.y1 * k };
      apply();
    };
    const draw = (refit) => {
      const tree = buildTree(S.topo, opts.clients);
      if (!tree) { vp.innerHTML = ''; return; }
      layoutTree(tree); placeTree(tree, 0, 0);
      const out = topoSVG(tree, selected);
      vp.innerHTML = out.svg; bounds = out.bounds;
      const infra = S.topo.nodes.filter((n) => n.infrastructure).length;
      $('#topoCount').textContent = `${infra} Mesh-Knoten · ${S.topo.links.length} Verbindungen`;
      if (refit || !view) fit(); else apply();
    };
    const showDetail = (id) => {
      selected = id; draw(false);
      const n = S.topo.nodes.find((x) => x.id === id);
      if (!n) { $('#detail').innerHTML = ''; return; }
      const links = S.topo.links.filter((l) => l.source === id || l.target === id).map((l) => {
        const other = S.topo.nodes.find((x) => x.id === (l.source === id ? l.target : l.source));
        return `<div class="list-item" style="padding:9px 16px"><div class="avatar ${(l.type || '').toUpperCase() === 'WLAN' ? 'wlan' : 'lan'}" style="width:30px;height:30px">${ic((l.type || '').toUpperCase() === 'WLAN' ? 'wifi' : 'ethernet')}</div>
          <div class="grow"><div class="title" style="font-size:13px">${esc(other ? other.name : '?')}</div><div class="meta">${esc(linkLabel(l))}${l.max_rx ? ` · max ${fmtKbit(Math.max(l.max_rx, l.max_tx || 0))}` : ''}</div></div></div>`;
      }).join('');
      $('#detail').innerHTML = `<div class="card topo-detail">
        <div class="card-head"><h2>${esc(n.name)}</h2><button class="icon-btn" id="closeDetail">${ic('x')}</button></div>
        <div class="card-body"><dl class="kv">
          <dt>Rolle</dt><dd>${n.role === 'master' ? 'Mesh Master' : n.role === 'slave' ? 'Mesh Repeater' : 'Endgerät'}</dd>
          ${n.model ? `<dt>Modell</dt><dd>${esc(n.model)}</dd>` : ''}
          ${n.firmware ? `<dt>Firmware</dt><dd>${esc(n.firmware)}</dd>` : ''}
          ${n.ip ? `<dt>IP</dt><dd class="mono">${esc(n.ip)}</dd>` : ''}
          ${n.mac ? `<dt>MAC</dt><dd class="mono">${esc(n.mac)}</dd>` : ''}
        </dl>
        ${n.infrastructure && n.ip ? `<a class="btn sm" style="margin-top:14px;width:100%" href="http://${esc(n.ip)}" target="_blank" rel="noopener">${ic('external')}Oberfläche öffnen</a>` : ''}
        </div>
        ${links ? `<div class="list-group">Verbindungen</div><div class="list">${links}</div>` : ''}
      </div>`;
      $('#closeDetail').addEventListener('click', () => { selected = null; $('#detail').innerHTML = ''; draw(false); });
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
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    $$('[data-z]').forEach((b) => b.addEventListener('click', () => {
      const r = svg.getBoundingClientRect();
      if (b.dataset.z === 'fit') fit(); else zoomAt(b.dataset.z === 'in' ? 1.25 : 0.8, r.width / 2, r.height / 2);
    }));
    $('#showClients').addEventListener('change', (e) => { opts.clients = e.target.checked; store.set('topo', opts); draw(true); });
    $('#reloadBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => { try { await load(true); draw(false); } catch (err) { toast(err.message, 'err'); } }));
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
      el.innerHTML = `<div class="grid cols-2">${list.map((b) => `<div class="card">
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

    const kinds = { all: ['Alle', () => true], incoming: ['Eingehend', (c) => c.type.endsWith('incoming')], outgoing: ['Ausgehend', (c) => c.type.endsWith('outgoing')], missed: ['Verpasst', (c) => c.type === 'missed' || c.type === 'rejected'] };
    const draw = () => {
      const q = f.q.trim().toLowerCase();
      const calls = data.calls.filter(kinds[f.kind][1]).filter((c) => !q || [c.name, c.number, c.own_number, c.device].some((v) => (v || '').toLowerCase().includes(q)));
      let lastDay = ''; let html = '';
      calls.forEach((c) => {
        const d = parseFritzDate(c.date);
        const day = d ? dayLabel(d) : '';
        if (day !== lastDay) { html += `<div class="list-group">${esc(day)}</div>`; lastDay = day; }
        const [icon, label, cls] = CALL[c.type] || CALL.unknown;
        const who = c.name || c.number || 'Unbekannt';
        html += `<div class="list-item">
          <div class="avatar ${cls === 'missed' || cls === 'rejected' ? 'err' : cls === 'outgoing' ? 'accent' : 'ok'}">${ic(icon, `call-dir ${cls}`)}</div>
          <div class="grow"><div class="title" ${cls === 'missed' ? 'style="color:var(--err)"' : ''}>${esc(who)}</div>
          <div class="meta">${c.name && c.number ? `${esc(c.number)} · ` : ''}${label}${c.own_number ? ` · ${cls === 'outgoing' ? 'von' : 'an'} ${esc(c.own_number)}` : ''}${c.device ? ` · ${esc(c.device)}` : ''}</div></div>
          <div style="text-align:right" class="nowrap"><div class="num" style="font-weight:600">${d ? fmtTime(d) : esc(c.date)}</div><div class="faint" style="font-size:12px">${c.type === 'missed' ? '' : esc(fmtCallDuration(c.duration))}</div></div>
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
        <div class="grid ${defl ? 'dash' : ''}"><div class="card">${html ? `<div class="list">${html}</div>` : empty('phone', 'Keine Anrufe', 'Im gewählten Zeitraum wurden keine passenden Anrufe gefunden.')}</div>${defl ? `<div>${defl}</div>` : ''}</div>`;
      const qi = $('#q');
      qi.addEventListener('input', () => { f.q = qi.value; store.set('callFilter', f); const pos = qi.selectionStart; draw(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
      $$('#kinds button').forEach((b) => b.addEventListener('click', () => { f.kind = b.dataset.kind; store.set('callFilter', f); draw(); }));
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
                <a class="icon-btn" href="api/tam/${bid}/${t.index}/${m.index}/audio?download=1" title="Herunterladen">${ic('download')}</a>
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
        playing = key; audio.src = `api/tam/${bid}/${t.index}/${m.index}/audio`;
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
        return `<div class="list-item ${e.dir ? 'clickable' : ''}" ${e.dir ? `data-open="${esc(full)}"` : ''}>
          <div class="avatar ${e.dir ? 'accent' : ''}">${ic(e.dir ? 'folder' : fileIcon(e.name))}</div>
          <div class="grow"><div class="title">${esc(e.name)}</div><div class="meta">${e.dir ? 'Ordner' : fmtBytes(e.size)}${e.modified ? ` · ${new Date(e.modified).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</div></div>
          <div class="actions row" style="gap:2px">
            ${e.dir ? '' : `<a class="icon-btn" title="Herunterladen" href="api/nas/${bid}/download?path=${encodeURIComponent(full)}" data-stop>${ic('download')}</a>`}
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
  async function renderSystem(el) {
    setHeader('System', 'Geräteinformationen, Neustart und Ereignisse', `<button class="btn" id="reloadBtn">${ic('refresh')}<span class="hide-sm">Aktualisieren</span></button>`);
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
        try { await api(`system/${b.config.id}/reboot`, { method: 'POST' }); toast('Neustart wurde ausgelöst.'); } catch (e) { toast(e.message, 'err'); }
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

  // ------------------------------------------------------------------ boxes
  let discovered = null;
  async function renderBoxes(el) {
    setHeader('Boxen & Zugänge', 'FRITZ!Box und FRITZ!Repeater verwalten', `<button class="btn" id="addBtn">${ic('plus')}<span class="hide-sm">Manuell hinzufügen</span></button><button class="btn primary" id="scanBtn">${ic('radar')}Netzwerk durchsuchen</button>`);
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
    if (q.includes('scan=1')) { history.replaceState(null, '', '#/boxes'); scan($('#scanBtn')); }
    if (q.includes('add=1')) { history.replaceState(null, '', '#/boxes'); boxForm(); }
  }

  const RENDER = {
    dashboard: renderDashboard, devices: renderDevices, topology: renderTopology, wlan: renderWlan,
    calls: renderCalls, tam: renderTam, nas: renderNas, system: renderSystem, boxes: renderBoxes,
  };

  // ------------------------------------------------------------------ theme
  const THEMES = [['auto', 'contrast', 'Design: automatisch'], ['light', 'sun', 'Design: hell'], ['dark', 'moon', 'Design: dunkel']];
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    const def = THEMES.find((x) => x[0] === t);
    $('#themeToggle').innerHTML = `${ic(def[1])}<span>${def[2]}</span>`;
  }

  // ------------------------------------------------------------------- boot
  function boot() {
    // ?theme=dark|light overrides the stored preference (used for screenshots)
    const forced = new URLSearchParams(location.search).get('theme');
    let theme = THEMES.some((x) => x[0] === forced) ? forced : store.get('theme', 'auto');
    applyTheme(theme);
    $('#themeToggle').addEventListener('click', () => { const i = THEMES.findIndex((x) => x[0] === theme); theme = THEMES[(i + 1) % THEMES.length][0]; store.set('theme', theme); applyTheme(theme); });
    $('#menuBtn').innerHTML = ic('menu');
    $('#menuBtn').addEventListener('click', () => $('#app').classList.toggle('nav-open'));
    $('#scrim').addEventListener('click', () => $('#app').classList.remove('nav-open'));
    window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
    window.addEventListener('hashchange', navigate);
    // keep nav badges fresh on all pages
    setInterval(() => { if (currentPage() !== 'dashboard') loadOverview().catch(() => {}); }, 60000);
    navigate();
  }
  boot();
})();
