/* ============================================================
   Core wrapper around the melonDS wasm build (vendor/melonds)
   ============================================================ */
// DS buttons in hardware order. X and Y are the DS extras the GBA never had.
const KEY_BIT = { a: 0, b: 1, select: 2, start: 3, right: 4, left: 5, up: 6, down: 7, r: 8, l: 9, x: 10, y: 11 };
const DS_FPS = 59.8261;
// how the two screens are laid out into one picture (nds_compose)
const SCREEN_LAYOUT = { stack: 0, side: 1, single: 2 };

class Core {
  async init() {
    const wasmBinary = b64ToBytes(WASM_B64);
    this.m = await createMelonModule({
      instantiateWasm(imports, done) { WebAssembly.instantiate(wasmBinary, imports).then(r => done(r.instance)); return {}; },
      print() {}, printErr(t) { console.debug('[melonDS]', t); },
    });
    this.m._nds_set_log_level(3);
    this.loaded = false;
    this.audioPtr = this.m._malloc(4096 * 4);
    this.micPtr = this.m._malloc(8192 * 2);
    this.rate = 48000;
    this.view = { layout: 'stack', swap: false, gap: 0 };
  }
  get H() { return this.m.HEAPU8; }
  setAudio(rate, interp = 0, bits = 0) { this.rate = rate; this.m._nds_set_audio(rate, interp, bits); }
  setUser(o) {
    const p = this.m.stringToNewUTF8((o.name || 'Player').slice(0, 10));
    this.m._nds_set_user(p, o.lang ?? 1, o.color ?? 0, o.month || 1, o.day || 1); this.m._free(p);
  }
  // rom is copied into the wasm heap; the save (if any) goes straight into the cart
  load(rom, save) {
    const m = this.m;
    if (this.loaded) this.unload();
    const rp = m._malloc(rom.length); if (!rp) return false;
    m.HEAPU8.set(rom, rp);
    let sp = 0; if (save && save.length) { sp = m._malloc(save.length); m.HEAPU8.set(save, sp); }
    const ok = m._nds_load(rp, rom.length, sp, sp ? save.length : 0, 1);
    if (sp) m._free(sp); // the ROM buffer now belongs to the core
    if (!ok) return false;
    this.loaded = true; this._frame = null;
    return true;
  }
  unload() { if (!this.loaded) return; this.m._nds_unload(); this.loaded = false; this._frame = null; }
  reset() { this.m._nds_reset(); }
  // draw = false runs the frame without drawing it; next = false also skips the 3D scene the next frame would show
  frame(draw = true, next = true) { this.m._nds_run_frame(draw ? 1 : 0, next ? 1 : 0); if (draw) this._frame = null; }
  get fps() { return DS_FPS; }
  get sampleRate() { return this.rate; }
  setKeys(mask) { if (mask !== this._mask) { this._mask = mask; this.m._nds_set_keys(mask); } }
  touch(x, y, down) { this.m._nds_touch(x | 0, y | 0, down ? 1 : 0); }
  setLid(closed) { this.m._nds_set_lid(closed ? 1 : 0); }
  get lidClosed() { return !!this.m._nds_lid(); }
  micBlow(on) { this.m._nds_mic_blow(on ? 1 : 0); }
  micPush(s16) { const n = Math.min(s16.length, 8192); new Int16Array(this.m.HEAPU8.buffer, this.micPtr, n).set(s16.subarray(0, n)); this.m._nds_mic_push(this.micPtr, n); }
  get topIsMain() { return !!this.m._nds_top_is_main(); }
  setView(v) { Object.assign(this.view, v); this._frame = null; }
  // the two screens laid out as one RGBA picture, rebuilt only after a drawn frame
  video() {
    if (this._frame && this._frame.data.buffer === this.m.HEAPU8.buffer) return this._frame;
    const m = this.m, v = this.view;
    const wh = m._nds_compose(SCREEN_LAYOUT[v.layout] ?? 0, v.swap ? 1 : 0, v.gap | 0);
    const w = wh >>> 16, h = wh & 0xFFFF, p = m._nds_frame_ptr();
    if (!w || !p) return { w: 256, h: 384, data: new Uint8Array(256 * 384 * 4) };
    return (this._frame = { w, h, data: m.HEAPU8.subarray(p, p + w * h * 4) });
  }
  drainAudio(cb) {
    const m = this.m;
    for (;;) {
      const n = m._nds_read_audio(this.audioPtr, 4096);
      if (n <= 0) return;
      if (cb) cb(m.HEAP16.slice(this.audioPtr >> 1, (this.audioPtr >> 1) + n * 2), n);
      if (n < 4096) return;
    }
  }
  saveState() { const n = this.m._nds_state_save(); if (!n) return null; const p = this.m._nds_state_ptr(); return this.m.HEAPU8.slice(p, p + n); }
  loadState(u8) {
    if (!u8 || u8.length < 16 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'MELN') return false;
    const p = this.m._malloc(u8.length); this.m.HEAPU8.set(u8, p);
    const ok = this.m._nds_state_load(p, u8.length); this.m._free(p); this._frame = null;
    return !!ok;
  }
  // cart save memory (EEPROM, flash or FRAM)
  get saveDirty() { return !!this.m._nds_save_dirty(); }
  sram() { const n = this.m._nds_save_len(), p = this.m._nds_save_ptr(); if (!n || !p) return null; return this.m.HEAPU8.slice(p, p + n); }
  loadSram(b) { if (!b || !b.length) return; const p = this.m._malloc(b.length); this.m.HEAPU8.set(b, p); this.m._nds_save_import(p, b.length); this.m._free(p); }
  // Action Replay DS codes, run by the core itself on the ARM7 VBlank like the real cart
  setCheats(list) {
    const m = this.m; m._nds_cheats_clear();
    for (const words of list) {
      if (!words.length) continue;
      const p = m._malloc(words.length * 4); new Uint32Array(m.HEAPU8.buffer, p, words.length).set(words);
      m._nds_cheat_add(p, words.length); m._free(p);
    }
  }
  /* main RAM for the RAM search: 4 MB at 0x02000000, mirrored up to 0x02FFFFFF */
  get hasMem() { return this.loaded; }
  addr(a) { if ((a >>> 24) !== 2) return -1; return this.m._nds_mainram() + (a & 0x3FFFFF); }
  r8(a) { const i = this.addr(a); return i < 0 ? 0 : this.H[i]; }
  r16(a) { const i = this.addr(a); if (i < 0) return 0; const H = this.H; return H[i] | H[i + 1] << 8; }
  r32(a) { const i = this.addr(a); if (i < 0) return 0; const H = this.H; return (H[i] | H[i + 1] << 8 | H[i + 2] << 16 | H[i + 3] << 24) >>> 0; }
  w8(a, v) { const i = this.addr(a); if (i >= 0) this.H[i] = v; }
  w16(a, v) { const i = this.addr(a); if (i >= 0) { const H = this.H; H[i] = v; H[i + 1] = v >> 8; } }
  w32(a, v) { const i = this.addr(a); if (i >= 0) { const H = this.H; H[i] = v; H[i + 1] = v >> 8; H[i + 2] = v >> 16; H[i + 3] = v >>> 24; } }
}

