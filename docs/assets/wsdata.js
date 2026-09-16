// Shared data + state module for the Weiss Schwarz price/collection site.
// Loaded by browse.html, wishlist.html, collection.html.
window.WS = (function(){
  const STORAGE_KEY = 'yuyutei-ws-collection-v1';

  let state = {};          // { "game|setCode|cardNumber": {owned:N, wishlist:bool} }
  let manifest = [];       // scraped price sets: {game,set,name,aliases,file,count,scrapedAt}
  let catalogMap = {};     // exact cardNumber -> catalog entry (official card details)
  let catalogBaseMap = {}; // base cardNumber (no rarity suffix) -> catalog entry, fallback
  const setDataCache = {};

  // ---------- local storage ----------
  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('Could not read saved collection:', e);
      state = {};
    }
  }
  function saveState(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Could not save collection:', e);
      alert('Could not save — your browser may be blocking local storage (private/incognito mode can do this).');
    }
  }
  function cardKey(r){ return `${r.game}|${r.setCode}|${r.cardNumber}`; }
  function getEntry(key){ return state[key] || {owned:0, wishlist:false}; }
  function setEntry(key, patch){
    const cur = getEntry(key);
    const next = {...cur, ...patch};
    if (next.owned <= 0 && !next.wishlist) delete state[key];
    else state[key] = next;
    saveState();
  }
  function exportBackup(){
    const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ws-collection-backup-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  function importBackup(file, onDone){
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (typeof imported !== 'object' || Array.isArray(imported)) throw new Error('bad shape');
        const merge = confirm(
          "Merge this backup into your current collection? Matching cards will be overwritten with the backup's values.\n\nClick Cancel to replace your entire collection with the backup instead."
        );
        state = merge ? {...state, ...imported} : imported;
        saveState();
        onDone && onDone();
        alert('Import complete.');
      } catch (e) {
        alert("That file doesn't look like a valid collection backup.");
      }
    };
    reader.readAsText(file);
  }

  // ---------- formatting ----------
  function fmtYen(v){
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return '—';
    return '¥' + n.toLocaleString('en-US');
  }
  function fmtDate(iso){
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
  }
  function normForMatch(s){ return (s || '').toLowerCase().replace(/[\s/\-]/g, ''); }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function setKey(m){ return m.game + '|' + m.set; }
  function baseCardNumber(cn){
    // Yuyu-tei appends a rarity code for parallel/foil prints
    // (e.g. "OSK/S121-002SSP"); the catalog keeps the plain number.
    return (cn || '').replace(/[A-Z+]+$/, '');
  }

  // ---------- data loading ----------
  function loadManifest(){
    return fetch('data/manifest.json', {cache:'no-store'})
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        manifest = data.filter(m => m.game === 'ws')
                        .sort((a,b) => (b.scrapedAt||'').localeCompare(a.scrapedAt||''));
        return manifest;
      })
      .catch(() => { manifest = []; return manifest; });
  }
  function fetchSetRows(entry){
    if (setDataCache[entry.file]) return Promise.resolve(setDataCache[entry.file]);
    return fetch(entry.file, {cache:'no-store'}).then(r => r.json()).then(rows => {
      setDataCache[entry.file] = rows;
      return rows;
    });
  }
  function loadAllSets(){
    return loadManifest().then(m => Promise.all(m.map(fetchSetRows))).then(arrs => arrs.flat());
  }
  function loadCatalog(){
    return fetch('data/catalog_manifest.json', {cache:'no-store'})
      .then(r => r.ok ? r.json() : [])
      .then(entries => Promise.all(entries.map(e => fetch(e.file, {cache:'no-store'}).then(r => r.json()))))
      .then(arrs => {
        arrs.flat().forEach(c => {
          if (!c.cardNumber) return;
          catalogMap[c.cardNumber] = c;
          const base = baseCardNumber(c.cardNumber);
          if (!catalogBaseMap[base]) catalogBaseMap[base] = c;
        });
      })
      .catch(() => { /* catalog is optional enrichment */ });
  }
  function catalogFor(cardNumber){
    return catalogMap[cardNumber] || catalogBaseMap[baseCardNumber(cardNumber)] || null;
  }
  function bestImage(row){
    const cat = catalogFor(row.cardNumber);
    return (cat && cat.imageUrl) || row.imageUrl || '';
  }

  // ---------- card tile (used by all three pages) ----------
  function cardTileHtml(row){
    const key = cardKey(row);
    const e = getEntry(key);
    const img = bestImage(row);
    return `
      <div class="card-tile" data-key="${escapeHtml(key)}">
        <div class="tile-media" data-act="open">
          ${img ? `<img src="${img}" alt="${escapeHtml(row.name||'')}" loading="lazy">` : '<div class="tile-noimg">No image</div>'}
          <button type="button" class="tile-add ${e.owned>0?'has-owned':''}" data-act="inc" title="Click: add · Right-click: remove">${e.owned>0 ? e.owned : '+'}</button>
          <button type="button" class="tile-wish ${e.wishlist?'active':''}" data-act="wish" title="Add to wishlist">${e.wishlist ? '♥' : '♡'}</button>
        </div>
        <div class="tile-info">
          <div class="tile-name">${escapeHtml(row.name||'')}</div>
          <div class="tile-meta">${row.rarity ? `<span class="rarity-badge">${escapeHtml(row.rarity)}</span>` : ''}<span class="tile-number">${escapeHtml(row.cardNumber||'')}</span></div>
          <div class="tile-prices"><span>Sell ${fmtYen(row.sellPriceJpy)}</span><span>Buy ${fmtYen(row.buyPriceJpy)}</span></div>
        </div>
      </div>`;
  }

  function attachTileHandlers(container, rowsByKey, onChange){
    container.querySelectorAll('.card-tile').forEach(tile => {
      const key = tile.dataset.key;
      const row = rowsByKey[key];

      tile.querySelector('[data-act="inc"]').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const e = getEntry(key);
        setEntry(key, {owned: e.owned + 1});
        onChange();
      });
      tile.querySelector('[data-act="inc"]').addEventListener('contextmenu', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const e = getEntry(key);
        setEntry(key, {owned: Math.max(0, e.owned - 1)});
        onChange();
      });
      tile.querySelector('[data-act="wish"]').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const e = getEntry(key);
        setEntry(key, {wishlist: !e.wishlist});
        onChange();
      });
      tile.querySelector('[data-act="open"]').addEventListener('click', () => openModal(row));
    });
  }

  // ---------- card detail modal ----------
  function ensureModal(){
    let el = document.getElementById('ws-modal-backdrop');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ws-modal-backdrop';
    el.className = 'modal-backdrop';
    el.hidden = true;
    el.innerHTML = `<div class="modal">
      <button type="button" class="modal-close" aria-label="Close">×</button>
      <div class="modal-body"></div>
    </div>`;
    el.addEventListener('click', (ev) => { if (ev.target === el) closeModal(); });
    el.querySelector('.modal-close').addEventListener('click', closeModal);
    document.body.appendChild(el);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });
    return el;
  }
  function openModal(row){
    if (!row) return;
    const el = ensureModal();
    const cat = catalogFor(row.cardNumber);
    const img = bestImage(row);
    const stats = cat ? [
      cat.color && `Color: ${escapeHtml(cat.color)}`,
      cat.level && `Level: ${escapeHtml(cat.level)}`,
      cat.cost && `Cost: ${escapeHtml(cat.cost)}`,
      cat.power && `Power: ${escapeHtml(cat.power)}`,
      cat.soul && `Soul: ${escapeHtml(cat.soul)}`,
      cat.trigger && `Trigger: ${escapeHtml(cat.trigger)}`,
    ].filter(Boolean).join(' · ') : '';
    const traits = cat && cat.traits ? cat.traits.map(escapeHtml).join(' / ') : '';
    const text = cat && cat.text ? cat.text.replace(/<br\s*\/?>/gi, '<br>') : '';
    const flavor = cat && cat.flavor ? escapeHtml(cat.flavor) : '';

    el.querySelector('.modal-body').innerHTML = `
      ${img ? `<img src="${img}" alt="">` : ''}
      <div class="modal-info">
        <h2>${escapeHtml(row.name||'')}</h2>
        <div class="modal-number">${escapeHtml(row.cardNumber||'')}${row.rarity ? ' · ' + escapeHtml(row.rarity) : ''}</div>
        ${stats ? `<div class="modal-stats">${stats}</div>` : ''}
        ${traits ? `<div class="modal-traits">${traits}</div>` : ''}
        ${text ? `<div class="modal-text">${text}</div>` : ''}
        ${flavor ? `<div class="modal-flavor">${flavor}</div>` : ''}
        <div class="modal-prices"><span>Sell ${fmtYen(row.sellPriceJpy)}</span><span>Buylist ${fmtYen(row.buyPriceJpy)}</span></div>
        ${row.url ? `<p style="margin-top:10px;"><a href="${row.url}" target="_blank" rel="noopener">View on yuyu-tei →</a></p>` : ''}
      </div>`;
    el.hidden = false;
  }
  function closeModal(){
    const el = document.getElementById('ws-modal-backdrop');
    if (el) el.hidden = true;
  }

  // ---------- pagination ----------
  function paginate(items, page, perPage){
    const start = (page - 1) * perPage;
    return items.slice(start, start + perPage);
  }
  function renderPagination(container, page, totalPages, onPage){
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const btn = (label, target, opts={}) =>
      `<button type="button" data-page="${target}" ${opts.active?'class="active"':''} ${opts.disabled?'disabled':''}>${label}</button>`;
    let html = '';
    html += btn('‹ Prev', page - 1, {disabled: page <= 1});
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
    html += btn('Next ›', page + 1, {disabled: page >= totalPages});
    container.innerHTML = html;
    container.querySelectorAll('button[data-page]:not(:disabled)').forEach(b => {
      b.addEventListener('click', () => onPage(Number(b.dataset.page)));
    });
  }

  // ---------- dropdown panels (Sets, Rarity) ----------
  // Uses an invisible full-screen backdrop to catch outside clicks, the
  // same robust pattern as the card detail modal, instead of trying to
  // detect "was this click outside the box" (which is fragile once the
  // panel's own content re-renders itself, e.g. on checkbox toggle).
  function createDropdown(toggleBtn, panelEl){
    const backdropId = 'ws-dropdown-backdrop';
    function backdrop(){
      let el = document.getElementById(backdropId);
      if (!el) {
        el = document.createElement('div');
        el.id = backdropId;
        el.style.position = 'fixed';
        el.style.inset = '0';
        el.style.zIndex = '25';
        el.style.display = 'none';
        document.body.appendChild(el);
      }
      return el;
    }
    function closeAll(){
      document.querySelectorAll('.panel[data-open="1"]').forEach(p => {
        p.hidden = true;
        p.removeAttribute('data-open');
      });
      backdrop().style.display = 'none';
    }
    function open(){
      closeAll();
      panelEl.hidden = false;
      panelEl.setAttribute('data-open', '1');
      const bd = backdrop();
      bd.style.display = 'block';
      bd.onclick = closeAll;
    }
    function toggle(){ panelEl.hidden ? open() : closeAll(); }
    toggleBtn.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
    panelEl.addEventListener('click', (ev) => ev.stopPropagation());
    return {open, close: closeAll, toggle};
  }

  return {
    loadState, saveState, cardKey, getEntry, setEntry, exportBackup, importBackup,
    fmtYen, fmtDate, normForMatch, escapeHtml, setKey, baseCardNumber,
    loadManifest, fetchSetRows, loadAllSets, loadCatalog, catalogFor, bestImage,
    cardTileHtml, attachTileHandlers, openModal, closeModal,
    paginate, renderPagination, createDropdown,
    get manifest(){ return manifest; },
  };
})();
