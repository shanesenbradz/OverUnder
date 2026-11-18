/* ============================================================
   Dialogs
   ============================================================ */
function dialog({ title, body, input, buttons = [{ label: 'OK', value: true, primary: true }], dismiss = null, build, wide = false, sheet = false }) {
  return new Promise(res => {
    const wrap = $('#dlgWrap'), d = $('#dlg'); d.innerHTML = '';
    wrap.classList.toggle('as', sheet); d.classList.toggle('wide', wide);
    let inp;
    const close = v => { wrap.classList.add('hidden'); wrap.onclick = null; res(v); };
    if (title) d.append(h('h4', null, title));
    if (body) d.append(typeof body === 'string' ? h('div', { class: 'body', html: body }) : body);
    if (build) build(d, close);
    if (input !== undefined) { inp = h('input', { class: 'inp', value: input }); d.append(inp); setTimeout(() => { inp.focus(); inp.select(); }, 30); inp.onkeydown = e => { if (e.key === 'Enter') close(inp.value); }; }
    if (buttons.length) d.append(h('div', { class: 'acts' }, buttons.map(b => h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => close(b.value === '__input' ? inp.value : b.value) }, b.label))));
    wrap.classList.remove('hidden');
    wrap.onclick = e => { if (e.target === wrap) close(dismiss); };
  });
}
const confirmD = (title, body, ok = 'OK', danger = false) => dialog({ title, body, buttons: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !danger, danger }] });
const promptD = (title, value = '') => dialog({ title, input: value, buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: '__input', primary: true }] });
const menuD = (title, items) => dialog({
  sheet: true, buttons: [], build: (d, close) => d.append(
    h('div', { class: 'as-group' }, h('div', { class: 'as-title' }, title), h('div', { class: 'menu-list' }, items.map(it => h('button', { class: it.danger ? 'danger' : '', onclick: () => close(it.k) }, it.label)))),
    h('button', { class: 'as-cancel', onclick: () => close(null) }, 'Cancel')),
});

/* ============================================================
   Views
   ============================================================ */
function showView(v) {
  $('#library').classList.toggle('hidden', v !== 'library');
  $('#player').classList.toggle('hidden', v !== 'player');
  if (v === 'player') history.pushState({ p: 1 }, '');
}
addEventListener('popstate', () => {
  if (!Emu.active) return;
  if (!$('#dlgWrap').classList.contains('hidden')) { $('#dlgWrap').click(); history.pushState({ p: 1 }, ''); return; }
  if (Touch.editing) { Touch.endEdit(); history.pushState({ p: 1 }, ''); return; }
  if (!$('#sheet').classList.contains('hidden')) { Sheet.close(); history.pushState({ p: 1 }, ''); return; }
  Emu.stop();
});
// Called by the Android shell for the back gesture. Returns true when the page used it.
window.bullpupBack = () => {
  if (!$('#dlgWrap').classList.contains('hidden')) { $('#dlgWrap').click(); return true; }
  if (Touch.editing) { Touch.endEdit(); return true; }
  if (!$('#sheet').classList.contains('hidden')) { if (Sheet.query) { Sheet.setQuery(''); Sheet.render(); } else Sheet.close(); return true; }
  if (Emu.active) { Emu.stop(); return true; }
  return false;
};

/* ============================================================
   Library
   ============================================================ */
