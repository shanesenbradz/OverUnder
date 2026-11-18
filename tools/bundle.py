#!/usr/bin/env python3
"""Inline the web app, the melonDS core and the pixel sprites into dist/Brads_Underover.html,
and copy it into docs/ for GitHub Pages."""
import base64, glob, os, pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = os.environ.get('VN', '1.1')
W = ROOT / 'web'
shell = (W / 'shell.html').read_text()
css = (W / 'app.css').read_text()
js = '\n'.join(pathlib.Path(p).read_text() for p in sorted(glob.glob(str(W / 'js' / '*.js'))))
core_js = (ROOT / 'vendor/melonds/melonds.js').read_text()
wasm = base64.b64encode((ROOT / 'vendor/melonds/melonds.wasm').read_bytes()).decode()
# the threaded core: its JS and worker go in as strings, loaded from blobs when the page is cross-origin isolated
import json
mt_js = (ROOT / 'vendor/melonds/mt/melonds.js').read_text()
mt_worker = (ROOT / 'vendor/melonds/mt/melonds.worker.js').read_text()
mt_wasm = base64.b64encode((ROOT / 'vendor/melonds/mt/melonds.wasm').read_bytes()).decode()
mt_consts = 'const CORE_MT_JS=' + json.dumps(mt_js).replace('</', '<\\/') + ';const CORE_MT_WORKER=' + json.dumps(mt_worker).replace('</', '<\\/') + ';const WASM_MT_B64="' + mt_wasm + '";'
gun = (W / 'brand/gun.svg').read_text()
sprites = (W / 'brand/sprites.json').read_text()
assert '</script' not in js and '</script' not in core_js
out = (shell.replace('__SPRITES__', sprites).replace('__GUNJS__', gun).replace('__GUN__', gun)
       .replace('/*CSS*/', css).replace('/*CORE_JS*/', core_js).replace('__WASM__', wasm).replace('__VERSION__', VERSION).replace('__LITE__', 'false').replace('/*MT_CONSTS*/', mt_consts).replace('/*APP_JS*/', js))
dest = ROOT / 'dist/Brads_Underover.html'
dest.parent.mkdir(exist_ok=True)
dest.write_text(out)
print(dest, len(out) // 1024, 'KB')

# GitHub Pages copy
site = ROOT / 'docs'
site.mkdir(exist_ok=True)
(site / 'index.html').write_text(out)
shutil.copytree(W / 'pwa', site / 'pwa', dirs_exist_ok=True)
shutil.copy(W / 'site/manifest.webmanifest', site / 'manifest.webmanifest')
shutil.copy(W / 'site/privacy.html', site / 'privacy.html')
(site / '.nojekyll').write_text('')
(site / 'sw.js').write_text((W / 'site/sw.js').read_text().replace('__VERSION__', VERSION).replace('__LITE__', 'false'))
print(site / 'index.html', 'for GitHub Pages')
