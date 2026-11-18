/* ============================================================
   Link: the GBA app's link cable has no DS equivalent yet (DS games
   talk over local wireless). This stub keeps the emulation loop's
   link checks in one place so wireless play can slot in later.
   ============================================================ */
const Link = { state: 'off', active: false, rxPending: false, native: null, cancel() {}, watchdog() {}, runFrame() { return 1; } };
