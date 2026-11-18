/* ============================================================
   Audio: ring-buffer sink (AudioWorklet, ScriptProcessor fallback)
   followed by an effects chain:
   EQ -> speaker filter -> reverb (dry/wet) -> stereo width -> limiter -> volume
   ============================================================ */
const SINK_SRC = `
class CalzoneSink extends AudioWorkletProcessor {
  constructor(){ super(); this.cap=65536; this.buf=new Float32Array(this.cap*2); this.pos=0; this.w=0; this.ratio=1; this.last=0;
    this.port.onmessage=e=>{ const m=e.data;
      if(m.ratio!==undefined){ this.ratio=m.ratio; return; }
      if(m.flush){ this.pos=this.w=this.last=0; this.port.postMessage(0); return; }
      const s=m, n=s.length>>1;
      for(let i=0;i<n;i++){ if(this.w-this.pos>=this.cap-2) break; const j=(this.w%this.cap)*2; this.buf[j]=s[i*2]/32768; this.buf[j+1]=s[i*2+1]/32768; this.w++; } };
  }
  process(_, outs){ const L=outs[0][0], R=outs[0][1]||L, n=L.length;
    for(let i=0;i<n;i++){ if(this.pos+1<this.w){ const b=Math.floor(this.pos), f=this.pos-b, a=(b%this.cap)*2, c=((b+1)%this.cap)*2;
        L[i]=this.buf[a]+(this.buf[c]-this.buf[a])*f; R[i]=this.buf[a+1]+(this.buf[c+1]-this.buf[a+1])*f; this.pos+=this.ratio; }
      else { L[i]=0; R[i]=0; } }
    const used=Math.floor(this.pos); if(used-this.last>=512){ this.port.postMessage(used); this.last=used; }
    return true; }
}
registerProcessor('calzone-sink', CalzoneSink);`;

const REVERB_PRESETS = {
  off: { label: 'Off' },
  room: { label: 'Small room', decay: 0.7, pre: 0.008, bright: 0.55, wet: 0.22 },
  studio: { label: 'Studio', decay: 1.2, pre: 0.012, bright: 0.7, wet: 0.25 },
  hall: { label: 'Concert hall', decay: 2.6, pre: 0.025, bright: 0.5, wet: 0.3 },
  plate: { label: 'Plate', decay: 1.8, pre: 0.002, bright: 0.95, wet: 0.28 },
  cave: { label: 'Cave', decay: 4.2, pre: 0.04, bright: 0.35, wet: 0.38 },
  cathedral: { label: 'Cathedral', decay: 6.5, pre: 0.05, bright: 0.45, wet: 0.42 },
};

