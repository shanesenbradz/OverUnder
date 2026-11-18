/* ============================================================
   Settings
   ============================================================ */
const DEFAULT_KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyX: 'a', KeyZ: 'b', KeyS: 'x', KeyA: 'y', KeyQ: 'l', KeyW: 'r', Enter: 'start', ShiftRight: 'select', Backspace: 'select',
  KeyT: 'swap_screens', KeyY: 'layout_next', KeyM: 'mic_hold', KeyL: 'lid',
  Space: 'ff_hold', Tab: 'ff_toggle', Backquote: 'rw_hold', KeyR: 'rw_hold', F2: 'qs', F4: 'ql', KeyP: 'pause', KeyN: 'step',
  F12: 'shot', KeyC: 'turbo_a', KeyV: 'turbo_b', Escape: 'menu', Equal: 'slot_next', Minus: 'slot_prev',
};
// standard pad order (0 bottom, 1 right, 2 left, 3 top) onto the DS diamond (A right, B bottom, X top, Y left)
const DEFAULT_PAD = { 0: 'b', 1: 'a', 2: 'y', 3: 'x', 4: 'l', 5: 'r', 6: 'rw_hold', 7: 'ff_hold', 8: 'select', 9: 'start', 10: 'swap_screens', 11: 'mic_hold', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'menu' };
const ACTIONS = [
  ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right'], ['a', 'A'], ['b', 'B'], ['x', 'X'], ['y', 'Y'], ['l', 'L'], ['r', 'R'], ['start', 'Start'], ['select', 'Select'],
  ['swap_screens', 'Swap screens'], ['layout_next', 'Next screen layout'], ['mic_hold', 'Blow into the mic (hold)'], ['lid', 'Close or open the lid'],
  ['turbo_a', 'Turbo A'], ['turbo_b', 'Turbo B'], ['ff_hold', 'Fast forward (hold)'], ['ff_toggle', 'Fast forward (toggle)'], ['rw_hold', 'Rewind (hold)'],
  ['qs', 'Quick save'], ['ql', 'Quick load'], ['slot_next', 'Next slot'], ['slot_prev', 'Previous slot'], ['pause', 'Pause'], ['step', 'Frame advance'], ['shot', 'Screenshot'], ['menu', 'Menu'],
];
const DEFAULTS = {
  // video
  shader: 'sharp', colorFix: false, blend: false, aspect: 'native', integer: false, brightness: 1, saturation: 1, contrast: 1, showFps: false,
  // audio
  volume: 1, mute: false, bass: 0, mid: 0, treble: 0, speaker: false, width: 1, reverb: 'off', reverbMix: 0.3, reverbSize: 1, limiter: true, ffAudio: 'chop',
  // speed
  ffSpeed: 3, slowSpeed: 0.5, rewind: true, rewindMB: 96, rewindEvery: 4, rewindRate: 1,
  // DS screens: stack, side or single; dsSwap puts the bottom screen first (in single, shows it)
  dsLayout: 'stack', dsSwap: false, dsGap: 0, swapMode: 'toggle',
  // DS console: the profile games read from the firmware, sound quality, microphone
  nick: 'Brad', lang: 1, favColor: 0, bMonth: 1, bDay: 1, interp: 2, bitDepth: 0, micSource: 'blow',
  // controls
  keys: DEFAULT_KEYS, pad: DEFAULT_PAD, haptics: true, ctlOpacity: 0.85, turboRate: 3, showTouch: 'auto', layout: null,
  // look
  theme: 'graphite', accent: 'brass', grid: 'regular', motion: 'full', skin: 'gunmetal', texture: 'auto', btnStyle: 'console', press: 'subtle', labels: true,
  click: 'off', clickVol: 1, haptic: 'light', ambient: 'subtle', bezel: false, glass: false, led: true,
  shell: true, gloss: 'satin', grille: true, decal: 'none', wall: false, wallDim: 0.1, wallBlur: 0, vinyl: 'soft', saveLights: true,
  // system
  autoResume: true, autoUpdate: true, autoSaveSec: 30, pauseOnMenu: true, pauseHidden: true, wakeLock: true, slot: 1,
  // performance: 'auto' or how many frames to skip drawing between drawn ones
  frameskip: 0,
};
// Lite: built for older, slower phones. Light defaults, and the heavy extras are off for good.
const LITE_DEFAULTS = { frameskip: 'auto', rewind: false, rewindMB: 24, rewindEvery: 4, btnStyle: 'flat', press: 'none', shell: false, gloss: 'matte', saveLights: false, ffSpeed: 2 };
const LITE_LOCKED = { ambient: 'off', wall: false, vinyl: 'off', glass: false, bezel: false, grille: false, decal: 'none', texture: 'matte', reverb: 'off', bass: 0, mid: 0, treble: 0, speaker: false, width: 1 };
if (LITE) Object.assign(DEFAULTS, LITE_DEFAULTS, LITE_LOCKED);
const SETTINGS_KEY = 'underover.settings';
const S = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) {}
  const s = Object.assign(structuredClone(DEFAULTS), saved);
  if (!s.v || s.v < 3) { s.btnStyle = 'console'; s.shell = true; s.v = 3; } // 1.3: molded console look by default
  if (s.v < 4) { const P = s.layout && s.layout.portrait; if (P) for (const k of ['rw', 'menu', 'ff']) delete P[k]; s.v = 4; } // respace hotkeys for button wells
  if (s.v < 5) { s.saveLights = !LITE; s.v = 5; } // 1.5: auto save lights on for everyone
  if (s.v < 7) { s.layout = null; s.v = 7; } // DS: new buttons and screen-aware layouts
  if (LITE) Object.assign(s, LITE_LOCKED);
  return s;
})();
let _saveT = 0;
function saveSettings() { clearTimeout(_saveT); _saveT = setTimeout(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch (e) {} }, 150); }

