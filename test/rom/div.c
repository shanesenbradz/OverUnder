/* integer division helpers the ARM EABI expects (the ARM7 and ARM9 have no divide instruction) */
typedef unsigned int u32; typedef unsigned long long u64;
static u32 udiv(u32 n, u32 d, u32 *r)
{
    u32 q = 0, rem = 0;
    if (!d) { *r = n; return 0xFFFFFFFF; }
    for (int i = 31; i >= 0; i--) { rem = (rem << 1) | ((n >> i) & 1); if (rem >= d) { rem -= d; q |= 1u << i; } }
    *r = rem; return q;
}
u32 __aeabi_uidiv(u32 n, u32 d) { u32 r; return udiv(n, d, &r); }
u64 __aeabi_uidivmod(u32 n, u32 d) { u32 r, q = udiv(n, d, &r); return (u64)r << 32 | q; }
int __aeabi_idiv(int n, int d) { u32 r; u32 q = udiv(n < 0 ? -n : n, d < 0 ? -d : d, &r); return ((n < 0) != (d < 0)) ? -(int)q : (int)q; }
u64 __aeabi_idivmod(int n, int d)
{
    u32 r; u32 q = udiv(n < 0 ? -n : n, d < 0 ? -d : d, &r);
    int qs = ((n < 0) != (d < 0)) ? -(int)q : (int)q, rs = n < 0 ? -(int)r : (int)r;
    return (u64)(u32)rs << 32 | (u32)qs;
}