const Library = {
  list: [],
  init() {
    $('#btnAdd').onclick = $('#btnAdd2').onclick = () => this.pickAndAdd();
    $('#btnSettings').onclick = () => Sheet.open('look');
    $('#library').addEventListener('scroll', () => $('#libHead').classList.toggle('scrolled', $('#library').scrollTop > 44), { passive: true });
    $('#search').oninput = () => this.render();
    $('#sort').value = localStorage.getItem('underover.sort') || 'recent';
    $('#sort').onchange = () => { localStorage.setItem('underover.sort', $('#sort').value); this.render(); };
    addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
    addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
    addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('dragging'); if (!Emu.active) this.addFiles([...e.dataTransfer.files]); });
    this.render();
  },
  async pickAndAdd() { const f = await pickFiles('.nds,.dsi,.srl,.zip', true); this.addFiles(f); },
  async addFiles(files) {
    let added = 0, last = null;
    for (const f of files) {
      try {
        let bytes = await readBytes(f), name = f.name;
        if (isZip(bytes)) ({ name, bytes } = await unzipFirst(bytes, ROM_EXT));
        const sys = detectSystem(bytes, name);
        if (!sys) { toast(`${f.name} does not look like a DS game`); continue; }
        if (sys === 'dsi') toast(`${cleanName(name)} is a DSi-only game. It may not start: this core runs DS games.`, 3200);
        const crc = crc32(bytes), id = hex(crc) + '-' + bytes.length;
        if (await DB.get('meta', id)) { toast(`${cleanName(name)} is already in your library`); continue; }
        const hd = romHeaderTitle(bytes);
        const meta = { id, name: cleanName(name) || hd.title || 'Untitled', file: name, system: sys, size: bytes.length, crc: hex(crc), code: hd.code, title: hd.title, banner: hd.banner, icon: hd.icon, added: Date.now(), lastPlayed: 0, playSec: 0, thumb: null };
        await DB.put('roms', id, bytes); await DB.put('meta', id, meta); added++; last = meta;
      } catch (e) { toast(`${f.name}: ${e.message}`); }
    }
    if (added) { toast(added === 1 ? `Added ${last.name}` : `Added ${added} games`); navigator.storage?.persist?.(); }
    this.render();
  },
  async render() {
    this.list = await DB.all('meta');
    const q = $('#search').value.trim().toLowerCase(), sort = $('#sort').value;
    let L = this.list.filter(m => !q || m.name.toLowerCase().includes(q) || (m.title || '').toLowerCase().includes(q));
    const by = { recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.added - a.added, name: (a, b) => a.name.localeCompare(b.name), added: (a, b) => b.added - a.added, time: (a, b) => (b.playSec || 0) - (a.playSec || 0) }[sort];
    L.sort(by);
    const g = $('#games'); g.innerHTML = '';
    $('#empty').classList.toggle('show', !this.list.length);
    const shelf = $('#shelf'); if (shelf && !shelf.childElementCount) for (const [k, w] of [['pistol', 30], ['raygun', 42], ['soaker', 48], ['revolver', 38], ['bubble', 32]]) shelf.append(h('span', { style: { width: w + 'px' }, html: SPRITES[k] }));
    $('.lib-tools').style.display = this.list.length ? '' : 'none';
    for (const m of L) {
      const cover = h('div', { class: 'cover', style: m.thumb ? { backgroundImage: `url(${m.thumb})` } : null },
        m.thumb ? null : m.icon ? h('img', { class: 'ds-icon', src: m.icon, alt: '' }) : h('span', { class: 'placeholder', html: spriteFor(m.id) }),
        h('span', { class: 'badge' }, m.system.toUpperCase()));
      const more = h('button', { class: 'more', 'aria-label': 'Options for ' + m.name, html: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>', onclick: e => { e.stopPropagation(); this.cardMenu(m); } });
      g.append(h('div', { class: 'card', role: 'button', tabindex: 0, onclick: () => Emu.start(m), onkeydown: e => { if (e.key === 'Enter') Emu.start(m); } }, cover,
        h('div', { class: 'meta' }, h('div', null, h('div', { class: 'name', title: m.name }, m.name), h('div', { class: 'sub' }, m.lastPlayed ? `${fmtTime(m.playSec)}  ·  ${fmtAgo(m.lastPlayed)}` : 'Not played yet')), more)));
    }
    const est = await navigator.storage?.estimate?.().catch(() => null);
    $('#libFoot').textContent = `${this.list.length} game${this.list.length === 1 ? '' : 's'}${est ? `  ·  ${fmtBytes(est.usage || 0)} on this phone` : ''}  ·  melonDS core`;
  },
  async cardMenu(m) {
    const k = await menuD(m.name, [
      { k: 'play', label: 'Play' }, { k: 'rename', label: 'Rename' }, { k: 'patch', label: 'Apply a patch (IPS, UPS, BPS)' },
      { k: 'isav', label: 'Import save file (.sav)' }, { k: 'esav', label: 'Export save file (.sav)' }, { k: 'erom', label: 'Export ROM' },
      { k: 'info', label: 'Details' }, { k: 'del', label: 'Delete from library', danger: true },
    ]);
    if (k === 'play') Emu.start(m);
    if (k === 'rename') { const n = await promptD('Rename', m.name); if (n && n.trim()) { m.name = n.trim(); await DB.put('meta', m.id, m); this.render(); } }
    if (k === 'patch') {
      const [f] = await pickFiles('.ips,.ups,.bps'); if (!f) return;
      try {
        const out = applyPatch(await DB.get('roms', m.id), await readBytes(f));
        const crc = crc32(out), id = hex(crc) + '-' + out.length;
        const meta = { ...m, id, name: m.name + ' [' + cleanName(f.name) + ']', crc: hex(crc), size: out.length, added: Date.now(), lastPlayed: 0, playSec: 0, thumb: null };
        await DB.put('roms', id, out); await DB.put('meta', id, meta); toast('Patched copy added'); this.render();
      } catch (e) { toast(e.message); }
    }
    if (k === 'isav') { const [f] = await pickFiles('.sav,.srm,.bin'); if (f) { await DB.put('saves', m.id, await readBytes(f)); await DB.del('states', m.id + ':auto'); toast('Save imported'); } }
    if (k === 'esav') { const s = await DB.get('saves', m.id); s ? download(safeName(m.name) + '.sav', s) : toast('No save data yet'); }
    if (k === 'erom') { const r = await DB.get('roms', m.id); download(m.file || safeName(m.name) + '.nds', r); }
    if (k === 'info') dialog({ wide: true, title: m.name, body: `<div class="note">System: <b>${m.system.toUpperCase()}</b><br>Header title: <b>${m.title || '-'}</b> ${m.code ? `(${m.code})` : ''}<br>${m.banner ? `Banner: <b>${m.banner}</b><br>` : ''}CRC32: <b>${m.crc}</b><br>Size: <b>${fmtBytes(m.size)}</b><br>Play time: <b>${fmtTime(m.playSec)}</b><br>Added: <b>${new Date(m.added).toLocaleString()}</b></div>` });
    if (k === 'del' && await confirmD('Delete ' + m.name + '?', 'This removes the ROM, its save data, save states and cheats from this phone.', 'Delete', true)) {
      await DB.del('roms', m.id); await DB.del('meta', m.id); await DB.del('saves', m.id); await DB.del('cheats', m.id); await DB.delPrefix('states', m.id + ':');
      this.render();
    }
  },
};

/* ============================================================
   Menu sheet
   ============================================================ */
const sw = (key, on) => { const i = h('input', { type: 'checkbox' }); i.checked = !!S[key]; i.onchange = () => { S[key] = i.checked; saveSettings(); on && on(i.checked); }; return h('label', { class: 'switch' }, i, h('i')); };
const swRaw = (val, on) => { const i = h('input', { type: 'checkbox' }); i.checked = !!val; i.onchange = () => on(i.checked); return h('label', { class: 'switch' }, i, h('i')); };
const sel = (key, opts, on) => { const s = h('select', null, opts.map(([v, l]) => h('option', { value: v }, l))); s.value = String(S[key]); s.onchange = () => { const v = s.value; S[key] = isNaN(+v) || v === '' ? v : +v; saveSettings(); on && on(S[key]); }; return s; };
const rng = (key, min, max, step, on, fmt = v => v) => {
  const out = h('span', { class: 'val' }, fmt(S[key]));
  const r = h('input', { type: 'range', min, max, step }); r.value = S[key];
  r.oninput = () => { S[key] = +r.value; out.textContent = fmt(S[key]); saveSettings(); on && on(S[key]); };
  return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', width: '55%', justifyContent: 'flex-end' } }, r, out);
};
const row = (t, d, ctl) => h('div', { class: 'row' + (ctl ? '' : ' head') }, h('div', null, h('div', { class: 't' }, t), d ? h('div', { class: 'd' }, d) : null), ctl);
// Sections fold shut so the long settings lists stay easy to scan. A closed section only shows
// its title bar; tap it to open. What you open or close is remembered per tab and section.
let _fold = {}; try { _fold = JSON.parse(localStorage.getItem('underover.fold') || '{}'); } catch (e) {}
const FOLD_OPEN = new Set(['look:Preview']); // open until the user closes it
const foldKey = title => (Sheet.tab || '') + ':' + String(title).split('  ·  ')[0];
const saveFold = () => { try { localStorage.setItem('underover.fold', JSON.stringify(_fold)); } catch (e) {} };
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.6 5.4 1.4-1.4 8 8-8 8-1.4-1.4 6.6-6.6z"/></svg>';
function setFold(box, open, remember = true) {
  box.classList.toggle('closed', !open);
  box.querySelector(':scope>.sec-h')?.setAttribute('aria-expanded', String(open));
  if (remember) { _fold[box.dataset.fold] = open; saveFold(); }
  if (open && box.querySelector('.pv') && typeof refreshPreviewVinyl === 'function') requestAnimationFrame(() => refreshPreviewVinyl(_pv));
}
// force: true keeps the section open no matter what was saved (used while a link is live)
const secF = (title, force, ...kids) => {
  const box = h('div', { class: 'sec' }); let grp = null, body = box;
  if (title) {
    const k = foldKey(title); box.dataset.fold = k; box.classList.add('fold');
    const open = force || (k in _fold ? _fold[k] : FOLD_OPEN.has(k));
    const head = h('button', { class: 'sec-h', type: 'button', 'aria-expanded': String(open), onclick: () => setFold(box, box.classList.contains('closed')) },
      h('span', null, title), h('span', { class: 'chev', html: CHEVRON }));
    body = h('div', { class: 'sec-body' });
    box.append(head, body); if (!open) box.classList.add('closed');
  }
  for (const k of kids.flat()) {
    if (!k) continue;
    if (k.classList && (k.classList.contains('note') || k.classList.contains('btns') || k.classList.contains('bare') || k.classList.contains('btn'))) { grp = null; body.append(k); continue; }
    if (!grp) { grp = h('div', { class: 'group' }); body.append(grp); }
    grp.append(k);
  }
  return box;
};
const sec = (title, ...kids) => secF(title, false, ...kids);
// "Open all / Close all" at the top of every tab
function foldBar(b) {
  const btn = h('button', { class: 'fold-all', type: 'button' });
  const secs = () => [...b.querySelectorAll('.sec.fold')];
  const label = () => { btn.textContent = secs().some(x => x.classList.contains('closed')) ? 'Open all' : 'Close all'; };
  btn.onclick = () => { const open = secs().some(x => x.classList.contains('closed')); secs().forEach(x => setFold(x, open)); label(); };
  b.addEventListener('click', e => { if (e.target.closest('.sec-h')) setTimeout(label, 0); });
  const bar = h('div', { class: 'fold-bar' }, btn); bar._label = label; return bar;
}
const chips = (key, opts, on) => {
  const box = h('div', { class: 'chips' });
  const draw = () => { box.innerHTML = ''; for (const [v, l] of opts) box.append(h('button', { class: 'chip' + (S[key] === v ? ' act' : ''), onclick: () => { S[key] = v; saveSettings(); draw(); on && on(v); } }, l)); };
  draw(); return box;
};
const applyAudio = () => Audio_.apply(S);
const redraw = () => { if (Emu.active) { Emu.layoutScreen(); } };

const Sheet = {
  tab: 'game',
  tabs() { return Emu.active ? [['game', 'Game'], ['cheats', 'Cheats'], ['look', 'Look'], ['audio', 'Audio'], ['controls', 'Input'], ['system', 'System']] : [['look', 'Look'], ['audio', 'Audio'], ['controls', 'Input'], ['system', 'System']]; },
  init() {
    $('#sheetClose').onclick = () => this.close(); $('#scrim').onclick = () => this.close();
    const q = $('#menuSearch'); let t = 0;
    q.oninput = () => { clearTimeout(t); t = setTimeout(() => { const was = !!this.query.trim(); this.query = q.value; if (!was || !this.query.trim()) $('#sheetBody').scrollTop = 0; this.render(); }, 120); };
    q.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); this.setQuery(''); this.render(); q.blur(); } if (e.key === 'Enter') q.blur(); };
  },
  get isOpen() { return !$('#sheet').classList.contains('hidden'); },
  toggle() { this.isOpen ? this.close() : this.open(); },
  open(tab) {
    if (tab) this.tab = tab; if (!this.tabs().some(t => t[0] === this.tab)) this.tab = this.tabs()[0][0];
    if (Emu.active && S.pauseOnMenu && !Link.active) { this._paused = !Emu.paused; Emu.pause(true); }
    $('#sheet').classList.remove('hidden'); $('#scrim').classList.remove('hidden');
    $('#sheetTitle').textContent = Emu.active ? Emu.game.name : 'Settings';
    $('#sheetSub').textContent = Emu.active ? `${Emu.game.system.toUpperCase()}  ·  SN ${Emu.game.crc}  ·  ${Emu.game.playSec >= 1 ? fmtTime(Emu.game.playSec) : 'first session'}` : 'Applies to every game';
    this.render();
  },
  close() {
    this.setQuery('');
    $('#sheet').classList.add('hidden'); $('#scrim').classList.add('hidden');
    if (Emu.active && this._paused && !Emu.userPaused) Emu.pause(false); this._paused = false;
    if (!Emu.active) Library.render();
  },
  refreshIf(t) { if (this.isOpen && (this.tab === t || this.query)) this.render(); },
  query: '',
  setQuery(q) { this.query = q; const i = $('#menuSearch'); if (i && i.value !== q) i.value = q; },
  render() {
    const nav = $('#tabs'); nav.innerHTML = '';
    for (const [k, l] of this.tabs()) nav.append(h('button', { class: k === this.tab && !this.query.trim() ? 'act' : '', onclick: () => { this.setQuery(''); this.tab = k; $('#sheetBody').scrollTop = 0; this.render(); } }, l));
    if (this.query.trim()) return this.renderSearch(this.query);
    const b = $('#sheetBody'); const top = b.scrollTop; b.innerHTML = '';
    const bar = foldBar(b); b.append(bar);
    Promise.resolve(Panels[this.tab](b)).then(() => { bar._label(); b.scrollTop = top; });
    bar._label(); b.scrollTop = top;
  },
};

