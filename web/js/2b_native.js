/* ============================================================
   Native core (Android app on arm64 phones): melonDS with the ARM64 JIT,
   reached through window.UnderoverNative. Same methods as Core, so the
   emulation loop doesn't care which one it drives. The picture never comes
   back to the page: the app draws it in a GL view under the WebView, lined
   up with #screen (see NativeRenderer in 3b_native_video.js).
   ============================================================ */
const NATIVE = (() => { try { const n = window.UnderoverNative; return n && n.info && JSON.parse(n.info()).jit ? n : null; } catch (e) { return null; } })();

// If the app died while a game was starting or in its first seconds, the next start steps back one
// notch: fast memory off, then the JIT off, then the WebAssembly core. Returns what changed, if anything.
const NATIVE_GUARD = 'underover-native-guard';
function nativeCrashFallback() {
  try { if (!localStorage.getItem(NATIVE_GUARD)) return null; localStorage.removeItem(NATIVE_GUARD); } catch (e) { return null; }
  let msg;
  if (S.jit !== false && S.fastmem !== false) { S.fastmem = false; msg = 'The last game closed the app, so Fast memory is now off (System tab).'; }
  else if (S.jit !== false) { S.jit = false; msg = 'The last game closed the app, so the JIT is now off (System tab).'; }
  else { S.nativeCore = false; msg = 'The last game closed the app, so it now uses the WebAssembly core (System tab).'; }
  saveSettings();
  return msg;
}
const guard = on => { try { on ? localStorage.setItem(NATIVE_GUARD, '1') : localStorage.removeItem(NATIVE_GUARD); } catch (e) {} };

// ROMs cross the bridge as base64 in 4 MB pieces (the bridge only carries strings)
const blobB64 = u8 => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => { const s = r.result; res(s.slice(s.indexOf(',') + 1)); };
  r.onerror = () => rej(r.error);
  r.readAsDataURL(new Blob([u8]));
});

