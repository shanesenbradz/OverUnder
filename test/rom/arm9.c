/* Brad's Bullpup DS test ROM, ARM9 side.
   Top screen: a ring of spinning 3D triangles, enough of them to load the 3D renderer.
   Bottom screen: a box per button, a health bar, a mic meter and a crosshair at the stylus.
   Fixed RAM spots the end-to-end test reads and cheats on:
     0x02100000 frame counter   0x02100004 health (A takes 7, START saves it to EEPROM)
     0x02100008 last touch      0x0210000C keys   0x02100010 triangle count */
#include "sintab.h"
typedef unsigned int u32; typedef unsigned short u16; typedef unsigned char u8; typedef int s32;
#define R16(a) (*(volatile u16 *)(a))
#define R32(a) (*(volatile u32 *)(a))
#define SHARED ((volatile u32 *)0x027FF000)
#define VARS ((volatile u32 *)0x02100000)
#define FB ((volatile u16 *)0x06200000)
#define RGB(r, g, b) ((r) | (g) << 5 | (b) << 10 | 0x8000)

static u8 aux(u8 v, int hold)
{
    R16(0x040001A0) = 0xA000 | (hold ? 0x40 : 0);
    R16(0x040001A2) = v;
    while (R16(0x040001A0) & 0x80);
    return (u8)R16(0x040001A2);
}
static void eeprom_wait(void) { for (;;) { aux(0x05, 1); if (!(aux(0, 0) & 1)) break; } }
static u32 eeprom_read32(void)
{
    aux(0x03, 1); aux(0, 1); aux(0, 1);
    u32 v = aux(0, 1); v |= aux(0, 1) << 8; v |= aux(0, 1) << 16; v |= (u32)aux(0, 0) << 24;
    return v;
}
static void eeprom_write32(u32 v)
{
    aux(0x06, 0);
    aux(0x02, 1); aux(0, 1); aux(0, 1);
    aux(v, 1); aux(v >> 8, 1); aux(v >> 16, 1); aux(v >> 24, 0);
    eeprom_wait();
}

static void rect(int x, int y, int w, int h, u16 c)
{
    for (int j = y; j < y + h; j++) { if (j < 0 || j > 191) continue; for (int i = x; i < x + w; i++) if (i >= 0 && i < 256) FB[j * 256 + i] = c; }
}

static void wait_vblank(void) { while (R16(0x04000006) >= 192) {} while (R16(0x04000006) < 192) {} }

int main(void)
{
    R16(0x04000204) &= ~0x0800;                  /* EXMEMCNT: slot 1 to the ARM9 */
    R32(0x04000304) = 0x820F;                    /* POWCNT1: LCDs, 2D A+B, 3D; engine A on top */
    R16(0x04000242) = 0x84;                      /* VRAM C -> engine B background */
    R32(0x04001000) = 0x10805;                   /* engine B: mode 5, BG3, normal display */
    R16(0x0400100E) = 0x4084;                    /* BG3: 256x256 direct colour bitmap */
    R16(0x04001030) = 0x100; R16(0x04001032) = 0; R16(0x04001034) = 0; R16(0x04001036) = 0x100;
    R32(0x04001038) = 0; R32(0x0400103C) = 0;
    R32(0x04000000) = 0x10108;                   /* engine A: BG0 is the 3D layer */
    R16(0x04000008) = 0;
    R16(0x04000060) = 0;                         /* DISP3DCNT */
    R32(0x04000350) = 0x001F0000 | RGB(2, 3, 8); /* clear colour, opaque */
    R16(0x04000354) = 0x7FFF;
    R32(0x04000580) = 0 | (0 << 8) | (255 << 16) | (191u << 24);

    u32 saved = eeprom_read32();
    VARS[1] = (saved > 0 && saved <= 1000) ? saved : 100;
    VARS[4] = 600;
    u32 prev = 0x3FF, t = 0, lastTouch = 0; int built = 0;
    static u8 base[2048]; static short rad[2048];
    rect(0, 0, 256, 192, RGB(4, 4, 6));

    for (;;)
    {
        u32 keys = (~R16(0x04000130) & 0x3FF) | ((~SHARED[1] & 3) << 10);
        u32 pressed = keys & ~prev; prev = keys;
        VARS[3] = keys;
        if (pressed & 1) VARS[1] = VARS[1] > 7 ? VARS[1] - 7 : 1;
        if (pressed & 8) eeprom_write32(VARS[1]);
        SHARED[3] = (keys & 2) ? 1 : 0;          /* B beeps */

        /* 3D: a spinning ring of triangles */
        R32(0x04000440) = 0; R32(0x04000454) = 0;
        R32(0x04000440) = 2; R32(0x04000454) = 0;
        R32(0x040004A4) = (31 << 16) | (3 << 6);
        R32(0x04000500) = 0;
        int n = VARS[4]; if (n > 2000) n = 2000;
        if (built != n) { for (int i = 0; i < n; i++) { base[i] = i * 256 / n; rad[i] = 1200 + (i * 37 % 2600); } built = n; }
        for (int i = 0; i < n; i++)
        {
            int a = (base[i] + t) & 255, b = (a + 3) & 255, r = rad[i];
            int cx = (SIN[(a + 64) & 255] * r) >> 12, cy = (SIN[a] * r) >> 12;
            int dx = (SIN[(b + 64) & 255] * 500) >> 12, dy = (SIN[b] * 500) >> 12;
            R32(0x04000480) = RGB((i * 3) & 31, (i * 7 + t) & 31, 31 - (i & 15));
            R32(0x0400048C) = (u16)(cx) | (u32)(u16)(cy) << 16; R32(0x0400048C) = (u16)(i & 1023);
            R32(0x0400048C) = (u16)(cx + dx) | (u32)(u16)(cy + dy) << 16; R32(0x0400048C) = (u16)(i & 1023);
            R32(0x0400048C) = (u16)(cx - dy) | (u32)(u16)(cy + dx) << 16; R32(0x0400048C) = (u16)(i & 1023);
        }
        R32(0x04000504) = 0;
        R32(0x04000540) = 0;

        /* bottom screen */
        u32 touch = SHARED[0];
        for (int k = 0; k < 12; k++) rect(8 + k * 20, 8, 16, 16, (keys >> k) & 1 ? RGB(31, 26, 0) : RGB(10, 10, 12));
        rect(8, 40, 240, 10, RGB(4, 4, 6)); rect(8, 40, (int)(VARS[1] * 240 / 1000) + 1, 10, RGB(0, 28, 6));
        u32 mic = SHARED[2]; rect(8, 60, 240, 6, RGB(4, 4, 6)); rect(8, 60, (int)(mic > 2000 ? 240 : mic * 240 / 2000), 6, RGB(28, 6, 26));
        if (lastTouch) { int x = lastTouch & 0xFF, y = (lastTouch >> 8) & 0xFF; rect(x - 6, y, 13, 1, RGB(4, 4, 6)); rect(x, y - 6, 1, 13, RGB(4, 4, 6)); lastTouch = 0; }
        if (touch & 0x10000)
        {
            lastTouch = touch;
            int x = touch & 0xFF, y = (touch >> 8) & 0xFF;
            VARS[2] = touch;
            rect(x - 6, y, 13, 1, RGB(31, 31, 31)); rect(x, y - 6, 1, 13, RGB(31, 31, 31));
        }
        VARS[0]++;
        t++;
        wait_vblank();
    }
}
