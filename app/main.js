/* Vortex Desk: the desktop shell.
   - The island: one transparent, always-on-top window docked at the top centre of the screen. Only the island itself catches the mouse;
     everything around it is click-through.
   - The control app: a normal window (tray → "Open Vortex Desk") where everything is managed: voice, keys, chats, memory, rules, the Claude Code hook.
   Claude Code talks to us through a hook over a named pipe (see src/pipe.js). */
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, shell, desktopCapturer, session, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { startPipe } = require('./src/pipe');
const { Rules } = require('./src/rules');
const { Agent } = require('./src/agent');
const { Presence } = require('./src/presence');
const { PushToTalk } = require('./src/hotkey');
const { EdgeVoice } = require('./src/edgevoice');
const hookInstall = require('./src/hookinstall');
const agentsApi = require('./src/agents');
const chatApi = require('./src/chat');
const { orbPng } = require('./src/icon');
const { Computer } = require('./src/computer');
const { Operator } = require('./src/operator');
const gem = require('./src/gem');

// lean on memory: Chromium's low-end mode (smaller caches and tiles) and software compositing (no big GPU surface), canvas drawing stays on the GPU
app.commandLine.appendSwitch('enable-low-end-device-mode');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=160');
app.setPath('userData', path.join(app.getPath('appData'), 'vortex-desk'));
/* a small log, so a crash or an unexpected exit can always be explained (userData/main.log) */
const logFile = path.join(app.getPath('userData'), 'main.log');
const log = (...a) => { try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch (_) { /* no log */ } };
process.on('uncaughtException', e => log('uncaught:', (e && e.stack) || e));
process.on('unhandledRejection', e => log('unhandled:', (e && e.stack) || e));
app.on('render-process-gone', (_e, _wc, d) => log('renderer gone:', d.reason, d.exitCode));
app.on('child-process-gone', (_e, d) => log('child gone:', d.type, d.reason, d.exitCode));
app.on('before-quit', () => log('quitting', String(new Error().stack).split('\n').slice(2, 7).join(' | ')));
log('start', process.versions.electron);
// the island window is only as big as the island needs: small while she is a notch, big while she is open (far less to draw and composite)
const SIZES = { small: { w: 420, h: 140 }, big: { w: 760, h: 460 } };
let sizeKey = 'big', shrinkT = null;
const iconFile = n => path.join(__dirname, '..', 'assets', n);
const loadIcon = (n, fallback) => { const i = nativeImage.createFromPath(iconFile(n)); return i.isEmpty() ? fallback() : i; };
let ptt = null, presence = null, win = null, ctl = null, tray = null, island = { x: 0, y: 0, w: 0, h: 0 }, ignoring = true, pipe = null, agent = null, rules = null;
const edge = new EdgeVoice();

/* ───────── dictation: type the words where the cursor is, in whatever app is in front ─────────
   The text goes through the clipboard and a Ctrl+V key press; the clipboard gets back what it held a moment later. */
let lastDictation = '', keyApi = null;
function keyEvent() {
  if (keyApi !== null) return keyApi;
  try { keyApi = require('koffi').load('user32.dll').func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)'); } catch (_) { keyApi = false; }
  return keyApi;
}
async function pasteText(text) {
  const k = keyEvent(); if (!k || !text) return false;
  lastDictation = text;
  const before = clipboard.readText();
  clipboard.writeText(text);
  await new Promise(r => setTimeout(r, 60));
  k(0x11, 0, 0, 0); k(0x56, 0, 0, 0); k(0x56, 0, 2, 0); k(0x11, 0, 2, 0);          // Ctrl down, V down, V up, Ctrl up
  setTimeout(() => { try { if (clipboard.readText() === text) clipboard.writeText(before); } catch (_) { /* gone */ } }, 700);
  return true;
}

/* ───────── assist mode: look at the screen now and then, only while the user has switched it on ─────────
   The picture goes straight to the island window (which asks Gemini about it). Nothing is saved to disk. */
