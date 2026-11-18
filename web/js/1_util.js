'use strict';
/* ============================================================
   Brad's Underover  -  utilities, storage, ROM helpers
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (n, w = 8) => (n >>> 0).toString(16).toUpperCase().padStart(w, '0');

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

function toast(msg, ms = 1900) {
  const t = h('div', { class: 'toast' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (window.CalzoneAndroid) { // inside the Android app: save straight to Downloads/Calzone
    blob.arrayBuffer().then(buf => {
      const where = window.CalzoneAndroid.save(name, blob.type || type, bytesToB64(new Uint8Array(buf)));
      toast(where ? 'Saved to ' + where : 'Could not save ' + name, 2600);
    });
    return;
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}

function pickFiles(accept, multiple = false) {
  return new Promise(res => {
    const i = $('#fileIn');
    i.value = ''; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res([...i.files]);
    i.click();
  });
}

const readBytes = f => f.arrayBuffer().then(b => new Uint8Array(b));

function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
function fmtTime(s) { s = Math.floor(s || 0); if (s < 60) return s ? s + 's' : 'new'; const m = Math.floor(s / 60); if (m < 60) return m + 'm'; return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; }
function fmtAgo(t) {
  if (!t) return 'never';
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + ' min ago';
  if (d < 86400) return Math.floor(d / 3600) + ' h ago'; return new Date(t).toLocaleDateString();
}

function b64ToBytes(s) {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(b) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return btoa(s);
}

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/* ---------------- IndexedDB ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('underover-ds', 1);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ['roms', 'meta', 'saves', 'states', 'cheats', 'kv']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  _tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode); let out;
      const r = fn(t.objectStore(store)); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  get(s, k) { return this._tx(s, 'readonly', st => st.get(k)); },
  put(s, k, v) { return this._tx(s, 'readwrite', st => st.put(v, k)); },
  del(s, k) { return this._tx(s, 'readwrite', st => st.delete(k)); },
  all(s) { return this._tx(s, 'readonly', st => st.getAll()); },
  keys(s) { return this._tx(s, 'readonly', st => st.getAllKeys()); },
  async delPrefix(s, p) { for (const k of await this.keys(s)) if (String(k).startsWith(p)) await this.del(s, k); },
};

/* ---------------- ROM detection ---------------- */
const ROM_EXT = ['.nds', '.dsi', '.srl', '.ids'];
// A DS cart header has the ARM9 and ARM7 load addresses at 0x28 and 0x38 and its own CRC16 at 0x15E
function detectSystem(b, name = '') {
  if (b.length >= 0x200) {
    const dv = new DataView(b.buffer, b.byteOffset, 0x200);
    const a9 = dv.getUint32(0x28, true), a7 = dv.getUint32(0x38, true);
    if ((a9 >>> 24) === 0x02 && ((a7 >>> 24) === 0x02 || (a7 >>> 24) === 0x03) && crc16(b.subarray(0, 0x15E)) === dv.getUint16(0x15E, true)) return b[0x12] === 3 ? 'dsi' : 'nds';
  }
  const n = name.toLowerCase();
  if (ROM_EXT.some(x => n.endsWith(x)) && b.length >= 0x200) return 'nds';
  return null;
}
function crc16(b) { let c = 0xFFFF; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xA001 : c >>> 1; } return c; }
function romHeaderTitle(b) {
  const txt = (s, e) => String.fromCharCode(...b.subarray(s, e)).replace(/[^\x20-\x7E]/g, '').trim();
  const out = { title: txt(0x00, 0x0C), code: txt(0x0C, 0x10), banner: '', icon: null };
  // the banner holds the game's real name and its 32x32 menu icon
  const off = new DataView(b.buffer, b.byteOffset).getUint32(0x68, true);
  if (off && off + 0x840 <= b.length) {
    try {
      const t = new TextDecoder('utf-16le').decode(b.subarray(off + 0x340, off + 0x440)).replace(/\0.*$/s, '').trim();
      if (t) out.banner = t.split('\n').map(s => s.trim()).filter(Boolean).join(' · ');
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const x = c.getContext('2d'), img = x.createImageData(32, 32);
      const pal = [...Array(16)].map((_, i) => { const v = b[off + 0x220 + i * 2] | b[off + 0x221 + i * 2] << 8; return [(v & 31) * 255 / 31, (v >> 5 & 31) * 255 / 31, (v >> 10 & 31) * 255 / 31]; });
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) for (let y = 0; y < 8; y++) for (let xx = 0; xx < 8; xx++) {
        const byte = b[off + 0x20 + (ty * 4 + tx) * 32 + y * 4 + (xx >> 1)], ci = xx & 1 ? byte >> 4 : byte & 15;
        const p = ((ty * 8 + y) * 32 + tx * 8 + xx) * 4, col = pal[ci];
        img.data[p] = col[0]; img.data[p + 1] = col[1]; img.data[p + 2] = col[2]; img.data[p + 3] = ci ? 255 : 0;
      }
      x.putImageData(img, 0, 0); out.icon = c.toDataURL('image/png');
    } catch (e) {}
  }
  return out;
}
function cleanName(fname) { return fname.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*\((?:U|E|J|USA|Europe|Japan)\)\s*/gi, ' ').replace(/\s*\[[^\]]*\]/g, '').trim(); }