/* ============================================================
   Input aggregator
   ============================================================ */
const Input = {
  kb: 0, pad: 0, touch: 0, turbo: 0, holds: new Set(), capture: null, padPrev: {},
  get mask() { return this.kb | this.pad | this.touch; },
  bitOf(act) { return KEY_BIT[act] !== undefined ? 1 << KEY_BIT[act] : 0; },
  init() {
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => { this.kb = 0; this.touch = 0; this.holds.clear(); Emu.onHoldChange(); });
  },
  onKey(e, down) {
    if (this.capture && down) { e.preventDefault(); this.capture({ type: 'key', code: e.code }); return; }
    if (!Emu.active || e.target.matches?.('input,textarea,select')) return;
    if (!$('#sheet').classList.contains('hidden') && e.code !== 'Escape') return;
    const act = S.keys[e.code]; if (!act) return;
    e.preventDefault();
    if (e.repeat) return;
    this.action(act, down, 'kb');
  },
  action(act, down, src) {
    const bit = this.bitOf(act);
    if (bit) {
      if (src === 'kb') this.kb = down ? this.kb | bit : this.kb & ~bit;
      return;
    }
    if (act === 'turbo_a' || act === 'turbo_b') {
      const b = 1 << KEY_BIT[act === 'turbo_a' ? 'a' : 'b'];
      this.turbo = down ? this.turbo | b : this.turbo & ~b; return;
    }
    if (act === 'ff_hold' || act === 'rw_hold') { down ? this.holds.add(act) : this.holds.delete(act); Emu.onHoldChange(); return; }
    if (act === 'mic_hold') { Mic.blow(down); return; }
    if (act === 'swap_screens' && S.swapMode === 'hold') { Emu.swapScreens(down); return; }
    if (!down) return;
    Emu.hotkey(act);
  },
  // controllers read by the Android app (Bluetooth and USB), pushed in standard Gamepad API order
  native: { btns: 0, x: 0, y: 0 }, padActive: false, padNames: [],
  pollPad() {
    const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(p => p && p.connected)
      .map(p => ({ pressed: i => { const b = p.buttons[i]; return !!b && (b.pressed || b.value > 0.5); }, n: p.buttons.length, ax: p.axes }));
    const N = this.native;
    if (N.btns || N.x || N.y || window.CalzoneAndroid) pads.push({ pressed: i => !!(N.btns & (1 << i)), n: 17, ax: [N.x, N.y] });
    let mask = 0; const seen = {};
    for (const p of pads) {
      for (let i = 0; i < p.n; i++) {
        const pressed = p.pressed(i);
        if (!pressed || seen[i]) continue;
        seen[i] = true;
        if (this.capture && !this.padPrev[i]) { this.capture({ type: 'pad', btn: i }); }
        const act = S.pad[i]; if (!act) continue;
        const bit = this.bitOf(act); if (bit) mask |= bit;
      }
      const ax = p.ax || [];
      if (ax[0] < -0.45) mask |= 1 << KEY_BIT.left; if (ax[0] > 0.45) mask |= 1 << KEY_BIT.right;
      if (ax[1] < -0.45) mask |= 1 << KEY_BIT.up; if (ax[1] > 0.45) mask |= 1 << KEY_BIT.down;
    }
    if (!this.capture) for (const i of new Set([...Object.keys(seen), ...Object.keys(this.padPrev)])) {
      const act = S.pad[i]; if (!act || this.bitOf(act)) continue;
      if (!!seen[i] !== !!this.padPrev[i]) this.action(act, !!seen[i], 'pad');
    }
    if ((mask || Object.keys(seen).length) && !this.padActive) this.setPadActive(true);
    this.padPrev = seen; this.pad = mask;
  },
  // In "On touch devices" mode the touch buttons step aside while a controller is in use and come back on the next tap
  setPadActive(on) {
    if (this.padActive === on) return; this.padActive = on;
    if (S.showTouch === 'auto' && Emu.active) { Touch.build(); Emu.layoutScreen(); }
  },
};
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', 'Select', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'Home'];
window.bullpupPad = (btns, x, y) => { Input.native = { btns, x, y }; };
window.bullpupPadEvent = (connected, name) => {
  try { Input.padNames = (window.CalzoneAndroid?.padNames?.() || '').split('\n').filter(Boolean); } catch (e) {}
  if (connected) toast(`${name || 'Controller'} connected`);
  else { toast('Controller disconnected'); Input.native = { btns: 0, x: 0, y: 0 }; Input.setPadActive(false); }
  if (typeof Sheet !== 'undefined' && Sheet.tab === 'controls' && !$('#sheet').classList.contains('hidden')) Sheet.render();
};
addEventListener('gamepadconnected', e => toast(`${e.gamepad.id.replace(/\s*\(.*$/, '') || 'Controller'} connected`));
addEventListener('pointerdown', e => { if (Input.padActive && e.pointerType === 'touch') Input.setPadActive(false); }, { capture: true });

