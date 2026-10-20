/* Turns agent hook events into what the island shows, and asks the user when it matters.
   Knows nothing about Electron: it gets a `send(event)` function and a Rules object, so it can be tested on its own.
   Several agents can work at once: each has its own pill; the code card follows whichever one moved last. */
const path = require('path');
const { classify } = require('./rules');
const { nameOf } = require('./agents');

const ASK_TIMEOUT = 110000;   // the hook waits ~115 s; after that the agent falls back to its own prompt

class Agent {
  constructor(rules, send, installedIds = () => []) {
    this.rules = rules; this.send = send; this.installedIds = installedIds;
    this.pending = new Map(); this.queue = []; this.active = null; this.seq = 0;
    this.pills = new Map(); this.cur = null; this.running = false; this.pillT = null;
    this.stats = { prompts: 0, tools: 0, files: new Set(), perms: 0, finished: 0 };
  }
  project(ev) { return path.basename(ev.cwd || '') || 'project'; }
  rel(ev, f) { if (!f) return ''; try { const r = path.relative(ev.cwd || '', f); return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : f.replace(/\\/g, '/'); } catch (_) { return f; } }
  statusOf(tool) {
    return ({ Edit: 'Editing file', MultiEdit: 'Editing file', Write: 'Writing file', Bash: 'Running a command', PowerShell: 'Running a command', Read: 'Reading', Grep: 'Searching', Glob: 'Looking for files', WebFetch: 'Reading a web page', WebSearch: 'Searching the web', Task: 'Working with a helper' })[tool] || 'Working';
  }
  snippetOf(tool, i) {
    const t = tool === 'Write' ? i.content : tool === 'MultiEdit' ? ((i.edits || [])[0] || {}).new_string : i.new_string;
    return typeof t === 'string' ? t.split('\n').slice(0, 14).join('\n').slice(0, 700) : '';
  }

  /* ───── pills: one per agent, with a state ───── */
  pill(id, ev) {
    let p = this.pills.get(id);
    if (!p) { p = { id, name: nameOf(id), state: 'idle', project: '', status: '', t: Date.now(), sessions: new Set() }; this.pills.set(id, p); }
    if (ev && ev.cwd) p.project = this.project(ev);
    if (ev && ev.session_id) p.sessions.add(ev.session_id);
    p.t = Date.now(); return p;
  }
  setState(id, state, status, ev) {
    const p = this.pill(id, ev); p.state = state; if (status !== undefined) p.status = status;
    if (state === 'finished') setTimeout(() => { if (p.state === 'finished') { p.state = 'idle'; p.status = ''; this.pushPills(); } }, 5000);
    this.pushPills();
  }
  pushPills() {
    clearTimeout(this.pillT);
    this.pillT = setTimeout(() => {
      const have = new Set([...this.pills.keys()]);
      const list = [...this.pills.values()].map(p => ({ id: p.id, name: p.name, state: p.state, project: p.project, status: p.status }));
      for (const id of this.installedIds()) if (!have.has(id)) list.push({ id, name: nameOf(id), state: 'idle', project: '', status: '' });
      this.send({ type: 'pills', pills: list });
    }, 120);
  }
  drop(id) {
    const p = this.pills.get(id); if (!p) return;
    p.state = 'idle'; p.status = ''; p.sessions.clear();
    if (!this.installedIds().includes(id)) this.pills.delete(id);          // an agent we only just met leaves when its session ends
    this.pushPills();
  }

  /* ───── the code card follows the agent that moved last ───── */
  focus(id, ev, status) {
    if (!this.running || this.cur !== id) {
      this.cur = id; this.running = true;
      this.send({ type: 'activity.start', agent: nameOf(id), project: this.project(ev), status, source: id, file: '', snippet: '' });
    }
  }