/* ---------- menu search ----------
 * Typing in the search box renders every tab of the menu at once and keeps only the settings that
 * match, so "rewind", "vibration" or "bluetooth" finds the switch wherever it lives. Matching
 * sections open (without changing which sections you keep open), everything else is hidden, and the
 * controls work right there in the results. Each tab's results have a button to jump to that tab. */
const normQ = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.+#]+/g, ' ').trim();
// Extra words people search for that don't appear in a section's own text
const SEARCH_TAGS = {
  'Speed': 'fast forward turbo slow motion pause',
  'Save states': 'load slot snapshot quick save',
  'Battery save': 'sav in game save export import pizza boy my boy',
  'Tools': 'screenshot record clip video capture photo',
  'Screens': 'dual screen layout swap bottom top touch single one stacked side by side gap stylus',
  'DS console': 'lid close sleep mic microphone blow',
  'Active cheats': 'action replay ards code',
  'RAM search': 'cheat finder memory value lock',
  'Screen shader': 'filter lcd crt scanlines grid graphics video look',
  'Screen picture': 'brightness contrast saturation color correction blend aspect integer scaling video',
  'Output': 'volume sound audio mute',
  'Reverb': 'room echo sound audio',
  'Equalizer': 'eq bass mid treble width stereo speaker',
  'Touch controls': 'buttons layout opacity size edit dpad on screen',
  'Controllers': 'gamepad bluetooth xbox playstation ps4 ps5 8bitdo switch pro pair',
  'Gamepad buttons': 'remap bind controller mapping',
  'Keyboard': 'keys remap bind mapping',
  'Performance': 'frame skip fps lag stutter slow speed',
  'Behaviour': 'auto resume snapshot pause background screen on wake lock lights',
  'Rewind': 'undo go back memory',
  'DS profile': 'nickname name language birthday favourite favorite colour color firmware user',
  'Sound quality': 'interpolation cubic gaussian cosine linear 10 bit 16 bit audio',
  'Microphone': 'mic blow voice permission',
  'Backup': 'export import restore transfer move phone saves',
  'Updates': 'update upgrade new version download install check',
  'About': 'version privacy license credits',
  'Appearance': 'theme dark light accent color colour',
  'Controller skin': 'skin shell color colour console',
  'Device': 'bezel glass led grille plate',
  'Wallpaper': 'background image photo',
  'Buttons': 'button style press haptic vibration click sound labels',
  'Effects': 'ambient glow vinyl wrap sticker decal shadow',
  'Controller': 'skin buttons haptic vibration labels',
  'Screen': 'shader filter video picture',
};
function filterPanel(part, words, tabLabel) {
  let hits = 0;
  const has = (txt, w) => txt.includes(w);
  // text of an element, ignoring the options inside drop-down lists
  const text = el => { const c = el.cloneNode(true); c.querySelectorAll('select,option,canvas,svg').forEach(x => x.remove()); return normQ(c.textContent); };
  for (const box of part.querySelectorAll('.sec')) {
    const headEl = box.querySelector(':scope>.sec-h');
    const title = headEl ? headEl.textContent : '';
    const base = String(title).split('  ·  ')[0];
    const ctx = normQ(tabLabel + ' ' + title + ' ' + (SEARCH_TAGS[base] || ''));
    const body = box.querySelector(':scope>.sec-body') || box;
    // a list of rows inside one wrapper (the key and button bindings) is searched row by row
    const split = c => !c.classList.contains('row') && c.querySelectorAll(':scope>.row').length > 1 ? [...c.children] : [c];
    const items = [...body.children].flatMap(c => c.classList.contains('group') ? [...c.children] : [c]).flatMap(split);
    const titleCtx = normQ(tabLabel + ' ' + title);
    let show = 0;
    if (title && words.every(w => has(titleCtx, w))) show = items.length || 1; // the section's own name matches: show all of it
    else {
      for (const it of items) {
        const t = text(it);
        const ok = t && words.every(w => has(t, w) || has(ctx, w)) && words.some(w => has(t, w));
        it.style.display = ok ? '' : 'none';
        if (ok) show++;
      }
      // only a related word matched (say "volume" for Output): show the whole section
      if (!show && title && words.every(w => has(ctx, w))) { items.forEach(it => { it.style.display = ''; }); show = items.length || 1; }
    }
    for (const w of body.querySelectorAll('.group>div:not(.row), :scope>.group')) if (w.children.length && ![...w.children].some(c => c.style.display !== 'none')) w.style.display = 'none';
    if (!show) { box.style.display = 'none'; continue; }
    hits += show;
    box.classList.remove('closed'); headEl?.setAttribute('aria-expanded', 'true');
    if (box.querySelector('.pv') && typeof refreshPreviewVinyl === 'function') requestAnimationFrame(() => refreshPreviewVinyl(_pv));
  }
  part.querySelectorAll('.fold-bar').forEach(x => x.remove());
  return hits;
}
Sheet.renderSearch = async function (q) {
  const gen = (this._gen = (this._gen || 0) + 1);
  const words = normQ(q).split(' ').filter(Boolean);
  const b = $('#sheetBody'), top = b.scrollTop, keep = this.tab, out = document.createDocumentFragment();
  let hits = 0;
  for (const [k, l] of this.tabs()) {
    const part = h('div', { class: 'search-part' });
    this.tab = k;
    try { await Panels[k](part); } catch (e) { console.warn('search', k, e); }
    this.tab = keep;
    if (gen !== this._gen) return; // a newer search started while this tab was rendering
    const n = words.length ? filterPanel(part, words, l) : 0;
    if (!n) continue;
    hits += n;
    out.append(h('div', { class: 'search-tab' }, h('span', null, l),
      h('button', { class: 'fold-all', type: 'button', onclick: () => { this.setQuery(''); this.tab = k; b.scrollTop = 0; this.render(); } }, 'Open ' + l + ' tab')), part);
  }
  if (!hits) out.append(h('div', { class: 'search-none' }, h('b', null, 'No settings match "' + q.trim() + '"'), h('div', null, 'Try a shorter word, like "sound", "skin" or "save".')));
  b.innerHTML = ''; b.append(out); b.scrollTop = top;
};

