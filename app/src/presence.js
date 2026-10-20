/* Lets Lumina notice what is going on at the computer, without reading anything:
   - how long the user has been away from the keyboard and mouse (Windows idle time) and whether the screen is locked
   - optionally, the name of the app in front (and its window title), read straight from Windows (no helper process)
   Everything stays on this PC. The renderer decides what, if anything, is ever shared with a model. */
const { powerMonitor } = require('electron');

let win32 = null;
function loadWin32() {
  if (win32 !== null) return win32;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll');
    win32 = {
      fg: user32.func('void* __stdcall GetForegroundWindow()'),
      title: user32.func('int __stdcall GetWindowTextW(void* h, _Out_ uint16_t* buf, int n)'),
      pidOf: user32.func('uint32 __stdcall GetWindowThreadProcessId(void* h, _Out_ uint32_t* pid)'),
      open: kernel32.func('void* __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)'),
      image: kernel32.func('int __stdcall QueryFullProcessImageNameW(void* h, uint32 flags, _Out_ uint16_t* buf, _Inout_ uint32_t* size)'),
      close: kernel32.func('int __stdcall CloseHandle(void* h)')
    };
  } catch (_) { win32 = false; }
  return win32;
}
const str = (a, n) => String.fromCharCode.apply(null, Array.from(a.subarray(0, n)));

/** { name: 'chrome', title: '…' } for the window in front, or null */
function foreground() {
  const w = loadWin32(); if (!w) return null;
  try {
    const h = w.fg(); if (!h) return null;
    const tb = new Uint16Array(300), n = w.title(h, tb, 300);
    const pid = [0]; w.pidOf(h, pid);
    let name = '';
    const ph = w.open(0x1000, 0, pid[0]);                       // PROCESS_QUERY_LIMITED_INFORMATION
    if (ph) {
      const ib = new Uint16Array(520), sz = [520];
      if (w.image(ph, 0, ib, sz)) name = str(ib, sz[0]).split('\\').pop().replace(/\.exe$/i, '');
      w.close(ph);
    }
    return { name, title: str(tb, n) };
  } catch (_) { return null; }
}

class Presence {
  constructor(send) {
    this.send = send; this.locked = false; this.app = ''; this.title = ''; this.timer = null; this.fgTimer = null;
    powerMonitor.on('lock-screen', () => { this.locked = true; this.emit(); });
    powerMonitor.on('unlock-screen', () => { this.locked = false; this.emit(); });
    powerMonitor.on('suspend', () => { this.locked = true; this.emit(); });
    powerMonitor.on('resume', () => { this.locked = false; this.emit(); });
  }
  idleNow() { try { return this.locked ? 3600 : powerMonitor.getSystemIdleTime(); } catch (_) { return 0; } }
  start() { this.timer = setInterval(() => this.emit(), 4000); this.emit(); }
  emit() {
    let idle = 0;
    try { idle = powerMonitor.getSystemIdleTime(); } catch (_) { /* not available */ }
    if (this.locked) idle = Math.max(idle, 3600);
    this.send({ type: 'presence', idle, app: this.app, title: this.title });
  }
  /** turn the "which app is in front" check on or off (a quick native call every 2.5 s, no extra process) */
  watch(on) {
    if (!on) { clearInterval(this.fgTimer); this.fgTimer = null; this.app = ''; this.title = ''; this.emit(); return; }
    if (this.fgTimer) return;
    const tick = () => {
      const f = foreground();
      if (!f || !f.name || /^(electron|vortex desk)$/i.test(f.name)) return;       // ignore ourselves
      if (f.name !== this.app || f.title !== this.title) { this.app = f.name; this.title = f.title; this.emit(); }
    };
    tick(); this.fgTimer = setInterval(tick, 2500);
  }
  stop() { clearInterval(this.fgTimer); this.fgTimer = null; }
  close() { clearInterval(this.timer); this.stop(); }
}

module.exports = { Presence, foreground };
