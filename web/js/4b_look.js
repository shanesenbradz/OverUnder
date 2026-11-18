/* ============================================================
   Look: themes, accents, controller skins, button feel, live effects
   ============================================================ */
// [fill, ink on fill, text on dark, text on light]
const ACCENTS = {
  brass: ['#d9a441', '#1a1307', '#e3b55c', '#94650f', 'Brass'],
  cobalt: ['#4c8dff', '#06132b', '#7aa9ff', '#1f5fd1', 'Cobalt'],
  mint: ['#5fd3b5', '#04201a', '#86e0c8', '#1b7d65', 'Mint'],
  moss: ['#8fb36a', '#132008', '#a8c787', '#4a7526', 'Moss'],
  coral: ['#ff7a59', '#2a0d05', '#ff9a80', '#c2452a', 'Coral'],
  rose: ['#f2709c', '#2a0613', '#f593b5', '#b8325f', 'Rose'],
  silver: ['#c7ccd4', '#14161a', '#d6dae0', '#565c66', 'Silver'],
};
const SKIN_KEYS = ['skin-top', 'skin-bot', 'btn-top', 'btn-bot', 'ab-top', 'ab-bot', 'btn-ink', 'edge', 'plate', 'well', 'engrave', 'engrave-hi'];
const SKINS = {
  gunmetal: { name: 'Gunmetal', v: ['#2a2c31', '#232529', '#3b3e44', '#2e3035', '#45484f', '#36393f', 'rgba(255,255,255,.86)', '#111214', 'rgba(235,235,245,.28)', '#17181b', 'rgba(255,255,255,.52)', 'rgba(0,0,0,.5)'] },
  arctic: { name: 'Arctic', v: ['#eceef1', '#dcdfe4', '#fafafb', '#e4e6ea', '#ffffff', '#eceef1', '#3a3e46', '#a9aeb7', 'rgba(30,32,38,.38)', '#c2c6cd', 'rgba(40,44,52,.36)', 'rgba(255,255,255,.9)'] },
  smoke: { name: 'Clear smoke', clear: true, v: ['rgba(48,50,58,.94)', 'rgba(24,25,30,.97)', 'rgba(74,76,86,.78)', 'rgba(40,41,48,.86)', 'rgba(84,86,96,.82)', 'rgba(46,47,55,.9)', '#ececf2', '#08080a', 'rgba(235,235,245,.34)', 'rgba(6,6,8,.62)', 'rgba(255,255,255,.55)', 'rgba(0,0,0,.5)'] },
  atomic: { name: 'Atomic purple', clear: true, v: ['#5e4192', '#3f2a68', 'rgba(172,142,222,.78)', 'rgba(112,82,168,.88)', 'rgba(188,158,238,.82)', 'rgba(126,94,182,.9)', '#f5f0ff', '#22153a', 'rgba(245,240,255,.42)', 'rgba(28,16,50,.58)', 'rgba(255,255,255,.62)', 'rgba(40,20,70,.6)'] },
  olive: { name: 'Olive drab', v: ['#4b5139', '#3c412e', '#5d6447', '#4b5139', '#6a7151', '#555c41', '#ecefdc', '#22251a', 'rgba(236,239,220,.36)', '#2b2f21', 'rgba(236,239,220,.55)', 'rgba(0,0,0,.45)'] },
  tan: { name: 'Desert tan', v: ['#cbb68c', '#b9a476', '#dcc9a0', '#c5b086', '#e2d1ab', '#ccb88f', '#46392a', '#86734d', 'rgba(70,57,42,.48)', '#9a855c', 'rgba(70,57,42,.42)', 'rgba(255,248,230,.65)'] },
  classic: { name: 'Classic blue', v: ['#3d8ff0', '#1c5ccd', '#f6f7f9', '#d6d9df', '#f6f7f9', '#d6d9df', '#9aa0a9', '#aeb2ba', 'rgba(255,255,255,.55)', '#1847a3', 'rgba(60,66,78,.26)', 'rgba(255,255,255,.9)'] },
  raygun: { name: 'Ray gun', v: ['#93e2cd', '#5ec4ab', '#fff8de', '#eee0b6', '#ff7d6e', '#e2513f', '#6b5a3a', '#c8b88c', 'rgba(20,70,58,.5)', '#3e9b85', 'rgba(90,70,40,.34)', 'rgba(255,255,255,.85)'] },
  soaker: { name: 'Water blaster', v: ['#ffa04f', '#ef7820', '#5ea6ff', '#2f7be6', '#ffe169', '#f5c518', '#ffffff', '#1d58b8', 'rgba(90,30,0,.5)', '#c3570e', 'rgba(255,255,255,.58)', 'rgba(0,0,0,.25)'] },
  bubble: { name: 'Bubblegum', v: ['#ffb6d8', '#f48bbc', '#ffffff', '#efe5ee', '#a3e4ff', '#63c8f2', '#b07a98', '#d6bccd', 'rgba(120,30,80,.45)', '#d46aa0', 'rgba(150,60,110,.3)', 'rgba(255,255,255,.92)'] },
  signal: { name: 'Signal red', v: ['#b8382e', '#9b2c24', '#c9473b', '#ab352c', '#2d2d30', '#1f1f22', '#fff3ef', '#56140f', 'rgba(255,240,235,.48)', '#6c1b14', 'rgba(255,240,235,.6)', 'rgba(0,0,0,.4)'] },
};

