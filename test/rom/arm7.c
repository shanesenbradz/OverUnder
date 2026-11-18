/* Brad's Bullpup DS test ROM, ARM7 side.
   Reads the touch screen, the mic and the X/Y/pen/lid keys over SPI and hands them to
   the ARM9 through shared main RAM. Plays a square wave while the ARM9 asks for it. */
typedef unsigned int u32; typedef unsigned short u16; typedef unsigned char u8;
#define R16(a) (*(volatile u16 *)(a))
#define R32(a) (*(volatile u32 *)(a))
#define SHARED ((volatile u32 *)0x027FF000)
/* SHARED[0] touch x | y<<8 | pen<<16, [1] EXTKEYIN, [2] mic level, [3] beep request, [4] alive counter */

static void spi_wait(void) { while (R16(0x040001C0) & 0x80); }
static u16 tsc(u8 cmd)
{
    R16(0x040001C0) = 0x8000 | 0x0800 | 0x0200 | 1; /* enable, hold, touch, 2 MHz */
    R16(0x040001C2) = cmd; spi_wait();
    R16(0x040001C2) = 0; spi_wait(); u16 hi = R16(0x040001C2);
    R16(0x040001C0) = 0x8000 | 0x0200 | 1;
    R16(0x040001C2) = 0; spi_wait(); u16 lo = R16(0x040001C2) >> 3;
    return ((hi & 0x7F) << 5) | lo;
}

int main(void)
{
    R16(0x04000304) = 1;               /* POWCNT2: speakers on */
    R32(0x04000500) = 0x807F;          /* SOUNDCNT: master enable, full volume */
    u32 level = 0, frame = 0;
    /* like a real game: sleep until the next VBlank instead of spinning */
    R16(0x04000004) |= 1 << 3;          /* DISPSTAT: VBlank IRQ */
    R32(0x04000210) = 1;                /* IE: VBlank (IME stays off, halt still wakes on it) */
    for (;;)
    {
        R32(0x04000214) = 1;            /* acknowledge */
        *(volatile u8 *)0x04000301 = 0x80;  /* HALTCNT: halt until VBlank */
        u16 ext = R16(0x04000136);
        SHARED[1] = ext;
        u16 x = tsc(0xD0) >> 4, y = tsc(0x90) >> 4;
        int pen = !(ext & 0x40);
        SHARED[0] = (x & 0xFF) | (y & 0xFF) << 8 | pen << 16;
        /* a burst of mic samples each frame, like a game listening for a blow */
        level = (level * 7) >> 3;
        for (int k = 0; k < 64; k++) { int s = (int)tsc(0xE0) - 2048; if (s < 0) s = -s; if ((u32)s > level) level = s; }
        SHARED[2] = level;
        u32 beep = SHARED[3];
        /* channel 8 is a PSG channel: duty 50%, centre pan, volume 100 */
        if (beep) { R16(0x04000488) = (u16)(0x10000 - 0x2000); R32(0x04000480) = 0x80000000 | (3u << 29) | (3u << 24) | (64u << 16) | 100; }
        else R32(0x04000480) = 0;
        SHARED[4] = ++frame;
    }
}