/* ============================================================
   Touch controls
   ============================================================ */
const CTL_DEFS = {
  dpad: { label: '', round: true }, a: { label: 'A' }, b: { label: 'B' }, x: { label: 'X' }, y: { label: 'Y' }, ab: { label: 'A+B', small: true },
  swap: { label: 'SWAP', small: true, act: 'swap_screens' }, mic: { label: 'MIC', small: true, act: 'mic_hold' },
  l: { label: 'L', pill: true }, r: { label: 'R', pill: true }, start: { label: 'START', pill: true, small: true }, select: { label: 'SELECT', pill: true, small: true },
  ff: { label: '>>', small: true, act: 'ff_toggle' }, rw: { label: '<<', small: true, act: 'rw_hold' }, menu: { label: 'MENU', small: true, act: 'menu' },
  qs: { label: 'SAVE', small: true, act: 'qs' }, ql: { label: 'LOAD', small: true, act: 'ql' }, ta: { label: 'TA', small: true, act: 'turbo_a' }, tb: { label: 'TB', small: true, act: 'turbo_b' },
};
// Portrait: the screens take the top of the phone and the controls fill the body below them.
// The touch layer starts where the screens end, so these y positions are % of that body area
// and the same layout fits stacked screens (tall) and one screen (short).
// Landscape: the screens stand in the middle and the controls go either side, like a DS on its side.
const LAYOUT_DEFAULT = {
  portrait: {
    dpad: { x: 21, y: 60, s: 33 }, a: { x: 91, y: 60, s: 14 }, b: { x: 80, y: 80, s: 14 }, x: { x: 80, y: 40, s: 14 }, y: { x: 69, y: 60, s: 14 },
    ab: { x: 93, y: 84, s: 10, v: false },
    l: { x: 12, y: 24, s: 20 }, r: { x: 88, y: 24, s: 20 }, select: { x: 38, y: 93, s: 16 }, start: { x: 62, y: 93, s: 16 },
    rw: { x: 34, y: 24, s: 11 }, menu: { x: 50, y: 24, s: 11 }, ff: { x: 66, y: 24, s: 11 }, swap: { x: 47, y: 62, s: 11 }, mic: { x: 47, y: 44, s: 10, v: false },
    qs: { x: 9, y: 93, s: 12, v: false }, ql: { x: 91, y: 93, s: 12, v: false }, ta: { x: 60, y: 42, s: 9, v: false }, tb: { x: 60, y: 80, s: 9, v: false },
  },
  landscape: {
    dpad: { x: 12, y: 60, s: 34 }, a: { x: 95, y: 56, s: 14 }, b: { x: 87, y: 72, s: 14 }, x: { x: 87, y: 40, s: 14 }, y: { x: 79, y: 56, s: 14 },
    ab: { x: 95, y: 76, s: 9, v: false },
    l: { x: 7, y: 17, s: 20 }, r: { x: 93, y: 17, s: 20 }, select: { x: 6, y: 92, s: 15 }, start: { x: 94, y: 92, s: 15 },
    rw: { x: 4, y: 32, s: 10 }, menu: { x: 18, y: 92, s: 10 }, ff: { x: 96, y: 28, s: 10 }, swap: { x: 82, y: 92, s: 10 }, mic: { x: 20, y: 30, s: 9, v: false },
    qs: { x: 22, y: 12, s: 10, v: false }, ql: { x: 78, y: 12, s: 10, v: false }, ta: { x: 80, y: 30, s: 9, v: false }, tb: { x: 74, y: 78, s: 9, v: false },
  },
};
const CHEV = '<svg viewBox="0 0 10 10"><path d="M2.6 6.4 5 4 7.4 6.4"/></svg>';
function dpadEl() {
  const d = h('div', { class: 'dpad' }, h('i', { class: 'h' }), h('i', { class: 'v' }), h('span', { class: 'hub' }), h('b', { class: 'u' }), h('b', { class: 'd' }), h('b', { class: 'l' }), h('b', { class: 'r' }));
  for (const k of ['ku', 'kr', 'kd', 'kl']) d.append(h('span', { class: 'dk ' + k, html: '<i class="kw"></i><i class="key">' + CHEV + '</i>' }));
  return d;
}
const Touch = {
  ptrs: new Map(), els: {}, rects: {}, editing: false, sel: null,
  get orient() { return innerWidth > innerHeight ? 'landscape' : 'portrait'; },
  layout() {
    const o = this.orient; S.layout = S.layout || {};
    const L = S.layout[o] = S.layout[o] || {};
    for (const k in LAYOUT_DEFAULT[o]) L[k] = Object.assign({ v: true, o: 1 }, LAYOUT_DEFAULT[o][k], L[k]);
    return L;
  },
  visible() {
    if (S.showTouch === 'on') return true; if (S.showTouch === 'off') return false;
    if (Input.padActive) return false;
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  },
  build() {
    const ov = $('#overlay'); ov.innerHTML = ''; this.els = {};
    ov.style.display = this.visible() || this.editing ? '' : 'none';
    const L = this.layout(); const vmin = Math.min(innerWidth, innerHeight) / 100;
    for (const k in CTL_DEFS) {
      const d = CTL_DEFS[k], c = L[k]; if (!c) continue;
      const e = h('div', { class: `ctl k-${k}${d.pill ? ' pill' : ''}${d.small ? ' small' : ''}`, 'data-k': k });
      const sz = c.s * vmin;
      e.style.left = c.x + '%'; e.style.top = c.y + '%'; e.style.width = sz + 'px'; e.style.height = (d.pill ? sz * 0.42 : sz) + 'px';
      e.style.opacity = (c.o ?? 1) * S.ctlOpacity;
      if (k === 'dpad') e.append(dpadEl());
      else e.append(h('div', { class: 'face' }, h('span', { class: 'lbl' }, d.label)));
      if (!c.v) { if (!this.editing) continue; e.classList.add('ghost'); }
      ov.append(e); this.els[k] = e;
    }
    this.measure();
    this.syncToggles();
    refreshVinyl();
  },
  setOpacity() { const L = this.layout(); for (const k in this.els) this.els[k].style.opacity = (L[k]?.o ?? 1) * S.ctlOpacity; },
  measure() { this.rects = {}; for (const k in this.els) { const r = this.els[k].getBoundingClientRect(); this.rects[k] = { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; } },
  syncToggles() { this.els.ff?.classList.toggle('on', Emu.ffToggle); this.els.swap?.classList.toggle('on', !!S.dsSwap !== !!Emu.peek); this.els.ta?.classList.toggle('on', !!(Input.turboLatch & 1)); this.els.tb?.classList.toggle('on', !!(Input.turboLatch & 2)); },
  hit(x, y) {
    let best = null, bd = Infinity;
    for (const k in this.rects) {
      const r = this.rects[k]; const pad = k === 'dpad' ? r.w * 0.2 : Math.min(r.w, r.h) * 0.22;
      if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) {
        const d = Math.hypot(x - r.cx, y - r.cy) / Math.max(r.w, r.h); if (d < bd) { bd = d; best = k; }
      }
    }
    return best;
  },
  dpadBits(k, x, y) {
    const r = this.rects[k]; const dx = (x - r.cx) / (r.w / 2), dy = (y - r.cy) / (r.h / 2);
    if (Math.hypot(dx, dy) < 0.22) return 0;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI; let m = 0; // -180..180, 0 = right
    if (ang > -67.5 && ang < 67.5) m |= 1 << KEY_BIT.right;
    if (ang > 112.5 || ang < -112.5) m |= 1 << KEY_BIT.left;
    if (ang > 22.5 && ang < 157.5) m |= 1 << KEY_BIT.down;
    if (ang < -22.5 && ang > -157.5) m |= 1 << KEY_BIT.up;
    return m;
  },
  init() {
    const ov = $('#overlay');
    const down = e => {
      Audio_.resume();
      if (this.editing) return this.editDown(e);
      e.preventDefault(); ov.setPointerCapture?.(e.pointerId);
      if (!this.hit(e.clientX, e.clientY) && Stylus.down(e)) return;
      this.ptrs.set(e.pointerId, { k: null, x: e.clientX, y: e.clientY }); this.update(e);
    };
    const move = e => { if (this.editing) return this.editMove(e); if (Stylus.move(e)) { e.preventDefault(); return; } if (!this.ptrs.has(e.pointerId)) return; e.preventDefault(); this.update(e); };
    const up = e => { if (this.editing) return this.editUp(e); if (Stylus.up(e)) return; const p = this.ptrs.get(e.pointerId); if (!p) return; this.ptrs.delete(e.pointerId); this.release(p); this.recompute(); };
    ov.addEventListener('pointerdown', down); ov.addEventListener('pointermove', move);
    ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    ov.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('resize', () => { if (Emu.active) { this.build(); Emu.layoutScreen(); } });
  },
  update(e) {
    const p = this.ptrs.get(e.pointerId); const k = this.hit(e.clientX, e.clientY);
    p.x = e.clientX; p.y = e.clientY;
    if (k !== p.k) {
      const prevAct = p.k && CTL_DEFS[p.k].act;
      if (prevAct) this.release(p);
      p.k = k;
      if (k && CTL_DEFS[k].act) this.press(k);
      if (k) feedback();
    }
    if (k === 'dpad') { const nb = this.dpadBits(k, e.clientX, e.clientY); if (nb !== p.bits && nb) feedback(); p.bits = nb; }
    this.recompute();
  },
  press(k) {
    const act = CTL_DEFS[k].act;
    if (act === 'turbo_a' || act === 'turbo_b') { Input.turboLatch = (Input.turboLatch || 0) ^ (act === 'turbo_a' ? 1 : 2); this.syncToggles(); return; }
    if (act === 'rw_hold') { Input.holds.add('rw_hold'); Emu.onHoldChange(); return; }
    if (act === 'menu') return;
    if (act === 'mic_hold') { Mic.blow(true); return; }
    if (act === 'swap_screens') { S.swapMode === 'hold' ? Emu.swapScreens(true) : Emu.swapScreens(); return; }
    Input.action(act, true, 'touch');
  },
  release(p) {
    if (!p.k) return; const act = CTL_DEFS[p.k].act;
    if (act === 'rw_hold') { Input.holds.delete('rw_hold'); Emu.onHoldChange(); }
    if (act === 'menu') Emu.hotkey('menu');
    if (act === 'mic_hold') Mic.blow(false);
    if (act === 'swap_screens' && S.swapMode === 'hold') Emu.swapScreens(false);
  },
  recompute() {
    let m = 0; const pressed = new Set();
    for (const p of this.ptrs.values()) {
      if (!p.k) continue; pressed.add(p.k);
      if (p.k === 'dpad') m |= p.bits || 0;
      else if (p.k === 'ab') m |= 3;
      else if (KEY_BIT[p.k] !== undefined) m |= 1 << KEY_BIT[p.k];
    }
    Input.touch = m;
    for (const k in this.els) this.els[k].classList.toggle('press', pressed.has(k) && k !== 'dpad');
    const dp = this.els.dpad?.firstChild;
    if (dp) for (const d of ['up', 'down', 'left', 'right']) dp.classList.toggle('p-' + d, !!(m & (1 << KEY_BIT[d])));
  },
  clear() { this.ptrs.clear(); Input.touch = 0; this.recompute(); },

  /* ---- layout editor ---- */
  startEdit() {
    this.editing = true; this.sel = null; Emu.pause(true);
    $('#overlay').classList.add('editing'); $('#editBar').classList.remove('hidden'); this.build(); this.selUpdate();
  },
  endEdit() {
    this.editing = false; $('#overlay').classList.remove('editing'); $('#editBar').classList.add('hidden');
    saveSettings(); this.build(); Emu.pause(false);
  },
  editDown(e) {
    const t = e.target.closest('.ctl'); if (!t) return;
    e.preventDefault(); this.sel = t.dataset.k; $$('.ctl').forEach(c => c.classList.toggle('sel', c === t));
    const r = $('#overlay').getBoundingClientRect(); const c = this.layout()[this.sel];
    this.drag = { id: e.pointerId, ox: e.clientX - (c.x / 100) * r.width, oy: e.clientY - (c.y / 100) * r.height, r };
    $('#overlay').setPointerCapture?.(e.pointerId); this.selUpdate();
  },
  editMove(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const { r, ox, oy } = this.drag, c = this.layout()[this.sel];
    c.x = clamp((e.clientX - ox) / r.width * 100, 0, 100); c.y = clamp((e.clientY - oy) / r.height * 100, 0, 100);
    const el = this.els[this.sel]; el.style.left = c.x + '%'; el.style.top = c.y + '%';
  },
  editUp() { this.drag = null; refreshVinyl(); },
  selUpdate() {
    const k = this.sel, L = this.layout();
    $('#ebName').textContent = k ? `${(CTL_DEFS[k].label || 'D-pad')}  (${this.orient})` : `Drag controls to move them (${this.orient})`;
    $('#ebSize').disabled = $('#ebOpacity').disabled = $('#ebHide').disabled = !k;
    if (k) { $('#ebSize').value = L[k].s; $('#ebOpacity').value = L[k].o ?? 1; $('#ebHide').textContent = L[k].v ? 'Hide' : 'Show'; }
  },
};