const Panels = {
  /* ---------------- GAME ---------------- */
  async game(b) {
    const g = Emu.game;
    b.append(sec(null, h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: () => { Emu.userPaused = false; Sheet._paused = true; Sheet.close(); } }, 'Resume'),
      h('button', { class: 'btn', onclick: async () => { if (await confirmD('Reset the game?', 'Unsaved progress since your last in-game save is lost. Your save file is kept.', 'Reset')) { Emu.reset(); Sheet.close(); } } }, 'Reset'),
      h('button', { class: 'btn', onclick: () => { Sheet.close(); Emu.stop(); } }, 'Exit to library'),
    )));
    // speed
    b.append(sec('Speed',
      row('Fast forward', 'Also on the >> button, Space or R2', swRaw(Emu.ffToggle, () => Emu.hotkey('ff_toggle'))),
      chips('ffSpeed', LITE ? [[1.5, '1.5x'], [2, '2x'], [3, '3x'], [4, '4x']] : [[1.5, '1.5x'], [2, '2x'], [3, '3x'], [4, '4x'], [6, '6x'], [8, '8x'], [12, '12x']], () => Emu.hud()),
      row('Slow motion', 'Audio slows down with it', swRaw(Emu.slow, v => { Emu.slow = v; Emu.hud(); })),
      chips('slowSpeed', [[0.25, '0.25x'], [0.5, '0.5x'], [0.75, '0.75x']]),
    ));
    // the second screen and the bits of the console a DS game can ask for
    b.append(sec('DS console',
      row('Swap screens', S.dsLayout === 'single' ? 'Shows the touch screen as the main screen. Also on the SWAP button.' : 'Puts the touch screen first. Also on the SWAP button.', swRaw(!!S.dsSwap, () => Emu.swapScreens())),
      row('Close the lid', 'Some games pause or react when the DS is shut', swRaw(core.lidClosed, v => core.setLid(v))),
      h('div', { class: 'btns', style: { marginTop: '8px' } },
        h('button', { class: 'btn small', onpointerdown: () => Mic.blow(true), onpointerup: () => Mic.blow(false), onpointerleave: () => Mic.blow(false) }, 'Hold to blow into the mic')),
    ));
    // states
    const slots = h('div', { class: 'slots' });
    const recs = {};
    for (let n = 1; n <= 9; n++) recs[n] = await DB.get('states', g.id + ':' + n);
    const auto = await DB.get('states', g.id + ':auto');
    for (let n = 1; n <= 9; n++) {
      const r = recs[n];
      slots.append(h('div', { class: 'slot' + (S.slot === n ? ' sel' : ''), onclick: () => { S.slot = n; saveSettings(); Sheet.render(); } },
        h('div', { class: 'img', style: r?.thumb ? { backgroundImage: `url(${r.thumb})` } : null }, r ? '' : 'Empty'),
        h('span', { class: 'n' }, String(n).padStart(2, '0')), h('div', { class: 'cap' }, r ? fmtAgo(r.time) : '-')));
    }
    const cur = recs[S.slot];
    b.append(sec(`Save states  ·  slot ${String(S.slot).padStart(2, '0')}`, slots, h('div', { class: 'btns', style: { marginTop: '12px' } },
      h('button', { class: 'btn primary', onclick: () => Emu.saveSlot(S.slot) }, 'Save here'),
      h('button', { class: 'btn', disabled: !cur, onclick: async () => { await Emu.loadSlot(S.slot); Sheet.close(); } }, 'Load'),
      h('button', { class: 'btn', disabled: !cur, onclick: async () => download(`${safeName(g.name)}.ml${S.slot}`, await unpackState(cur.data)) }, 'Export'),
      h('button', { class: 'btn', onclick: async () => { const [f] = await pickFiles('*'); if (!f) return; const d = await readBytes(f); const raw = await unpackState(d).catch(() => null); if (!raw || String.fromCharCode(...raw.subarray(0, 4)) !== 'MELN') return toast('That is not a melonDS save state'); await DB.put('states', g.id + ':' + S.slot, { data: d, thumb: null, time: Date.now() }); Sheet.render(); } }, 'Import'),
      h('button', { class: 'btn danger', disabled: !cur, onclick: async () => { await DB.del('states', g.id + ':' + S.slot); Sheet.render(); } }, 'Delete'),
    ), h('div', { class: 'btns', style: { marginTop: '8px' } },
      h('button', { class: 'btn small', disabled: !Emu.undoLoad, onclick: () => { Emu.undoLoadState(); Sheet.render(); } }, 'Undo last load'),
      h('button', { class: 'btn small', disabled: !Emu.undoSave, onclick: () => Emu.undoSaveState() }, 'Undo last save'),
      h('button', { class: 'btn small', disabled: !auto, onclick: async () => { Emu.undoLoad = core.saveState(); core.loadState(await unpackState(auto.data)); Emu.afterStateJump(); Sheet.close(); toast('Loaded auto save'); } }, auto ? `Load auto save (${fmtAgo(auto.time)})` : 'No auto save yet'),
    )));
    // tools
    b.append(sec('Tools', h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => Emu.screenshot() }, 'Screenshot'),
      LITE ? null : h('button', { class: 'btn' + (Emu.rec ? ' on' : ''), onclick: () => { Emu.toggleRecording(); Sheet.render(); } }, Emu.rec ? 'Stop recording' : 'Record clip'),
      h('button', { class: 'btn', onclick: () => { Sheet.close(); Emu.hotkey('step'); toast('Paused. Use N or Frame advance to step'); } }, 'Frame advance'),
      window.CalzoneAndroid ? null : h('button', { class: 'btn', onclick: () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen not available')); } }, 'Fullscreen'),
      h('button', { class: 'btn', onclick: () => { Sheet.close(); Touch.startEdit(); } }, 'Edit touch layout'),
    )));
    b.append(sec('Battery save', h('div', { class: 'note', style: { marginBottom: '12px' } }, 'In-game saves are stored automatically every few seconds. .sav files from melonDS, DeSmuME and DraStic work.'), h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: async () => { await Emu.persistSram(); const s = core.sram(); s ? download(safeName(g.name) + '.sav', s) : toast('This game has no save memory'); } }, 'Export .sav'),
      h('button', { class: 'btn', onclick: async () => { const [f] = await pickFiles('.sav,.srm,.bin'); if (!f) return; if (!await confirmD('Replace save data?', 'The game will reset to load the imported save.', 'Import', true)) return; const d = await readBytes(f); core.loadSram(d); await DB.put('saves', g.id, d); Emu.sramCrc = crc32(d); Emu.reset(); } }, 'Import .sav'),
    )));

  },

  /* ---------------- CHEATS ---------------- */
  cheats(b) {
    if (!core.hasMem) { b.append(sec('Cheats', h('div', { class: 'note' }, 'Start a game to use cheats.'))); return; }
    const list = h('div');
    const drawList = () => {
      list.innerHTML = '';
      if (!Emu.cheats.length) list.append(h('div', { class: 'note' }, 'No cheats yet. Add a code below or find your own with the RAM search.'));
      Emu.cheats.forEach((c, i) => {
        const t = h('input', { type: 'checkbox' }); t.checked = c.on; t.onchange = () => { c.on = t.checked; Emu.saveCheats().then(drawList); };
        list.append(h('div', { class: 'cheat' }, h('label', { class: 'switch' }, t, h('i')),
          h('div', { class: 'info' }, h('div', { class: 'nm' }, c.name), h('div', { class: 'cd' }, c.code.replace(/\n/g, '  ')), c.errors?.length ? h('div', { class: 'err' }, c.errors[0]) : h('div', { class: 'd note' }, 'Action Replay DS')),
          h('button', { class: 'btn small', onclick: () => editCheat(c, i) }, 'Edit')));
      });
    };
    const editCheat = async (c, i) => {
      const name = h('input', { value: c?.name || '' }), code = h('textarea', { rows: 5, placeholder: 'One code per line\nAction Replay DS: 0213A4C8 000003E7\nRaw: 0213A4C8:03E7' }); code.value = c?.code || '';
      const r = await dialog({ wide: true, title: c ? 'Edit cheat' : 'Add cheat', build: d => d.append(h('label', { class: 'field' }, h('span', null, 'Name'), name), h('label', { class: 'field' }, h('span', null, 'Code'), code)),
        buttons: [...(c ? [{ label: 'Delete', value: 'del', danger: true }] : []), { label: 'Cancel', value: null }, { label: 'Save', value: 'ok', primary: true }] });
      if (r === 'del') Emu.cheats.splice(i, 1);
      else if (r === 'ok' && code.value.trim()) {
        const rec = { name: name.value.trim() || 'Cheat', code: code.value.trim(), on: c ? c.on : true };
        c ? Emu.cheats.splice(i, 1, rec) : Emu.cheats.push(rec);
      } else return;
      await Emu.saveCheats(); drawList();
    };
    drawList();
    b.append(sec('Active cheats', list, h('div', { class: 'btns', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => editCheat(null) }, 'Add cheat'))));

    // RAM search
    const rs = Emu.search; const res = h('div', { class: 'res' }); const val = h('input', { type: 'number', placeholder: 'value', style: { width: '110px' } });
    const bits = h('select', null, [[8, '8-bit'], [16, '16-bit'], [32, '32-bit']].map(([v, l]) => h('option', { value: v }, l))); bits.value = rs.bits;
    bits.onchange = () => { rs.reset(+bits.value); drawRes(); };
    const info = h('div', { class: 'note' });
    const drawRes = () => {
      res.innerHTML = '';
      info.innerHTML = !rs.addrs ? 'Start a search, play a little, then narrow it down. Example: note your health, take a hit, choose <b>Equals</b> with the new value.' : `<b>${rs.count.toLocaleString()}</b> candidate address${rs.count === 1 ? '' : 'es'} after ${rs.history} pass${rs.history === 1 ? '' : 'es'}`;
      if (!rs.addrs || rs.count > 300) return;
      for (let i = 0; i < Math.min(rs.count, 60); i++) {
        const a = rs.addrs[i], v = rs.read(a);
        res.append(h('div', { class: 'r' }, h('span', null, hex(a)), h('span', null, `${v}  (0x${v.toString(16).toUpperCase()})`), h('span', { class: 'btns' },
          h('button', { class: 'btn small', onclick: async () => { const n = await promptD('Write a new value', String(rs.read(a))); if (n == null || n === '') return; const x = +n >>> 0; rs.bits === 8 ? core.w8(a, x) : rs.bits === 16 ? core.w16(a, x) : core.w32(a, x); toast('Written'); drawRes(); } }, 'Set'),
          h('button', { class: 'btn small', onclick: async () => { const n = await promptD('Lock this address to', String(rs.read(a))); if (n == null || n === '') return; const x = +n >>> 0; Emu.cheats.push({ name: 'Lock ' + hex(a), code: `${hex(a)}:${hex(x, rs.bits / 4)}`, fmt: 'raw', on: true }); await Emu.saveCheats(); drawList(); toast('Locked'); } }, 'Lock'))));
      }
    };
    const f = (mode, needVal) => () => { if (needVal && val.value === '') return toast('Enter a value first'); const n = rs.filter(mode, +val.value); drawRes(); if (!n) toast('No matches. Start a new search.'); };
    drawRes();
    b.append(sec('RAM search',
      h('div', { class: 'btns search-row', style: { marginBottom: '12px' } }, bits, h('button', { class: 'btn small primary', onclick: () => { rs.reset(+bits.value); rs.start(); drawRes(); toast('Snapshot taken'); } }, 'New search'), val),
      h('div', { class: 'btns search-row', style: { marginBottom: '12px' } },
        h('button', { class: 'btn small', onclick: f('eq', true) }, 'Equals'), h('button', { class: 'btn small', onclick: f('ne', true) }, 'Not'),
        h('button', { class: 'btn small', onclick: f('changed') }, 'Changed'), h('button', { class: 'btn small', onclick: f('same') }, 'Unchanged'),
        h('button', { class: 'btn small', onclick: f('inc') }, 'Increased'), h('button', { class: 'btn small', onclick: f('dec') }, 'Decreased'),
        h('button', { class: 'btn small', onclick: f('incby', true) }, 'Up by'), h('button', { class: 'btn small', onclick: f('decby', true) }, 'Down by'),
      ), info, res));
    b.append(sec('Code formats', h('div', { class: 'note', html: '<b>Action Replay DS</b> codes (two 8-digit groups per line), the format nearly every DS code list uses. The core runs them every frame the way the real cart did, so conditionals, loops, pointer codes and button activators all work. <b>Raw</b> AAAAAAAA:VV, :VVVV or :VVVVVVVV writes a byte, halfword or word. The RAM search covers the 4 MB of main RAM.' })));
  },

  /* ---------------- LOOK ---------------- */
  look(b) { if (LITE) return liteLookPanel(b); lookPanel(b); this.video(b); },
  video(b) {
    const views = () => { Emu.active && (Emu.applyView(), Touch.build(), Emu.layoutScreen()); };
    b.append(sec('Screens',
      row('Layout', null, null),
      chips('dsLayout', [['stack', 'Stacked'], ['side', 'Side by side'], ['single', 'One at a time']], () => { views(); Sheet.render(); }),
      S.dsLayout === 'single'
        ? row('Show the touch screen', 'Swaps which screen you see. The SWAP button does the same while you play.', sw('dsSwap', views))
        : row('Touch screen first', 'Puts the bottom screen on top (or on the left)', sw('dsSwap', views)),
      row('SWAP button', 'Hold shows the other screen only while you press it', sel('swapMode', [['toggle', 'Tap to switch'], ['hold', 'Hold to peek']])),
      S.dsLayout !== 'single' ? row('Gap between screens', 'The hinge on a real DS is about 90 pixels', rng('dsGap', 0, 96, 4, views, v => v + ' px')) : null,
    ));
    b.append(sec('Screen shader', chips('shader', Object.entries(SHADERS).map(([k, v]) => [k, v.label]), redraw)));
    b.append(sec('Screen picture',
      row('LCD color correction', 'Matches the duller real DS screen', sw('colorFix', redraw)),
      row('Frame blending', 'Fixes flicker transparency effects', sw('blend', redraw)),
      row('Aspect', null, sel('aspect', [['native', 'Original'], ['stretch', 'Stretch to fit']], redraw)),
      row('Integer scaling', 'Even pixels, may leave borders', sw('integer', redraw)),
      row('Brightness', null, rng('brightness', 0.5, 1.6, 0.05, redraw, v => Math.round(v * 100) + '%')),
      row('Saturation', null, rng('saturation', 0, 2, 0.05, redraw, v => Math.round(v * 100) + '%')),
      row('Contrast', null, rng('contrast', 0.5, 1.6, 0.05, redraw, v => Math.round(v * 100) + '%')),
      row('Show FPS', null, sw('showFps', () => Emu.hud())),
      h('div', { class: 'btns', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => { for (const k of ['shader', 'colorFix', 'blend', 'aspect', 'integer', 'brightness', 'saturation', 'contrast']) S[k] = DEFAULTS[k]; saveSettings(); redraw(); Sheet.render(); } }, 'Reset video')),
    ));
  },

  /* ---------------- AUDIO ---------------- */
  audio(b) {
    if (LITE) {
      b.append(sec('Output',
        row('Volume', 'Up to 200%', rng('volume', 0, 2, 0.05, applyAudio, v => Math.round(v * 100) + '%')),
        row('Mute', null, sw('mute', applyAudio)),
        row('While fast forwarding', null, sel('ffAudio', [['chop', 'Play sped-up audio'], ['mute', 'Mute']])),
        h('div', { class: 'note', style: { marginTop: '8px' } }, 'Lite sends the game sound straight to the speaker. The reverb, EQ and limiter from the full app are left out to save power.')));
      return;
    }
    b.append(sec('Output',
      row('Volume', 'Up to 200%. The limiter stops clipping.', rng('volume', 0, 2, 0.05, applyAudio, v => Math.round(v * 100) + '%')),
      row('Mute', null, sw('mute', applyAudio)),
      row('Limiter', null, sw('limiter', applyAudio)),
      row('While fast forwarding', null, sel('ffAudio', [['chop', 'Play sped-up audio'], ['mute', 'Mute']])),
    ));
    const applySq = () => { if (core.loaded) core.setAudio(Audio_.ctx.sampleRate, S.interp, S.bitDepth); };
    b.append(sec('Sound quality',
      row('Interpolation', 'Smooths the DS sound chip. Cubic sounds the cleanest.', sel('interp', [[0, 'None (raw)'], [1, 'Linear'], [2, 'Cosine'], [3, 'Cubic'], [4, 'SNES Gaussian']], applySq)),
      row('Bit depth', 'The DS speaker output is 10-bit', sel('bitDepth', [[0, 'Automatic'], [1, '10-bit (like the hardware)'], [2, '16-bit']], applySq)),
    ));
    b.append(sec('Reverb', chips('reverb', Object.entries(REVERB_PRESETS).map(([k, v]) => [k, v.label]), applyAudio),
      row('Mix', 'How much of the room you hear', rng('reverbMix', 0, 1, 0.02, applyAudio, v => Math.round(v * 100) + '%')),
      row('Room size', null, rng('reverbSize', 0.4, 2, 0.05, applyAudio, v => Math.round(v * 100) + '%')),
    ));
    b.append(sec('Equalizer',
      row('Bass', null, rng('bass', -12, 12, 1, applyAudio, v => (v > 0 ? '+' : '') + v + ' dB')),
      row('Mids', null, rng('mid', -12, 12, 1, applyAudio, v => (v > 0 ? '+' : '') + v + ' dB')),
      row('Treble', null, rng('treble', -12, 12, 1, applyAudio, v => (v > 0 ? '+' : '') + v + ' dB')),
      row('Stereo width', '0% is mono, 200% is extra wide', rng('width', 0, 2, 0.05, applyAudio, v => Math.round(v * 100) + '%')),
      row('Handheld speaker', 'Thin, boxy sound like the real thing', sw('speaker', applyAudio)),
      h('div', { class: 'btns', style: { marginTop: '8px' } },
        h('button', { class: 'btn small', onclick: () => { Object.assign(S, { bass: 6, mid: -1, treble: 3, width: 1.35, reverb: 'studio', reverbMix: 0.22 }); saveSettings(); applyAudio(); Sheet.render(); } }, 'Punchy preset'),
        h('button', { class: 'btn small', onclick: () => { Object.assign(S, { bass: 3, mid: 0, treble: -2, width: 1.6, reverb: 'hall', reverbMix: 0.32, reverbSize: 1.2 }); saveSettings(); applyAudio(); Sheet.render(); } }, 'Big room preset'),
        h('button', { class: 'btn small', onclick: () => { for (const k of ['bass', 'mid', 'treble', 'width', 'speaker', 'reverb', 'reverbMix', 'reverbSize']) S[k] = DEFAULTS[k]; saveSettings(); applyAudio(); Sheet.render(); } }, 'Flat'),
      ),
    ));
  },

  /* ---------------- CONTROLS ---------------- */
  controls(b) {
    b.append(sec('Touch controls',
      row('Show on screen', null, sel('showTouch', [['auto', 'On touch devices'], ['on', 'Always'], ['off', 'Never']], () => { if (Emu.active) { Touch.build(); Emu.layoutScreen(); } })),
      row('Opacity', null, rng('ctlOpacity', 0.05, 1, 0.05, () => Emu.active && Touch.setOpacity(), v => Math.round(v * 100) + '%')),
      row('Turbo speed', 'Presses per second for TA, TB and turbo keys', sel('turboRate', [[2, '15'], [3, '10'], [4, '7.5'], [6, '5']])),
      h('div', { class: 'btns', style: { marginTop: '8px' } },
        Emu.active ? h('button', { class: 'btn primary small', onclick: () => { Sheet.close(); Touch.startEdit(); } }, 'Edit layout') : null,
        h('button', { class: 'btn small', onclick: () => { S.layout = null; saveSettings(); if (Emu.active) Touch.build(); toast('Layouts reset'); } }, 'Reset layouts'),
      ),
      h('div', { class: 'note', style: { marginTop: '8px' } }, 'Each orientation has its own layout. Hidden buttons such as quick save, quick load, A+B and turbo can be turned on in the editor.')));
    const keyName = c => c.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', '');
    const kbBox = h('div'), padBox = h('div');
    const draw = () => {
      kbBox.innerHTML = ''; padBox.innerHTML = '';
      for (const [act, label] of ACTIONS) {
        const keys = Object.entries(S.keys).filter(([, a]) => a === act).map(([c]) => c);
        const pads = Object.entries(S.pad).filter(([, a]) => a === act).map(([c]) => c);
        kbBox.append(row(label, null, h('span', { class: 'btns' }, h('button', { class: 'kbd', onclick: e => capture(e.target, act, 'key') }, keys.map(keyName).join(', ') || 'none'))));
        padBox.append(row(label, null, h('span', { class: 'btns' }, h('button', { class: 'kbd', onclick: e => capture(e.target, act, 'pad') }, pads.map(p => PAD_NAMES[p] || 'B' + p).join(', ') || 'none'))));
      }
    };
    const capture = (btn, act, type) => {
      btn.classList.add('wait'); btn.textContent = type === 'key' ? 'press a key' : 'press a button';
      const poll = setInterval(() => Input.pollPad(), 50);
      Input.capture = ev => {
        if (ev.type !== type) return;
        clearInterval(poll); Input.capture = null;
        if (type === 'key') { if (ev.code === 'Escape') { draw(); return; } if (ev.code === 'Delete') { for (const k in S.keys) if (S.keys[k] === act) delete S.keys[k]; } else S.keys = { ...S.keys, [ev.code]: act }; }
        else S.pad = { ...S.pad, [ev.btn]: act };
        saveSettings(); draw();
      };
    };
    draw();
    let names = Input.padNames;
    try { if (window.CalzoneAndroid?.padNames) names = CalzoneAndroid.padNames().split('\n').filter(Boolean); } catch (e) {}
    if (!names.length && navigator.getGamepads) names = [...navigator.getGamepads()].filter(Boolean).map(p => p.id.replace(/\s*\(.*$/, ''));
    b.append(sec('Controllers',
      row(names.length ? names.join(', ') : 'No controller connected', names.length ? 'Ready. The touch buttons hide while you use it and come back when you tap the screen.' : 'Xbox, PlayStation, 8BitDo, Switch Pro and most Bluetooth or USB pads work.', null),
      h('div', { class: 'btns', style: { marginTop: '8px' } },
        window.CalzoneAndroid?.openBluetooth ? h('button', { class: 'btn primary small', onclick: () => CalzoneAndroid.openBluetooth() }, 'Pair a Bluetooth controller') : null,
        h('button', { class: 'btn small', onclick: () => Sheet.render() }, 'Refresh')),
      h('div', { class: 'note', style: { marginTop: '8px' } }, window.CalzoneAndroid
        ? 'Put the controller in pairing mode (Xbox: hold the pair button; PlayStation: hold Share and PS; 8BitDo: hold Start and the mode button; Switch Pro: hold the sync button), tap Pair, pick it in the list, then come back here.'
        : 'Pair the controller in your phone or computer Bluetooth settings first, then press any button on it so the browser notices it.')));
    b.append(sec('Microphone',
      row('DS microphone', 'Games that ask you to blow or shout', sel('micSource', [['blow', 'MIC button (built-in blow)'], ['mic', 'Phone microphone']], () => Mic.sync())),
      h('div', { class: 'note', style: { marginTop: '8px' } }, 'The MIC button plays a recorded puff of air into the game. It is hidden by default: turn it on in the touch layout editor, or bind Blow into the mic to a key or controller button.')));
    b.append(sec('Gamepad buttons', h('div', { class: 'note', style: { marginBottom: '6px' } }, 'Tap a binding, then press the controller button. The left stick also drives the D-pad.'), padBox,
      h('button', { class: 'btn small', onclick: () => { S.pad = structuredClone(DEFAULT_PAD); saveSettings(); draw(); } }, 'Reset gamepad')));
    b.append(sec('Keyboard', h('div', { class: 'note', style: { marginBottom: '6px' } }, 'Tap a binding, then press the new key. Delete clears all keys for that action. Esc cancels.'), kbBox,
      h('button', { class: 'btn small', onclick: () => { S.keys = structuredClone(DEFAULT_KEYS); saveSettings(); draw(); } }, 'Reset keyboard')));
  },

  /* ---------------- SYSTEM ---------------- */
  async system(b) {
    const ms = Emu.active && Emu.frameMs ? `This game takes about ${Emu.frameMs.toFixed(1)} ms a frame here (16.7 ms is full speed)${S.frameskip === 'auto' ? `, skipping ${Emu.skip}` : ''}.` : null;
    b.append(sec('Performance',
      row('Frame skip', 'Leaves out some pictures when the phone falls behind. The game and sound keep full speed.', sel('frameskip', [['auto', 'Auto'], [0, 'Off'], [1, '1 of 2'], [2, '2 of 3'], [3, '3 of 4']], () => { Emu.skip = 0; Emu.hud(); })),
      row('Show FPS', null, sw('showFps', () => Emu.hud())),
      ms ? h('div', { class: 'note', style: { marginTop: '8px' } }, ms) : null,
      LITE ? h('div', { class: 'note', style: { marginTop: '8px' } }, 'For the fastest picture use the Sharp or Smooth screen, with color correction and frame blending off. The phone\'s graphics chip then does the scaling.') : null,
    ));
    b.append(sec('Behaviour',
      row('Resume where I left off', 'Saves a snapshot when you leave a game', sw('autoResume')),
      row('Auto snapshot every', null, sel('autoSaveSec', [[15, '15 s'], [30, '30 s'], [60, '1 min'], [300, '5 min']])),
      row('Auto save lights', 'Green lights on the controller count down to the next snapshot', sw('saveLights', () => Emu.active && Emu.saveLeds())),
      row('Pause when menu opens', null, sw('pauseOnMenu')),
      row('Pause in background', null, sw('pauseHidden')),
      row('Keep screen on', null, sw('wakeLock', v => v ? Emu.requestWake() : Emu.releaseWake())),
    ));
    b.append(sec('Rewind',
      row('Enable rewind', LITE ? 'Off by default in Lite: it saves a snapshot every few frames. Takes effect next time a game starts.' : 'Takes effect next time a game starts', sw('rewind')),
      row('Memory for rewind', 'More memory, longer rewind', sel('rewindMB', LITE ? [[16, '16 MB'], [24, '24 MB'], [48, '48 MB']] : [[24, '24 MB'], [48, '48 MB'], [64, '64 MB'], [128, '128 MB'], [256, '256 MB']])),
      row('Snapshot every', 'Fewer frames, smoother rewind', sel('rewindEvery', [[1, '1 frame'], [2, '2 frames'], [4, '4 frames'], [8, '8 frames']])),
      row('Rewind speed', null, sel('rewindRate', [[1, 'Normal'], [2, 'Fast'], [4, 'Very fast']])),
      Emu.active && Emu.rw ? h('div', { class: 'note' }, `Buffer: ${Emu.rw.count} steps, ${fmtBytes(Emu.rw.bytes)} used, about ${(Emu.rw.count * S.rewindEvery / 60).toFixed(0)} s of history`) : null,
    ));
    const nick = h('input', { class: 'inp', value: S.nick, maxlength: 10, style: { width: '45%' } });
    nick.onchange = () => { S.nick = nick.value.trim().slice(0, 10) || 'Player'; saveSettings(); };
    const months = [...Array(12)].map((_, i) => [i + 1, new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })]);
    b.append(sec('DS profile',
      h('div', { class: 'note', style: { marginBottom: '8px' } }, 'What a DS keeps in its settings and games read: your name shows up in many of them. Used next time a game starts.'),
      row('Nickname', 'Up to 10 letters', nick),
      row('Language', null, sel('lang', [[0, '日本語'], [1, 'English'], [2, 'Français'], [3, 'Deutsch'], [4, 'Italiano'], [5, 'Español']])),
      row('Birthday month', null, sel('bMonth', months)),
      row('Birthday day', null, sel('bDay', [...Array(31)].map((_, i) => [i + 1, String(i + 1)]))),
      row('Favourite colour', 'The colour of the DS menu', sel('favColor', ['Grey', 'Brown', 'Red', 'Pink', 'Orange', 'Yellow', 'Lime', 'Green', 'Dark green', 'Sea green', 'Turquoise', 'Blue', 'Dark blue', 'Purple', 'Violet', 'Magenta'].map((n, i) => [i, n]))),
    ));
    const inc = h('input', { type: 'checkbox' });
    b.append(sec('Backup',
      h('div', { class: 'note', style: { marginBottom: '8px' } }, 'One file with your saves, save states, cheats and settings. Handy before clearing app data or moving to a new phone.'),
      row('Include ROMs', 'Makes the file much bigger', h('label', { class: 'switch' }, inc, h('i'))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => exportBackup(inc.checked) }, 'Export backup'),
        h('button', { class: 'btn', onclick: importBackup }, 'Import backup')),
    ));
    b.append(updatesSection());
    b.append(sec('About', h('div', { class: 'note', html: `<b>Brad's Underover</b> ${APP_VERSION}. Nintendo DS emulation by <b>melonDS</b> (Arisotura and the melonDS team, GPL 3), built into WebAssembly with SIMD for this app, with its open-source FreeBIOS so no BIOS or firmware files are needed. The app around it comes from Brad's Bullpup. Source is public on GitHub. No games are included. Only play games you dumped from cartridges you own. Nothing is collected or sent anywhere: your games, saves and settings stay on this device. <a href="https://shanesenbradz.github.io/Brads-Underover/privacy.html" target="_blank" rel="noopener">Privacy policy</a>` })));
  },
};


