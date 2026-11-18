#!/usr/bin/env python3
"""After building the APK, copies them into release/ and the GitHub Pages download page, and
writes docs/version.json, which the app reads to offer in-place updates.

  python3 tools/publish.py "First change" "Second change"   # release notes, one per argument
"""
import hashlib, json, os, pathlib, re, shutil, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = 'https://raw.githubusercontent.com/shanesenbradz/OverUnder/main/'
SITE = 'https://shanesenbradz.github.io/OverUnder/'

def ver(script, lite):
    s = (ROOT / 'tools/build_apk.sh').read_text()
    line = [l for l in s.splitlines() if 'VC=${VC:-' in l][0]
    return int(re.search(r'VC=\$\{VC:-(\d+)', line).group(1)), re.search(r'VN=\$\{VN:-([\d.]+)', line).group(1)

notes = sys.argv[1:]
dl = ROOT / 'docs/download'; dl.mkdir(parents=True, exist_ok=True)
info, page = {}, (ROOT / 'web/site/download.html').read_text()
for kind, lite, name in [('full', False, 'Brads_Underover')]:
    code, vn = ver('', lite)
    apk = ROOT / 'dist' / (name + '.apk')
    data = apk.read_bytes(); sha = hashlib.sha256(data).hexdigest()
    shutil.copy(apk, ROOT / 'release' / f'{name}_{vn}.apk')
    shutil.copy(ROOT / 'dist' / (name + '.html'), ROOT / 'release' / f'{name}_{vn}.html')
    shutil.copy(apk, dl / (name + '.apk'))
    info[kind] = {'version': vn, 'code': code, 'apk': RAW + f'release/{name}_{vn}.apk', 'page': SITE + 'download/',
                  'size': len(data), 'sha256': sha, 'notes': notes}
    key = 'FULL' if kind == 'full' else 'LITE'
    page = page.replace(f'__{key}_SHA__', sha).replace(f'__{key}_KB__', str(len(data) // 1024)).replace(f'__{key}__', vn)
(dl / 'index.html').write_text(page)
(ROOT / 'docs/version.json').write_text(json.dumps(info, indent=2) + '\n')
print(json.dumps({k: (v['version'], v['code'], v['sha256'][:12]) for k, v in info.items()}))