/* ============================================================
   Stylus: taps on the touch screen part of the picture
   ============================================================ */
const Stylus = {
  id: null,
  pos(e, clampIt) {
    if (!Emu.active || !core.loaded) return null;
    const ta = Emu.touchArea(); if (!ta) return null;
    const r = $('#screen').getBoundingClientRect(), f = core.video();
    let x = (e.clientX - r.left) / r.width * f.w - ta.x, y = (e.clientY - r.top) / r.height * f.h - ta.y;
    if (clampIt) { x = clamp(x, 0, 255); y = clamp(y, 0, 191); }
    else if (x < 0 || y < 0 || x >= 256 || y >= 192) return null;
    return { x, y };
  },
  down(e) {
    if (this.id !== null) return false;
    const p = this.pos(e); if (!p) return false;
    this.id = e.pointerId; core.touch(p.x, p.y, true); Audio_.resume(); return true;
  },
  // a stylus dragged off the edge keeps pressing at the edge, like on the real screen
  move(e) { if (e.pointerId !== this.id) return false; const p = this.pos(e, true); if (p) core.touch(p.x, p.y, true); return true; },
  up(e) { if (e.pointerId !== this.id) return false; this.id = null; core.touch(0, 0, false); return true; },
  clear() { if (this.id === null) return; this.id = null; if (core.loaded) core.touch(0, 0, false); },
  // with the touch buttons hidden (keyboard, controller or mouse) the canvas takes the taps itself
  init() {
    const cv = $('#screen');
    cv.addEventListener('pointerdown', e => { if (this.down(e)) { e.preventDefault(); cv.setPointerCapture?.(e.pointerId); } });
    cv.addEventListener('pointermove', e => { if (this.move(e)) e.preventDefault(); });
    cv.addEventListener('pointerup', e => this.up(e)); cv.addEventListener('pointercancel', e => this.up(e));
  },
};

