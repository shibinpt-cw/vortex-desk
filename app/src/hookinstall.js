/* Adds, removes or checks the Vortex Desk hook in Claude Code's user settings (~/.claude/settings.json). */
const fs = require('fs');
const os = require('os');
const path = require('path');

const file = path.join(os.homedir(), '.claude', 'settings.json');
const hookPath = path.join(__dirname, '..', 'hook', 'vortex-hook.js');
const command = `node "${hookPath}"`;
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const isOurs = h => h && h.command && h.command.includes('vortex-hook.js');

function read() {
  try { return { cfg: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { return fs.existsSync(file) ? { error: e.message } : { cfg: {} }; }
}
function installed(cfg) { return EVENTS.every(ev => ((cfg.hooks || {})[ev] || []).some(g => (g.hooks || []).some(isOurs))); }

function status() {
  const r = read(); if (r.error) return { ok: false, error: r.error, file };
  return { ok: true, installed: installed(r.cfg), file, command };
}
function change(remove) {
  const r = read(); if (r.error) return { ok: false, error: r.error, file };
  const cfg = r.cfg, before = JSON.stringify(cfg, null, 2);
  cfg.hooks = cfg.hooks || {};
  for (const ev of EVENTS) {
    const list = (cfg.hooks[ev] = cfg.hooks[ev] || []);
    const has = list.some(g => (g.hooks || []).some(isOurs));
    if (remove) {
      cfg.hooks[ev] = list.map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurs(h)) })).filter(g => g.hooks.length);
      if (!cfg.hooks[ev].length) delete cfg.hooks[ev];
    } else if (!has) {
      const group = { hooks: [{ type: 'command', command, timeout: ev === 'PreToolUse' ? 120 : 10 }] };
      if (ev === 'PreToolUse' || ev === 'PostToolUse') group.matcher = '*';
      list.push(group);
    }
  }
  if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
  const after = JSON.stringify(cfg, null, 2);
  if (before === after) return { ok: true, changed: false, file, command };
  return { ok: true, changed: true, file, command, apply() {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.vortex-backup');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, after + '\n');
  } };
}
const install = (apply = true) => { const c = change(false); if (c.ok && c.changed && apply) c.apply(); return c; };
const remove = (apply = true) => { const c = change(true); if (c.ok && c.changed && apply) c.apply(); return c; };

module.exports = { status, install, remove, EVENTS, file, command };