/* ---------------- Lite look panel ---------------- */
function liteLookPanel(b) {
  const L = () => { saveSettings(); applyLook(); };
  b.append(sec('Appearance',
    row('Theme', null, null), chips('theme', [['graphite', 'Graphite'], ['oled', 'OLED black'], ['light', 'Light']], applyLook),
    row('Accent', ACCENTS[S.accent]?.[4], null),
    (() => { const box = h('div', { class: 'swatches' }); for (const [k, a] of Object.entries(ACCENTS)) box.append(h('button', { class: 'swatch' + (S.accent === k ? ' act' : ''), style: { background: a[0] }, 'aria-label': a[4], title: a[4], onclick: () => { S.accent = k; L(); Sheet.render(); } })); return box; })(),
    row('Library covers', null, null), chips('grid', [['compact', 'Compact'], ['regular', 'Regular'], ['large', 'Large']], applyLook),
    row('Reduce motion', 'Turns off sheet and toast animations', swRaw(S.motion === 'reduce', v => { S.motion = v ? 'reduce' : 'full'; L(); })),
  ));
  b.append(sec('Controller',
    (() => { const box = h('div', { class: 'skins' }); for (const [k, sk] of Object.entries(SKINS)) { const v = sk.v; box.append(h('button', { class: 'skin' + (S.skin === k ? ' act' : ''), onclick: () => { S.skin = k; L(); Sheet.render(); } }, h('span', { class: 'sw', style: { background: `linear-gradient(${v[0]},${v[1]})` } }, h('b', { style: { background: v[3] } })), sk.name)); } return box; })(),
    row('Screen shell', 'A dark frame and logo strip around the screen', sw('shell', applyLook)),
    row('Button style', null, null), chips('btnStyle', [['flat', 'Flat'], ['soft', 'Soft'], ['console', 'Console']], applyLook),
    row('Opacity', 'How see-through the on-screen buttons are', rng('ctlOpacity', 0.05, 1, 0.05, () => Emu.active && Touch.setOpacity(), v => Math.round(v * 100) + '%')),
    row('Show labels', null, sw('labels', applyLook)),
    row('Power LED', null, sw('led', applyLook)),
    row('Vibration', null, null), chips('haptic', [['off', 'Off'], ['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']], () => feedback()),
    row('Click sound', null, null), chips('click', [['off', 'Off'], ['soft', 'Soft tick'], ['clicky', 'Clicky']], v => Audio_.ctx.resume().then(() => clickSound(v))),
  ));
  b.append(sec('Screen',
    row('Picture', 'Sharp and Smooth are the fastest', null),
    chips('shader', ['sharp', 'smooth', 'lcd', 'scan', 'dmg'].map(k => [k, SHADERS[k].label]), redraw),
    row('LCD color correction', 'Matches the duller real DS screen', sw('colorFix', redraw)),
    row('Frame blending', 'Fixes flicker transparency effects', sw('blend', redraw)),
    row('Aspect', null, sel('aspect', [['native', 'Original'], ['stretch', 'Stretch to fit']], redraw)),
    row('Integer scaling', 'Even pixels, may leave borders', sw('integer', redraw)),
    row('Brightness', null, rng('brightness', 0.5, 1.6, 0.05, redraw, v => Math.round(v * 100) + '%')),
    h('div', { class: 'btns', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => { for (const k of ['theme', 'accent', 'grid', 'motion', 'skin', 'shell', 'btnStyle', 'ctlOpacity', 'labels', 'led', 'haptic', 'click', 'shader', 'colorFix', 'blend', 'aspect', 'integer', 'brightness']) S[k] = structuredClone(DEFAULTS[k]); L(); redraw(); Sheet.render(); } }, 'Reset look')),
  ));
}

