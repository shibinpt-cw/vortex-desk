/* The hands and eyes Lumina uses when you ask her to do something on the computer.
   Eyes: a picture of the screen, the list of open windows, the list of installed apps.
   Hands: open an app, bring a window forward, click, type, press keys, scroll.
   Files: list a folder, make a folder, move or rename a file, but ONLY inside folders you allowed, and never delete anything. */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const VK = { enter: 0x0D, return: 0x0D, tab: 0x09, esc: 0x1B, escape: 0x1B, space: 0x20, backspace: 0x08, delete: 0x2E, up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5B };
for (let i = 1; i <= 12; i++) VK['f' + i] = 0x6F + i;
const vkOf = k => { k = String(k).toLowerCase(); if (VK[k]) return VK[k]; if (/^[a-z]$/.test(k)) return k.toUpperCase().charCodeAt(0); if (/^[0-9]$/.test(k)) return k.charCodeAt(0); return 0; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ps(script, timeout = 20000) {
  return new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + script], { windowsHide: true, maxBuffer: 8e6, timeout }, (e, out) => e ? rej(e) : res(String(out).trim())));
}
const asList = t => { if (!t) return []; try { const j = JSON.parse(t); return Array.isArray(j) ? j : [j]; } catch (_) { return []; } };

class Computer {
  /** deps: { screen, desktopCapturer, clipboard, roots: () => [folders], native?: {...} } (native can be replaced in tests) */
  constructor(deps) { this.d = deps; this.appCache = null; this._native = deps.native || null; }

