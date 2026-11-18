"""End-to-end test: boots the homebrew test ROM (test/rom) in headless Chromium and checks
buttons, the stylus, the mic, cheats, RAM search, save states, rewind, in-game saves and the
screen layouts. Screenshots go to /tmp/underover-*.png.

  python3 test/rom/build.py && python3 tools/bundle.py && python3 test/e2e.py
"""
import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
import os
URL = os.environ.get('URL') or (ROOT / 'dist/Brads_Underover.html').as_uri()
ROM = ROOT / 'test/rom/bullpup_test.nds'
# the test ROM keeps its variables here (see test/rom/arm9.c)
FRAME, HEALTH, TOUCH, KEYS = 0x02100000, 0x02100004, 0x02100008, 0x0210000C
MIC = 0x027FF008
fails = []
def check(name, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + name, info)
    if not ok: fails.append(name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 420, 'height': 860}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pg = await ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
        await pg.goto(URL); await pg.wait_for_function('!document.getElementById("boot")', timeout=30000)
        await pg.screenshot(path='/tmp/underover-1-empty.png')
        async with pg.expect_file_chooser() as fc: await pg.click('#btnAdd2')
        await (await fc.value).set_files(str(ROM))
        await pg.wait_for_selector('.card')
        meta = await pg.evaluate('__underover.DB.all("meta").then(m => m[0])')
        check('ROM recognised as DS', meta['system'] == 'nds', meta['code'])
        await pg.screenshot(path='/tmp/underover-2-library.png')
        await pg.click('.card'); await pg.wait_for_timeout(2500)
        r32 = lambda a: pg.evaluate(f'__underover.core.r32({a})')
        f1 = await r32(FRAME); await pg.wait_for_timeout(1000); f2 = await r32(FRAME)
        check('game runs', f2 > f1 > 0, f'{f1} -> {f2}')
        fps = await pg.evaluate('__underover.Emu.fps')
        check('frames per second', fps > 20, f'{fps:.1f} (headless, software GL)')
        thr = await pg.evaluate('({t: __underover.core.threaded, iso: self.crossOriginIsolated})')
        print('core:', 'threaded' if thr['t'] else 'single-threaded', '(cross-origin isolated)' if thr['iso'] else '')
        if os.environ.get('EXPECT_MT'): check('threaded core running', thr['t'])
        await pg.screenshot(path='/tmp/underover-3-portrait.png')

        # A on the keyboard (X key) takes 7 health
        h0 = await r32(HEALTH)
        await pg.keyboard.down('KeyX'); await pg.wait_for_timeout(150); await pg.keyboard.up('KeyX'); await pg.wait_for_timeout(200)
        h1 = await r32(HEALTH)
        check('keyboard A', h1 == h0 - 7, f'{h0} -> {h1}')

        # touch X button on screen -> bit 10 in the key mask the ROM saw
        box = await pg.evaluate('(()=>{const r=document.querySelector(".k-x").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
        await pg.mouse.move(box['x'], box['y']); await pg.mouse.down(); await pg.wait_for_timeout(250)
        k = await r32(KEYS); await pg.mouse.up()
        check('touch X button', bool(k & (1 << 10)), hex(k))

        # stylus: tap the middle of the bottom screen (stacked layout)
        await pg.evaluate('(()=>{const {S,Emu}=__underover; S.dsLayout="stack"; S.dsSwap=false; Emu.applyView(); Touch.build(); Emu.layoutScreen();})()')
        await pg.wait_for_timeout(300)
        pt = await pg.evaluate('(()=>{const r=document.getElementById("screen").getBoundingClientRect();return {x:r.left+r.width*0.25,y:r.top+r.height*0.75,w:r.width,h:r.height}})()')
        await pg.mouse.move(pt['x'], pt['y']); await pg.mouse.down(); await pg.wait_for_timeout(250)
        t = await r32(TOUCH); await pg.mouse.up()
        tx, ty = t & 0xFF, (t >> 8) & 0xFF
        check('stylus on the bottom screen', abs(tx - 64) <= 3 and abs(ty - 96) <= 3 and (t >> 16) & 1, f'({tx},{ty}) expected (64,96)')

        # mic: the blow sample drives the ROM's mic meter
        await pg.evaluate('Mic.blow(true)'); await pg.wait_for_timeout(500)
        mic = await r32(MIC); await pg.evaluate('Mic.blow(false)')
        check('mic blow', mic > 300, str(mic))

        # Action Replay DS cheat: 32-bit write of 999 to health
        await pg.evaluate('(async()=>{const E=__underover.Emu; E.cheats=[{name:"hp",code:"02100004 000003E7",on:true}]; await E.saveCheats();})()')
        await pg.wait_for_timeout(300)
        check('Action Replay cheat', await r32(HEALTH) == 999)
        await pg.evaluate('(async()=>{const E=__underover.Emu; E.cheats=[{name:"raw",code:"02100004:0000012C",on:true}]; await E.saveCheats();})()')
        await pg.wait_for_timeout(300)
        check('raw cheat', await r32(HEALTH) == 300)
        await pg.evaluate('(async()=>{const E=__underover.Emu; E.cheats=[]; await E.saveCheats();})()')

        # RAM search: health drops by 7 when A is pressed
        await pg.evaluate('(()=>{const s=__underover.Emu.search; s.reset(32); s.start();})()')
        await pg.keyboard.down('KeyX'); await pg.wait_for_timeout(150); await pg.keyboard.up('KeyX'); await pg.wait_for_timeout(200)
        r = await pg.evaluate(f'(()=>{{const s=__underover.Emu.search; const n=s.filter("decby",7); return {{n, has:[...s.addrs].includes({HEALTH})}}}})()')
        check('RAM search', r['has'] and r['n'] < 50, json.dumps(r))

        # save state: save, press A, load
        await pg.evaluate('__underover.Emu.saveSlot(1)'); await pg.wait_for_timeout(600)
        s1 = await r32(HEALTH)
        await pg.keyboard.down('KeyX'); await pg.wait_for_timeout(150); await pg.keyboard.up('KeyX'); await pg.wait_for_timeout(200)
        await pg.evaluate('__underover.Emu.loadSlot(1)'); await pg.wait_for_timeout(400)
        s3 = await r32(HEALTH)
        st = await pg.evaluate('__underover.DB.get("states", __underover.Emu.game.id + ":1").then(r => r.data.length)')
        check('save state', s1 == s3, f'health {s1} -> {s3}, stored {st // 1024} KB gzipped')

        # rewind: hold R after pressing A twice
        await pg.wait_for_timeout(1500)
        before = await r32(HEALTH)
        for i in range(2):
            await pg.keyboard.down('KeyX'); await pg.wait_for_timeout(120); await pg.keyboard.up('KeyX'); await pg.wait_for_timeout(150)
        after = await r32(HEALTH)
        await pg.keyboard.down('KeyR'); await pg.wait_for_timeout(1500); await pg.keyboard.up('KeyR')
        back = await r32(HEALTH)
        rw = await pg.evaluate('({c:__underover.Emu.rw.count, kb:__underover.Emu.rw.bytes/1024|0})')
        check('rewind', after < before and back > after, f'{before} -> {after} -> rewound {back} {rw}')

        # in-game save: START writes health to the cart EEPROM; it must survive leaving and coming back
        await pg.keyboard.down('Enter'); await pg.wait_for_timeout(150); await pg.keyboard.up('Enter'); await pg.wait_for_timeout(400)
        saved = await r32(HEALTH)
        await pg.evaluate('__underover.Emu.persistSram()'); await pg.wait_for_timeout(200)
        sav = await pg.evaluate('__underover.DB.get("saves", __underover.Emu.game.id).then(s => s ? [s.length, s[0] | s[1] << 8] : null)')
        check('save memory written', sav and sav[1] == saved, str(sav))
        await pg.evaluate('(async()=>{ __underover.S.autoResume=false; await __underover.Emu.stop(); })()'); await pg.wait_for_timeout(400)
        await pg.click('.card'); await pg.wait_for_timeout(1500)
        check('save memory survives a restart', await r32(HEALTH) == saved, f'{saved}')
        await pg.evaluate('__underover.S.autoResume=true')

        # one screen at a time: top first, then SWAP shows the touch screen and taps work there
        await pg.evaluate('(()=>{const {S,Emu}=__underover; S.dsLayout="single"; S.dsSwap=false; Emu.applyView(); Touch.build(); Emu.layoutScreen();})()')
        await pg.wait_for_timeout(500)
        w1 = await pg.evaluate('__underover.core.video().h')
        await pg.screenshot(path='/tmp/underover-4-single-top.png')
        sw = await pg.evaluate('(()=>{const r=document.querySelector(".k-swap").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
        await pg.mouse.click(sw['x'], sw['y']); await pg.wait_for_timeout(500)
        sw2 = await pg.evaluate('__underover.S.dsSwap')
        pt = await pg.evaluate('(()=>{const r=document.getElementById("screen").getBoundingClientRect();return {x:r.left+r.width*0.5,y:r.top+r.height*0.5}})()')
        await pg.mouse.move(pt['x'], pt['y']); await pg.mouse.down(); await pg.wait_for_timeout(250)
        t = await r32(TOUCH); await pg.mouse.up()
        await pg.screenshot(path='/tmp/underover-5-single-bottom.png')
        check('single screen + swap + stylus', w1 == 192 and sw2 and abs((t & 0xFF) - 128) <= 3 and abs(((t >> 8) & 0xFF) - 96) <= 3, f'h={w1} swapped={sw2} touch=({t & 0xFF},{(t >> 8) & 0xFF})')

        # landscape: stacked in the middle, then side by side
        await pg.set_viewport_size({'width': 860, 'height': 420})
        await pg.evaluate('(()=>{const {S,Emu}=__underover; S.dsLayout="stack"; S.dsSwap=false; Emu.applyView(); Touch.build(); Emu.layoutScreen();})()')
        await pg.wait_for_timeout(500); await pg.screenshot(path='/tmp/underover-6-landscape.png')
        await pg.evaluate('(()=>{const {S,Emu}=__underover; S.dsLayout="side"; Emu.applyView(); Touch.build(); Emu.layoutScreen();})()')
        await pg.wait_for_timeout(500); await pg.screenshot(path='/tmp/underover-7-side.png')
        pt = await pg.evaluate('(()=>{const r=document.getElementById("screen").getBoundingClientRect();return {x:r.left+r.width*0.75,y:r.top+r.height*0.25}})()')
        await pg.mouse.move(pt['x'], pt['y']); await pg.mouse.down(); await pg.wait_for_timeout(250)
        t = await r32(TOUCH); await pg.mouse.up()
        check('side by side stylus', abs((t & 0xFF) - 128) <= 3 and abs(((t >> 8) & 0xFF) - 48) <= 3, f'({t & 0xFF},{(t >> 8) & 0xFF}) expected (128,48)')

        # menu opens and the search finds the screen settings
        await pg.set_viewport_size({'width': 420, 'height': 860})
        await pg.evaluate('(()=>{const {S,Emu}=__underover; S.dsLayout="stack"; Emu.applyView(); Touch.build(); Emu.layoutScreen(); Sheet.open("look");})()')
        await pg.wait_for_timeout(400); await pg.screenshot(path='/tmp/underover-8-menu.png')
        await pg.fill('#menuSearch', 'swap'); await pg.wait_for_timeout(600)
        hits = await pg.evaluate('document.querySelectorAll(".search-part .row:not([style*=none])").length')
        check('menu search', hits > 0, f'{hits} rows')
        await pg.screenshot(path='/tmp/underover-9-search.png')
        await pg.evaluate('Sheet.setQuery(""); Sheet.open("game")'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='/tmp/underover-10-game-menu.png')

        check('no page errors', not errs, '\n'.join(errs[:10]))
        try: await asyncio.wait_for(b.close(), 10)
        except Exception: pass
    print('\n' + ('ALL PASSED' if not fails else 'FAILED: ' + ', '.join(fails)))
    sys.exit(1 if fails else 0)
asyncio.run(main())