/* ---------------- Look panel ---------------- */
function lookPanel(b) {
  const L = () => { saveSettings(); applyLook(); };
  // live preview of the controller
  const pv = h('div', { class: 'pv' });
  const mk = (k, x, y, sz, pill) => { const d = CTL_DEFS[k]; const e = h('div', { class: `ctl k-${k}${d.pill ? ' pill' : ''}${d.small ? ' small' : ''}`, 'data-k': k, style: { left: x + '%', top: y + '%', width: sz + 'px', height: (d.pill ? sz * 0.42 : sz) + 'px' } });
    e.append(k === 'dpad' ? dpadEl() : h('div', { class: 'face' }, h('span', { class: 'lbl' }, d.label)));
    e.style.opacity = S.ctlOpacity; pv.append(e); return e; };
  pv.append(h('div', { class: 'pwall' }), h('div', { class: 'shade' }));
  mk('dpad', 22, 50, 104); mk('a', 82, 38, 56); mk('b', 64, 62, 56); mk('select', 36, 88, 60); mk('start', 64, 88, 60);
  pv.addEventListener('pointerdown', e => { const t = e.target.closest('.ctl'); if (!t) return; Audio_.ctx.resume().then(() => feedback()); t.classList.add('press'); if (t.dataset.k === 'dpad') t.firstChild.classList.add('p-right'); });
  const up = () => pv.querySelectorAll('.ctl').forEach(c => { c.classList.remove('press'); c.firstChild.classList?.remove('p-right'); });
  pv.addEventListener('pointerup', up); pv.addEventListener('pointerleave', up);
  pv.style.touchAction = 'none'; pv.querySelectorAll('.ctl').forEach(c => c.style.pointerEvents = 'auto');
  b.append(sec('Preview', pv, h('div', { class: 'note' }, 'Tap the buttons to feel the current settings')));
  _pv = pv; requestAnimationFrame(() => refreshPreviewVinyl(pv));

  const sw2 = (cls, items, key, render) => { const box = h('div', { class: cls }); const draw = () => { box.innerHTML = ''; for (const it of items) box.append(render(it, S[key] === it[0], () => { S[key] = it[0]; L(); draw(); })); }; draw(); return box; };
  b.append(sec('Appearance',
    row('Theme', null, null), chips('theme', [['graphite', 'Graphite'], ['oled', 'OLED black'], ['light', 'Light']], applyLook),
    row('Accent', ACCENTS[S.accent]?.[4], null),
    sw2('swatches', Object.entries(ACCENTS).map(([k, a]) => [k, a]), 'accent', ([k, a], act, pick) => h('button', { class: 'swatch' + (act ? ' act' : ''), style: { background: a[0] }, 'aria-label': a[4], title: a[4], onclick: () => { pick(); Sheet.render(); } })),
    row('Library covers', null, null), chips('grid', [['compact', 'Compact'], ['regular', 'Regular'], ['large', 'Large']], applyLook),
    row('Reduce motion', 'Turns off sheet and toast animations', swRaw(S.motion === 'reduce', v => { S.motion = v ? 'reduce' : 'full'; L(); })),
  ));
  b.append(sec('Controller skin',
    sw2('skins', Object.entries(SKINS), 'skin', ([k, sk], act, pick) => {
      const v = sk.v; const sw = h('span', { class: 'sw', style: { background: `linear-gradient(${v[0]},${v[1]})` } },
        h('i', { style: { background: `linear-gradient(${v[4]},${v[5]})` } }), h('i', { style: { background: `linear-gradient(${v[4]},${v[5]})` } }), h('b', { style: { background: v[3] } }), h('b', { style: { background: v[3] } }));
      return h('button', { class: 'skin' + (act ? ' act' : ''), onclick: pick }, sw, sk.name);
    }),
    row('Surface', 'Auto shows the circuit board through clear skins', null),
    chips('texture', [['auto', 'Auto'], ['matte', 'Matte'], ['brushed', 'Brushed'], ['grip', 'Grip'], ['pcb', 'Circuit'], ['armory', 'Armory']], applyLook),
  ));
  b.append(sec('Device',
    row('Screen shell', 'A dark molded frame and logo strip around the screen', sw('shell', applyLook)),
    row('Finish', 'How light catches the body', null), chips('gloss', [['matte', 'Matte'], ['satin', 'Satin'], ['gloss', 'Gloss']], applyLook),
    row('Speaker grille', null, sw('grille', applyLook)),
    row('Sticker', 'A little pixel decal on the body', null),
    sw2('chips', [['none', null], ...Object.keys(SPRITES).map(k => [k, SPRITES[k]])], 'decal', ([k, svg], act, pick) => h('button', { class: 'chip' + (act ? ' act' : ''), style: { display: 'inline-flex', alignItems: 'center', gap: '6px' }, onclick: pick }, svg ? h('span', { html: svg, style: { width: '28px', display: 'block', imageRendering: 'pixelated' } }) : 'None')),
  ));
  const wallThumb = h('span', { class: 'wall-thumb', style: _wallUrl ? { backgroundImage: `url(${_wallUrl})` } : null });
  b.append(sec('Wallpaper',
    h('div', { class: 'row' }, h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, wallThumb, h('div', null, h('div', { class: 't' }, 'Your own picture'), h('div', { class: 'd' }, _wallUrl ? 'Printed on the body like a vinyl skin' : 'Any photo, wrapped on like a vinyl skin'))),
      h('span', { class: 'btns' }, h('button', { class: 'btn small', onclick: async () => { const [f] = await pickFiles('image/*'); if (!f) return; try { await setWallpaperFromFile(f); Sheet.render(); toast('Wallpaper set'); } catch (e) { toast('Could not read that image'); } } }, _wallUrl ? 'Change' : 'Choose'),
        _wallUrl ? h('button', { class: 'btn small danger', onclick: async () => { await clearWallpaper(); Sheet.render(); } }, 'Remove') : null)),
    _wallUrl ? row('Use wallpaper', null, sw('wall', applyLook)) : null,
    _wallUrl ? row('Vinyl wrap', 'Bends the picture over the edges and down into the button wells', null) : null,
    _wallUrl ? chips('vinyl', [['off', 'Flat'], ['soft', 'Vinyl'], ['deep', 'Deep wrap']], applyLook) : null,
    _wallUrl ? row('Dim', null, rng('wallDim', 0, 0.7, 0.05, applyLook, v => Math.round(v * 100) + '%')) : null,
    _wallUrl ? row('Blur', null, rng('wallBlur', 0, 16, 1, applyLook, v => v + ' px')) : null,
  ));
  b.append(sec('Buttons',
    row('Style', null, null), chips('btnStyle', [['console', 'Console'], ['real', 'Realistic'], ['soft', 'Soft'], ['flat', 'Flat'], ['clear', 'Clear']], applyLook),
    row('Press travel', 'How far buttons sink when pressed', null), chips('press', [['none', 'None'], ['subtle', 'Subtle'], ['deep', 'Deep']], applyLook),
    row('Opacity', 'How see-through the on-screen buttons are', rng('ctlOpacity', 0.05, 1, 0.05, v => { if (Emu.active) Touch.setOpacity(); _pv?.querySelectorAll('.ctl').forEach(c => c.style.opacity = v); }, v => Math.round(v * 100) + '%')),
    row('Show labels', null, sw('labels', applyLook)),
    row('Click sound', 'Plays on every press, separate from game volume', null),
    chips('click', [['off', 'Off'], ['soft', 'Soft tick'], ['clicky', 'Clicky'], ['thock', 'Thock'], ['membrane', 'Membrane']], v => Audio_.ctx.resume().then(() => clickSound(v))),
    row('Click volume', null, rng('clickVol', 0.2, 2, 0.1, null, v => Math.round(v * 100) + '%')),
    row('Vibration', null, null), chips('haptic', [['off', 'Off'], ['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']], v => feedback()),
  ));
  b.append(sec('Effects',
    row('Ambient glow', 'The game picture lights up the area around the screen', null),
    chips('ambient', [['off', 'Off'], ['subtle', 'Subtle'], ['strong', 'Strong']], applyLook),
    row('Screen bezel', 'A dark frame around the picture', sw('bezel', applyLook)),
    row('Glass reflection', 'A faint sheen across the screen', sw('glass', applyLook)),
    row('Power LED', 'Green running, amber fast forward, blue rewind, red recording', sw('led', applyLook)),
    row('Auto save lights', S.autoResume ? `Six lights on the left fill up, one every ${+(Math.max(10, S.autoSaveSec) / 6).toFixed(1)} s, until the auto snapshot` : 'Turn on Resume where I left off in System first', sw('saveLights', () => Emu.active && Emu.saveLeds())),
    h('div', { class: 'btns', style: { marginTop: '12px' } }, h('button', { class: 'btn small', onclick: () => { for (const k of ['theme', 'accent', 'grid', 'motion', 'skin', 'texture', 'btnStyle', 'press', 'labels', 'click', 'clickVol', 'haptic', 'ambient', 'bezel', 'glass', 'led', 'shell', 'gloss', 'grille', 'decal', 'wallDim', 'wallBlur', 'vinyl', 'saveLights']) S[k] = DEFAULTS[k]; L(); Sheet.render(); } }, 'Reset look')),
  ));
}

