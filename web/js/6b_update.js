/* ============================================================
   Updates
   docs/version.json in the GitHub repo says which version is current. In the Android app a newer
   build is downloaded and installed over this one in place (same package, same signing key), so
   games, saves, states and settings all stay. The web app refreshes its offline copy and reloads.
   The Google Play build leaves updates to Play.
   ============================================================ */
const UPDATE_URLS = [
  'https://raw.githubusercontent.com/shanesenbradz/OverUnder/main/docs/version.json',
  'https://shanesenbradz.github.io/OverUnder/version.json',
];
const SITE_URL = 'https://shanesenbradz.github.io/OverUnder/';

const Updater = {
  native: window.BullpupUpdate || null,
  info: null, state: '', pct: 0, err: '',
  get play() { try { return !!this.native && this.native.packageName() === 'com.bradz.underover.play'; } catch (e) { return false; } },
  get kind() { return LITE ? 'lite' : 'full'; },
  newer(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
    return false;
  },
  isNewer(i) {
    if (!i) return false;
    if (this.native && i.code) { try { const c = this.native.versionCode(); if (c) return i.code > c; } catch (e) {} }
    return this.newer(i.version, APP_VERSION);
  },
  async fetchInfo() {
    for (const u of UPDATE_URLS) {
      try { const r = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) {}
    }
    return null;
  },
  set(state, extra) { this.state = state; Object.assign(this, extra || {}); Sheet.refreshIf('system'); },
  async check(manual) {
    if (this.play) { if (manual) toast('Updates for this version come from Google Play'); return null; }
    if (this.state === 'downloading' || this.state === 'installing') return null;
    this.set('checking', { err: '' });
    const j = await this.fetchInfo();
    try { localStorage.setItem('underover.updChecked', String(Date.now())); } catch (e) {}
    if (!j || !j[this.kind]) { this.set('error', { err: 'Could not reach GitHub. Check your connection and try again.' }); if (manual) toast('Could not check for updates'); return null; }
    this.info = j[this.kind];
    const avail = this.isNewer(this.info);
    this.set(avail ? 'available' : 'current');
    if (manual && !avail) toast(`You're up to date (${APP_VERSION})`);
    return avail ? this.info : null;
  },
  // Quietly checks at most every 12 hours after launch, and asks before doing anything.
  async auto() {
    if (!S.autoUpdate || this.play || !navigator.onLine) return;
    const last = +(localStorage.getItem('underover.updChecked') || 0);
    if (Date.now() - last < 12 * 3600e3) return;
    const i = await this.check(false);
    if (!i || localStorage.getItem('underover.updSkip') === i.version || Emu.active) return;
    this.prompt();
  },
  notesHtml(i, intro = true) {
    const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const list = (i.notes || []).map(n => `<li>${esc(n)}</li>`).join('');
    return `${intro ? `<div class="note">You have ${esc(APP_VERSION)}. ${this.native ? 'It installs over this one and keeps your games, saves, states and settings.' : 'Your games and saves stay on this device.'}</div>` : ''}${list ? `<ul class="upd-notes">${list}</ul>` : ''}`;
  },
  async prompt() {
    const i = this.info; if (!i) return;
    const v = await dialog({ wide: true, title: `Underover ${i.version} is out`, body: this.notesHtml(i), dismiss: 'later',
      buttons: [{ label: 'Skip', value: 'skip' }, { label: 'Later', value: 'later' }, { label: 'Update', value: 'go', primary: true }] });
    if (v === 'skip') { try { localStorage.setItem('underover.updSkip', i.version); } catch (e) {} }
    if (v === 'go') this.install();
  },
  async install() {
    const i = this.info; if (!i) return;
    if (this.native) {
      if (!this.native.canInstall()) {
        const ok = await confirmD('Allow Underover to update itself', 'Android asks once. On the next screen turn on "Allow from this source", come back, and tap Update again.', 'Open settings');
        if (ok) this.native.allowInstalls();
        return;
      }
      if (Emu.active) await Emu.stop(); // writes the save and a resume snapshot first
      this.set('downloading', { pct: 0, err: '' });
      this.native.install(i.apk, i.sha256 || '');
      return;
    }
    // Web app: pull the new version into the offline cache, then reload into it
    if (location.protocol === 'https:' && 'serviceWorker' in navigator) {
      this.set('downloading', { pct: 0, err: '' });
      if (Emu.active) await Emu.stop();
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
          await reg.update();
          if (reg.installing || reg.waiting) { setTimeout(() => location.reload(), 15000); return; }
        }
      } catch (e) {}
      location.reload();
      return;
    }
    // A saved copy of the HTML file can't replace itself: open the site with the new version
    window.open(SITE_URL + (LITE ? 'lite/' : ''), '_blank', 'noopener');
  },
};

// Progress and results from the Android updater (Updater.java)
window.bullpupUpdate = (type, data) => {
  const U = Updater;
  if (type === 'progress') { U.pct = +data || 0; U.state = 'downloading'; const el = $('#updBar'); if (el) { el.style.width = U.pct + '%'; $('#updPct').textContent = U.pct + '%'; } else Sheet.refreshIf('system'); }
  else if (type === 'installing') U.set('installing');
  else if (type === 'confirm') U.set('confirm');
  else if (type === 'done') { U.set('current'); toast('Update installed'); }
  else if (type === 'error') { U.set('error', { err: data }); toast(data, 3200); }
};

function updatesSection() {
  const U = Updater;
  if (U.play) return sec('Updates', row('Updates come from Google Play', `You have ${APP_VERSION}. Play installs new versions for you.`, null));
  const btn = (label, fn, primary) => h('button', { class: 'btn' + (primary ? ' primary' : ''), onclick: fn }, label);
  const kids = [row('Check for updates on launch', 'Looks once or twice a day and asks before installing anything', sw('autoUpdate'))];
  const i = U.info;
  if (U.state === 'available' && i) {
    kids.push(row(`Version ${i.version} is ready`, `You have ${APP_VERSION}${i.size ? '  ·  ' + fmtBytes(i.size) + ' download' : ''}`, h('span', { class: 'upd-dot' })));
    kids.push(h('div', { class: 'bare', html: U.notesHtml(i, false) }));
    kids.push(h('div', { class: 'btns', style: { marginTop: '10px' } }, btn('Update now', () => U.install(), true), btn('Check again', () => U.check(true))));
  } else if (U.state === 'downloading') {
    kids.push(row(U.native ? 'Downloading the update' : 'Getting the new version', null, h('span', { id: 'updPct', class: 'val' }, U.native ? U.pct + '%' : '')));
    kids.push(h('div', { class: 'upd-track' }, h('i', { id: 'updBar', style: { width: (U.native ? U.pct : 60) + '%' } })));
  } else if (U.state === 'installing' || U.state === 'confirm') {
    kids.push(row('Installing', 'Tap Update on Android\'s screen. Underover closes when it\'s done. Open it again and everything is still there.', null));
  } else {
    const msg = U.state === 'checking' ? 'Checking' : U.state === 'current' ? `You're on the latest version (${APP_VERSION})` : `You have ${APP_VERSION}`;
    kids.push(row(msg, U.state === 'error' ? U.err : (U.native ? 'Updates install over this app and keep everything.' : 'The web app updates its offline copy and reloads.'), null));
    kids.push(h('div', { class: 'btns', style: { marginTop: '10px' } }, btn(U.state === 'checking' ? 'Checking' : 'Check for updates', () => U.check(true), true)));
  }
  return secF('Updates', U.state === 'available' || U.state === 'downloading' || U.state === 'installing', ...kids);
}