class AudioOut {
  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: LITE ? 'balanced' : 'interactive' }); this.lite = LITE;
    const c = this.ctx;
    this.enq = 0; this.used = 0; this.rate = 32768; this.speed = 1;
    try {
      try { const url = URL.createObjectURL(new Blob([SINK_SRC], { type: 'application/javascript' })); await c.audioWorklet.addModule(url); URL.revokeObjectURL(url); }
      catch (e1) { await c.audioWorklet.addModule('data:application/javascript;base64,' + btoa(SINK_SRC)); }
      this.sink = new AudioWorkletNode(c, 'calzone-sink', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      this.sink.port.onmessage = e => { this.used = e.data; };
      this.post = m => this.sink.port.postMessage(m, m.buffer ? [m.buffer] : undefined);
    } catch (e) {
      // ScriptProcessor fallback for WebViews without AudioWorklet
      const cap = 65536, buf = new Float32Array(cap * 2); let pos = 0, w = 0, ratio = 1;
      const sp = c.createScriptProcessor(1024, 0, 2);
      sp.onaudioprocess = ev => {
        const L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1);
        for (let i = 0; i < L.length; i++) {
          if (pos + 1 < w) { const b = Math.floor(pos), f = pos - b, a = (b % cap) * 2, d = ((b + 1) % cap) * 2; L[i] = buf[a] + (buf[d] - buf[a]) * f; R[i] = buf[a + 1] + (buf[d + 1] - buf[a + 1]) * f; pos += ratio; }
          else L[i] = R[i] = 0;
        }
        this.used = Math.floor(pos);
      };
      this.post = m => {
        if (m.ratio !== undefined) { ratio = m.ratio; return; }
        if (m.flush) { pos = w = 0; return; }
        const n = m.length >> 1;
        for (let i = 0; i < n; i++) { if (w - pos >= cap - 2) break; const j = (w % cap) * 2; buf[j] = m[i * 2] / 32768; buf[j + 1] = m[i * 2 + 1] / 32768; w++; }
      };
      this.sink = sp;
    }
    if (this.lite) {
      // Lite: straight to the speaker, no EQ, reverb, widener or limiter running on the audio thread
      this.master = c.createGain(); this.sink.connect(this.master).connect(c.destination); this.recDest = null; return;
    }
    // effects chain
    this.bass = c.createBiquadFilter(); this.bass.type = 'lowshelf'; this.bass.frequency.value = 180;
    this.mid = c.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1200; this.mid.Q.value = 0.8;
    this.treble = c.createBiquadFilter(); this.treble.type = 'highshelf'; this.treble.frequency.value = 4000;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.5;
    this.dry = c.createGain(); this.wet = c.createGain(); this.wet.gain.value = 0;
    this.conv = c.createConvolver();
    this.preGain = c.createGain();
    const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
    this.gLL = c.createGain(); this.gRR = c.createGain(); this.gLR = c.createGain(); this.gRL = c.createGain();
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -3; this.comp.knee.value = 6; this.comp.ratio.value = 12; this.comp.attack.value = 0.003; this.comp.release.value = 0.15;
    this.master = c.createGain();
    this.sink.connect(this.preGain).connect(this.bass).connect(this.mid).connect(this.treble).connect(this.lp);
    this.lp.connect(this.dry); this.lp.connect(this.conv).connect(this.wet);
    this.dry.connect(split); this.wet.connect(split);
    split.connect(this.gLL, 0); split.connect(this.gLR, 0); split.connect(this.gRR, 1); split.connect(this.gRL, 1);
    this.gLL.connect(merge, 0, 0); this.gRL.connect(merge, 0, 0); this.gRR.connect(merge, 0, 1); this.gLR.connect(merge, 0, 1);
    merge.connect(this.comp).connect(this.master).connect(c.destination);
    this.recDest = null;
  }
  get running() { return this.ctx.state === 'running'; }
  resume() { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  suspend() { this.ctx.suspend().catch(() => {}); }
  push(chunk, frames) { this.post(chunk); this.enq += frames; }
  flush() { this.post({ flush: true }); this.enq = 0; this.used = 0; }
  get buffered() { return this.enq - this.used; }
  setRate(rate, speed = 1) {
    if (rate === this.rate && speed === this.speed && this._sr === this.ctx.sampleRate) return;
    this.rate = rate; this.speed = speed; this._sr = this.ctx.sampleRate;
    this.post({ ratio: rate * speed / this.ctx.sampleRate });
  }
  apply(S) {
    const t = this.ctx.currentTime, set = (p, v) => p.setTargetAtTime(v, t, 0.02);
    set(this.master.gain, S.mute ? 0 : S.volume);
    if (this.lite) return;
    set(this.bass.gain, S.bass); set(this.mid.gain, S.mid); set(this.treble.gain, S.treble);
    set(this.lp.frequency, S.speaker ? 3800 : 20000);
    this.lp.Q.value = S.speaker ? 1.6 : 0.5;
    set(this.preGain.gain, S.speaker ? 1.25 : 1);
    const w = S.width, a = (1 + w) / 2, b = (1 - w) / 2;
    set(this.gLL.gain, a); set(this.gRR.gain, a); set(this.gLR.gain, b); set(this.gRL.gain, b);
    this.comp.threshold.value = S.limiter ? -3 : 0; this.comp.ratio.value = S.limiter ? 12 : 1;
    const p = REVERB_PRESETS[S.reverb] || REVERB_PRESETS.off;
    const key = S.reverb + ':' + S.reverbSize;
    if (S.reverb === 'off') { set(this.wet.gain, 0); set(this.dry.gain, 1); }
    else {
      if (this._irKey !== key) { this.conv.buffer = this.makeIR(p.decay * S.reverbSize, p.pre, p.bright); this._irKey = key; }
      const mix = clamp(S.reverbMix, 0, 1);
      set(this.wet.gain, mix * 1.6); set(this.dry.gain, 1 - mix * 0.55);
    }
  }
  makeIR(decay, pre, bright) {
    const sr = this.ctx.sampleRate, len = Math.max(1, Math.floor(sr * (decay + pre))), ir = this.ctx.createBuffer(2, len, sr);
    const preN = Math.floor(sr * pre);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch); let lpS = 0;
      const k = 1 - Math.pow(0.001, 1 / (sr * decay)); // -60 dB over decay
      let env = 1;
      for (let i = preN; i < len; i++) {
        const n = Math.random() * 2 - 1;
        const coeff = bright * 0.9 + 0.05 + (1 - bright) * 0.05 * (1 - env);
        lpS += (n - lpS) * coeff;
        d[i] = lpS * env;
        env *= (1 - k);
      }
      // a few early reflections
      for (let r = 0; r < 6; r++) { const at = preN + Math.floor(sr * (0.004 + Math.random() * 0.03 * (r + 1) / 3)); if (at < len) d[at] += (Math.random() > .5 ? 1 : -1) * (0.5 - r * 0.06); }
    }
    return ir;
  }
  recordStream() {
    if (!this.recDest) { this.recDest = this.ctx.createMediaStreamDestination(); this.master.connect(this.recDest); }
    return this.recDest.stream;
  }
}

