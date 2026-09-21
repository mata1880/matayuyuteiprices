// API client for the Weiss Schwarz backend. Replaces the old localStorage
// (wsdata.js) approach — everything now lives in the real database.
window.WSAPI = (function(){
  // ⚠️ Your live backend URL. Update this if you ever redeploy to a new
  // Render URL, or move hosts.
  const API_BASE = "https://ws-backend-z28t.onrender.com";
  const TOKEN_KEY = "ws-auth-token";

  function getToken(){ return localStorage.getItem(TOKEN_KEY); }
  function setToken(t){ localStorage.setItem(TOKEN_KEY, t); }
  function clearToken(){ localStorage.removeItem(TOKEN_KEY); }
  function isLoggedIn(){ return !!getToken(); }

  // Every page (except login.html itself) should call this at the very
  // top of its init — if there's no token at all, it sends you straight
  // to the login screen before anything tries to load. Doesn't validate
  // the token is still GOOD (the backend does that per-request and 401
  // handling below covers a token going stale mid-session) — just that
  // one exists to try.
  function requireLogin(){
    if (!isLoggedIn()) {
      window.location.href = "login.html";
      return false;
    }
    return true;
  }

  async function login(username, pin){
    const result = await api("/auth/login", {method: "POST", body: JSON.stringify({username, pin})});
    setToken(result.token);
    return result;
  }

  async function logout(){
    try { await api("/auth/logout", {method: "POST"}); } catch (e) { /* token already invalid — fine, we're clearing it anyway */ }
    clearToken();
    window.location.href = "login.html";
  }

  async function api(path, options = {}) {
    const token = getToken();
    const headers = {"Content-Type": "application/json"};
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(API_BASE + path, {
      headers,
      ...options,
    });
    if (res.status === 401) {
      // Token's gone stale (or never existed and the backend actually
      // requires one now — phase 5). Clear whatever we had and send them
      // back to log in again, rather than surfacing a confusing error.
      clearToken();
      if (!window.location.pathname.endsWith("login.html")) {
        window.location.href = "login.html";
      }
      throw new Error("Session expired — please log in again.");
    }
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
          <button type="button" class="sidebar-edit" title="Rename">✎</button>
          <button type="button" class="sidebar-delete" title="Delete">🗑</button>
        </div>`;
      }).join("") : '<div class="sidebar-empty">None yet</div>';
      return `<div class="sidebar-section">
        <div class="sidebar-section-head">
          <h3>${title}</h3>
          <button type="button" class="sidebar-new" data-new-type="${type}" data-new-page="${page}" title="Create a new ${title.toLowerCase().replace(/s$/, '')}">+</button>
        </div>
        ${rows}</div>`;
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
      const editBtn = row.querySelector('.sidebar-edit');
      const link = row.querySelector('.sidebar-link');

      if (editBtn) {
        editBtn.addEventListener('click', async (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const current = link ? link.textContent : '';
          const name = prompt(`Rename this ${type}:`, current);
          if (!name || name === current) return;
          try { await patch(`${ENDPOINTS[type]}/${id}`, {name}); }
          catch (e) { alert(e.message); return; }
          if (onChanged) onChanged();
        });
      }

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
          // Target's position must be captured BEFORE removing the picked
          // item — removing an earlier item shifts every later index back
          // by one, so computing toIdx afterward silently pointed at the
          // wrong slot (and specifically made "move item 1 to item 2"
          // collapse into a no-op, since it landed right back where it started).
          const toIdx = orderedIds.indexOf(id);
          if (toIdx === -1) { sidebarPicked = null; if (onChanged) onChanged(); return; }
          orderedIds.splice(fromIdx, 1);
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
    container.querySelectorAll('.sidebar-new').forEach(btn => {
      const type = btn.dataset.newType;
      const page = btn.dataset.newPage;
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const name = prompt(`Name for the new ${type}:`);
        if (!name) return;
        const body = {name};
        if (type === 'binder') {
          const layoutInput = prompt('Layout — type 3x3 (fits toploaders) or 4x3 (sleeved/raw only):', '3x3');
          body.layout = (layoutInput || '').trim() === '4x3' ? '4x3' : '3x3';
        }
        let created;
        try { created = await post(ENDPOINTS[type], body); }
        catch (e) { alert(e.message); return; }
        window.location.href = `${page}.html?id=${created.id}`;
      });
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

  function logoutButtonHtml(){
    return `<button type="button" id="ws-logout-btn" title="Log out" style="font-family:var(--sans);font-size:12px;padding:6px 10px;border:1px solid var(--line);background:var(--card-bg);color:var(--ink);cursor:pointer;border-radius:999px;">Log out</button>`;
  }
  function wireLogoutButton(){
    const btn = document.getElementById('ws-logout-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (confirm('Log out?')) logout();
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
  // Finds where a card should go in a given binder (reuse an existing
  // planned slot for it, or the next free one) and places it — the core
  // placement logic shared by the binder-picker flow and quick-add.
  async function addCardToBinder(binderId, card){
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
    return {slotIndex: targetSlot, copyId};
  }

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
          const {slotIndex, copyId} = await addCardToBinder(binderId, card);
          const layout = binder ? binder.layout : '3x3';
          toast((copyId ? 'Added to ' : 'Added as planned — ') + pageSlotLabel(layout, slotIndex) + '.');
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
  // Standalone rank function (lower = rarer/more important), reused by
  // both sortRarities() and the quick-add search results ranking.
  function rarityRank(r){
    const upper = (r || "").toUpperCase();
    const exact = RARITY_ORDER.indexOf(upper);
    if (exact !== -1) return exact;
    const m = upper.match(/^([A-Z+]+)(\d+)$/);
    if (m && RARITY_ORDER.includes(m[1])) {
      return RARITY_ORDER.indexOf(m[1]) + Number(m[2]) / 1000;
    }
    return 999;
  }
  function sortRarities(list){
    // Exact match first. If that fails, check whether it's a NUMBERED
    // variant of a known rarity (e.g. "SR1"/"SR2"/"SR3" — a base name
    // from RARITY_ORDER followed by digits) and rank it immediately
    // next to that base, in numeric order, instead of falling all the
    // way to the bottom just because "SR1" itself isn't in the list.
    const rank = rarityRank;
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
  // "Add to collection" as ONE list: every collection shown at once, with
  // its own -/+ right on the row, so adjusting quantity across multiple
  // collections never needs more than this one picker. Stays open across
  // clicks (closes only via outside-click/Escape, same as any picker) —
  // click + or - as many times, on as many rows, as you want.
  async function openCollectionQuantityPicker(anchorEl, card, onDone){
    const el = ensurePicker();
    el.innerHTML = `<div class="ws-picker-title">Add to collection</div><div class="ws-picker-list">Loading…</div>`;
    const rect = anchorEl.getBoundingClientRect();
    el.style.top = (window.scrollY + rect.bottom + 6) + "px";
    el.style.left = (window.scrollX + Math.max(8, rect.left - 100)) + "px";
    el.hidden = false;

    let rows;
    try { rows = await get(`/copies/counts-for-card/${card.id}`); }
    catch (e) {
      el.querySelector('.ws-picker-list').innerHTML = `<div class="ws-picker-error">Couldn't load: ${escapeHtml(e.message)}</div>`;
      return;
    }

    function renderRows(){
      const listEl = el.querySelector('.ws-picker-list');
      listEl.innerHTML = rows.map(r => `
        <div class="ws-stepper-item" data-collection-id="${r.collection_id}">
          <span class="ws-stepper-item-name">${escapeHtml(r.name)}</span>
          <button type="button" class="ws-stepper-mini" data-act="dec" ${r.count <= 0 ? 'disabled' : ''}>−</button>
          <span class="ws-stepper-item-count">${r.count}</span>
          <button type="button" class="ws-stepper-mini" data-act="inc">+</button>
        </div>`).join('')
        + `<button type="button" class="ws-picker-item ws-picker-new" data-act="new">+ New…</button>`;

      listEl.querySelectorAll('.ws-stepper-item').forEach(rowEl => {
        const cid = Number(rowEl.dataset.collectionId);
        const row = rows.find(r => r.collection_id === cid);
        rowEl.querySelector('[data-act="inc"]').addEventListener('click', async () => {
          try {
            await post('/copies', {card_id: card.id, collection_id: cid});
            row.count++;
            card.owned_copies = (card.owned_copies || 0) + 1;
            renderRows();
            if (onDone) onDone();
          } catch (e) { alert(e.message); }
        });
        const decBtn = rowEl.querySelector('[data-act="dec"]');
        decBtn.addEventListener('click', async () => {
          if (row.count <= 0) return;
          try {
            const copiesHere = await get(`/collections/${cid}/copies-of-card/${card.id}`);
            const last = copiesHere[copiesHere.length - 1];
            if (!last) return;
            await del(`/copies/${last.id}`);
            row.count--;
            card.owned_copies = Math.max(0, (card.owned_copies || 0) - 1);
            renderRows();
            if (onDone) onDone();
          } catch (e) { alert(e.message); }
        });
      });
      listEl.querySelector('[data-act="new"]').addEventListener('click', async () => {
        const name = prompt('Name for the new collection:');
        if (!name) return;
        try {
          const created = await post('/collections', {name});
          rows.push({collection_id: created.id, name: created.name, count: 0});
          renderRows();
        } catch (e) { alert(e.message); }
      });
    }
    renderRows();
  }

  // Search-as-you-type against the whole card database (not just what's
  // already in the current collection/wishlist/binder), showing up to 4
  // results as a 2x2 grid of thumbnails, rarest first. Each page decides
  // what "picking" a result means via onPick — add a copy, wishlist it,
  // send it to the binder, whatever that page is for.
  function initQuickAdd(inputEl, resultsEl, onPick){
    let debounceTimer = null;
    inputEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = inputEl.value.trim();
      if (!q) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; return; }
      debounceTimer = setTimeout(async () => {
        let cards;
        try { cards = await get(`/cards?search=${encodeURIComponent(q)}`); }
        catch (e) { return; }
        const sorted = cards.slice().sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity)).slice(0, 4);
        renderQuickAddResults(resultsEl, sorted, onPick, () => { inputEl.value = ''; });
      }, 250);
    });
    document.addEventListener('click', (ev) => {
      if (!inputEl.contains(ev.target) && !resultsEl.contains(ev.target)) resultsEl.style.display = 'none';
    });
  }
  function renderQuickAddResults(resultsEl, cards, onPick, onPicked){
    if (!cards.length) {
      resultsEl.innerHTML = '<div class="quickadd-empty">No matches.</div>';
      resultsEl.style.display = 'block';
      return;
    }
    resultsEl.innerHTML = `<div class="quickadd-grid">` + cards.map(c => `
      <div class="quickadd-card" data-id="${c.id}">
        ${c.image_url ? `<img src="${escapeHtml(c.image_url)}" alt="">` : '<div class="quickadd-card-noimg"></div>'}
        <div class="quickadd-card-info">
          <span class="quickadd-card-rarity">${escapeHtml(c.rarity || '')}</span>
          <span class="quickadd-card-name">${escapeHtml(c.name)}</span>
        </div>
      </div>`).join('') + `</div>`;
    resultsEl.style.display = 'block';
    resultsEl.querySelectorAll('.quickadd-card').forEach(el => {
      const card = cards.find(c => c.id === Number(el.dataset.id));
      el.addEventListener('click', () => {
        onPick(card);
        resultsEl.style.display = 'none';
        if (onPicked) onPicked();
      });
    });
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
    getToken, isLoggedIn, requireLogin, login, logout,
    fmtYen, escapeHtml, normForMatch, sortRarities,
    getCurrency, setCurrency, loadRates, fmtYenConverted, stockClass, trendArrow, yenToCurrency, currencyToYen,
    loadSidebarData, sidebarHtml, wireSidebar, getUrlId, sendCardToBinder, addCardToBinder,
    getTheme, setTheme, applyTheme, initTheme, themeToggleHtml, wireThemeToggle,
    logoutButtonHtml, wireLogoutButton,
    toast, titlePrefix, setCodePrefix, PAGE_SIZE, resolvedLayout, pageSlotLabel, showPriceChanges,
    paginate, renderPagination,
    openPicker, closePicker, openCollectionQuantityPicker, initQuickAdd,
  };
})();