function applyLook() {
  const r = document.documentElement, d = r.dataset;
  d.theme = S.theme; d.btn = S.btnStyle; d.press = S.press; d.labels = S.labels ? 'on' : 'off';
  d.amb = S.ambient; d.shell = S.shell ? 'on' : 'off'; d.gloss = S.gloss; d.grille = S.grille ? 'on' : 'off'; d.wall = S.wall && _wallUrl ? 'on' : 'off'; d.bezel = S.bezel ? 'on' : 'off'; d.glass = S.glass ? 'on' : 'off'; d.led = S.led ? 'on' : 'off'; d.motion = S.motion; d.vinyl = S.vinyl !== 'off' ? 'on' : 'off';
  const sk = SKINS[S.skin] || SKINS.gunmetal;
  d.tex = S.texture === 'auto' ? (d.wall === 'on' ? 'matte' : sk.clear ? 'pcb' : 'matte') : S.texture;
  r.style.setProperty('--armory', armoryTile());
  const wall = document.getElementById('wall'); if (wall) wall.style.filter = `blur(${S.wallBlur}px) brightness(${(1 - S.wallDim).toFixed(2)})`;
  const vc = document.getElementById('vinyl'); if (vc) vc.style.filter = `brightness(${(1 - S.wallDim).toFixed(2)})`;
  const dec = document.getElementById('decal'); if (dec) { dec.innerHTML = SPRITES[S.decal] || ''; dec.classList.toggle('show', !!SPRITES[S.decal]); }
  SKIN_KEYS.forEach((k, i) => r.style.setProperty('--' + k, sk.v[i]));
  if (d.wall === 'on') r.style.setProperty('--well', 'rgba(0,0,0,.34)');
  const a = ACCENTS[S.accent] || ACCENTS.brass;
  r.style.setProperty('--acc', a[0]); r.style.setProperty('--acc-ink', a[1]); r.style.setProperty('--acc-text', S.theme === 'light' ? a[3] : a[2]);
  r.style.setProperty('--cover-min', { compact: '112px', regular: '148px', large: '208px' }[S.grid] || '148px');
  const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = S.theme === 'light' ? '#f2f2f7' : S.theme === 'oled' ? '#000000' : '#111113';
  if (typeof Emu !== 'undefined' && Emu.active) { Emu.layoutScreen(); Emu.updateLed(); Emu.saveLeds(); }
  refreshVinyl();
}