/* ============================================================
   Microphone: a built-in blow sound (MIC button) or the phone's own mic
   ============================================================ */
const Mic = {
  stream: null, node: null,
  blow(on) { if (core?.loaded) core.micBlow(on); Touch.els.mic?.classList.toggle('on', on); },
  async sync() { if (S.micSource === 'mic' && Emu.active) await this.start(); else this.stop(); },
  async start() {
    if (this.stream || !navigator.mediaDevices?.getUserMedia) { if (!this.stream) toast('No microphone here. The MIC button still works.'); return; }
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }); }
    catch (e) { toast('Microphone permission was refused. The MIC button still works.'); return; }
    const ctx = Audio_.ctx, src = ctx.createMediaStreamSource(this.stream), sp = ctx.createScriptProcessor(2048, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
    sp.onaudioprocess = ev => {
      if (!Emu.active || Emu.paused) return;
      const d = ev.inputBuffer.getChannelData(0), o = new Int16Array(d.length);
      for (let i = 0; i < d.length; i++) o[i] = Math.max(-32768, Math.min(32767, d[i] * 32767));
      core.micPush(o);
    };
    src.connect(sp).connect(mute).connect(ctx.destination);
    this.node = { src, sp, mute }; core.m._nds_mic_live(1);
  },
  stop() {
    if (!this.stream) return;
    this.stream.getTracks().forEach(t => t.stop()); this.stream = null;
    try { this.node.src.disconnect(); this.node.sp.disconnect(); this.node.mute.disconnect(); } catch (e) {}
    this.node = null; if (core?.m) core.m._nds_mic_live(0);
  },
};