/* ============================================================
   Rewind: the core keeps XOR deltas between states in the wasm heap
   (a DS state is about 6 MB, too much to diff in JS every few frames)
   ============================================================ */
class Rewinder {
  constructor(core, budgetMB) { this.core = core; this.m = core.m; this.m._nds_rewind_reset(budgetMB); }
  reset() { this.m._nds_rewind_reset(0); }
  get count() { return this.m._nds_rewind_count(); }
  get bytes() { return this.m._nds_rewind_bytes(); }
  capture() { this.m._nds_rewind_capture(); }
  step() { const ok = !!this.m._nds_rewind_step(); this.core._frame = null; return ok; }
}

/* ============================================================
   Cheats: Action Replay DS codes (the format nearly every DS code list uses),
   plus a raw AAAAAAAA:VV form for values found with the RAM search.
   Returns { words, errors }: one array of 32-bit words for the core.
   ============================================================ */
function parseCheat(code) {
  const words = [], errors = [];
  const lines = code.toUpperCase().split(/\n/).map(s => s.replace(/[^0-9A-F: ]/g, ' ').trim()).filter(Boolean);
  for (const raw of lines) {
    const ln = raw.replace(/\s+/g, ' ');
    let m;
    if ((m = ln.match(/^([0-9A-F]{7,8})\s*:\s*([0-9A-F]{1,8})$/))) {
      const a = parseInt(m[1], 16) & 0x0FFFFFFF, v = parseInt(m[2], 16) >>> 0, L = m[2].length;
      // AR DS: 0XXXXXXX 32-bit write, 1XXXXXXX 16-bit, 2XXXXXXX 8-bit
      words.push(((L <= 2 ? 0x20000000 : L <= 4 ? 0x10000000 : 0) | a) >>> 0, v);
      continue;
    }
    if ((m = ln.match(/^([0-9A-F]{8}) ?([0-9A-F]{8})$/))) { words.push(parseInt(m[1], 16) >>> 0, parseInt(m[2], 16) >>> 0); continue; }
    errors.push('Could not read line: ' + raw);
  }
  return { words, errors, format: 'ards' };
}

/* ============================================================
   RAM search (cheat finder) over the 4 MB of DS main RAM
   ============================================================ */
class RamSearch {
  constructor(core) { this.core = core; this.reset(16); }
  reset(bits) { this.bits = bits; this.addrs = null; this.prev = null; this.history = 0; }
  read(a) { return this.bits === 8 ? this.core.r8(a) : this.bits === 16 ? this.core.r16(a) : this.core.r32(a); }
  start() {
    const step = this.bits / 8, n = 0x400000 / step;
    this.addrs = new Uint32Array(n); this.prev = new Float64Array(n);
    for (let i = 0; i < n; i++) { const a = 0x02000000 + i * step; this.addrs[i] = a; this.prev[i] = this.read(a); }
    this.history = 1;
  }
  filter(mode, x) {
    if (!this.addrs) this.start();
    const A = this.addrs, P = this.prev, keepA = new Uint32Array(A.length), keepP = new Float64Array(A.length);
    let k = 0;
    for (let i = 0; i < A.length; i++) {
      const v = this.read(A[i]), p = P[i];
      let ok;
      switch (mode) {
        case 'eq': ok = v === x; break; case 'ne': ok = v !== x; break;
        case 'changed': ok = v !== p; break; case 'same': ok = v === p; break;
        case 'inc': ok = v > p; break; case 'dec': ok = v < p; break;
        case 'incby': ok = v - p === x; break; case 'decby': ok = p - v === x; break;
      }
      if (ok) { keepA[k] = A[i]; keepP[k++] = v; }
    }
    this.addrs = keepA.slice(0, k); this.prev = keepP.slice(0, k); this.history++;
    return k;
  }
  get count() { return this.addrs ? this.addrs.length : 0; }
}

/* Save states are big (about 6 MB, mostly RAM), so they are stored gzipped. */
async function packState(u8) {
  if (typeof CompressionStream === 'undefined') return u8;
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function unpackState(u8) {
  if (!u8 || u8[0] !== 0x1F || u8[1] !== 0x8B) return u8;
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