/* ============================================================
   Video: WebGL renderer with shaders + 2D canvas fallback
   ============================================================ */
const SHADERS = {
  sharp: { label: 'Sharp pixels', filter: 'nearest', body: 'vec3 c = tex(uv);' },
  smooth: { label: 'Smooth', filter: 'linear', body: 'vec3 c = tex(uv);' },
  crisp: { label: 'Crisp bilinear', filter: 'linear', body: `
    vec2 texel = uv * uTex; vec2 sc = max(floor(uOut / uTex), vec2(1.0));
    vec2 fl = floor(texel); vec2 s = fract(texel); vec2 rr = 0.5 - 0.5 / sc;
    vec2 cd = s - 0.5; vec2 f = (cd - clamp(cd, -rr, rr)) * sc + 0.5;
    vec3 c = tex((fl + f) / uTex);` },
  lcd: { label: 'LCD grid', filter: 'nearest', body: `
    vec3 c = tex(uv); vec2 p = fract(uv * uTex); vec2 px = uTex / uOut;
    vec2 g = smoothstep(vec2(0.0), px * 1.5, p) * smoothstep(vec2(0.0), px * 1.5, 1.0 - p);
    c *= mix(0.55, 1.0, g.x * g.y); c = c * 1.12;` },
  subpixel: { label: 'LCD subpixels', filter: 'nearest', body: `
    vec3 s = tex(uv); vec2 p = fract(uv * uTex);
    vec3 m = vec3(smoothstep(0.0,0.15,p.x)*smoothstep(0.38,0.28,p.x), smoothstep(0.30,0.40,p.x)*smoothstep(0.70,0.60,p.x), smoothstep(0.62,0.72,p.x)*smoothstep(1.0,0.88,p.x));
    float row = smoothstep(0.0,0.12,p.y)*smoothstep(1.0,0.88,p.y);
    vec3 c = s * (0.35 + 1.25 * m) * mix(0.6, 1.0, row);` },
  scan: { label: 'Scanlines', filter: 'nearest', body: `
    vec3 c = tex(uv); float y = fract(uv.y * uTex.y);
    c *= 0.62 + 0.48 * smoothstep(0.0, 0.5, y) * smoothstep(1.0, 0.5, y);` },
  crt: { label: 'CRT', filter: 'linear', body: `
    vec2 q = uv * 2.0 - 1.0; q *= 1.0 + 0.045 * dot(q.yx, q.yx); vec2 u2 = q * 0.5 + 0.5;
    if (u2.x < 0.0 || u2.x > 1.0 || u2.y < 0.0 || u2.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec2 tx = u2 * uTex; vec2 pc = (floor(tx) + 0.5) / uTex;
    vec3 c = mix(tex(vec2(u2.x, pc.y)), tex(u2), 0.35);
    float d = fract(tx.y) - 0.5; c *= exp(-d * d * 7.0) * 1.35;
    float mx = mod(gl_FragCoord.x, 3.0); vec3 mask = vec3(mx < 1.0 ? 1.0 : 0.75, (mx >= 1.0 && mx < 2.0) ? 1.0 : 0.75, mx >= 2.0 ? 1.0 : 0.75);
    c *= mask; c += 0.06 * tex(u2 + vec2(1.5, 0.0) / uTex) + 0.06 * tex(u2 - vec2(1.5, 0.0) / uTex);
    c *= 1.0 - 0.35 * dot(q, q) * 0.5;` },
  dmg: { label: 'Pea soup (DMG)', filter: 'nearest', body: `
    vec3 s = tex(uv); float l = dot(s, vec3(0.299, 0.587, 0.114));
    vec3 c = l < 0.25 ? vec3(0.06,0.22,0.06) : l < 0.5 ? vec3(0.19,0.38,0.19) : l < 0.75 ? vec3(0.55,0.67,0.06) : vec3(0.61,0.74,0.06);
    vec2 p = fract(uv * uTex); vec2 px = uTex / uOut; vec2 g = smoothstep(vec2(0.0), px, p) * smoothstep(vec2(0.0), px, 1.0 - p); c *= mix(0.8, 1.0, g.x * g.y);` },
};