const assist = { on: false, every: 60, timer: null, lastHash: null, lastSent: 0, busy: false };
async function grabScreen() {
  const d = screen.getPrimaryDisplay(), w = 1280, h = Math.max(200, Math.round(w * d.size.height / d.size.width));
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  const src = srcs.find(x => String(x.display_id) === String(d.id)) || srcs[0];
  if (!src || src.thumbnail.isEmpty()) return null;
  const bmp = src.thumbnail.resize({ width: 24, height: 14 }).toBitmap(), hash = [];
  for (let i = 0; i < bmp.length; i += 4) hash.push(bmp[i], bmp[i + 1], bmp[i + 2]);
  return { jpeg: src.thumbnail.toJPEG(72).toString('base64'), hash };
}
async function assistTick(force) {
  if (assist.busy || !win || win.isDestroyed()) return;
  if (!force && (!assist.on || (presence && presence.idleNow() > 90))) return;     // nobody is there: do not look
  assist.busy = true;
  try {
    const g = await grabScreen(); if (!g) return;
    let changed = true;
    if (assist.lastHash) { let d = 0; for (let i = 0; i < g.hash.length; i++) d += Math.abs(g.hash[i] - assist.lastHash[i]); changed = d / g.hash.length > 5; }
    if (!force && !changed && Date.now() - assist.lastSent < 240000) return;          // same picture as last time: save the request
    assist.lastHash = g.hash; assist.lastSent = Date.now();
    win.webContents.send('screen', { jpeg: g.jpeg, manual: !!force });
  } catch (e) { log('assist:', e.message); } finally { assist.busy = false; }
}
function assistConfig(c) {
  assist.on = !!c.on; assist.every = Math.max(20, Math.min(900, Number(c.every) || 60));
  clearInterval(assist.timer); assist.timer = null; assist.lastHash = null;
  if (assist.on) assist.timer = setInterval(() => assistTick(false), assist.every * 1000);
}

/* ───────── keys: the app's own file wins over the one in config/ ───────── */
const USER_KEYS = path.join(app.getPath('userData'), 'keys.local.json');
const CONFIG_KEYS = path.join(__dirname, '..', 'config', 'keys.local.json');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
function readKeys() {
  const a = readJson(CONFIG_KEYS), b = readJson(USER_KEYS);
  if (!a && !b) return null;
  const out = { ...(a || {}), ...(b || {}) };
  for (const k of Object.keys(out)) if (out[k] === '' && a && a[k]) out[k] = a[k];
  return out;
}
function writeKey(provider, value) {
  const cur = readJson(USER_KEYS) || {};
  if (value) cur[provider] = value; else cur[provider] = '';
  fs.mkdirSync(path.dirname(USER_KEYS), { recursive: true });
  fs.writeFileSync(USER_KEYS, JSON.stringify(cur, null, 2));
  if (!value) { const c = readJson(CONFIG_KEYS); if (c && c[provider]) { c[provider] = ''; fs.writeFileSync(CONFIG_KEYS, JSON.stringify(c, null, 2)); } }   // "remove" really removes it
}
const mask = v => (v ? '••••' + String(v).slice(-4) : '');

async function testKey(provider, key) {
  if (['deepseek', 'qwen', 'moonshot'].includes(provider)) { try { const m = await chatApi.models({ provider, key }); return m.length ? { ok: true, msg: 'Key works.' } : { ok: false, msg: 'No models came back.' }; } catch (e) { return { ok: false, msg: String(e.message).slice(0, 120) }; } }
  try {
    if (provider === 'gemini') { const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } }); return r.ok ? { ok: true, msg: 'Key works.' } : { ok: false, msg: `Google said ${r.status}${r.status === 400 ? ' (key not valid)' : ''}.` }; }
    if (provider === 'openai') { const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key } }); return r.ok ? { ok: true, msg: 'Key works.' } : { ok: false, msg: `OpenAI said ${r.status}.` }; }
    if (provider === 'claude') { const r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }); return r.ok ? { ok: true, msg: 'Key works.' } : { ok: false, msg: `Anthropic said ${r.status}.` }; }
    if (provider === 'openrouter') { const r = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: 'Bearer ' + key } }); return r.ok ? { ok: true, msg: 'Key works.' } : { ok: false, msg: `OpenRouter said ${r.status}.` }; }
  } catch (e) { return { ok: false, msg: 'Could not reach the service: ' + e.message }; }
  return { ok: true, msg: 'Saved.' };
}

