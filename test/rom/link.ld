ENTRY(_start)
SECTIONS {
  . = ORIGIN_ADDR;
  .text : { *(.text.start) *(.text*) *(.rodata*) }
  .data : { *(.data*) }
  . = ALIGN(4);
  __bss_start = .;
  .bss : { *(.bss*) *(COMMON) }
  . = ALIGN(4);
  __bss_end = .;
  /DISCARD/ : { *(.ARM.exidx*) *(.comment) }
}
