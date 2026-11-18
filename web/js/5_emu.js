/* ============================================================
   Emulation controller
   ============================================================ */
let core, Audio_, renderer;
const Emu = {
  active: false, paused: false, userPaused: false, game: null, raf: 0, frameNo: 0,
  ffToggle: false, rewinding: false, acc: 0, last: 0, fpsN: 0, fpsT: 0, fps: 0,
  cheatOps: [], rw: null, undoLoad: null, undoSave: null, sramCrc: 0, playT: 0,

  async start(meta) {
    const rom = await DB.get('roms', meta.id);
    if (!rom) { toast('ROM data missing'); return; }
    Audio_.resume();
    core.setAudio(Audio_.ctx.sampleRate, S.interp, S.bitDepth);
    core.setUser({ name: S.nick, lang: S.lang, color: S.favColor, month: S.bMonth, day: S.bDay });
    const sram = await DB.get('saves', meta.id);
    if (!core.load(rom, sram)) { toast('That file did not boot. Is it a DS game?'); return; }
    this.applyView();
    this.game = meta; this.active = true; this.frameNo = 0; this.ffToggle = false; this.undoLoad = this.undoSave = null;
    this.rom = rom;
    this.sramCrc = sram ? crc32(sram) : 0; this._sramDirty = false;
    this.rw = S.rewind ? new Rewinder(core, S.rewindMB) : null;
    await this.loadCheats();
    if (S.autoResume) {
      const auto = await DB.get('states', meta.id + ':auto');
      if (auto && core.loadState(await unpackState(auto.data))) toast('Resumed where you left off');
    }
    meta.lastPlayed = Date.now(); await DB.put('meta', meta.id, meta);
    showView('player');
    $('#plateSN').textContent = 'SN ' + meta.crc;
    Touch.build(); this.layoutScreen();
    this.search = new RamSearch(core);
    this.paused = false; this.userPaused = false; this.acc = 0; this.last = 0; this.playT = performance.now(); this.skip = 0; this.costMs = this.costN = 0;
    Audio_.flush(); Audio_.apply(S);
    this.autoT = 0; this.autoLast = performance.now(); this._ledN = -1;
    this.timers = [setInterval(() => this.persistSram(), 2500), setInterval(() => this.autoTick(), 250)];
    this.requestWake(); Mic.sync();
    cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(t => this.tick(t));
    this.hud();
  },
  async stop() {
    if (!this.active) return;
    if (Link.state !== 'off') Link.cancel();
    this.stopRecording();
    cancelAnimationFrame(this.raf); this.timers?.forEach(clearInterval);
    await this.persistAll();
    this.active = false; core.unload(); this.game = null; this.rw = null; this.rom = null;
    Touch.clear(); Stylus.clear(); Mic.stop(); Audio_.flush(); this.releaseWake();
    showView('library'); Library.render();
  },
  async persistAll() {
    if (!this.active) return;
    await this.persistSram();
    await this.autoState();
    this.flushPlayTime();
    await DB.put('meta', this.game.id, this.game);
  },
  flushPlayTime() {
    const now = performance.now();
    if (!this.paused) this.game.playSec = (this.game.playSec || 0) + (now - this.playT) / 1000;
    this.playT = now;
  },
  async persistSram() {
    if (!this.active) return;
    // the core flags any write to the cart's save chip; only then is it worth reading back
    if (core.saveDirty) this._sramDirty = true;
    if (!this._sramDirty) return;
    this._sramDirty = false;
    const s = core.sram(); if (!s) return;
    const c = crc32(s); if (c === this.sramCrc) return;
    this.sramCrc = c; await DB.put('saves', this.game.id, s);
  },
  // auto snapshot clock: counts play time only, so the lights freeze while paused
  autoTick() {
    const now = performance.now(), dt = now - this.autoLast; this.autoLast = now;
    if (!this.active) return;
    if (!this.paused) this.autoT += dt;
    const per = Math.max(10, S.autoSaveSec) * 1000;
    if (this.autoT >= per) { this.autoT = 0; this.autoState(); this.saveLeds(true); return; }
    this.saveLeds();
  },
  saveLeds(fire) {
    const boxes = ['saveLeds', 'saveLedsL'].map(id => document.getElementById(id)).filter(Boolean); if (!boxes.length) return;
    const on = S.saveLights && S.autoResume;
    $('#player').classList.toggle('leds-on', on);
    boxes.forEach(b => b.classList.toggle('on', on)); if (!on) { this._ledN = -1; return; }
    if (fire) {
      this._ledN = 6; boxes.forEach(b => { b.classList.add('fire'); [...b.children].forEach(i => i.classList.add('lit')); });
      clearTimeout(this._fireT); this._fireT = setTimeout(() => { boxes.forEach(b => b.classList.remove('fire')); this._ledN = -1; this.saveLeds(); }, 650); return;
    }
    if (boxes[0].classList.contains('fire')) return;
    const n = Math.min(5, Math.floor(this.autoT / (Math.max(10, S.autoSaveSec) * 1000) * 6));
    if (n === this._ledN) return; this._ledN = n;
    boxes.forEach(b => [...b.children].forEach((i, k) => i.classList.toggle('lit', k < n)));
  },
  // covers and slot pictures show the first screen of the layout (usually the top one)
  thumb() {
    try {
      const f = core.video(), c = frameToCanvas(f), t = document.createElement('canvas'); t.width = 256; t.height = 192;
      t.getContext('2d').drawImage(c, 0, 0, 256, 192, 0, 0, 256, 192);
      return t.toDataURL('image/jpeg', 0.82);
    } catch (e) { return null; }
  },
  async autoState() {
    if (!this.active || !S.autoResume) return;
    const st = core.saveState(); if (!st) return;
    const t = this.thumb(), id = this.game.id;
    await DB.put('states', id + ':auto', { data: await packState(st), thumb: t, time: Date.now() });
    if (t) { this.game.thumb = t; }
  },

  /* ---------- main loop ---------- */
  speed() {
    if (Link.active) return 1; // both phones must run at real speed while linked
    if (this.rewinding) return 1;
    if (Input.holds.has('ff_hold') || this.ffToggle) return S.ffSpeed;
    return this.slow ? S.slowSpeed : 1;
  },
  tick(now) {
    this.raf = requestAnimationFrame(t => this.tick(t));
    if (!this.active) return;
    Input.pollPad();
    const dt = this.last ? Math.min(now - this.last, 100) : 16.7; this.last = now;
    if (this.paused) return;
    if (Link.active) Link.watchdog(now);
    const fps = core.fps, sp = this.speed();
    const rate = core.sampleRate || 32768;
    Audio_.setRate(rate, sp < 1 ? sp : 1);

    if (this.rewinding && this.rw && !Link.active) {
      let stepped = false;
      for (let i = 0; i < S.rewindRate; i++) { if (!this.rw.step()) break; stepped = true; }
      if (stepped) { core.setKeys(0); core.frame(); core.drainAudio(null); renderer.draw(core.video(), S); }
      this.countFps(now, stepped ? 1 : 0);
      return;
    }

    let frames = 0;
    const audioOk = Audio_.running && this.audioClock(now);
    if (sp === 1 && audioOk) {
      const deficit = Math.round(rate * (LITE ? 0.1 : 0.075)) - Audio_.buffered;
      frames = deficit > 0 ? Math.ceil(deficit / (rate / fps)) : 0;
      frames = Math.min(frames, 4); this.acc = 0;
    } else {
      this.acc += dt / 1000 * fps * sp;
      frames = Math.floor(this.acc); this.acc -= frames;
      frames = Math.min(frames, sp > 1 ? Math.ceil(sp) * 2 + 2 : 4);
      if (sp > 1 && Audio_.buffered > rate * 0.15) Audio_.flush();
    }
    if (frames <= 0) return;
    const chopEvery = sp > 1 ? Math.round(sp) : 1;
    let ran = 0, drew = false; const t0 = performance.now();
    // Only the last frame of a catch-up batch is ever seen, so the ones before it skip drawing.
    // Frame skip on top of that (Auto on slow phones) leaves out every 2nd, 3rd or 4th picture.
    // The DS renders 3D one frame ahead, so the 3D scene is only rendered for frames that get drawn.
    const draws = []; for (let i = 0; i < frames; i++) draws.push(i === frames - 1 && this.drawThisFrame());
    const nextDraw = this.peekDraw();
    for (let i = 0; i < frames; i++) {
      this.frameNo++;
      core.setKeys(this.inputMask());
      const draw = draws[i], next = i + 1 < frames ? draws[i + 1] : nextDraw;
      if (Link.active) {
        // the link can pause us mid-frame until the other phone answers; linkKick resumes it
        if (Link.runFrame() !== 1) { this.linkStalled = true; core.drainAudio((c, n) => Audio_.push(c, n)); break; }
        this.linkStalled = false;
      } else { core.frame(draw, next); if (draw) drew = true; }
      ran++;
      if (sp > 1 && (S.ffAudio === 'mute' || this.frameNo % chopEvery)) core.drainAudio(null);
      else core.drainAudio((c, n) => Audio_.push(c, n));
      if (this.rw && !Link.active && this.frameNo % S.rewindEvery === 0) this.rw.capture();
    }
    if (!ran) return;
    if (drew || Link.active) {
      renderer.draw(core.video(), S);
      if (S.ambient !== 'off' && (this._ambN = (this._ambN || 0) + 1) % 8 === 0) sampleAmbient();
    }
    this.costMs += performance.now() - t0; this.costN += ran;
    this.countFps(now, ran);
  },
  // frame skip: 0 draws every frame; Auto picks 0 to 3 from how long frames take on this phone
  skip: 0, _skipC: 0, costMs: 0, costN: 0,
  drawThisFrame() {
    const n = S.frameskip === 'auto' ? this.skip : +S.frameskip || 0;
    if (n <= 0 || this.speed() < 1 || Link.active) { this._skipC = 0; return true; }
    this._skipC = (this._skipC + 1) % (n + 1);
    return this._skipC === 0;
  },
  // would the next frame be drawn? (decides whether to render its 3D scene now)
  peekDraw() {
    const n = S.frameskip === 'auto' ? this.skip : +S.frameskip || 0;
    if (n <= 0 || this.speed() < 1 || Link.active) return true;
    return (this._skipC + 1) % (n + 1) === 0;
  },
  tuneSkip() {
    const per = this.costN ? this.costMs / this.costN : 0; this.costMs = this.costN = 0; this.frameMs = per;
    if (S.frameskip !== 'auto' || !per || this.speed() !== 1) return;
    // a frame has about 16.7 ms; leave room for the browser to show the picture and play sound
    if (per > 12.5 && this.skip < 3) this.skip++;
    else if (per < 7 && this.skip > 0) this.skip--;
  },
  // An answer from the other phone arrived: carry on with the frame straight away instead of
  // waiting for the next screen refresh, which keeps link-heavy screens (trades) moving.
  linkKick() {
    if (!this.active || !Link.active || !this.linkStalled || this.paused) return;
    if (Link.runFrame() === 1) {
      this.linkStalled = false;
      core.drainAudio((c, n) => Audio_.push(c, n));
      renderer.draw(core.video(), S);
    }
  },
  // The other phone is waiting on us and our game hasn't re-armed its port yet: run just
  // far enough for it to answer (at most a couple of frames), then leave the frame half done.
  linkService() {
    if (!this.active || !Link.active || this.paused) return;
    for (let i = 0; i < 3 && Link.rxPending; i++) {
      const r = Link.runFrame(true);
      if (r === 1) { this.linkStalled = false; core.drainAudio((c, n) => Audio_.push(c, n)); renderer.draw(core.video(), S); }
      else { this.linkStalled = true; if (r === 0) break; }
    }
  },
  audioClock(now) {
    const t = Audio_.ctx.currentTime;
    if (t !== this._at) { this._at = t; this._aw = now; return true; }
    return now - (this._aw || now) < 400;
  },
  inputMask() {
    let m = Input.mask;
    const phase = Math.floor(this.frameNo / S.turboRate) & 1;
    if (!phase) m |= Input.turbo;
    const latch = Input.turboLatch || 0;
    if (phase && latch) m &= ~((latch & 1 ? 1 : 0) | (latch & 2 ? 2 : 0));
    return m;
  },
  countFps(now, n) {
    this.fpsN += n;
    if (now - this.fpsT >= 1000) { this.fps = this.fpsN * 1000 / (now - this.fpsT); this.fpsN = 0; this.fpsT = now; this.tuneSkip(); this.hud(); }
  },
  hud() {
    const sp = this.speed();
    $('#hudSpeed').textContent = this.paused && this.userPaused ? 'PAUSED' : Link.active ? 'LINK' : this.rewinding ? '<< REWIND' : sp > 1 ? `>> ${sp}x` : sp < 1 ? `${sp}x` : '';
    const sk = S.frameskip === 'auto' ? this.skip : +S.frameskip || 0;
    $('#hudFps').textContent = S.showFps ? `${this.fps.toFixed(0)} fps${sk ? '  ·  skip ' + sk : ''}` : '';
    this.updateLed();
  },
  updateLed() {
    const st = this.rec ? 'rec' : !this.active || this.paused ? '' : this.rewinding ? 'rw' : this.speed() > 1 ? 'ff' : 'run';
    for (const id of ['plateLed', 'bezLed']) { const e = document.getElementById(id); if (e) e.className = 'led ' + st; }
  },
  onHoldChange() {
    const rw = Input.holds.has('rw_hold') && !!this.rw && !Link.active;
    if (rw !== this.rewinding) {
      this.rewinding = rw;
      if (!rw) { Audio_.flush(); this.acc = 0; }
      else if (this.rw && this.rw.count === 0) toast('Nothing to rewind yet');
    }
    if (!this.rewinding && !Input.holds.has('ff_hold') && !this.ffToggle) Audio_.flush();
    this.hud();
  },
  pause(on) {
    if (on === this.paused) return;
    this.paused = on;
    if (on) { this.flushPlayTime(); Audio_.suspend(); Touch.clear(); Input.holds.clear(); this.rewinding = false; }
    else { this.playT = performance.now(); this.last = 0; Audio_.flush(); Audio_.resume(); }
    this.hud();
  },
  hotkey(act) {
    if (!this.active) return;
    switch (act) {
      case 'ff_toggle': this.ffToggle = !this.ffToggle; Touch.syncToggles(); Audio_.flush(); this.hud(); break;
      case 'qs': this.saveSlot(S.slot); break;
      case 'ql': this.loadSlot(S.slot); break;
      case 'slot_next': S.slot = S.slot % 9 + 1; saveSettings(); toast('Slot ' + S.slot); break;
      case 'slot_prev': S.slot = (S.slot + 7) % 9 + 1; saveSettings(); toast('Slot ' + S.slot); break;
      case 'pause': this.userPaused = !this.paused; this.pause(!this.paused); break;
      case 'step': if (!this.paused) { this.userPaused = true; this.pause(true); } this.frameNo++; core.setKeys(this.inputMask()); core.frame(); core.drainAudio(null); renderer.draw(core.video(), S); break;
      case 'shot': this.screenshot(); break;
      case 'menu': Sheet.toggle(); break;
      case 'swap_screens': if (S.swapMode !== 'hold') this.swapScreens(); break;
      case 'layout_next': S.dsLayout = { stack: 'side', side: 'single', single: 'stack' }[S.dsLayout] || 'stack'; saveSettings(); this.applyView(); Touch.build(); this.layoutScreen(); toast({ stack: 'Screens stacked', side: 'Screens side by side', single: 'One screen at a time' }[S.dsLayout]); break;
      case 'lid': core.setLid(!core.lidClosed); toast(core.lidClosed ? 'Lid closed' : 'Lid open'); break;
    }
  },
  /* ---------- the two screens ---------- */
  applyView() {
    core.setView({ layout: S.dsLayout, swap: !!S.dsSwap !== !!this.peek, gap: S.dsLayout === 'single' ? 0 : Math.round(S.dsGap) });
  },
  // In one-screen mode this flips between the top and the touch screen; with both screens showing it swaps them round
  swapScreens(peek) {
    if (peek !== undefined) { this.peek = peek; }
    else { S.dsSwap = !S.dsSwap; saveSettings(); }
    this.applyView(); Stylus.clear();
    const fr = core.video(); if (fr.w !== this._fw || fr.h !== this._fh) this.layoutScreen(); else renderer.draw(fr, S);
    Touch.syncToggles();
  },
  // where the touch screen sits inside the picture, in picture pixels (null when it isn't showing)
  touchArea() {
    const v = core.view, gap = v.layout === 'single' ? 0 : v.gap | 0;
    if (v.layout === 'single') return v.swap ? { x: 0, y: 0 } : null;
    if (v.layout === 'side') return { x: v.swap ? 0 : 256 + gap, y: 0 };
    return { x: 0, y: v.swap ? 0 : 192 + gap };
  },
  layoutScreen() {
    const fr = core.loaded ? core.video() : { w: 256, h: 384 };
    this._fw = fr.w; this._fh = fr.h;
    const W = innerWidth, H = innerHeight, port = H > W;
    const ar = S.aspect === '4:3' ? 4 / 3 : fr.w / fr.h;
    const stage = $('#stage'), player = $('#player');
    const showCtl = Touch.visible(), device = port && showCtl;
    const bz = S.bezel ? 24 : 0, logo = device && S.shell ? 44 : 0;
    const availW = W - bz - (S.bezel ? 8 : 0);
    // stacked DS screens are tall, so in portrait they get more of the phone than a GBA picture did
    const share = fr.h > fr.w ? 0.58 : 0.47;
    const availH = (device ? Math.round(H * share) - logo : H) - bz;
    let cw, ch;
    if (S.aspect === 'stretch') { cw = availW; ch = availH; }
    else {
      cw = availW; ch = cw / ar; if (ch > availH) { ch = availH; cw = ch * ar; }
      if (S.integer) { const dpr = devicePixelRatio || 1; const k = Math.max(1, Math.floor(Math.min(cw * dpr / fr.w, ch * dpr / fr.h))); cw = k * fr.w / dpr; ch = k * fr.h / dpr; if (S.aspect === '4:3') cw = ch * 4 / 3; }
    }
    cw = Math.floor(cw); ch = Math.floor(ch);
    // in device mode the shell hugs the picture; otherwise the stage fills the screen
    const stageH = device ? ch + bz + logo + (S.shell ? 8 : 0) : H;
    stage.style.height = device ? `calc(${stageH}px + env(safe-area-inset-top,0px))` : H + 'px';
    stage.style.top = '0'; stage.style.paddingTop = device ? '' : '0';
    if (device && !S.shell) stage.style.paddingTop = 'env(safe-area-inset-top,0px)';
    player.classList.toggle('port', device);
    // in portrait the touch buttons live in the body under the screens, so the stylus has the screens to itself
    const ov = $('#overlay').style; ov.top = device ? `calc(${stageH}px + env(safe-area-inset-top,0px))` : '0';
    Touch.measure();
    player.style.setProperty('--stage-h', `calc(${stageH}px + env(safe-area-inset-top,0px))`);
    const body = $('#body'); body.classList.toggle('show', device); refreshVinyl();
    renderer.setSize(cw, ch);
    const cy = device ? (stageH - logo) / 2 : H / 2;
    const amb = $('#amb').style; amb.setProperty('--amb-y', (cy / H * 100).toFixed(1) + '%'); amb.setProperty('--amb-w', Math.min(140, cw / W * 100 * 0.85 + 20).toFixed(0) + '%'); amb.setProperty('--amb-h', Math.min(120, ch / H * 100 * 0.9 + 18).toFixed(0) + '%');
    if (core.loaded) renderer.draw(core.video(), S);
  },

  /* ---------- states ---------- */
  async saveSlot(n) {
    const st = core.saveState(); if (!st) return toast('Could not save state');
    const key = this.game.id + ':' + n, thumb = this.thumb();
    this.undoSave = { key, prev: await DB.get('states', key) };
    await DB.put('states', key, { data: await packState(st), thumb, time: Date.now() });
    toast('Saved to slot ' + n); Sheet.refreshIf('game');
  },
  async loadSlot(n) {
    if (Link.active) return toast('Disconnect the link cable before loading a state');
    const rec = await DB.get('states', this.game.id + ':' + n);
    if (!rec) return toast('Slot ' + n + ' is empty');
    this.undoLoad = core.saveState();
    if (!core.loadState(await unpackState(rec.data))) return toast('That state does not fit this game');
    this.afterStateJump(); toast('Loaded slot ' + n); Sheet.refreshIf('game');
  },
  afterStateJump() { this.rw?.reset(); Audio_.flush(); renderer.draw(core.video(), S); },
  async undoLoadState() { if (!this.undoLoad) return; const cur = core.saveState(); core.loadState(this.undoLoad); this.undoLoad = cur; this.afterStateJump(); toast('Load undone'); },
  async undoSaveState() {
    if (!this.undoSave) return; const { key, prev } = this.undoSave;
    if (prev) await DB.put('states', key, prev); else await DB.del('states', key);
    this.undoSave = null; toast('Save undone'); Sheet.refreshIf('game');
  },
  reset() { core.reset(); this.afterStateJump(); toast('Game reset'); },

  /* ---------- cheats ---------- */
  async loadCheats() {
    this.cheats = (await DB.get('cheats', this.game.id)) || [];
    this.compileCheats();
  },
  compileCheats() {
    const list = [];
    for (const c of this.cheats) { const r = parseCheat(c.code); c.errors = r.errors; c.detected = r.format; if (c.on && r.words.length) list.push(r.words); }
    core.setCheats(list);
  },
  async saveCheats() { this.compileCheats(); await DB.put('cheats', this.game.id, this.cheats.map(({ errors, detected, ...c }) => c)); },

  /* ---------- media ---------- */
  screenshot() {
    const c = frameToCanvas(core.video(), 3);
    c.toBlob(b => { download(`${safeName(this.game.name)}-${stamp()}.png`, b); toast('Screenshot saved'); }, 'image/png');
  },
  toggleRecording() {
    if (this.rec) return this.stopRecording();
    const cv = $('#screen');
    if (!cv.captureStream || typeof MediaRecorder === 'undefined') return toast('Recording is not supported here');
    const stream = new MediaStream([...cv.captureStream(60).getVideoTracks(), ...Audio_.recordStream().getAudioTracks()]);
    // MP4 (H.264 + AAC) first so clips go straight to WhatsApp and the gallery; older WebViews fall back to WebM
    // (only with AAC audio: WhatsApp turns down MP4s that carry Opus)
    const type = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    let rec; try { rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined); } catch (e) { rec = new MediaRecorder(stream); }
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => { const blob = new Blob(chunks, { type: rec.mimeType }); download(`${safeName(this.game?.name || 'clip')}-${stamp()}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`, blob); toast('Clip saved'); };
    renderer.hires = true; this.layoutScreen();
    rec.start(1000); this.rec = rec; $('#hudRec').classList.remove('hidden'); this.updateLed(); toast('Recording. Open the menu to stop.');
  },
  stopRecording() { if (!this.rec) return; this.rec.stop(); this.rec = null; renderer.hires = false; if (this.active) this.layoutScreen(); $('#hudRec').classList.add('hidden'); this.updateLed(); },
  async requestWake() { if (!S.wakeLock || !navigator.wakeLock) return; try { this.wake = await navigator.wakeLock.request('screen'); } catch (e) {} },
  releaseWake() { try { this.wake?.release(); } catch (e) {} this.wake = null; },
};
const safeName = s => (s || 'game').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

document.addEventListener('visibilitychange', () => {
  if (!Emu.active) return;
  if (document.hidden) { Emu.persistAll(); if (S.pauseHidden) { Emu._bgPaused = !Emu.paused; Emu.pause(true); } }
  else { if (Emu._bgPaused && $('#sheet').classList.contains('hidden')) Emu.pause(false); Emu._bgPaused = false; Emu.requestWake(); }
});
addEventListener('pagehide', () => { if (Emu.active) Emu.persistAll(); });
