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
    fmtYen, escapeHtml, normForMatch,
    paginate, renderPagination,
    openPicker, closePicker,
  };
})();