/* Gemini speech from the main process (used by the control app's "play a sample") */
const GEM_TTS = ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];
async function geminiTts(text, voice) {
  const key = (readKeys() || {}).gemini; if (!key) throw new Error('no Gemini key');
  let last = '';
  for (const m of GEM_TTS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Aoede' } } } } }) });
    if (!r.ok) { last = `${m}: ${r.status}`; continue; }
    const j = await r.json(), part = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.find(x => x.inlineData);
    if (part) return { mime: part.inlineData.mimeType, data: new Uint8Array(Buffer.from(part.inlineData.data, 'base64')), model: m };
  }
  throw new Error('Gemini voice unavailable (' + last + ')');
}

/* ───────── the island ───────── */
function place() {
  if (!win) return;
  const b = screen.getPrimaryDisplay().bounds;
  const { w, h } = SIZES[sizeKey];
  win.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: b.y, width: w, height: h });
}
const send = ev => { if (win && !win.isDestroyed()) win.webContents.send('event', ev); };

function createWindow() {
  win = new BrowserWindow({
    width: SIZES.big.w, height: SIZES.big.h, title: 'Vortex Desk', icon: loadIcon('logo-256.png', () => nativeImage.createFromBuffer(orbPng(64))), frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  place();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-finish-load', () => { if (agent) agent.pushPills(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  screen.on('display-metrics-changed', place);
  screen.on('display-added', place);
  screen.on('display-removed', place);
}

/* the island catches the mouse, the transparent rest of the window lets it through (also while dragging a file over) */
function pollMouse() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = win.getBounds(), x = p.x - b.x, y = p.y - b.y, pad = 10;
    const inside = island.w > 0 && x >= island.x - pad && x <= island.x + island.w + pad && y <= island.y + island.h + pad && y >= -2;
    if (inside === ignoring) { ignoring = !inside; win.setIgnoreMouseEvents(ignoring, { forward: true }); }
  }, 45);
}

