#!/usr/bin/env python3
"""Builds test/rom/bullpup_test.nds with clang and lld (no devkitPro needed)."""
import math, pathlib, struct, subprocess
D = pathlib.Path(__file__).resolve().parent
(D / 'sintab.h').write_text('static const short SIN[256] = {' + ','.join(str(round(math.sin(i * math.pi / 128) * 4096)) for i in range(256)) + '};\n')
def build(cpu, src, origin, stack):
    out = D / f'{cpu}.elf'
    flags = ['clang', f'--target={"armv5te" if cpu == "arm9" else "armv4t"}-none-eabi', '-marm', '-O2', '-ffreestanding', '-nostdlib',
             '-fno-builtin', '-fuse-ld=lld', f'-Wl,--defsym=ORIGIN_ADDR={origin}', f'-Wl,--defsym=STACK_TOP={stack}', '-Wl,-T,' + str(D / 'link.ld'),
             str(D / 'crt0.S'), str(D / src), str(D / 'div.c'), '-o', str(out)]
    subprocess.check_call(flags)
    binf = D / f'{cpu}.bin'
    subprocess.check_call(['llvm-objcopy', '-O', 'binary', str(out), str(binf)])
    return binf.read_bytes()
a9 = build('arm9', 'arm9.c', 0x02000800, 0x02300000)
# a retail-style secure area in front of the code: melonDS re-encrypts it and the decrypted
# copy starts with the 0xE7FFDEFF marker, so the code itself starts 2 KB in
a9 = struct.pack('<II', 0xE7FFDEFF, 0xE7FFDEFF) + bytes(0x800 - 8) + a9
a7 = build('arm7', 'arm7.c', 0x037F8000, 0x0380FD00)
pad = lambda b, n=0x200: b + b'\0' * (-len(b) % n)
a9, a7 = pad(a9), pad(a7)
o9 = 0x4000; o7 = o9 + len(a9); total = o7 + len(a7)
h = bytearray(0x4000)
h[0:12] = b'BULLPUP TEST'; h[12:16] = b'BPDS'; h[16:18] = b'01'
h[0x14] = 0  # chip size: 128 KB
struct.pack_into('<IIII', h, 0x20, o9, 0x02000800, 0x02000000, len(a9))
struct.pack_into('<IIII', h, 0x30, o7, 0x037F8000, 0x037F8000, len(a7))
struct.pack_into('<I', h, 0x80, total); struct.pack_into('<I', h, 0x84, 0x4000)
struct.pack_into('<II', h, 0x60, 0x00586000, 0x001808F8)  # cart timing words homebrew uses
def crc16(data, crc=0xFFFF):
    for b in data:
        crc ^= b
        for _ in range(8): crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc
struct.pack_into('<H', h, 0x15C, 0xCF56)
struct.pack_into('<H', h, 0x15E, crc16(h[:0x15E]))
rom = bytes(h) + a9 + a7
rom += b'\xFF' * (0x20000 - len(rom))
(D / 'bullpup_test.nds').write_bytes(rom)
for f in ('arm9.elf', 'arm7.elf', 'arm9.bin', 'arm7.bin'): (D / f).unlink()
print('bullpup_test.nds', len(rom), 'bytes; arm9', len(a9), 'arm7', len(a7))
