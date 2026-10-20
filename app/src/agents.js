/* The coding agents Vortex Desk can watch, and how each one is connected.
   Most agents read hooks from a settings file; we add ours next to whatever is already there and can take it out again.
   Every change keeps a backup (<file>.vortex-backup), never touches entries that are not ours, and only happens when you press the button. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const claude = require('./hookinstall');

const MARK = 'vortex-hook.js';
const hookPath = path.join(__dirname, '..', 'hook', MARK);
const cmd = (agent, event) => `node "${hookPath}" --agent ${agent}${event ? ' ' + event : ''}`;
const home = () => process.env.VORTEX_HOME || os.homedir();
const isOurs = v => typeof v === 'string' && v.includes(MARK);

/* ───── names and colours (used by the pills in the island) ───── */
const CATALOG = [
  { id: 'claude-code', name: 'Claude Code', c1: '#ffd29a', c2: '#e8762d', how: 'hook' },
  { id: 'gemini', name: 'Gemini CLI', c1: '#cdd6ff', c2: '#5a6fe0', how: 'hook' },
  { id: 'codex', name: 'Codex', c1: '#bff5d6', c2: '#2fa876', how: 'hook' },
  { id: 'cursor', name: 'Cursor', c1: '#e4e4ee', c2: '#7a7a96', how: 'hook' },
  { id: 'copilot', name: 'Copilot CLI', c1: '#d8c7ff', c2: '#7a4fd6', how: 'hook' },
  { id: 'antigravity', name: 'Antigravity', c1: '#ffc8e6', c2: '#d6559f', how: 'hook' },
  { id: 'muse', name: 'Muse Code', c1: '#c9f2ff', c2: '#2e9fc4', how: 'hook' },
  { id: 'claude-desktop', name: 'Claude Desktop', c1: '#ffe3c2', c2: '#d88a3a', how: 'auto' },
  { id: 'opencode', name: 'OpenCode', c1: '#d9d9d9', c2: '#555566', how: 'plugin' },
  { id: 'amp', name: 'Amp', c1: '#ffd0d0', c2: '#d64f4f', how: 'plugin' },
  { id: 'hermes', name: 'Hermes', c1: '#e8d9ff', c2: '#8a5fd6', how: 'plugin' }
];
const nameOf = id => (CATALOG.find(a => a.id === id) || { name: id.replace(/(^|-)([a-z])/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase()) }).name;