/* ───────── the control app ───────── */
function openControl(page) {
  if (ctl && !ctl.isDestroyed()) { if (ctl.isMinimized()) ctl.restore(); ctl.show(); ctl.focus(); if (page) ctl.webContents.send('goto', page); return; }
  ctl = new BrowserWindow({
    width: 1060, height: 720, minWidth: 840, minHeight: 560, title: 'Vortex Desk', icon: loadIcon('logo-256.png', () => nativeImage.createFromBuffer(orbPng(64))),
    backgroundColor: '#080a1f', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'control-preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  ctl.setMenu(null);
  ctl.loadFile(path.join(__dirname, 'renderer', 'control.html'), page ? { hash: page } : undefined);
  ctl.once('ready-to-show', () => ctl.show());
  ctl.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  ctl.webContents.on('will-navigate', e => e.preventDefault());
  ctl.on('closed', () => { ctl = null; });
}

let stars = null;
function openStars() {
  if (stars && !stars.isDestroyed()) { stars.show(); stars.focus(); return; }
  const b = screen.getPrimaryDisplay().workArea;
  stars = new BrowserWindow({
    width: 380, height: 230, x: b.x + b.width - 400, y: b.y + b.height - 250, title: 'Lumina’s stars', icon: loadIcon('logo-256.png', () => nativeImage.createFromBuffer(orbPng(64))),
    frame: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#05061a', resizable: true, minWidth: 260, minHeight: 160, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  stars.setMenu(null);
  stars.loadFile(path.join(__dirname, 'renderer', 'stars.html'));
  stars.once('ready-to-show', () => stars.show());
  stars.on('closed', () => { stars = null; });
}

let show = null;
function openShowcase() {
  if (show && !show.isDestroyed()) { show.show(); show.focus(); return; }
  show = new BrowserWindow({
    width: 1280, height: 720, useContentSize: true, title: 'Vortex Desk showcase', icon: loadIcon('logo-256.png', () => nativeImage.createFromBuffer(orbPng(64))),
    backgroundColor: '#05061a', autoHideMenuBar: true, show: false, resizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false }
  });
  show.setMenu(null);
  show.loadFile(path.join(__dirname, 'renderer', 'index.html'), { search: 'showcase=1' });
  show.once('ready-to-show', () => show.show());
  show.on('closed', () => { show = null; });
}

function makeTray() {
  tray = new Tray(loadIcon('tray-32.png', () => nativeImage.createFromBuffer(orbPng(32))));
  tray.setToolTip('Vortex Desk');
  const build = () => Menu.buildFromTemplate([
    { label: 'Open Vortex Desk', click: () => openControl() },
    { label: 'Look at my screen now   (Ctrl+Alt+L)', click: () => assistTick(true) },
    { label: 'Star window', click: () => openStars() },
    { label: 'Make the showcase video', click: () => openShowcase() },
    { label: win && win.isVisible() ? 'Hide Lumina' : 'Show Lumina', click: () => { if (win.isVisible()) win.hide(); else win.showInactive(); tray.setContextMenu(build()); } },
    { label: 'Talk to Lumina   (Ctrl+Alt+Space)', click: () => win && win.webContents.send('voice') },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: m => app.setLoginItemSettings({ openAtLogin: m.checked }) },
    { type: 'separator' },
    { label: 'Quit Vortex Desk   (Ctrl+Alt+Shift+Q)', click: () => app.quit() }
  ]);
  tray.setContextMenu(build());
  tray.on('click', () => openControl());
  tray.on('double-click', () => openControl());
}

const folders = () => ({ config: path.dirname(CONFIG_KEYS), data: app.getPath('userData'), assets: path.join(__dirname, '..', 'assets'), project: path.join(__dirname, '..') });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win && !win.isDestroyed()) { win.showInactive(); win.webContents.send('wake'); } });      // starting it again (the desktop shortcut) wakes Lumina
  app.whenReady().then(() => {
    // lets the showcase window record itself: just that window's picture, at full frame rate
    session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
      const pid = req.frame && req.frame.processId;
      if (show && !show.isDestroyed() && pid === show.webContents.mainFrame.processId) cb({ video: req.frame });                // the showcase films itself
      else if (win && !win.isDestroyed() && pid === win.webContents.mainFrame.processId) {                                      // the meeting listener: the sound coming out of the speakers
        try { const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }))[0]; cb({ video: src, audio: 'loopback' }); } catch (_) { cb({}); }
      } else cb({});
    });
    const dir = app.getPath('userData');
    rules = new Rules(path.join(dir, 'rules.json'));
    agent = new Agent(rules, send, () => agentsApi.list().filter(a => a.installed).map(a => a.id));
    pipe = startPipe(dir, (ev, reply, onClose) => { try { agent.handle(ev, reply, onClose); } catch (e) { console.error(e); reply({ ok: false }); } });
    presence = new Presence(send); presence.start();
    ptt = new PushToTalk(phase => { if (win && !win.isDestroyed()) win.webContents.send('ptt', phase); }, phase => { if (win && !win.isDestroyed()) win.webContents.send('dictate', phase); });
    ptt.start();
    createWindow(); pollMouse(); makeTray();
    // Ctrl+Alt+Space talks to Lumina from anywhere (a bare Ctrl+Alt tap needs a native keyboard hook, which comes later)
    globalShortcut.register('Control+Alt+Space', () => win && win.webContents.send('voice'));
    globalShortcut.register('Control+Alt+D', () => openControl());          // the control app
    globalShortcut.register('Control+Alt+L', () => assistTick(true));       // "look at my screen now"
    globalShortcut.register('Control+Alt+Shift+Q', () => app.quit());      // quit from anywhere

    /* island ⇄ main */
    ipcMain.handle('keys', () => readKeys());
    const baseOf = (k, p) => (p === 'ollama' ? k.local : p === 'lmstudio' ? k.lmstudio : '') || '';
    ipcMain.handle('chat-ask', (_e, a) => { const k = readKeys() || {}; return chatApi.ask({ ...a, key: k[a.provider] || '', base: baseOf(k, a.provider) }); });
    ipcMain.handle('chat-models', (_e, p) => { const k = readKeys() || {}; return chatApi.models({ provider: p, key: k[p] || '', base: baseOf(k, p) }); });
    ipcMain.handle('tts-edge', (_e, { text, voice }) => edge.speak(String(text || ''), voice));
    ipcMain.on('rect', (e, r) => { if (e.sender === win.webContents) island = r; });
    ipcMain.on('decide', (_e, d) => agent.decide(d.id, d.decision, d.rule));

    /* doing things on the computer (off until the user switches it on in the control app) */
    const cfgFile = path.join(dir, 'computer.json'), logFile = path.join(dir, 'computer.log');
    const cfg = () => ({ on: false, confirm: true, folders: [], ...(readJson(cfgFile) || {}) });
    const tlog = line => { try { fs.appendFileSync(logFile, `${new Date().toISOString()}  ${line}\n`); } catch (_) { /* log is optional */ } };
    const computer = new Computer({ screen, desktopCapturer, clipboard, roots: () => cfg().folders });
    let escOn = false;
    const stopTask = () => operator.stop();
    const operator = new Operator({
      computer, log: tlog, quit: () => app.quit(), settings: () => cfg(),
      generate: opts => gem.generate((readKeys() || {}).gemini, opts),
      send: ev => {
        if (ev.type === 'task.start' && !escOn) { escOn = globalShortcut.register('Escape', stopTask); }
        if (ev.type === 'task.end' && escOn) { globalShortcut.unregister('Escape'); escOn = false; }
        send(ev);
      }
    });
    ipcMain.on('task-start', (_e, goal) => { operator.start(String(goal || '').slice(0, 600)).catch(e => tlog('task crash: ' + e.message)); });
    ipcMain.on('task-stop', () => operator.stop());
    ipcMain.on('task-answer', (_e, d) => operator.answer(d.id, d.yes));
    ipcMain.handle('ctl:computer', () => cfg());
    ipcMain.handle('ctl:computerSet', (_e, c) => { const cur = cfg(); const n = { on: !!c.on, confirm: c.confirm !== false, folders: Array.isArray(c.folders) ? c.folders.filter(f => typeof f === 'string').slice(0, 20) : cur.folders }; fs.writeFileSync(cfgFile, JSON.stringify(n, null, 2)); return n; });
    ipcMain.handle('ctl:computerPick', async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
    ipcMain.handle('ctl:computerQuick', () => ['Desktop', 'Documents', 'Downloads', 'Pictures'].map(n => ({ name: n, path: app.getPath(n.toLowerCase()) })));
    ipcMain.handle('ctl:computerLog', () => { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-80); } catch (_) { return []; } });
    ipcMain.on('quit', () => app.quit());
    ipcMain.on('open-control', (_e, page) => openControl(page));
    ipcMain.on('size', (e, k) => {
      if (e.sender !== win.webContents) return;                                  // only the island window changes the island's size
      if (k === 'big') { clearTimeout(shrinkT); shrinkT = null; if (sizeKey !== 'big') { sizeKey = 'big'; place(); } }
      else if (sizeKey !== 'small' && !shrinkT) shrinkT = setTimeout(() => { shrinkT = null; sizeKey = 'small'; place(); }, 1100);
    });
    ipcMain.on('watch', (_e, on) => presence && presence.watch(!!on));
    ipcMain.on('assist-set', (_e, c) => assistConfig(c || {}));
    ipcMain.on('assist-look', () => assistTick(true));
    ipcMain.on('open-showcase', () => openShowcase());
    ipcMain.on('open-stars', () => openStars());
    ipcMain.handle('dictation-paste', (_e, text) => pasteText(String(text || '')));
    globalShortcut.register('Control+Alt+P', () => { if (lastDictation) pasteText(lastDictation); });      // paste the last dictation again
    ipcMain.on('meet-set', (_e, on) => { if (on && win && !win.isDestroyed()) win.webContents.executeJavaScript('window.__startMeet&&window.__startMeet()', true).catch(() => {}); });
    ipcMain.on('menu', () => Menu.buildFromTemplate([
      { label: 'Open Vortex Desk', click: () => openControl() },
      { label: 'Talk to Lumina', click: () => win && win.webContents.send('voice') },
      { label: 'Hide Lumina', click: () => win && win.hide() },
      { type: 'separator' },
      { label: 'Quit Vortex Desk', click: () => app.quit() }
    ]).popup({ window: win }));

    /* control app ⇄ main */
    const ok = (v = {}) => ({ ok: true, ...v });
    ipcMain.handle('ctl:keys', () => { const k = readKeys() || {}; const o = {}; for (const p of ['gemini', 'claude', 'openai', 'deepseek', 'qwen', 'moonshot', 'openrouter']) o[p] = { set: !!k[p], tail: mask(k[p]) }; o.local = k.local || 'http://localhost:11434'; o.lmstudio = k.lmstudio || 'http://localhost:1234/v1'; o.file = USER_KEYS; return o; });
    ipcMain.handle('ctl:setKey', (_e, { provider, value }) => { writeKey(provider, String(value || '').trim()); send({ type: 'keys-changed' }); if (win && !win.isDestroyed()) win.webContents.send('keys-changed'); return ok(); });
    ipcMain.handle('ctl:testKey', async (_e, { provider, value }) => testKey(provider, value || (readKeys() || {})[provider]));
    ipcMain.handle('ctl:rules', () => ({ auto: rules.data.autoAllowSafe, rules: rules.data.rules, file: path.join(dir, 'rules.json') }));
    ipcMain.handle('ctl:ruleDelete', (_e, i) => { rules.data.rules.splice(i, 1); rules.save(); return ok(); });
    ipcMain.handle('ctl:ruleAuto', (_e, v) => { rules.data.autoAllowSafe = !!v; rules.save(); return ok(); });
    ipcMain.handle('ctl:hook', (_e, what) => { const r = what === 'install' ? hookInstall.install() : what === 'remove' ? hookInstall.remove() : hookInstall.status(); const { apply, ...rest } = r; return rest; });
    ipcMain.handle('ctl:agents', () => ({ list: agentsApi.list(), command: agentsApi.command('my-tool') }));
    ipcMain.handle('ctl:agentSet', (_e, { id, on }) => { const r = on ? agentsApi.install(id) : agentsApi.remove(id); agent.pushPills(); return r; });
    ipcMain.handle('ctl:login', (_e, v) => { if (typeof v === 'boolean') app.setLoginItemSettings({ openAtLogin: v }); return app.getLoginItemSettings().openAtLogin; });
    ipcMain.handle('ctl:ttsEdge', (_e, { text, voice }) => edge.speak(String(text || ''), voice));
    ipcMain.handle('ctl:ttsGemini', (_e, { text, voice }) => geminiTts(String(text || ''), voice));
    ipcMain.handle('ctl:about', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, folders: folders(), mem: Math.round(process.memoryUsage().rss / 1048576) }));
    ipcMain.handle('ctl:open', (_e, what) => { const f = folders(); if (what === 'rules') shell.showItemInFolder(path.join(dir, 'rules.json')); else if (f[what]) shell.openPath(f[what]); return ok(); });
    ipcMain.on('ctl:island', (_e, what) => { if (!win) return; if (what === 'show') win.showInactive(); else if (what === 'hide') win.hide(); else if (what === 'talk') win.webContents.send('voice'); else if (what === 'look') assistTick(true); });
    ipcMain.on('ctl:showcase', () => openShowcase());
    ipcMain.on('ctl:stars', () => openStars());
    ipcMain.on('ctl:quit', () => app.quit());
  });
  app.on('window-all-closed', e => e.preventDefault());
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (pipe) pipe.close(); if (presence) presence.close(); if (ptt) ptt.stop(); edge.reset(); });
}