/* ---- tactile feedback: haptics + synthesized click ---- */
let _noiseBuf = null;
function clickSound(kind = S.click) {
  if (kind === 'off' || !Audio_) return;
  const c = Audio_.ctx; if (c.state !== 'running') return;
  const t = c.currentTime + 0.002, out = c.createGain(); out.connect(c.destination);
  if (!_noiseBuf) { _noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.04), c.sampleRate); const ch = _noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 5); }
  const noise = (type, freq, gain) => { const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); n.buffer = _noiseBuf; f.type = type; f.frequency.value = freq; g.gain.value = gain; n.connect(f).connect(g).connect(out); n.start(t); };
  const tone = (type, f0, f1, dur, gain) => { const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.4); o.connect(g).connect(out); o.start(t); o.stop(t + dur * 1.5); };
  const vol = S.clickVol;
  if (kind === 'soft') tone('sine', 2400, 1100, 0.018, 0.05 * vol);
  else if (kind === 'clicky') { noise('highpass', 2800, 0.5 * vol); tone('square', 3200, 2600, 0.006, 0.015 * vol); }
  else if (kind === 'thock') { tone('triangle', 230, 85, 0.05, 0.22 * vol); noise('bandpass', 1300, 0.12 * vol); }
  else if (kind === 'membrane') { noise('lowpass', 900, 0.35 * vol); tone('sine', 140, 70, 0.03, 0.12 * vol); }
}
/* Haptics, in order of preference:
   1. Android app: the native bridge (WebView ignores navigator.vibrate, which is why some phones felt nothing)
   2. Browsers with the Vibration API (Chrome on Android). Pulses under ~10 ms are too short for many
      coin motors to spin up, so the levels start at 12 ms.
   3. iOS 18 Safari has no Vibration API, but toggling a native switch input plays the system tick. */
const HAPTIC_MS = { off: 0, light: 12, medium: 22, strong: 38 };
let _iosTick = null, _hapticLast = 0;
function iosTick() {
  if (!_iosTick) {
    const l = document.createElement('label'), i = document.createElement('input');
    i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i);
    l.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l); _iosTick = l;
  }
  _iosTick.click();
}
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function haptic(level = S.haptic) {
  const ms = HAPTIC_MS[level] || 0; if (!ms) return;
  const now = performance.now(); if (now - _hapticLast < 25) return; // sliding across buttons shouldn't buzz continuously
  _hapticLast = now;
  const A = window.CalzoneAndroid;
  try {
    if (A && A.haptic) return void A.haptic(level);
    if (A && A.vibrate) return void A.vibrate(ms);
    if (navigator.vibrate && navigator.vibrate(ms)) return;
    if (IS_IOS) iosTick();
  } catch (e) {}
}
function feedback() {
  haptic();
  clickSound();
}

/* ---- ambient glow from the game picture ---- */
let _ambLast = '';
function sampleAmbient() {
  const { data } = core.video(); let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4 * 31) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  if (!n) return;
  r /= n; g /= n; b /= n;
  const m = (r + g + b) / 3, k = 1.7; r = m + (r - m) * k; g = m + (g - m) * k; b = m + (b - m) * k;
  const mx = Math.max(r, g, b, 1), lift = Math.min(2.2, 210 / mx); r *= lift; g *= lift; b *= lift;
  const q = v => clamp(Math.round(v / 8) * 8, 0, 255);
  const col = `rgb(${q(r)},${q(g)},${q(b)})`;
  if (col !== _ambLast) { _ambLast = col; $('#amb').style.backgroundColor = col; }
}