  native() {
    if (this._native) return this._native;
    const koffi = require('koffi'), u = koffi.load('user32.dll');
    this._native = {
      cursor: u.func('bool __stdcall SetCursorPos(int x, int y)'),
      mouse: u.func('void __stdcall mouse_event(uint32 flags, int dx, int dy, int data, uintptr_t extra)'),
      key: u.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)'),
      front: u.func('bool __stdcall SetForegroundWindow(intptr_t h)'),
      show: u.func('bool __stdcall ShowWindow(intptr_t h, int cmd)')
    };
    return this._native;
  }

  /* ───────── eyes ───────── */
  async windows() {
    const t = await ps('Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { [pscustomobject]@{pid=$_.Id;name=$_.ProcessName;title=$_.MainWindowTitle;h=[int64]$_.MainWindowHandle} } | ConvertTo-Json -Compress');
    return asList(t).filter(w => !/^(electron|vortex desk)$/i.test(w.name));
  }
  async installedApps(force) {
    if (this.appCache && !force && Date.now() - this.appCache.t < 300000) return this.appCache.list;
    const list = asList(await ps('Get-StartApps | ForEach-Object { [pscustomobject]@{name=$_.Name;id=$_.AppID} } | ConvertTo-Json -Compress', 30000));
    this.appCache = { t: Date.now(), list }; return list;
  }
  /** the installed apps whose name looks like the query (best first) */
  async findApp(query) {
    const q = String(query || '').toLowerCase().trim(); if (!q) return [];
    const words = q.split(/\s+/);
    const scored = (await this.installedApps()).map(a => { const n = a.name.toLowerCase(); let s = 0; if (n === q) s = 100; else if (n.startsWith(q)) s = 80; else if (n.includes(q)) s = 60; else if (words.every(w => n.includes(w))) s = 40; return { ...a, s }; }).filter(a => a.s).sort((a, b) => b.s - a.s || a.name.length - b.name.length);
    return scored.slice(0, 5).map(({ name, id }) => ({ name, id }));
  }
  async shot(width = 1366) {
    const { screen, desktopCapturer } = this.d, disp = screen.getPrimaryDisplay();
    const h = Math.max(200, Math.round(width * disp.size.height / disp.size.width));
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height: h } });
    const src = srcs.find(x => String(x.display_id) === String(disp.id)) || srcs[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('could not see the screen');
    return { jpeg: src.thumbnail.toJPEG(70).toString('base64'), width, height: h };
  }

  /* ───────── hands ───────── */
  async openApp(idOrName) {
    const found = (await this.installedApps()).find(a => a.id === idOrName) || (await this.findApp(idOrName))[0];
    if (!found) throw new Error(`no app called "${idOrName}" is installed`);
    await new Promise((res, rej) => execFile('explorer.exe', ['shell:AppsFolder\\' + found.id], { windowsHide: true }, () => res()));      // explorer returns 1 even on success
    return found.name;
  }
  async focus(win) {
    const n = this.native(); if (!win || !win.h) throw new Error('that window cannot be brought forward');
    n.key(0x12, 0, 0, 0); n.key(0x12, 0, 2, 0);            // a tap on Alt lets Windows hand over the front
    n.show(win.h, 9); const ok = n.front(win.h); await sleep(400); return ok;
  }
  point(a) {
    // a is {box:[ymin,xmin,ymax,xmax]} or {point:[y,x]} in a 0..1000 grid over the whole screen
    let y, x;
    if (Array.isArray(a.box) && a.box.length === 4) { y = (a.box[0] + a.box[2]) / 2; x = (a.box[1] + a.box[3]) / 2; }
    else if (Array.isArray(a.point) && a.point.length === 2) { y = a.point[0]; x = a.point[1]; }
    else throw new Error('no place to click was given');
    if (![x, y].every(v => Number.isFinite(v) && v >= 0 && v <= 1000)) throw new Error('that place is outside the screen');
    const b = this.d.screen.getPrimaryDisplay().bounds;
    return this.d.screen.dipToScreenPoint({ x: Math.round(b.x + x / 1000 * b.width), y: Math.round(b.y + y / 1000 * b.height) });
  }
  async click(a, { button = 'left', double = false } = {}) {
    const n = this.native(), p = this.point(a);
    n.cursor(p.x, p.y); await sleep(120);
    const [dn, up] = button === 'right' ? [0x8, 0x10] : [0x2, 0x4];
    for (let i = 0; i < (double ? 2 : 1); i++) { n.mouse(dn, 0, 0, 0, 0); await sleep(40); n.mouse(up, 0, 0, 0, 0); await sleep(90); }
    return p;
  }
  async scroll(clicks) { const n = this.native(); n.mouse(0x800, 0, 0, Math.round(clicks) * 120, 0); await sleep(150); }
  async keys(combo) {
    const n = this.native(), parts = String(combo).toLowerCase().split('+').map(s => s.trim()).filter(Boolean), codes = parts.map(vkOf);
    if (!codes.length || codes.includes(0)) throw new Error(`I do not know the key "${combo}"`);
    for (const c of codes) n.key(c, 0, 0, 0);
    await sleep(40);
    for (const c of [...codes].reverse()) n.key(c, 0, 2, 0);
    await sleep(120);
  }
  /** types text the reliable way for any language: through the clipboard, then Ctrl+V */
  async type(text) {
    const { clipboard } = this.d, before = clipboard.readText();
    clipboard.writeText(String(text)); await sleep(60);
    await this.keys('ctrl+v'); await sleep(250);
    setTimeout(() => { try { if (clipboard.readText() === String(text)) clipboard.writeText(before); } catch (_) { /* gone */ } }, 800);
  }

  /* ───────── files: only inside folders you allowed, nothing is ever deleted ───────── */
  roots() { return (this.d.roots() || []).map(r => path.resolve(r)).filter(r => fs.existsSync(r)); }
  safe(p, { mustExist = false } = {}) {
    const roots = this.roots(); if (!roots.length) throw new Error('no folder is allowed yet: add the folders I may organise in the Vortex Desk control app');
    const full = path.resolve(String(p || ''));
    let real = full; try { real = fs.existsSync(full) ? fs.realpathSync(full) : path.join(fs.realpathSync(path.dirname(full)), path.basename(full)); } catch (_) { /* parent missing */ }
    const inside = roots.some(r => { const rr = fs.realpathSync(r); return real === rr || real.startsWith(rr + path.sep); });
    if (!inside) throw new Error(`"${p}" is outside the folders I am allowed to use`);
    if (mustExist && !fs.existsSync(real)) throw new Error(`"${p}" does not exist`);
    return real;
  }
  listFolder(dir) {
    const real = this.safe(dir, { mustExist: true });
    return fs.readdirSync(real, { withFileTypes: true }).slice(0, 300).map(e => { let st = {}; try { st = fs.statSync(path.join(real, e.name)); } catch (_) { /* skip */ } return { name: e.name, type: e.isDirectory() ? 'folder' : 'file', size: st.size || 0, modified: st.mtime ? st.mtime.toISOString().slice(0, 10) : '' }; });
  }
  createFolder(dir) { const real = this.safe(dir); fs.mkdirSync(real, { recursive: true }); return real; }
  moveFile(src, dst) {
    const from = this.safe(src, { mustExist: true });
    if (this.roots().some(r => path.resolve(r) === from)) throw new Error('I will not move a whole allowed folder');
    let to = this.safe(dst);
    if (fs.existsSync(to) && fs.statSync(to).isDirectory()) to = path.join(to, path.basename(from));     // moving into a folder
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(to)) { const ext = path.extname(to), base = to.slice(0, to.length - ext.length); let i = 2; while (fs.existsSync(`${base} (${i})${ext}`)) i++; to = `${base} (${i})${ext}`; }   // never overwrite
    try { fs.renameSync(from, to); } catch (e) { if (e.code === 'EXDEV') { fs.copyFileSync(from, to); fs.unlinkSync(from); } else throw e; }
    return to;
  }
}

module.exports = { Computer, vkOf };