/* ───── small JSON helpers ───── */
function readJson(file) {
  if (!fs.existsSync(file)) return { value: {} };
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return { value: v && typeof v === 'object' ? v : {} }; }
  catch (e) { return { error: `${file} is not valid JSON (${e.message}). Nothing was changed.` }; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.vortex-backup');
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
const groupHasOurs = g => g && (isOurs(g.command) || isOurs(g.bash) || isOurs(g.powershell) || (Array.isArray(g.hooks) && g.hooks.some(h => isOurs(h.command))));
/** puts one entry per event under root[key][event], replacing any earlier entry of ours and leaving everyone else's */
function mergeEvents(root, key, entries) {
  const hooks = root[key] && typeof root[key] === 'object' && !Array.isArray(root[key]) ? root[key] : {};
  for (const [event, entry] of entries) {
    const list = Array.isArray(hooks[event]) ? hooks[event].filter(g => !groupHasOurs(g)) : [];
    list.push(entry); hooks[event] = list;
  }
  root[key] = hooks; return root;
}
function stripOurs(root, key) {
  const hooks = root[key];
  if (hooks && typeof hooks === 'object') {
    for (const ev of Object.keys(hooks)) { if (Array.isArray(hooks[ev])) { hooks[ev] = hooks[ev].filter(g => !groupHasOurs(g)); if (!hooks[ev].length) delete hooks[ev]; } }
    if (!Object.keys(hooks).length) delete root[key];
  }
  return root;
}
const hasOurs = (root, key) => { const h = root[key]; return !!h && typeof h === 'object' && Object.values(h).some(l => Array.isArray(l) && l.some(groupHasOurs)); };
const star = (command, timeout) => ({ matcher: '*', hooks: [{ type: 'command', command, timeout }] });

/* ───── one definition per agent: where its settings live, what we add ───── */
const DEFS = {
  gemini: {
    file: () => path.join(home(), '.gemini', 'settings.json'),
    events: [['BeforeTool', 'PreToolUse', 5000], ['AfterTool', 'PostToolUse', 5000], ['BeforeAgent', 'UserPromptSubmit', 5000], ['AfterAgent', 'Stop', 5000], ['SessionStart', 'SessionStart', 10000], ['SessionEnd', 'SessionEnd', 10000]],
    install: r => mergeEvents(r, 'hooks', DEFS.gemini.events.map(([ev, canon, t]) => [ev, star(cmd('gemini', canon), t)])),
    remove: r => stripOurs(r, 'hooks'), has: r => hasOurs(r, 'hooks')
  },
  antigravity: {
    file: () => path.join(home(), '.gemini', 'config', 'hooks.json'),
    install: r => {
      const handler = ev => ({ type: 'command', command: cmd('antigravity', ev), timeout: 10 });
      const block = {};
      for (const ev of ['PreToolUse', 'PostToolUse']) block[ev] = [{ matcher: '*', hooks: [handler(ev)] }];
      for (const ev of ['PreInvocation', 'PostInvocation', 'Stop']) block[ev] = [handler(ev)];
      if (r.vortex && !JSON.stringify(r.vortex).includes(MARK)) throw new Error('A hook group named "vortex" that Vortex Desk did not write is already there. Nothing was changed.');
      r.vortex = block; return r;
    },
    remove: r => { if (r.vortex && JSON.stringify(r.vortex).includes(MARK)) delete r.vortex; return r; },
    has: r => !!r.vortex && JSON.stringify(r.vortex).includes(MARK)
  },
  cursor: {
    file: () => path.join(home(), '.cursor', 'hooks.json'),
    events: ['sessionStart', 'sessionEnd', 'beforeSubmitPrompt', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'stop'],
    install: r => { mergeEvents(r, 'hooks', DEFS.cursor.events.map(ev => [ev, { command: cmd('cursor', ev) }])); if (!r.version) r.version = 1; return r; },
    remove: r => stripOurs(r, 'hooks'), has: r => hasOurs(r, 'hooks')
  },
  codex: {
    file: () => path.join(home(), '.codex', 'hooks.json'),
    events: [['SessionStart', 10], ['UserPromptSubmit', 10], ['PreToolUse', 10], ['PermissionRequest', 120], ['PostToolUse', 10], ['Stop', 10], ['SubagentStart', 10], ['SubagentStop', 10], ['Interrupt', 3], ['SessionEnd', 3]],
    install: r => mergeEvents(r, 'hooks', DEFS.codex.events.map(([ev, t]) => {
      const h = { type: 'command', command: cmd('codex', ev), timeout: t };
      if (ev === 'PermissionRequest') h.statusMessage = 'Waiting for your answer in Vortex Desk';
      return [ev, { hooks: [h] }];
    })),
    remove: r => stripOurs(r, 'hooks'), has: r => hasOurs(r, 'hooks')
  },
  copilot: {
    file: () => path.join(home(), '.copilot', 'hooks', 'vortex.json'),
    events: [['sessionStart', 10], ['userPromptSubmitted', 10], ['preToolUse', 10], ['permissionRequest', 120], ['postToolUse', 10], ['agentStop', 10], ['sessionEnd', 3], ['notification', 10]],
    install: r => { mergeEvents(r, 'hooks', DEFS.copilot.events.map(([ev, t]) => [ev, { type: 'command', bash: cmd('copilot', ev), powershell: cmd('copilot', ev), timeoutSec: t }])); r.version = 1; return r; },
    remove: r => { stripOurs(r, 'hooks'); return r; }, has: r => hasOurs(r, 'hooks'),
    removeFileIfEmpty: true
  },
  muse: {
    file: () => path.join(home(), '.config', 'muse', 'settings.json'),
    events: [['SessionStart', 10], ['UserPromptSubmit', 5], ['PreToolUse', 5], ['PermissionRequest', 120], ['PostToolUse', 5], ['Stop', 5], ['SessionEnd', 3]],
    install: r => { const fresh = !Object.keys(r).length; mergeEvents(r, 'hooks', DEFS.muse.events.map(([ev, t]) => [ev, star(cmd('muse', ev), t)])); if (fresh) r.schema_version = 1; return r; },
    remove: r => stripOurs(r, 'hooks'), has: r => hasOurs(r, 'hooks')
  }
};

/* ───── public API ───── */
function status(id) {
  if (id === 'claude-code') { const s = claude.status(); return { id, ok: s.ok, installed: !!s.installed, file: s.file, error: s.error, how: 'hook' }; }
  if (id === 'claude-desktop') return { id, ok: true, installed: claude.status().installed === true, file: '', how: 'auto', note: 'Needs no setup: it comes through the Claude Code hook.' };
  const d = DEFS[id]; if (!d) return { id, ok: false, installed: false, how: 'plugin', note: 'A plugin for this agent is coming.' };
  const file = d.file(), r = readJson(file);
  return r.error ? { id, ok: false, error: r.error, file, installed: false } : { id, ok: true, installed: d.has(r.value), file, how: 'hook' };
}
function install(id) {
  if (id === 'claude-code') { const r = claude.install(true); return { ok: r.ok, file: r.file, error: r.error }; }
  const d = DEFS[id]; if (!d) return { ok: false, error: 'This agent connects through a plugin, which is not built yet.' };
  const file = d.file(), r = readJson(file); if (r.error) return { ok: false, error: r.error, file };
  try { writeJson(file, d.install(r.value)); } catch (e) { return { ok: false, error: e.message, file }; }
  return { ok: true, file };
}
function remove(id) {
  if (id === 'claude-code') { const r = claude.remove(true); return { ok: r.ok, file: r.file, error: r.error }; }
  const d = DEFS[id]; if (!d) return { ok: true };
  const file = d.file(), r = readJson(file); if (r.error) return { ok: false, error: r.error, file };
  const v = d.remove(r.value);
  if (d.removeFileIfEmpty && Object.keys(v).every(k => k === 'version')) { try { fs.copyFileSync(file, file + '.vortex-backup'); fs.unlinkSync(file); } catch (_) { /* gone */ } return { ok: true, file }; }
  writeJson(file, v); return { ok: true, file };
}
const list = () => CATALOG.map(a => ({ ...a, ...status(a.id) }));
const command = (agent = 'my-tool') => cmd(agent, '');

module.exports = { CATALOG, nameOf, status, install, remove, list, command };