class NativeCore {
  async init() {
    this.n = NATIVE; this.native = true; this.threaded = true;
    this.loaded = false; this.rate = 48000; this._a = ''; this._mask = 0;
    this.view = { layout: 'single', swap: false, gap: 0 };
    await this.n.ready?.(); // only the test stand-in (test/native_mock.js) has this
    this.n.setLogLevel?.(3);
  }
  get jit() { return this.loaded && this.n.jitActive(); }
  setAudio(rate, interp = 0, bits = 0) { this.rate = rate; this.n.setAudio(rate, interp | 0, bits | 0); }
  setUser(o) { this.n.setUser((o.name || 'Player').slice(0, 10), o.lang ?? 1, o.color ?? 0, o.month || 1, o.day || 1); }
  // the ROM is kept by the app after the first boot, so the copy only happens once per game
  async load(rom, save, id, onProgress) {
    if (this.loaded) this.unload();
    const n = this.n;
    n.setJit(S.jit !== false, S.fastmem !== false);
    if (!(id && n.romCached(String(id), rom.length))) {
      if (!n.romBegin(rom.length)) return false;
      const CH = 4 << 20;
      for (let o = 0; o < rom.length; o += CH) {
        if (!n.romAppend(await blobB64(rom.subarray(o, Math.min(rom.length, o + CH))))) return false;
        onProgress?.(Math.min(1, (o + CH) / rom.length));
      }
      if (id) n.romStore(String(id));
    }
    guard(true); this._n = 0;
    if (!n.load(save && save.length ? bytesToB64(save) : '')) { guard(false); return false; }
    this.loaded = true;
    return true;
  }
  forgetRom(id) { this.n.romForget(String(id)); }
  unload() { if (!this.loaded) return; guard(false); this.n.unload(); this.loaded = false; }
  reset() { this.n.reset(); }
  frame(draw = true, next = true) {
    this._a = this.n.frame(this._mask | 0, !!draw, !!next, true);
    if (++this._n === 300) guard(false); // five seconds in: this game runs fine here
  }
  get fps() { return DS_FPS; }
  get sampleRate() { return this.rate; }
  setKeys(mask) { this._mask = mask; }
  touch(x, y, down) { this.n.touch(x | 0, y | 0, !!down); }
  setLid(closed) { this.n.setLid(!!closed); }
  get lidClosed() { return !!this.n.lid(); }
  micBlow(on) { this.n.micBlow(!!on); }
  micLive(on) { this.n.micLive(!!on); }
  micPush(s16) { this.n.micPush(bytesToB64(new Uint8Array(s16.buffer, s16.byteOffset, Math.min(s16.length, 8192) * 2))); }
  get topIsMain() { return !!this.n.topIsMain(); }
  isThreaded() { return !!this.n.isThreaded(); }
  setThreaded(on) { this.n.setThreaded(!!on); }
  setView(v) { Object.assign(this.view, v); }
  // size of the laid out picture, worked out here so layout never has to ask the app for pixels
  get frameSize() {
    const v = this.view, gap = v.layout === 'single' ? 0 : v.gap | 0;
    return v.layout === 'side' ? { w: 512 + gap, h: 192 } : v.layout === 'single' ? { w: 256, h: 192 } : { w: 256, h: 384 + gap };
  }
  // the picture's pixels are only fetched when something asks for them (covers, screenshots, clips)
  video() {
    const { w, h } = this.frameSize, self = this;
    return { w, h, native: true, get data() { return self.pixels(w, h); } };
  }
  pixels(w, h) {
    const v = this.view, L = SCREEN_LAYOUT[v.layout] ?? 0;
    this.n.present(L, !!v.swap, v.gap | 0);
    const s = this.n.picture();
    const d = s ? b64ToBytes(s) : null;
    return d && d.length === w * h * 4 ? d : new Uint8Array(w * h * 4);
  }
  avgColor() { const c = this.n.avgColor() >>> 0; return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
  drainAudio(cb) {
    const s = this._a; this._a = '';
    if (!s || !cb) return;
    const u8 = b64ToBytes(s), s16 = new Int16Array(u8.buffer, 0, u8.length >> 1);
    cb(s16, s16.length >> 1);
  }
  // states come back gzipped (about 100 KB instead of 6 MB); loadState takes them either way
  saveState() { const s = this.n.stateSave(); return s ? b64ToBytes(s) : null; }
  loadState(u8) {
    if (!u8 || u8.length < 16) return false;
    if (!(u8[0] === 0x1F && u8[1] === 0x8B) && String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'MELN') return false;
    return !!this.n.stateLoad(bytesToB64(u8));
  }
  get saveDirty() { return !!this.n.saveDirty(); }
  sram() { const s = this.n.sram(); return s ? b64ToBytes(s) : null; }
  loadSram(b) { if (b && b.length) this.n.sramImport(bytesToB64(b)); }
  setCheats(list) {
    this.n.cheatsClear();
    for (const words of list) if (words.length) this.n.cheatAdd(Array.from(words, w => (w >>> 0).toString(16)).join(','));
  }
  get hasMem() { return this.loaded; }
  // the RAM search reads all 4 MB at once instead of a few million single reads over the bridge
  ramSnapshot() { const s = this.n.mainRam(); return s ? b64ToBytes(s) : null; }
  r8(a) { return (a >>> 24) === 2 ? this.n.ramRead(a | 0, 8) & 0xFF : 0; }
  r16(a) { return (a >>> 24) === 2 ? this.n.ramRead(a | 0, 16) & 0xFFFF : 0; }
  r32(a) { return (a >>> 24) === 2 ? this.n.ramRead(a | 0, 32) >>> 0 : 0; }
  w8(a, v) { this.n.ramWrite(a | 0, 8, v | 0); }
  w16(a, v) { this.n.ramWrite(a | 0, 16, v | 0); }
  w32(a, v) { this.n.ramWrite(a | 0, 32, v | 0); }
}