/* ---- pixel armory pattern, built once from the sprites ---- */
let _armory = '';
function spriteInner(svg) { const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/); return { w: +vb[1], h: +vb[2], body: svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') }; }
function armoryTile() {
  if (_armory) return _armory;
  const place = [['pistol', 6, 6, 26, -12], ['raygun', 58, 4, 44, 8], ['soaker', 18, 40, 46, -6], ['bubble', 78, 40, 32, 14]];
  let g = '';
  for (const [k, x, y, w, rot] of place) { const sp = spriteInner(SPRITES[k]); const hh = w * sp.h / sp.w; g += `<g transform="rotate(${rot} ${x + w / 2} ${y + hh / 2})"><svg x="${x}" y="${y}" width="${w}" height="${hh}" viewBox="0 0 ${sp.w} ${sp.h}" shape-rendering="crispEdges">${sp.body}</svg></g>`; }
  _armory = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="72">${g}</svg>`)}")`;
  return _armory;
}
function spriteFor(seed) { const keys = ['pistol', 'revolver', 'raygun', 'soaker', 'sniper', 'bubble', 'bullpup']; let n = 0; for (const c of String(seed)) n = (n * 31 + c.charCodeAt(0)) >>> 0; return SPRITES[keys[n % keys.length]]; }

/* ---- custom wallpaper on the device body ---- */
let _wallUrl = null;
function applyWall(u) { _wallUrl = u || null; _wallVer++; const w = document.getElementById('wall'); if (w) w.style.backgroundImage = u ? `url(${u})` : ''; document.documentElement.style.setProperty('--wall-url', u ? `url(${u})` : 'none'); }
async function loadWallpaper() { try { applyWall(await DB.get('kv', 'wallpaper')); } catch (e) {} applyLook(); }
async function setWallpaperFromFile(f) {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.86);
  await DB.put('kv', 'wallpaper', url); S.wall = true; saveSettings(); applyWall(url); applyLook();
}
async function clearWallpaper() { await DB.del('kv', 'wallpaper'); S.wall = false; saveSettings(); applyWall(null); applyLook(); }

/* ---- vinyl wrap: the wallpaper as a printed skin that rolls over the body edges and dips into the button wells ----
   Everything is baked once into a canvas (per layout), so it costs nothing while a game runs. */