  /** one hook event arrives; `reply` is only used for the asking moments */
  handle(ev, reply, onClose) {
    const id = /^[a-z0-9-]{1,24}$/.test(ev.vortex_agent || '') ? ev.vortex_agent : 'claude-code';
    const name = ev.hook_event_name;
    switch (name) {
      case 'SessionStart': this.pill(id, ev); this.setState(id, 'idle', '', ev); break;
      case 'UserPromptSubmit': this.stats.prompts++; this.setState(id, 'thinking', 'Thinking', ev); this.focus(id, ev, 'Thinking'); break;
      case 'PostToolUse': {
        const tr = ev.tool_response || {};
        const failed = tr.is_error === true || tr.interrupted === true || (typeof tr.exit_code === 'number' && tr.exit_code !== 0) || (typeof tr.exitCode === 'number' && tr.exitCode !== 0);
        if (failed) { this.send({ type: 'mood', mood: 'sad', note: 'That one failed' }); this.setState(id, 'error', 'A step failed', ev); }
        else { this.setState(id, 'working', 'Working', ev); if (this.running && this.cur === id) this.send({ type: 'activity.update', status: 'Working' }); }
        break;
      }
      case 'Notification': this.send({ type: 'mood', mood: 'attention', note: `${nameOf(id)} needs you` }); break;
      case 'Stop': case 'SubagentStop':
        if (name === 'Stop') {
          this.stats.finished++; this.setState(id, 'finished', 'Finished', ev);
          if (this.running && this.cur === id) { this.running = false; this.send({ type: 'activity.finish' }); }
        }
        break;
      case 'StopFailure': this.setState(id, 'error', 'Stopped with an error', ev); if (this.running && this.cur === id) { this.running = false; this.send({ type: 'activity.stop' }); } this.send({ type: 'mood', mood: 'sad', note: `${nameOf(id)} stopped with an error` }); break;
      case 'SessionEnd': this.drop(id); if (this.running && this.cur === id) { this.running = false; this.send({ type: 'activity.stop' }); } break;
      case 'PreToolUse': case 'PermissionRequest': this.tool(ev, id, reply, onClose); return;
    }
    if (reply) reply({ ok: true });
  }

  tool(ev, id, reply, onClose) {
    const tool = ev.tool_name || '', input = ev.tool_input || {};
    const asking = ev.hook_event_name === 'PermissionRequest' || (ev.hook_event_name === 'PreToolUse' && (id === 'claude-code' || id === 'claude-desktop'));
    this.stats.tools++;
    const file = this.rel(ev, input.file_path || input.path || '');
    if (file) this.stats.files.add(file);
    const status = this.statusOf(tool);
    this.setState(id, 'working', status, ev); this.focus(id, ev, status);
    if (this.cur === id) this.send({ type: 'activity.update', status, file: file || (tool === 'Bash' ? '' : undefined), snippet: this.snippetOf(tool, input) || (tool === 'Bash' ? String(input.command || '').slice(0, 300) : undefined), progress: null });
    if (!asking) { if (reply) reply({ ok: true }); return; }               // watching only: that agent keeps its own permission rules
    const c = classify(tool, input, ev.cwd);
    const r = this.rules.evaluate(c, ev.cwd);
    if (r.action !== 'ask') { reply({ decision: r.action, reason: r.reason }); return; }
    const rid = 'r' + (++this.seq);
    const entry = { id: rid, ev, c, reply, agentId: id, project: this.project(ev), timer: setTimeout(() => this.finish(rid, 'ask', 'No answer in time'), ASK_TIMEOUT) };
    this.pending.set(rid, entry);
    onClose(() => { if (this.pending.has(rid)) this.finish(rid, null); });
    this.queue.push(rid); this.pump();
  }
  pump() {
    if (this.active || !this.queue.length) return;
    const id = this.queue.shift(), e = this.pending.get(id);
    if (!e) return this.pump();
    this.active = id; this.stats.perms++;
    this.send({ type: 'permission.request', id, risk: e.c.risk, agent: nameOf(e.agentId), project: e.project, summary: e.c.summary, cmd: e.c.cmd, details: e.c.details, rule: e.c.rulePattern });
  }
  /** the user pressed a button in the UI (or it timed out / the hook went away) */
  finish(id, decision, reason) {
    const e = this.pending.get(id); if (!e) return;
    clearTimeout(e.timer); this.pending.delete(id);
    if (this.active === id) { this.active = null; if (decision === null || reason) this.send({ type: 'permission.cancel', id }); }
    this.queue = this.queue.filter(x => x !== id);
    if (decision) e.reply({ decision, reason: reason || (decision === 'deny' ? 'Denied in Vortex Desk' : decision === 'allow' ? 'Allowed in Vortex Desk' : '') });
    this.pump();
  }
  decide(id, decision, rule) {
    const e = this.pending.get(id); if (!e) return;
    if (rule) this.rules.add(e.c, e.ev.cwd, rule.scope, decision === 'deny' ? 'deny' : 'allow');
    this.finish(id, decision === 'deny' ? 'deny' : 'allow');
  }
}

module.exports = { Agent };
