# Whimsical pixel weapons. Each sprite: rows of chars + palette. Outline added automatically.
import json
from PIL import Image
S = {
 'pistol': (['..........',
             'mmmmmmmmmm',
             'lllllllll.',
             'mmmmmmmmm.',
             'ddddmmmm..',
             '...dddd...',
             '...ddd.d..',
             '..ddd.....',
             '..ddd.....',
             '..ddd.....'], {'m':'#767c88','l':'#b3b9c4','d':'#3e434c'}),
 'revolver': (['..............',
               '.mmmmmmmmmmmmm',
               '.lllllllllll..',
               '.mmmmbbmmmmm..',
               '..mmmbbmm.....',
               '..wwwmd.d.....',
               '.wwww..dd.....',
               '.www..........',
               'www...........'], {'m':'#8a8f99','l':'#c9ced6','d':'#4a4f58','b':'#d9a441','w':'#8a5a33'}),
 'raygun': (['......rr........',
             '.....cccccc.....',
             '..ccccccccccmmll',
             'rcccbbbccccccmmll',
             '..ccccccccccmmll',
             '....cccc........',
             '....rrr.........',
             '....rrr.........',
             '...rrr..........'], {'c':'#7fd6c2','b':'#fff3c4','m':'#d6dce3','l':'#ff5b6e','r':'#e8584a'}),
 'soaker': (['....bbbb..........',
             '...bbbbbb.........',
             'oooooooooooooooyy.',
             'oooooooooooooooyyy',
             'oooooooooooooooyy.',
             '..ooo.bbbb........',
             '..ooo..bb.........',
             '..ooo.............',
             '..ooo.............'], {'o':'#ff8a3d','b':'#3c8dff','y':'#ffd23f'}),
 'sniper': (['........ssssssss............',
             '.........dd..dd.............',
             'wwwwwwmmmmmmmmmmmmmmmmmmmmmm',
             'wwwwwwmmmmmmmmmmdddddddddd..',
             'wwww..ddmm..................',
             'www....dd...................',
             '.......d....................'], {'w':'#7a5230','m':'#6d7380','d':'#3a3f47','s':'#2a2d33'}),
 'bubble': (['.....pppp...',
             'ppppppppppkk',
             'ppppwwppppkk',
             'ppppppppppkk',
             '..ppp.......',
             '..ppp.......',
             '..ppp.......'], {'p':'#ff8fc7','w':'#ffffff','k':'#7fd6ff'}),
}
out={}
for name,(rows,pal) in S.items():
    W=max(len(r) for r in rows)+2; H=len(rows)+2
    g=[['.']*W for _ in range(H)]
    for y,r in enumerate(rows):
        for x,c in enumerate(r): g[y+1][x+1]=c
    o=[row[:] for row in g]
    for y in range(H):
        for x in range(W):
            if g[y][x]=='.' and any(0<=x+dx<W and 0<=y+dy<H and g[y+dy][x+dx]!='.' for dx,dy in((1,0),(-1,0),(0,1),(0,-1))): o[y][x]='K'
    pal=dict(pal); pal['K']='#141518'
    rects=[]
    for y in range(H):
        x=0
        while x<W:
            c=o[y][x]
            if c=='.': x+=1; continue
            s=x
            while x<W and o[y][x]==c: x+=1
            rects.append(f'<rect x="{s}" y="{y}" width="{x-s}" height="1" fill="{pal[c]}"/>')
    out[name]=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" shape-rendering="crispEdges">'+''.join(rects)+'</svg>'
out['bullpup']=open('gun.svg').read()
json.dump(out,open('sprites.json','w'))
# preview sheet
import cairosvg, io
