// A stand-in for the Android app's window.UnderoverNative (CoreBridge.java), built on the wasm core,
// so test/e2e.py can run the page's whole native-core path in headless Chromium:
//   NATIVE_MOCK=1 python3 test/e2e.py
// It speaks the same strings-only protocol as the real bridge (base64 in and out).
(() => {
  let m = null, rom = 0, romLen = 0, romFill = 0, apt = 0, wh = 0;
  const calls = window.__nativeCalls = { setRect: [], setShader: 0, present: 0, frames: 0, romAppend: 0, romStore: 0 };
  const enc = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const dec = s => { const b = atob(s), o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; };
  const put = u8 => { const p = m._malloc(u8.length); m.HEAPU8.set(u8, p); return p; };
  let ready = null;
  window.UnderoverNative = {
    info: () => '{"abi":"arm64-v8a","jit":true}',
    // test hook only: the real bridge is ready as soon as the page can see it
    ready() {
      return ready || (ready = (async () => {
        while (typeof createMelonModule === 'undefined' || typeof WASM_B64 === 'undefined') await new Promise(r => setTimeout(r, 10));
        const bin = b64ToBytes(WASM_B64);
        m = await createMelonModule({ instantiateWasm(i, done) { WebAssembly.instantiate(bin, i).then(r => done(r.instance, r.module)); return {}; }, print() {}, printErr() {} });
        apt = m._malloc(4096 * 4);
      })());
    },
    setLogLevel: lv => m._nds_set_log_level(lv),
    setUser(name, lang, color, month, day) { const p = m.stringToNewUTF8(name); m._nds_set_user(p, lang, color, month, day); m._free(p); },
    setAudio: (rate, i, b) => m._nds_set_audio(rate, i, b),
    setJit() {}, jitActive: () => true,
    romCached: () => false,
    romBegin(len) { rom = m._malloc(len); romLen = len; romFill = 0; return !!rom; },
    romAppend(b64) { const d = dec(b64); if (romFill + d.length > romLen) return false; m.HEAPU8.set(d, rom + romFill); romFill += d.length; calls.romAppend++; return true; },
    romStore() { calls.romStore++; }, romForget() {},
    load(saveB64) {
      const s = saveB64 ? dec(saveB64) : null, sp = s ? put(s) : 0;
      const ok = m._nds_load(rom, romLen, sp, s ? s.length : 0, 1); if (sp) m._free(sp); rom = 0; return !!ok;
    },
    unload: () => m._nds_unload(), reset: () => m._nds_reset(),
    isThreaded: () => !!m._nds_is_threaded(), setThreaded: on => m._nds_set_threaded(on ? 1 : 0),
    frame(keys, draw, next, wantAudio) {
      calls.frames++;
      m._nds_set_keys(keys); m._nds_run_frame(draw ? 1 : 0, next ? 1 : 0);
      let out = [], n;
      do { n = m._nds_read_audio(apt, 4096); if (n > 0) out.push(m.HEAPU8.slice(apt, apt + n * 4)); } while (n === 4096);
      if (!wantAudio || !out.length) return '';
      const all = new Uint8Array(out.reduce((a, b) => a + b.length, 0)); let o = 0; for (const c of out) { all.set(c, o); o += c.length; }
      return enc(all);
    },
    touch: (x, y, d) => m._nds_touch(x, y, d ? 1 : 0), setLid: c => m._nds_set_lid(c ? 1 : 0), lid: () => !!m._nds_lid(),
    micBlow: on => m._nds_mic_blow(on ? 1 : 0), micLive: on => m._nds_mic_live(on ? 1 : 0),
    micPush(b64) { const d = dec(b64), p = put(d); m._nds_mic_push(p, d.length >> 1); m._free(p); },
    topIsMain: () => !!m._nds_top_is_main(),
    present(layout, swap, gap) { calls.present++; wh = m._nds_compose(layout, swap ? 1 : 0, gap); return wh; },
    picture() { const w = wh >>> 16, h = wh & 0xFFFF, p = m._nds_frame_ptr(); return w && p ? enc(m.HEAPU8.subarray(p, p + w * h * 4)) : ''; },
    avgColor() { const w = wh >>> 16, h = wh & 0xFFFF, p = m._nds_frame_ptr(); let r = 0, g = 0, b = 0, k = 0; for (let i = 0; i < w * h; i += 31) { r += m.HEAPU8[p + i * 4]; g += m.HEAPU8[p + i * 4 + 1]; b += m.HEAPU8[p + i * 4 + 2]; k++; } return k ? (r / k << 16 | g / k << 8 | b / k) : 0; },
    setShader() { calls.setShader++; }, setParams() {},
    setRect(x, y, w, h, vis) { calls.setRect.push([x, y, w, h, vis]); },
    saveDirty: () => !!m._nds_save_dirty(),
    sram() { const n = m._nds_save_len(), p = m._nds_save_ptr(); return n && p ? enc(m.HEAPU8.subarray(p, p + n)) : ''; },
    sramImport(b64) { const d = dec(b64), p = put(d); m._nds_save_import(p, d.length); m._free(p); },
    stateSave() { const n = m._nds_state_save(); return n ? enc(m.HEAPU8.subarray(m._nds_state_ptr(), m._nds_state_ptr() + n)) : ''; },
    stateLoad(b64) { const d = dec(b64), p = put(d); const ok = m._nds_state_load(p, d.length); m._free(p); return !!ok; },
    rewindReset: mb => m._nds_rewind_reset(mb), rewindCount: () => m._nds_rewind_count(), rewindBytes: () => m._nds_rewind_bytes(),
    rewindCapture: () => !!m._nds_rewind_capture(), rewindStep: () => !!m._nds_rewind_step(),
    cheatsClear: () => m._nds_cheats_clear(),
    cheatAdd(hex) { const w = hex.split(',').map(x => parseInt(x, 16) >>> 0), p = m._malloc(w.length * 4); new Uint32Array(m.HEAPU8.buffer, p, w.length).set(w); m._nds_cheat_add(p, w.length); m._free(p); },
    mainRam() { const p = m._nds_mainram(); return p ? enc(m.HEAPU8.subarray(p, p + 0x400000)) : ''; },
    ramRead(a, bits) { const p = m._nds_mainram() + ((a >>> 0) & 0x3FFFFF), H = m.HEAPU8; return bits === 8 ? H[p] : bits === 16 ? H[p] | H[p + 1] << 8 : (H[p] | H[p + 1] << 8 | H[p + 2] << 16 | H[p + 3] << 24); },
    ramWrite(a, bits, v) { const p = m._nds_mainram() + ((a >>> 0) & 0x3FFFFF), H = m.HEAPU8; H[p] = v; if (bits >= 16) H[p + 1] = v >> 8; if (bits >= 32) { H[p + 2] = v >> 16; H[p + 3] = v >>> 24; } },
  };
})();
