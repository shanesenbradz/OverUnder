#!/usr/bin/env python3
"""Draws the web app icons (web/pwa/) and the Google Play listing art (play/) from web/brand/gun.svg."""
import pathlib, re
from PIL import Image, ImageDraw, ImageFont
ROOT = pathlib.Path(__file__).resolve().parent.parent
svg = (ROOT / 'web/brand/gun.svg').read_text()
W, H = map(int, re.search(r'viewBox="0 0 (\d+) (\d+)"', svg).groups())
gun = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(gun)
for x, y, w, h, c in re.findall(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="#(\w{6})"/>', svg):
    x, y, w, h = map(int, (x, y, w, h)); d.rectangle([x, y, x + w - 1, y + h - 1], fill=tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (255,))
ORANGE, GRAPHITE = (255, 90, 54, 255), (27, 28, 32, 255)

def tile(S, frac, bg, rounded=False):
    c = Image.new('RGBA', (S, S), bg if not rounded else (0, 0, 0, 0))
    if rounded:
        big = Image.new('RGBA', (S * 4, S * 4), (0, 0, 0, 0))
        ImageDraw.Draw(big).rounded_rectangle([0, 0, S * 4 - 1, S * 4 - 1], radius=S * 0.9, fill=bg)
        c = big.resize((S, S), Image.LANCZOS)
    k = max(1, int(S * frac / W)); g = gun.resize((W * k, H * k), Image.NEAREST)
    c.alpha_composite(g, ((S - g.width) // 2, (S - g.height) // 2)); return c

pwa = ROOT / 'web/pwa'; pwa.mkdir(exist_ok=True)
tile(192, 0.82, GRAPHITE, rounded=True).save(pwa / 'icon-192.png')
tile(512, 0.82, GRAPHITE, rounded=True).save(pwa / 'icon-512.png')
tile(512, 0.62, ORANGE).save(pwa / 'icon-maskable-512.png')      # safe zone is the middle 80%
tile(180, 0.70, ORANGE).convert('RGB').save(pwa / 'apple-touch-icon.png')

play = ROOT / 'play'; play.mkdir(exist_ok=True)
tile(512, 0.66, ORANGE).convert('RGB').save(play / 'icon-512.png')  # Play masks it itself; no transparency allowed
fg = Image.new('RGB', (1024, 500), (17, 17, 19)); fd = ImageDraw.Draw(fg)
for i in range(500):  # soft orange glow from the left
    a = max(0, 1 - i / 500); fd.line([(0, i), (1024, i)], fill=(17 + int(30 * a), 17 + int(8 * a), 19))
g = gun.resize((W * 11, H * 11), Image.NEAREST); fg.paste(g, (60, (500 - g.height) // 2), g)
def font(sz, bold=True):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        try: return ImageFont.truetype(f, sz)
        except OSError: pass
    return ImageFont.load_default()
fd.text((530, 184), "Brad's Underover", font=font(52), fill=(245, 245, 247))
fd.text((532, 262), "Nintendo DS emulator", font=font(30, False), fill=(255, 140, 110))
fd.text((532, 306), "melonDS accuracy, offline, no ads", font=font(26, False), fill=(170, 170, 178))
fg.save(play / 'feature-graphic-1024x500.png')
print('icons and Play art written')