let _pv = null, _wallImg = null, _wallImgUrl = null, _wallVer = 0, _vinylKey = '', _vinylT = 0;
async function wallImage() {
  if (!_wallUrl) return null;
  if (_wallImg && _wallImgUrl === _wallUrl) return _wallImg;
  const im = new Image(); im.src = _wallUrl; await im.decode();
  _wallImg = im; _wallImgUrl = _wallUrl; return im;
}
const vinylOn = () => document.documentElement.dataset.wall === 'on' && S.vinyl !== 'off';
// molded wells under the controls, as rounded boxes in host-relative CSS px
function wellShapes(host, ctls) {
  if (S.btnStyle !== 'console') return [];
  const hr = host.getBoundingClientRect(), out = [];
  for (const e of ctls) {
    if (!e.isConnected || e.classList.contains('ghost')) continue;
    const r = e.getBoundingClientRect(); if (!r.width) continue;
    const cx = r.left + r.width / 2 - hr.left, cy = r.top + r.height / 2 - hr.top, w = r.width, h = r.height;
    let boxes;
    if (e.dataset.k === 'dpad') boxes = [[w * 0.52, w * 0.205, w * 0.07], [w * 0.205, w * 0.52, w * 0.07]];
    else if (e.classList.contains('pill')) boxes = [[w / 2 + 5, h / 2 + 5, h / 2 + 5]];
    else boxes = [[w / 2 + 7, h / 2 + 7, Math.min(w, h) / 2 + 7]];
    const R = Math.max(...boxes.map(b => Math.max(b[0], b[1])));
    out.push({ cx, cy, R, boxes });
  }
  return out;
}
function sdWell(wl, x, y) {
  let d = Infinity; const px = Math.abs(x - wl.cx), py = Math.abs(y - wl.cy);
  for (const [hx, hy, r] of wl.boxes) {
    const qx = px - (hx - r), qy = py - (hy - r);
    const o = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    if (o < d) d = o;
  }
  return d;
}
// 1D edge roll: screen position -> position on the flat sheet, plus how far the surface has turned away (0..1)
function rollAxis(n, scale, len, r0, r1, offset) {
  const S_ = new Float32Array(n), N = new Float32Array(n), A = Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / scale - offset;
    let s, t = 0;
    if (x < r0) { t = Math.min(1, (r0 - Math.max(x, 0)) / r0); s = r0 * A - r0 * Math.asin(t); t = -t; }
    else if (x > len - r1) { t = Math.min(1, (x - (len - r1)) / r1); s = r0 * A + (len - r0 - r1) + r1 * Math.asin(t); }
    else s = r0 * A + (x - r0);
    S_[i] = s; N[i] = t;
  }
  return { S: S_, N, total: (len - r0 - r1) + (r0 + r1) * A };
}
async function renderVinyl(cv, W, H, wells, topY = 0) {
  const img = await wallImage(); if (!img || W < 20 || H < 20) return;
  const k = S.vinyl === 'deep' ? 1.8 : 1;
  const sc = Math.min(Math.min(devicePixelRatio || 1, 1.6), 1400 / Math.max(W, H));
  const w = Math.round(W * sc), h = Math.round(H * sc);
  const Hv = Math.max(40, H - topY);
  const rx = Math.min(W * 0.07 * k, 64), rb = Math.min(Hv * 0.045 * k, 56), rt = Math.min(16 * k, 32);
  const cols = rollAxis(w, sc, W, rx, rx, 0), rows = rollAxis(h, sc, Hv, rt, rb, topY);
  // the flat sheet, cover-fitted, with the wallpaper blur baked in
  const sw = Math.max(1, Math.round(cols.total * sc)), sh = Math.max(1, Math.round(rows.total * sc));
  const src = document.createElement('canvas'); src.width = sw; src.height = sh;
  const g = src.getContext('2d', { willReadFrequently: true });
  const f = Math.max(sw / img.width, sh / img.height), dw = img.width * f, dh = img.height * f;
  const bl = S.wallBlur * sc; if (bl) g.filter = `blur(${bl}px)`;
  g.drawImage(img, (sw - dw) / 2 - bl * 2, (sh - dh) / 2 - bl * 2, dw + bl * 4, dh + bl * 4);
  const sd = g.getImageData(0, 0, sw, sh).data;
  const out = new ImageData(w, h), od = out.data;
  // light from the upper left, a little in front
  let Lx = -0.34, Ly = -0.52, Lz = 0.78; { const m = Math.hypot(Lx, Ly, Lz); Lx /= m; Ly /= m; Lz /= m; }
  let Hx = Lx, Hy = Ly, Hz = Lz + 1; { const m = Math.hypot(Hx, Hy, Hz); Hx /= m; Hy /= m; Hz /= m; }
  const ks = { matte: 0.08, satin: 0.22, gloss: 0.42 }[S.gloss] ?? 0.22, shin = S.gloss === 'gloss' ? 70 : 34;
  const specFlat = Math.pow(Hz, shin);
  const B = 12 * k, D = 4 * k; // band the vinyl stretches over around a well, and how far it gets pulled in
  let seed = 1234567;
  for (let j = 0; j < h; j++) {
    const py = (j + 0.5) / sc, syRow = rows.S[j], nyRoll = rows.N[j], tiltY = 0.07 * ((py - topY) / Hv * 2 - 1);
    const near = wells.filter(wl => Math.abs(py - wl.cy) < wl.R + B + 2);
    for (let i = 0; i < w; i++) {
      const px = (i + 0.5) / sc, nxRoll = cols.N[i];
      let sx = cols.S[i], sy = syRow, nx = nxRoll + 0.1 * (px / W * 2 - 1), ny = nyRoll + tiltY, mul = 1;
      // only the closest well bends the vinyl, so neighbouring wells don't stack into ripples
      let wl = null, d = B;
      for (const c of near) { if (Math.abs(px - c.cx) > c.R + B + 2) continue; const dc = sdWell(c, px, py); if (dc < d) { d = dc; wl = c; } }
      if (wl) {
        const gx = sdWell(wl, px + 0.6, py) - sdWell(wl, px - 0.6, py), gy = sdWell(wl, px, py + 0.6) - sdWell(wl, px, py - 0.6);
        const gm = Math.hypot(gx, gy) || 1, ux = gx / gm, uy = gy / gm;
        let pull, slope;
        if (d > 0) { const t = 1 - d / B, s = t * t * (3 - 2 * t); pull = D * s; slope = 0.9 * Math.sin(t * Math.PI / 2) * s; }
        else { pull = D + Math.min(-d, 12) * 0.25; slope = 0; mul *= 0.8; }
        sx += ux * pull; sy += uy * pull; nx -= ux * slope; ny -= uy * slope;
      }
      // shading from the bent surface
      const nz = Math.sqrt(Math.max(0.04, 1 - nx * nx - ny * ny)), m = Math.hypot(nx, ny, nz);
      const ex = nx / m, ey = ny / m, ez = nz / m;
      const diff = ex * Lx + ey * Ly + ez * Lz;
      const edge = Math.sqrt(Math.max(0, 1 - nxRoll * nxRoll)) * Math.sqrt(Math.max(0, 1 - nyRoll * nyRoll));
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const peel = 1 + ((seed >> 16) / 32768 - 0.5) * 0.035;
      const shade = Math.max(0.2, (1 + 0.95 * (diff - Lz)) * (0.55 + 0.45 * edge) * mul * peel);
      const nh = Math.max(0, ex * Hx + ey * Hy + ez * Hz);
      const spec = 255 * ks * Math.max(0, Math.pow(nh, shin) - specFlat);
      // bilinear sample of the flat sheet
      let fx = sx * sc - 0.5, fy = sy * sc - 0.5;
      fx = fx < 0 ? 0 : fx > sw - 1.001 ? sw - 1.001 : fx; fy = fy < 0 ? 0 : fy > sh - 1.001 ? sh - 1.001 : fy;
      const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, e = (y1 * sw + x1) * 4, o = (j * w + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v = (sd[a + ch] * (1 - ax) + sd[b + ch] * ax) * (1 - ay) + (sd[c + ch] * (1 - ax) + sd[e + ch] * ax) * ay;
        od[o + ch] = v * shade + spec;
      }
      od[o + 3] = 255;
    }
  }
  cv.width = w; cv.height = h; cv.getContext('2d').putImageData(out, 0, 0);
}
// the in-game body: re-bake when the wallpaper, layout or finish changes
function refreshVinyl(now) {
  clearTimeout(_vinylT);
  if (!now) { _vinylT = setTimeout(() => refreshVinyl(true), 120); return; }
  if (_pv?.isConnected) refreshPreviewVinyl(_pv);
  const body = document.getElementById('body'), cv = document.getElementById('vinyl');
  if (!body || !cv || !vinylOn() || !body.classList.contains('show') || typeof Touch === 'undefined') return;
  const br = body.getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect();
  const topY = Math.max(0, Math.min(br.height * 0.8, st.bottom - br.top));
  const wells = wellShapes(body, Object.values(Touch.els));
  const key = [_wallVer, br.width, br.height, topY, S.vinyl, S.gloss, S.wallBlur, S.btnStyle, devicePixelRatio, JSON.stringify(wells.map(w => [w.cx | 0, w.cy | 0, w.R | 0]))].join('|');
  if (key === _vinylKey) return;
  _vinylKey = key;
  renderVinyl(cv, br.width, br.height, wells, topY).catch(() => {});
}
// the little preview in the Look tab
function refreshPreviewVinyl(pv) {
  if (!pv || !pv.isConnected || !vinylOn()) return;
  let cv = pv.querySelector('.pvinyl');
  if (!cv) { cv = document.createElement('canvas'); cv.className = 'pvinyl'; pv.prepend(cv); }
  const r = pv.getBoundingClientRect();
  renderVinyl(cv, r.width, r.height, wellShapes(pv, pv.querySelectorAll('.ctl')), 0).catch(() => {});
}
