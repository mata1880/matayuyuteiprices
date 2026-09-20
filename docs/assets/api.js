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
  const put = (path, body) => api(path, {method: "PUT", body: JSON.stringify(body || {})});
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

  // ---------- left sidebar (Collections / Wishlists / Binders quick-nav) ----------
  function loadSidebarData(){
    return Promise.all([get("/collections"), get("/wishlists"), get("/binders")])
      .then(([collections, wishlists, binders]) => ({collections, wishlists, binders}));
  }
  let sidebarPicked = null; // {type, id} — the item currently "picked up" for reordering, or null
  function sidebarHtml(data, activeType, activeId){
    function section(title, items, page, type){
      const rows = items.length ? items.map(it => {
        const isActive = activeType === type && Number(activeId) === it.id;
        const isPicked = sidebarPicked && sidebarPicked.type === type && sidebarPicked.id === it.id;
        return `<div class="sidebar-row ${isPicked ? 'picked' : ''}" data-type="${type}" data-id="${it.id}">
          <button type="button" class="sidebar-handle" title="${isPicked ? 'Click another item to move it here, or click again to cancel' : 'Click to pick up and reorder'}">⠿</button>
          <a class="sidebar-link ${isActive ? 'active' : ''}" href="${page}.html?id=${it.id}">${escapeHtml(it.name)}</a>
          <button type="button" class="sidebar-delete" title="Delete">🗑</button>
        </div>`;
      }).join("") : '<div class="sidebar-empty">None yet</div>';
      return `<div class="sidebar-section"><h3>${title}</h3>${rows}</div>`;
    }
    return section("Collections", data.collections, "collection", "collection")
         + section("Wishlists", data.wishlists, "wishlist", "wishlist")
         + section("Binders", data.binders, "binder", "binder");
  }
  // Call once right after setting the sidebar's innerHTML. Handles both
  // delete (with confirmation) and reorder (click an item's handle to
  // pick it up, click another item's handle in the same section to move
  // it there — same pick-up/place pattern as binder cards, since that's
  // proven more reliable than native drag-and-drop). onChanged is called
  // after any delete or successful reorder so the page can re-fetch.
  function wireSidebar(container, onChanged){
    const ENDPOINTS = {collection: '/collections', wishlist: '/wishlists', binder: '/binders'};
    container.querySelectorAll('.sidebar-row').forEach(row => {
      const type = row.dataset.type;
      const id = Number(row.dataset.id);
      const handle = row.querySelector('.sidebar-handle');
      const delBtn = row.querySelector('.sidebar-delete');
      const link = row.querySelector('.sidebar-link');

      handle.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (sidebarPicked && sidebarPicked.type === type && sidebarPicked.id === id) {
          sidebarPicked = null;
          if (onChanged) onChanged();
          return;
        }
        if (sidebarPicked && sidebarPicked.type === type) {
          const rowsOfType = [...container.querySelectorAll(`.sidebar-row[data-type="${type}"]`)];
          const orderedIds = rowsOfType.map(r => Number(r.dataset.id));
          const fromIdx = orderedIds.indexOf(sidebarPicked.id);
          if (fromIdx === -1) { sidebarPicked = null; if (onChanged) onChanged(); return; }
          orderedIds.splice(fromIdx, 1);
          const toIdx = orderedIds.indexOf(id);
          orderedIds.splice(toIdx, 0, sidebarPicked.id);
          sidebarPicked = null;
          try { await put(`${ENDPOINTS[type]}/reorder`, {ids: orderedIds}); }
          catch (e) { alert(e.message); }
          if (onChanged) onChanged();
          return;
        }
        sidebarPicked = {type, id};
        if (onChanged) onChanged();
      });

      if (delBtn) {
        delBtn.addEventListener('click', async (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const name = link ? link.textContent : 'this';
          if (!confirm(`Delete the ${type} "${name}"? This can't be undone — though nothing inside it gets deleted, items just become unassigned.`)) return;
          try { await del(`${ENDPOINTS[type]}/${id}`); }
          catch (e) { alert(e.message); return; }
          if (onChanged) onChanged();
        });
      }
    });
  }
  function showPriceChanges(result){
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.id = 'ws-price-changes-modal';
    const rows = result.changed.map(c => {
      const sellChanged = c.old_sell_price_jpy !== c.new_sell_price_jpy;
      const buyChanged = c.old_buy_price_jpy !== c.new_buy_price_jpy;
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid var(--line-soft);">${escapeHtml(c.name)}<br><span style="font-family:monospace;font-size:11px;color:var(--ink-soft);">${escapeHtml(c.card_number)}</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid var(--line-soft);font-family:monospace;font-size:12.5px;${sellChanged?'color:var(--red);font-weight:600;':''}">${fmtYen(c.old_sell_price_jpy)} → ${fmtYen(c.new_sell_price_jpy)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid var(--line-soft);font-family:monospace;font-size:12.5px;${buyChanged?'color:var(--red);font-weight:600;':''}">${fmtYen(c.old_buy_price_jpy)} → ${fmtYen(c.new_buy_price_jpy)}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `<div class="modal" style="max-width:520px;">
      <button type="button" class="modal-close" aria-label="Close">×</button>
      <div style="padding:20px;color:var(--ink);">
        <h2 style="margin:0 0 6px;font-size:16px;">Price update — ${result.checked} card${result.checked===1?'':'s'} checked</h2>
        <p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 14px;">${result.changed.length} price${result.changed.length===1?'':'s'} changed.${result.truncated ? ' Some cards were skipped this round — click again to work through the rest.' : ''}</p>
        ${result.changed.length ? `<table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr><th style="text-align:left;padding:4px 10px;">Card</th><th style="text-align:left;padding:4px 10px;">Sell</th><th style="text-align:left;padding:4px 10px;">Buy</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>` : `<p style="font-size:13px;color:var(--ink-soft);">No price changes this time.</p>`}
      </div>
    </div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    el.addEventListener('click', (ev) => { if (ev.target === el) close(); });
    el.querySelector('.modal-close').addEventListener('click', close);
  }

  // ---------- dark/light theme (persisted, shared across all pages) ----------
  const THEME_KEY = "ws-theme-pref";
  function getTheme(){ try { return localStorage.getItem(THEME_KEY) || "light"; } catch(e) { return "light"; } }
  function setTheme(theme){
    try { localStorage.setItem(THEME_KEY, theme); } catch(e) {}
    applyTheme(theme);
  }
  function applyTheme(theme){
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  }
  function initTheme(){ applyTheme(getTheme()); }
  // Renders a light/dark toggle button and wires it up. Call once per
  // page, passing the element to fill (usually the header's status area).
  function themeToggleHtml(){
    const isDark = getTheme() === "dark";
    return `<button type="button" id="ws-theme-toggle" title="Switch light/dark" style="font-family:var(--sans);font-size:12px;padding:6px 10px;border:1px solid var(--line);background:var(--card-bg);color:var(--ink);cursor:pointer;border-radius:999px;">${isDark ? '☀ Light' : '☾ Dark'}</button>`;
  }
  function wireThemeToggle(){
    const btn = document.getElementById('ws-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = getTheme() === "dark" ? "light" : "dark";
      setTheme(next);
      btn.textContent = next === "dark" ? '☀ Light' : '☾ Dark';
    });
  }

  function getUrlId(){
    try { const v = new URLSearchParams(location.search).get("id"); return v ? Number(v) : null; }
    catch(e) { return null; }
  }

  // ---------- non-blocking toast (replaces alert() for success messages) ----------
  function toast(message, ms = 3200){
    let el = document.getElementById('ws-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ws-toast';
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);'
        + 'background:#1c1a16;color:#f7f4ee;padding:11px 18px;border-radius:5px;font-size:13.5px;'
        + 'z-index:200;box-shadow:0 4px 16px rgba(0,0,0,0.3);max-width:90vw;text-align:center;'
        + 'opacity:0;transition:opacity 0.2s ease;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, ms);
  }

  // ---------- title/set prefix (strictly the leading 2-4 letters before "/") ----------
  // Not just "everything before the first slash" — a malformed or
  // catalog-only card_number without a clean short letter code would
  // otherwise pollute the Title filter with one-off junk entries.
  function titlePrefix(cardNumber){
    const before = (cardNumber || '').split('/')[0];
    const m = before.match(/^[A-Za-z]{2,4}/);
    return m ? m[0].toUpperCase() : null;
  }

  // The SPECIFIC expansion code — e.g. "SAO/S71" from "SAO/S71-001R" —
  // not just the broad title ("SAO"). Used for price-update's search
  // scoping: no reason to search every SAO expansion when you only own
  // cards from one. Everything before the first "-", since card numbers
  // are always "TITLE/SETCODE-cardnum".
  function setCodePrefix(cardNumber){
    return (cardNumber || '').split('-', 1)[0] || null;
  }

  const PAGE_SIZE = {"3x3": 9, "4x3": 12};
  const LEGACY_LAYOUT_FALLBACK = {"4x5": "4x3", "5x5": "4x3"};
  function resolvedLayout(layout){ return LEGACY_LAYOUT_FALLBACK[layout] || layout; }
  function pageSlotLabel(binderLayout, slotIndex){
    const size = PAGE_SIZE[resolvedLayout(binderLayout)] || 9;
    const page = Math.floor(slotIndex / size) + 1;
    const local = (slotIndex % size) + 1;
    return `page ${page}, slot ${local}`;
  }

  // For Browse/Wishlist, where we only know the CARD, not a specific
  // copy (unlike Collection, which already has individual copies to work
  // with). Prefers linking an owned, unplaced copy if one's available;
  // otherwise creates a "planned" placeholder (greyed out) for a card you
  // don't own yet — either way, reuses an existing planned slot for this
  // exact card in the chosen binder if there is one, rather than making a
  // second slot for the same card.
  async function sendCardToBinder(anchorEl, card){
    let binders;
    try { binders = await get('/binders'); } catch (e) { alert(e.message); return; }
    await openPicker(anchorEl, {
      title: 'Send to binder', emptyLabel: 'No binders yet',
      listFn: () => Promise.resolve(binders),
      createFn: async (name) => {
        const layoutInput = prompt('Layout — type 3x3 (fits toploaders) or 4x3 (sleeved/raw only):', '3x3');
        const layout = (layoutInput || '').trim() === '4x3' ? '4x3' : '3x3';
        return await post('/binders', {name, layout});
      },
      onPick: async (binderId) => {
        try {
          const binder = binders.find(b => b.id === binderId) || await get(`/binders/${binderId}`).catch(() => null);
          let copyId = null;
          const avail = await get(`/binders/${binderId}/available-copies?card_id=${card.id}`);
          if (avail.length === 1) {
            copyId = avail[0].id;
          } else if (avail.length > 1) {
            const label = avail.map(c => `#${c.copy_number}${c.grade ? ' ('+c.grade+')' : ''}`).join(', ');
            const choice = prompt(`Multiple copies available: ${label}\nType which copy number to place (or leave blank to place as a planned/not-yet-owned card):`, String(avail[0].copy_number));
            const picked = avail.find(c => String(c.copy_number) === (choice || '').trim());
            if (picked) copyId = picked.id;
          }

          let targetSlot = null;
          try {
            const planned = await get(`/binders/${binderId}/planned-slot?card_id=${card.id}`);
            targetSlot = planned.slot_index;
          } catch (e) { /* none — fine, fall through to next free slot */ }

          if (targetSlot === null) {
            const slots = await get(`/binders/${binderId}/slots`);
            const occupied = new Set(slots.map(s => s.slot_index));
            targetSlot = 0;
            while (occupied.has(targetSlot)) targetSlot++;
          }

          const body = copyId ? {copy_id: copyId} : {card_id: card.id};
          await post(`/binders/${binderId}/slots/${targetSlot}`, body);
          const layout = binder ? binder.layout : '3x3';
          toast((copyId ? 'Added to ' : 'Added as planned — ') + pageSlotLabel(layout, targetSlot) + '.');
        } catch (e) { alert(e.message); }
      },
    });
  }

  // ---------- currency conversion (setting shared across all pages) ----------
  const CURRENCY_KEY = "ws-currency-pref";
  const RATES_KEY = "ws-fx-rates";
  const RATES_TTL_MS = 24 * 60 * 60 * 1000; // refetch at most once a day
  const CURRENCY_SYMBOLS = {USD: "$", GBP: "£", NOK: "kr"};
  // Rough manual fallback (checked Sep 2026) used only if the live rate
  // fetch fails — better to show an approximate, clearly-marked figure
  // than nothing at all.
  const FALLBACK_RATES = {USD: 0.0067, GBP: 0.0050, NOK: 0.0644};
  let ratesCache = null;
  let ratesAreFallback = false;

  function getCurrency(){ try { return localStorage.getItem(CURRENCY_KEY) || "USD"; } catch(e) { return "USD"; } }
  function setCurrency(code){ try { localStorage.setItem(CURRENCY_KEY, code); } catch(e) {} }

  function loadRates(){
    try {
      const raw = localStorage.getItem(RATES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.rates && Date.now() - parsed.fetchedAt < RATES_TTL_MS) {
          ratesCache = parsed.rates; ratesAreFallback = !!parsed.fallback;
          return Promise.resolve(ratesCache);
        }
      }
    } catch(e) {}
    // Free, no-key exchange rate API (European Central Bank data).
    return fetch("https://api.frankfurter.app/latest?from=JPY&to=USD,GBP,NOK")
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(data => {
        if (!data.rates || !data.rates.USD || !data.rates.GBP || !data.rates.NOK) {
          throw new Error("Unexpected response shape: " + JSON.stringify(data));
        }
        ratesCache = data.rates;
        ratesAreFallback = false;
        try { localStorage.setItem(RATES_KEY, JSON.stringify({rates: ratesCache, fetchedAt: Date.now(), fallback: false})); } catch(e) {}
        return ratesCache;
      })
      .catch((err) => {
        console.error("Currency rate fetch failed, using fallback rates:", err);
        ratesCache = FALLBACK_RATES;
        ratesAreFallback = true;
        try { localStorage.setItem(RATES_KEY, JSON.stringify({rates: ratesCache, fetchedAt: Date.now(), fallback: true})); } catch(e) {}
        return ratesCache;
      });
  }

  // ▲ green (went up) / ▼ red (went down) / - neutral (unchanged) / nothing
  // if there's no previous snapshot to compare against yet.
  function trendArrow(trend){
    if (trend === "up") return '<span class="trend-up">▲</span>';
    if (trend === "down") return '<span class="trend-down">▼</span>';
    if (trend === "same") return '<span class="trend-same">-</span>';
    return '';
  }

  // "In Stock" -> green, "Sold Out" -> red, anything else/unknown -> default color
  function stockClass(availability){
    const a = (availability || '').toLowerCase();
    if (a.includes('sold out')) return 'price-out-of-stock';
    if (a.includes('in stock')) return 'price-in-stock';
    return '';
  }

  function fmtYenConverted(v){
    const base = fmtYen(v);
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return base;
    const code = getCurrency();
    if (!ratesCache || !ratesCache[code]) return base; // rates not loaded yet — plain yen is still correct, just not converted
    const converted = Number(v) * ratesCache[code];
    const sym = CURRENCY_SYMBOLS[code] || code;
    const shown = converted >= 10 ? Math.round(converted).toLocaleString("en-US") : converted.toFixed(2);
    const approx = ratesAreFallback ? "~" : "";
    return code === "NOK" ? `${base} (${approx}${shown} kr)` : `${base} (${approx}${sym}${shown})`;
  }

  // Raw conversion (no formatting/rounding-for-display) — for form fields
  // where the user types a number in a chosen currency and it needs to
  // become a plain JPY figure to store, or vice versa.
  function yenToCurrency(yenAmount, code){
    if (code === "JPY") return yenAmount;
    if (!ratesCache || !ratesCache[code]) return null; // rates not loaded yet
    return yenAmount * ratesCache[code];
  }
  function currencyToYen(amount, code){
    if (code === "JPY") return amount;
    if (!ratesCache || !ratesCache[code]) return null;
    return amount / ratesCache[code];
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
    // Exact match first. If that fails, check whether it's a NUMBERED
    // variant of a known rarity (e.g. "SR1"/"SR2"/"SR3" — a base name
    // from RARITY_ORDER followed by digits) and rank it immediately
    // next to that base, in numeric order, instead of falling all the
    // way to the bottom just because "SR1" itself isn't in the list.
    const rank = (r) => {
      const upper = (r || "").toUpperCase();
      const exact = RARITY_ORDER.indexOf(upper);
      if (exact !== -1) return exact;
      const m = upper.match(/^([A-Z+]+)(\d+)$/);
      if (m && RARITY_ORDER.includes(m[1])) {
        return RARITY_ORDER.indexOf(m[1]) + Number(m[2]) / 1000; // base rank + a small fraction so 1 < 2 < 3, still ahead of the next real entry
      }
      return 999;
    };
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
  // A small floating "- N +" stepper for how many copies of one card sit
  // in one collection — replaces the old one-shot "pick a collection,
  // add one copy, done" flow so you don't have to reopen the picker for
  // every additional copy. Reuses the picker's positioning/backdrop.
  async function openQuantityStepper(anchorEl, collectionId, collectionName, cardId, onCountChanged){
    const el = ensurePicker();
    el.innerHTML = `<div class="ws-picker-title">${escapeHtml(collectionName)}</div>
      <div class="ws-stepper-row">
        <button type="button" class="ws-stepper-btn" data-act="dec">−</button>
        <span class="ws-stepper-count" id="ws-stepper-count">…</span>
        <button type="button" class="ws-stepper-btn" data-act="inc">+</button>
      </div>
      <button type="button" class="ws-picker-item" data-act="done" style="text-align:center;margin-top:4px;">Done</button>`;
    const rect = anchorEl.getBoundingClientRect();
    el.style.top = (window.scrollY + rect.bottom + 6) + "px";
    el.style.left = (window.scrollX + Math.max(8, rect.left - 100)) + "px";
    el.hidden = false;

    const countEl = () => el.querySelector('#ws-stepper-count');
    let copies = [];
    async function refresh(){
      try { copies = await get(`/collections/${collectionId}/copies-of-card/${cardId}`); }
      catch (e) { countEl().textContent = '?'; return; }
      countEl().textContent = copies.length;
      if (onCountChanged) onCountChanged(copies.length);
    }
    await refresh();

    el.querySelector('[data-act="inc"]').addEventListener('click', async () => {
      try { await post('/copies', {card_id: cardId, collection_id: collectionId}); await refresh(); }
      catch (e) { alert(e.message); }
    });
    el.querySelector('[data-act="dec"]').addEventListener('click', async () => {
      if (!copies.length) return;
      const last = copies[copies.length - 1];
      try { await del(`/copies/${last.id}`); await refresh(); }
      catch (e) { alert(e.message); }
    });
    el.querySelector('[data-act="done"]').addEventListener('click', closePicker);
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
    API_BASE, get, post, put, patch, del,
    fmtYen, escapeHtml, normForMatch, sortRarities,
    getCurrency, setCurrency, loadRates, fmtYenConverted, stockClass, trendArrow, yenToCurrency, currencyToYen,
    loadSidebarData, sidebarHtml, wireSidebar, getUrlId, sendCardToBinder,
    getTheme, setTheme, applyTheme, initTheme, themeToggleHtml, wireThemeToggle,
    toast, titlePrefix, setCodePrefix, PAGE_SIZE, resolvedLayout, pageSlotLabel, showPriceChanges,
    paginate, renderPagination,
    openPicker, closePicker, openQuantityStepper,
  };
})();
