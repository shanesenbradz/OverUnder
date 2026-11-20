/* ============================================================
   Native video: with the native core the app draws the game in a GL view
   under the WebView, using the same shaders as the WebGL renderer. This keeps
   that view lined up with #screen and makes the page see-through there: the
   backgrounds that sit under the screen get a hole cut in them, while the
   controls, HUD, glass and menus stay on top as usual.
   ============================================================ */
const HOLED = ['#amb', '#body', '#stage', '#screenWrap'];
class NativeRenderer {
  constructor(canvas) {
    this.cv = canvas; this.n = NATIVE; this.hires = false; this._key = ''; this._pkey = ''; this._rect = ''; this.cssW = 256; this.cssH = 384;
    // the page's own WebGL renderer, only fed while a clip records (MediaRecorder films the canvas)
    this.page = new Renderer(canvas);
    document.documentElement.classList.add('nv');
    addEventListener('resize', () => this.sync());
    // The hole also lets taps through: one on the picture lands on #player instead of #screen,
    // so the stylus is picked up here too.
    const pl = $('#player'), mine = e => e.target === pl && document.documentElement.classList.contains('nv-on');
    pl.addEventListener('pointerdown', e => { if (mine(e) && Stylus.down(e)) { e.preventDefault(); pl.setPointerCapture?.(e.pointerId); } });
    pl.addEventListener('pointermove', e => { if (mine(e) && Stylus.move(e)) e.preventDefault(); });
    pl.addEventListener('pointerup', e => { if (mine(e)) Stylus.up(e); });
    pl.addEventListener('pointercancel', e => { if (mine(e)) Stylus.up(e); });
  }
  setSize(cssW, cssH) { this.cssW = cssW; this.cssH = cssH; this.page.setSize(cssW, cssH); this.sync(); }
  get recording() { return !!(typeof Emu !== 'undefined' && Emu.rec); }
  draw(frame, S) {
    if (!core.loaded) return;
    const key = S.shader;
    if (key !== this._key) {
      this._key = key;
      const def = SHADERS[S.shader] || SHADERS.sharp;
      const src = fragmentSource(S.shader).replace('precision mediump float;', '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n');
      this.n.setShader(src, def.filter === 'linear');
    }
    const pk = [S.blend ? 1 : 0, S.colorFix ? 1 : 0, S.brightness, S.saturation, S.contrast].join();
    if (pk !== this._pkey) { this._pkey = pk; this.n.setParams(S.blend ? 1 : 0, S.colorFix ? 1 : 0, +S.brightness, +S.saturation, +S.contrast); }
    const v = core.view;
    this.n.present(SCREEN_LAYOUT[v.layout] ?? 0, !!v.swap, v.gap | 0);
    if (this.recording) { this.page.hires = true; this.page.draw({ w: frame.w, h: frame.h, data: core.pixels(frame.w, frame.h) }, S); }
    if (!this._shown) this.sync();
  }
  // where the picture goes, in device pixels, and the hole in the page above it
  sync() {
    const on = typeof Emu !== 'undefined' && Emu.active && !$('#player').classList.contains('hidden');
    const root = document.documentElement;
    root.classList.toggle('nv-on', on);
    if (!on) {
      if (this._shown !== false) { this.n.setRect(0, 0, 1, 1, false); this._shown = false; this._rect = ''; }
      for (const sel of HOLED) { const el = $(sel); if (el) el.style.clipPath = ''; }
      return;
    }
    const r = this.cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (r.width < 2 || r.height < 2) return;
    const x = Math.round(r.left * d), y = Math.round(r.top * d), w = Math.round(r.right * d) - x, h = Math.round(r.bottom * d) - y;
    const key = [x, y, w, h].join();
    if (key !== this._rect || !this._shown) { this._rect = key; this.n.setRect(x, y, w, h, true); this._shown = true; }
    for (const sel of HOLED) {
      const el = $(sel); if (!el) continue;
      const e = el.getBoundingClientRect();
      if (!e.width || e.right <= r.left || e.left >= r.right || e.bottom <= r.top || e.top >= r.bottom) { el.style.clipPath = ''; continue; }
      const hx = r.left - e.left, hy = r.top - e.top, f = n => n.toFixed(2);
      // a huge outer box keeps shadows and anything drawn outside the element
      el.style.clipPath = `path(evenodd, "M-9999 -9999H9999V9999H-9999Z M${f(hx)} ${f(hy)}h${f(r.width)}v${f(r.height)}h${f(-r.width)}Z")`;
    }
  }
}