// Sharp and Smooth draw the picture at the game's own size (240x160) and let the phone's
// compositor (the GPU) scale it up to the screen, with image-rendering choosing nearest or
// bilinear. The colour work then runs on 38 thousand pixels a frame instead of up to two
// million. Shaders that need the full screen size (LCD grid, CRT...) render at screen size,
// capped at 3x the game size in Lite. Recording a clip switches to full size so clips stay sharp.
const NATIVE_SHADERS = new Set(['sharp', 'smooth']);
class Renderer {
  constructor(canvas) {
    this.cv = canvas; this.w = 0; this.h = 0; this.cssW = 240; this.cssH = 160; this.hires = false;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.gl = gl;
    if (!gl) { this.ctx2d = canvas.getContext('2d', { alpha: false }); return; }
    const vs = `attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`;
    this.vs = this._sh(gl.VERTEX_SHADER, vs);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.DITHER);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.texA = gl.createTexture(); this.texB = gl.createTexture(); this._filt = -1; this._cur = null;
    this.progs = {};
  }
  _sh(type, src) { const gl = this.gl, s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  _prog(name) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl, def = SHADERS[name] || SHADERS.sharp;
    const fs = `precision mediump float; varying vec2 uv; uniform sampler2D uCur, uPrev; uniform vec2 uTex, uOut; uniform float uBlend, uCC, uBright, uSat, uContrast;
      vec3 raw(vec2 u){ vec3 a = texture2D(uCur, u).rgb; if (uBlend < 0.5) return a; vec3 b = texture2D(uPrev, u).rgb; return mix(a, b, 0.5); }
      vec3 tex(vec2 u){ vec3 c = raw(u);
        if (uCC > 0.5) { vec3 l = pow(c, vec3(2.2)); l = mat3(0.80,0.135,0.195, 0.275,0.64,0.155, -0.075,0.225,0.65) * l; c = pow(max(l * 0.94, 0.0), vec3(1.0/2.2)); }
        return c; }
      void main(){ ${def.body}
        float lum = dot(c, vec3(0.299,0.587,0.114)); c = mix(vec3(lum), c, uSat); c = (c - 0.5) * uContrast + 0.5; c *= uBright;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }`;
    const p = gl.createProgram(); gl.attachShader(p, this.vs); gl.attachShader(p, this._sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    const u = n => gl.getUniformLocation(p, n);
    const o = { p, loc: gl.getAttribLocation(p, 'p'), cur: u('uCur'), prev: u('uPrev'), tex: u('uTex'), out: u('uOut'), blend: u('uBlend'), cc: u('uCC'), bright: u('uBright'), sat: u('uSat'), con: u('uContrast'), filter: def.filter };
    this.progs[name] = o; return o;
  }
  setSize(cssW, cssH) {
    this.cssW = cssW; this.cssH = cssH;
    this.cv.style.width = cssW + 'px'; this.cv.style.height = cssH + 'px';
    this._sizeKey = '';
  }
  // backing-store size for this shader and frame
  _fit(S, w, h) {
    const native = NATIVE_SHADERS.has(S.shader) && !this.hires;
    const key = [native, S.shader, w, h, this.cssW, this.cssH].join();
    if (key === this._sizeKey) return;
    this._sizeKey = key;
    let bw, bh;
    if (native) { bw = w; bh = h; }
    else {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      bw = Math.round(this.cssW * dpr); bh = Math.round(this.cssH * dpr);
      if (LITE) { const k = Math.min(1, w * 3 / bw); bw = Math.round(bw * k); bh = Math.round(bh * k); }
    }
    if (this.cv.width !== bw) this.cv.width = bw;
    if (this.cv.height !== bh) this.cv.height = bh;
    // the GPU does the upscale: nearest for Sharp, bilinear for Smooth
    this.cv.style.imageRendering = native && S.shader === 'sharp' ? 'pixelated' : 'auto';
  }
  draw(frame, S) {
    const { w, h, data } = frame;
    if (!this.gl) {
      if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; this.img = this.ctx2d.createImageData(w, h); }
      this.img.data.set(data); this.ctx2d.putImageData(this.img, 0, 0);
      this.cv.style.imageRendering = S.shader === 'smooth' ? 'auto' : 'pixelated';
      return;
    }
    const gl = this.gl;
    this._fit(S, w, h);
    const pr = this._prog(S.shader);
    const filt = pr.filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    // the previous frame is only kept (in texB) when frame blending needs it
    if (S.blend) { const t = this.texA; this.texA = this.texB; this.texB = t; }
    if (w !== this.w || h !== this.h) {
      for (const tx of [this.texA, this.texB]) { gl.bindTexture(gl.TEXTURE_2D, tx); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); }
      this.w = w; this.h = h; this._filt = -1;
    }
    if (filt !== this._filt) {
      for (const tx of [this.texA, this.texB]) {
        gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      this._filt = filt;
    }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    if (this._cur !== pr) {
      gl.useProgram(pr.p); this._cur = pr;
      gl.enableVertexAttribArray(pr.loc); gl.vertexAttribPointer(pr.loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(pr.cur, 0); gl.uniform1i(pr.prev, 1);
    }
    gl.uniform2f(pr.tex, w, h); gl.uniform2f(pr.out, this.cv.width, this.cv.height);
    gl.uniform1f(pr.blend, S.blend ? 1 : 0); gl.uniform1f(pr.cc, S.colorFix ? 1 : 0);
    gl.uniform1f(pr.bright, S.brightness); gl.uniform1f(pr.sat, S.saturation); gl.uniform1f(pr.con, S.contrast);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function frameToCanvas(frame, scale = 1) {
  const c = document.createElement('canvas'); c.width = frame.w; c.height = frame.h;
  const x = c.getContext('2d'); const img = x.createImageData(frame.w, frame.h); img.data.set(frame.data); x.putImageData(img, 0, 0);
  if (scale === 1) return c;
  const c2 = document.createElement('canvas'); c2.width = frame.w * scale; c2.height = frame.h * scale;
  const x2 = c2.getContext('2d'); x2.imageSmoothingEnabled = false; x2.drawImage(c, 0, 0, c2.width, c2.height); return c2;
}