/* ---------------- ZIP (store + deflate) ---------------- */
async function unzipFirst(bytes, exts) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid zip file');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl));
    entries.push({ method, csize, usize, off, name }); p += 46 + nl + xl + cl;
  }
  const e = entries.find(e => exts.some(x => e.name.toLowerCase().endsWith(x))) || entries.find(e => !e.name.endsWith('/'));
  if (!e) throw new Error('No ROM inside the zip');
  const lh = e.off, data0 = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const comp = bytes.subarray(data0, data0 + e.csize);
  if (e.method === 0) return { name: e.name.split('/').pop(), bytes: comp.slice() };
  if (e.method !== 8) throw new Error('Unsupported zip compression');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip. Extract the ROM first.');
  const ds = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return { name: e.name.split('/').pop(), bytes: new Uint8Array(await new Response(ds).arrayBuffer()) };
}
const isZip = b => b.length > 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;

/* ---------------- Soft patching: IPS / UPS / BPS ---------------- */
function applyPatch(rom, patch) {
  const tag = String.fromCharCode(...patch.subarray(0, 5));
  if (tag === 'PATCH') return applyIPS(rom, patch);
  if (tag.startsWith('UPS1')) return applyUPS(rom, patch);
  if (tag.startsWith('BPS1')) return applyBPS(rom, patch);
  throw new Error('Unknown patch format (IPS, UPS and BPS are supported)');
}
function applyIPS(rom, p) {
  let out = new Uint8Array(rom); let i = 5;
  const grow = n => { if (n > out.length) { const o = new Uint8Array(n); o.set(out); out = o; } };
  while (i + 3 <= p.length) {
    if (p[i] === 0x45 && p[i + 1] === 0x4F && p[i + 2] === 0x46) { i += 3; if (i + 3 <= p.length) { const t = p[i] << 16 | p[i + 1] << 8 | p[i + 2]; out = out.slice(0, t); } break; }
    const off = p[i] << 16 | p[i + 1] << 8 | p[i + 2]; i += 3;
    const size = p[i] << 8 | p[i + 1]; i += 2;
    if (size === 0) { const run = p[i] << 8 | p[i + 1], v = p[i + 2]; i += 3; grow(off + run); out.fill(v, off, off + run); }
    else { grow(off + size); out.set(p.subarray(i, i + size), off); i += size; }
  }
  return out;
}
function vuintReader(p, start) {
  let i = start;
  const read = () => { let data = 0, shift = 1; for (;;) { const x = p[i++]; data += (x & 0x7f) * shift; if (x & 0x80) break; shift *= 128; data += shift; } return data; };
  return { read, get pos() { return i; }, set pos(v) { i = v; } };
}
function applyUPS(rom, p) {
  const r = vuintReader(p, 4); const inSize = r.read(), outSize = r.read();
  const swapped = rom.length === outSize && rom.length !== inSize;
  const size = swapped ? inSize : outSize;
  const out = new Uint8Array(size); out.set(rom.subarray(0, Math.min(rom.length, size)));
  let pos = 0; const end = p.length - 12;
  while (r.pos < end) {
    pos += r.read();
    for (;;) { const x = p[r.pos]; r.pos = r.pos + 1; if (x === 0) { pos++; break; } if (pos < size) out[pos] ^= x; pos++; }
  }
  return out;
}
function applyBPS(src, p) {
  const r = vuintReader(p, 4); r.read(); const tsize = r.read(); const msize = r.read(); r.pos = r.pos + msize;
  const out = new Uint8Array(tsize); let o = 0, srel = 0, trel = 0; const end = p.length - 12;
  while (r.pos < end) {
    const data = r.read(); const cmd = data % 4; const len = Math.floor(data / 4) + 1;
    if (cmd === 0) { for (let k = 0; k < len; k++, o++) out[o] = src[o] || 0; }
    else if (cmd === 1) { for (let k = 0; k < len; k++) { out[o++] = p[r.pos]; r.pos = r.pos + 1; } }
    else if (cmd === 2) { const d = r.read(); srel += (d & 1 ? -1 : 1) * Math.floor(d / 2); for (let k = 0; k < len; k++) out[o++] = src[srel++] || 0; }
    else { const d = r.read(); trel += (d & 1 ? -1 : 1) * Math.floor(d / 2); for (let k = 0; k < len; k++) out[o++] = out[trel++]; }
  }
  return out;
}
