// node test/bench.mjs [rom] [frames]: boots a ROM in the wasm core, times frames with and
// without frame skip, and checks touch, keys, states, rewind and the save memory
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
const root = path.dirname(new URL(import.meta.url).pathname) + '/..';
const create = require(root + '/vendor/melonds/melonds.js');
const m = await create({ wasmBinary: fs.readFileSync(root + '/vendor/melonds/melonds.wasm'), printErr: t => process.stderr.write(t + '\n') });
const rom = fs.readFileSync(process.argv[2] || root + '/test/rom/bullpup_test.nds');
const N = +process.argv[3] || 300;
m._nds_set_log_level(4);
m._nds_set_audio(48000, 0, 0);
const p = m._malloc(rom.length); m.HEAPU8.set(rom, p);
if (!m._nds_load(p, rom.length, 0, 0, 1)) throw new Error('load failed');
const ab = m._malloc(4096 * 4);
const drain = () => { let n, t = 0; do { n = m._nds_read_audio(ab, 4096); t += n; } while (n === 4096); return t; };
const vars = () => { const dv = new DataView(m.HEAPU8.buffer, m._nds_mainram() + 0x100000, 32); return [0, 1, 2, 3, 4].map(i => dv.getUint32(i * 4, true)); };
function run(label, draw2d, r3d) {
  const t = performance.now();
  for (let i = 0; i < N; i++) { m._nds_run_frame(draw2d(i), r3d(i)); drain(); }
  const ms = (performance.now() - t) / N;
  console.log(`${label.padEnd(22)} ${ms.toFixed(2)} ms/frame  ${(1000 / ms / 59.83 * 100).toFixed(0)}% speed`);
}
run('warmup', () => 1, () => 1);
run('every frame', () => 1, () => 1);
run('draw 1 in 2', i => i & 1, i => !(i & 1) ? 1 : 0);
run('nothing drawn', () => 0, () => 0);
let t = performance.now(); for (let i = 0; i < 30; i++) m._nds_compose(0, 0, 0); console.log('compose', ((performance.now() - t) / 30).toFixed(3), 'ms');
// input
m._nds_set_keys(1); m._nds_run_frame(1, 1); m._nds_run_frame(1, 1); m._nds_run_frame(1, 1); m._nds_set_keys(0);
const h0 = vars()[1];
m._nds_touch(200, 150, 1); for (let i = 0; i < 4; i++) m._nds_run_frame(1, 1);
const tv = vars()[2]; console.log('health', h0, 'touch', tv & 0xFF, (tv >> 8) & 0xFF, 'pen', tv >> 16);
m._nds_touch(0, 0, 0);
// states
t = performance.now(); const len = m._nds_state_save(); console.log('state', (len / 1048576).toFixed(2), 'MB in', (performance.now() - t).toFixed(1), 'ms');
const st = m.HEAPU8.slice(m._nds_state_ptr(), m._nds_state_ptr() + len);
const f0 = vars()[0]; for (let i = 0; i < 30; i++) m._nds_run_frame(1, 1);
const sp = m._malloc(len); m.HEAPU8.set(st, sp); console.log('load state', m._nds_state_load(sp, len), 'frame', vars()[0], '==', f0);
// rewind
m._nds_rewind_reset(64); t = performance.now();
for (let i = 0; i < 60; i++) { m._nds_run_frame(1, 1); drain(); if (i % 2 === 0) m._nds_rewind_capture(); }
console.log('rewind: 60 frames with capture every 2:', ((performance.now() - t) / 60).toFixed(2), 'ms/frame;', m._nds_rewind_count(), 'deltas', (m._nds_rewind_bytes() / 1024).toFixed(0), 'KB');
const fa = vars()[0]; let ok = 0; for (let i = 0; i < 10; i++) ok += m._nds_rewind_step(); console.log('steps ok', ok); console.log('rewound frame counter', fa, '->', vars()[0]);
console.log('save memory', m._nds_save_len(), 'bytes');
const wh = m._nds_compose(0, 0, 0), w = wh >>> 16, h = wh & 0xFFFF, fp = m._nds_frame_ptr();
fs.writeFileSync('/tmp/ds.rgba', m.HEAPU8.subarray(fp, fp + w * h * 4));
