// API client for the Weiss Schwarz backend. Replaces the old localStorage
// (wsdata.js) approach — everything now lives in the real database.
window.WSAPI = (function(){
  // ⚠️ Your live backend URL. Update this if you ever redeploy to a new
  // Render URL, or move hosts.
  const API_BASE = "https://ws-backend-z28t.onrender.com";

  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      headers: {"Content-Type": "application/json"},
      ...options,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { const body = await res.json(); detail = body.detail || detail; } catch(e) {}
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    if (res.status === 204) return null;
    return res.json();
  }

  const get = (path) => api(path);
  const post = (path, body) => api(path, {method: "POST", body: JSON.stringify(body || {})});
  const patch = (path, body) => api(path, {method: "PATCH", body: JSON.stringify(body || {})});
  const del = (path) => api(path, {method: "DELETE"});

  // ---------- formatting ----------
  function fmtYen(v){
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    if (Number.isNaN(n)) return "—";
    return "¥" + n.toLocaleString("en-US");
  }
  function escapeHtml(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }
  function normForMatch(s){ return (s || "").toLowerCase().replace(/[\s/\-]/g, ""); }

  // ---------- currency conversion (setting shared across all pages) ----------
  const CURRENCY_KEY = "ws-currency-pref";
  const RATES_KEY = "ws-fx-rates";
  const RATES_TTL_MS = 24 * 60 * 60 * 1000; // refetch at most once a day
  const CURRENCY_SYMBOLS = {USD: "$", GBP: "£", NOK: "kr"};
  let ratesCache = null;

  function getCurrency(){ try { return localStorage.getItem(CURRENCY_KEY) || "USD"; } catch(e) { return "USD"; } }
  function setCurrency(code){ try { localStorage.setItem(CURRENCY_KEY, code); } catch(e) {} }

  function loadRates(){
    try {
      const raw = localStorage.getItem(RATES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.fetchedAt < RATES_TTL_MS) { ratesCache = parsed.rates; return Promise.resolve(ratesCache); }
      }
    } catch(e) {}
    // Free, no-key exchange rate API (European Central Bank data).
    return fetch("https://api.frankfurter.app/latest?from=JPY&to=USD,GBP,NOK")
      .then(r => r.json())
      .then(data => {
        ratesCache = data.rates || null;
        try { localStorage.setItem(RATES_KEY, JSON.stringify({rates: ratesCache, fetchedAt: Date.now()})); } catch(e) {}
        return ratesCache;
      })
      .catch(() => { ratesCache = null; return null; });
  }

  function fmtYenConverted(v){
    const base = fmtYen(v);
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return base;
    const code = getCurrency();
    if (!ratesCache || !ratesCache[code]) return base; // rates not loaded yet — plain yen is still correct, just not converted
    const converted = Number(v) * ratesCache[code];
    const sym = CURRENCY_SYMBOLS[code] || code;
    const shown = converted >= 10 ? Math.round(converted).toLocaleString("en-US") : converted.toFixed(2);
    return code === "NOK" ? `${base} (${shown} kr)` : `${base} (${sym}${shown})`;
  }

  // ---------- rarity ordering (highest to lowest, not alphabetical) ----------
  // Based on typical Weiss Schwarz chase-rarity conventions. Anything not
  // listed here (e.g. a rarity code from a set that uses different
  // conventions) sorts alphabetically after all of these, so it still
  // shows up rather than being dropped.
  const RARITY_ORDER = [
    "AGR", "SEC+", "SEC", "SSP", "SP", "RRR+", "OFR", "RRR", "CR",
    "PR+", "PR", "SR", "RR", "R", "U", "TD", "C", "CC", "CX", "N",
  ];
  function sortRarities(list){
    const rank = (r) => { const i = RARITY_ORDER.indexOf((r||"").toUpperCase()); return i === -1 ? 999 : i; };
    return list.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b); // tie-break alphabetically for anything unranked
    });
  }

  // ---------- pagination ----------
  function paginate(items, page, perPage){
    const start = (page - 1) * perPage;
    return items.slice(start, start + perPage);
  }
  function renderPagination(container, page, totalPages, onPage){
    if (totalPages <= 1) { container.innerHTML = ""; return; }
    const btn = (label, target, opts={}) =>
      `<button type="button" data-page="${target}" ${opts.active?'class="active"':''} ${opts.disabled?'disabled':''}>${label}</button>`;
    let html = "";
    html += btn("‹ Prev", page - 1, {disabled: page <= 1});
    const windowSize = 2;
    const pages = new Set([1, totalPages]);
    for (let p = page - windowSize; p <= page + windowSize; p++) if (p >= 1 && p <= totalPages) pages.add(p);
    const sorted = [...pages].sort((a,b)=>a-b);
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) html += `<span class="ellipsis">…</span>`;
      html += btn(String(p), p, {active: p === page});
      prev = p;
    }
    html += btn("Next ›", page + 1, {disabled: page >= totalPages});
    container.innerHTML = html;
    container.querySelectorAll('button[data-page]:not(:disabled)').forEach(b => {
      b.addEventListener('click', () => onPage(Number(b.dataset.page)));
    });
  }

  // ---------- collection/wishlist picker popover ----------
  // Shared by the + (collections) and ♥ (wishlists) buttons on every card
  // tile: shows existing lists to pick from, plus a "create new" option.
  function ensurePicker(){
    let el = document.getElementById('ws-picker');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ws-picker';
    el.className = 'ws-picker';
    el.hidden = true;
    document.body.appendChild(el);
    document.addEventListener('click', (ev) => {
      if (!el.hidden && !el.contains(ev.target) && !ev.target.closest('[data-picker-trigger]')) {
        closePicker();
      }
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePicker(); });
    return el;
  }
  function closePicker(){
    const el = document.getElementById('ws-picker');
    if (el) el.hidden = true;
  }
  async function openPicker(anchorEl, {listFn, createFn, onPick, title, emptyLabel}){
    const el = ensurePicker();
    el.innerHTML = `<div class="ws-picker-title">${escapeHtml(title)}</div><div class="ws-picker-list">Loading…</div>`;
    const rect = anchorEl.getBoundingClientRect();
    el.style.top = (window.scrollY + rect.bottom + 6) + "px";
    el.style.left = (window.scrollX + Math.max(8, rect.left - 100)) + "px";
    el.hidden = false;

    let items;
    try {
      items = await listFn();
    } catch (e) {
      el.querySelector('.ws-picker-list').innerHTML = `<div class="ws-picker-error">Couldn't load: ${escapeHtml(e.message)}</div>`;
      return;
    }

    const listEl = el.querySelector('.ws-picker-list');
    listEl.innerHTML = (items.length ? items.map(it =>
      `<button type="button" class="ws-picker-item" data-id="${it.id}">${escapeHtml(it.name)}</button>`
    ).join('') : `<div class="ws-picker-empty">${escapeHtml(emptyLabel || 'None yet')}</div>`)
      + `<button type="button" class="ws-picker-item ws-picker-new" data-act="new">+ New…</button>`;

    listEl.querySelectorAll('.ws-picker-item[data-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        closePicker();
        try { await onPick(Number(btn.dataset.id)); }
        catch (e) { alert(e.message); }
      });
    });
    listEl.querySelector('[data-act="new"]').addEventListener('click', async () => {
      const name = prompt(`Name for the new ${title.toLowerCase()}:`);
      if (!name) return;
      closePicker();
      try {
        const created = await createFn(name);
        await onPick(created.id);
      } catch (e) { alert(e.message); }
    });
  }

  return {
    API_BASE, get, post, patch, del,
    fmtYen, escapeHtml, normForMatch, sortRarities,
    getCurrency, setCurrency, loadRates, fmtYenConverted,
    paginate, renderPagination,
    openPicker, closePicker,
  };
})();