async function exportBackup(withRoms) {
  toast('Building backup');
  const out = { app: 'underover-ds', v: 1, time: Date.now(), settings: S, meta: await DB.all('meta'), saves: {}, states: {}, cheats: {}, roms: {} };
  for (const k of await DB.keys('saves')) out.saves[k] = bytesToB64(await DB.get('saves', k));
  for (const k of await DB.keys('states')) { const r = await DB.get('states', k); out.states[k] = { ...r, data: bytesToB64(r.data) }; }
  for (const k of await DB.keys('cheats')) out.cheats[k] = await DB.get('cheats', k);
  if (withRoms) for (const k of await DB.keys('roms')) out.roms[k] = bytesToB64(await DB.get('roms', k));
  download(`underover-backup-${stamp()}.json`, JSON.stringify(out), 'application/json');
}
async function importBackup() {
  const [f] = await pickFiles('.json'); if (!f) return;
  try {
    const j = JSON.parse(await f.text()); if (j.app !== 'underover-ds') throw new Error('Not a Brad\'s Underover backup file');
    for (const m of j.meta || []) { if (j.roms?.[m.id]) await DB.put('roms', m.id, b64ToBytes(j.roms[m.id])); if (await DB.get('roms', m.id)) await DB.put('meta', m.id, m); }
    for (const [k, v] of Object.entries(j.saves || {})) await DB.put('saves', k, b64ToBytes(v));
    for (const [k, v] of Object.entries(j.states || {})) await DB.put('states', k, { ...v, data: b64ToBytes(v.data) });
    for (const [k, v] of Object.entries(j.cheats || {})) await DB.put('cheats', k, v);
    if (j.settings && await confirmD('Restore settings too?', 'Replaces your current video, audio, control and system settings.', 'Restore')) { Object.assign(S, j.settings); saveSettings(); }
    toast('Backup imported'); Library.render(); Sheet.isOpen && Sheet.render();
  } catch (e) { toast(e.message); }
}

