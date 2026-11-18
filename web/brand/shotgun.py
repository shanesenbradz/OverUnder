#!/usr/bin/env python3
"""Draws Brad's Underover's mark: a pixel over/under shotgun (two stacked barrels,
break action, walnut stock). Writes web/brand/gun.svg (used everywhere in the app)
and the Android launcher icons in android/res/mipmap-*."""
import os, pathlib
from PIL import Image, ImageDraw
D = pathlib.Path(__file__).resolve().parent
ROOT = D.parent.parent
W, H = 48, 16
g = [['.'] * W for _ in range(H)]
def r(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if 0 <= x < W and 0 <= y < H: g[y][x] = c
# walnut stock: drops from the wrist to the butt, with a rubber pad
for x in range(1, 16):
    top = 4 + max(0, 11 - x) // 5
    bot = 9 + int(max(0, 12 - x) / 2.6)
    r(x, top, x, bot, 'w'); r(x, top, x, top, 'u'); r(x, bot, x, bot, 'v')
r(0, 6, 0, 13, 'p')
r(3, 8, 8, 8, 'v'); r(4, 10, 9, 10, 'v')           # grain
# receiver, engraved, with the top lever
r(15, 3, 21, 9, 'm'); r(15, 3, 21, 3, 'l'); r(15, 9, 21, 9, 'd'); r(21, 4, 21, 8, 'd')
r(17, 5, 17, 5, 'b'); r(19, 6, 19, 6, 'b'); r(18, 7, 18, 7, 'b'); r(16, 7, 16, 7, 'l')
r(14, 2, 16, 2, 'b')
# the two barrels, one over the other, with a vent rib and a bead sight
r(22, 3, 46, 3, 'l'); r(22, 4, 46, 4, 'm')       # top barrel
r(22, 5, 46, 5, 'd')                               # seam
r(22, 6, 46, 6, 'm'); r(22, 7, 46, 7, 'd')       # bottom barrel
r(22, 2, 46, 2, 'r'); r(45, 1, 45, 1, 'b')        # rib + bead
r(47, 3, 47, 7, 'd'); r(47, 4, 47, 4, 'k'); r(47, 6, 47, 6, 'k')  # muzzles
# walnut fore-end under the barrels
r(23, 8, 35, 9, 'w'); r(23, 8, 35, 8, 'u'); r(24, 9, 34, 9, 'v')
# trigger guard and gold trigger
r(15, 10, 20, 10, 'd'); r(15, 11, 15, 11, 'd'); r(20, 11, 20, 11, 'd'); r(16, 12, 20, 12, 'd'); r(17, 11, 17, 11, 'b')
pal = {'d': (62, 67, 76), 'm': (112, 119, 131), 'l': (182, 189, 200), 'r': (140, 147, 158), 'b': (226, 172, 66), 'k': (14, 15, 17),
       'w': (128, 72, 36), 'u': (176, 110, 58), 'v': (88, 48, 24), 'p': (40, 32, 30)}
o = [row[:] for row in g]
for y in range(H):
    for x in range(W):
        if g[y][x] == '.' and any(0 <= x + dx < W and 0 <= y + dy < H and g[y + dy][x + dx] != '.' for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            o[y][x] = 'k'
im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
for y in range(H):
    for x in range(W):
        if o[y][x] != '.': im.putpixel((x, y), pal[o[y][x]] + (255,))
rects = []
for y in range(H):
    x = 0
    while x < W:
        c = o[y][x]
        if c == '.': x += 1; continue
        s = x
        while x < W and o[y][x] == c: x += 1
        rects.append(f'<rect x="{s}" y="{y}" width="{x - s}" height="1" fill="#%02x%02x%02x"/>' % pal[c])
(D / 'gun.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" shape-rendering="crispEdges">' + ''.join(rects) + '</svg>')

def icon(S, frac, tile=True):
    c = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    if tile:
        big = Image.new('RGBA', (S * 4, S * 4), (0, 0, 0, 0))
        ImageDraw.Draw(big).rounded_rectangle([S * 0.24, S * 0.24, S * 3.76, S * 3.76], radius=S * 0.8, fill=(27, 28, 32, 255))
        c = big.resize((S, S), Image.LANCZOS)
    k = max(1, int(S * frac / W)); gi = im.resize((W * k, H * k), Image.NEAREST)
    c.alpha_composite(gi, ((S - gi.width) // 2, (S - gi.height) // 2)); return c
icon(512, 0.84).save(ROOT / 'docs/icon.png')
for d, m in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
    p = ROOT / f'android/res/mipmap-{d}'; os.makedirs(p, exist_ok=True)
    icon(int(48 * m), 0.86).save(p / 'ic_launcher.png'); icon(int(108 * m), 0.64, tile=False).save(p / 'ic_fg.png')
print('gun.svg and launcher icons written')