/* ---------------- edit bar ---------------- */
function initEditBar() {
  const cur = () => Touch.sel && Touch.layout()[Touch.sel];
  $('#ebSize').oninput = e => { const c = cur(); if (!c) return; c.s = +e.target.value; Touch.build(); $$('.ctl').forEach(x => x.classList.toggle('sel', x.dataset.k === Touch.sel)); };
  $('#ebOpacity').oninput = e => { const c = cur(); if (!c) return; c.o = +e.target.value; Touch.els[Touch.sel].style.opacity = c.o * S.ctlOpacity; };
  $('#ebHide').onclick = () => { const c = cur(); if (!c) return; c.v = !c.v; Touch.build(); Touch.selUpdate(); };
  $('#ebShowAll').onclick = () => { const L = Touch.layout(); for (const k in L) L[k].v = true; Touch.build(); };
  $('#ebReset').onclick = () => { S.layout && delete S.layout[Touch.orient]; Touch.sel = null; Touch.build(); Touch.selUpdate(); };
  $('#ebDone').onclick = () => Touch.endEdit();
}

/* ============================================================
   Boot
   ============================================================ */
(async function boot() {
  try {
    applyLook();
    await DB.open();
    await loadWallpaper();
    core = new Core(); await core.init();
    Audio_ = new AudioOut(); await Audio_.init(); Audio_.apply(S);
    renderer = new Renderer($('#screen'));
    Input.init(); Touch.init(); Stylus.init(); Sheet.init(); initEditBar(); Library.init();
    $('#boot').remove();
    window.__underover = window.__calzone = { core, Emu, S, DB, Audio_, Input };
    setTimeout(() => Updater.auto(), 5000);
  } catch (e) {
    console.error(e);
    $('.boot-msg').textContent = 'Could not start: ' + (e.message || e);
  }
})();
