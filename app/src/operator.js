/* Lumina doing things on the computer, carefully: look at the screen, choose ONE next step, do it, look again.
   She never rushes, never types a password, never deletes anything, and asks before anything that cannot be undone
   (sending a message, moving files). You can stop her at any time (Esc, or the Stop button). */
const MAX_STEPS = 30, MAX_MS = 6 * 60 * 1000;
const BLOCKED_KEYS = new Set(['alt+f4', 'delete', 'shift+delete', 'ctrl+shift+delete', 'ctrl+alt+delete']);
const SECRET = /(password|passcode|passphrase|\botp\b|one.?time|verification code|\bcvv\b|\bcvc\b|card number|security code|\bpin\b|\bssn\b)/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ACTIONS = ['find_app', 'open_app', 'focus_window', 'click', 'double_click', 'right_click', 'type', 'key', 'scroll', 'wait', 'create_folder', 'list_folder', 'move_file', 'ask_user', 'quit_lumina', 'done', 'give_up'];
const SCHEMA = {
  type: 'OBJECT', required: ['thought', 'action'],
  properties: {
    thought: { type: 'STRING' }, say: { type: 'STRING' }, confirm: { type: 'STRING' }, irreversible: { type: 'BOOLEAN' },
    action: { type: 'OBJECT', required: ['type'], properties: {
      type: { type: 'STRING', enum: ACTIONS }, query: { type: 'STRING' }, app: { type: 'STRING' }, pid: { type: 'INTEGER' }, title: { type: 'STRING' },
      target: { type: 'STRING' }, box: { type: 'ARRAY', items: { type: 'INTEGER' } }, point: { type: 'ARRAY', items: { type: 'INTEGER' } },
      text: { type: 'STRING' }, key: { type: 'STRING' }, clicks: { type: 'INTEGER' }, ms: { type: 'INTEGER' },
      path: { type: 'STRING' }, src: { type: 'STRING' }, dst: { type: 'STRING' }, question: { type: 'STRING' }, summary: { type: 'STRING' } } }
  }
};

const SYSTEM = `You are Lumina, a careful assistant who operates the user's Windows computer FOR them, one small step at a time.
Every turn you get: the goal, a picture of the whole screen, the open windows, and what you did so far. Choose exactly ONE next action.
Coordinates are a 0 to 1000 grid over the whole picture: box is [ymin, xmin, ymax, xmax] around the element you want to click. Aim at its middle.

How to work:
- Be patient and precise. After every click or typing, LOOK at the next picture and check it did what you expected before you go on. If not, try something else.
- If an app is not open: use find_app to see if it is installed, then open_app. If it is already open, focus_window brings it forward.
- Messaging: open the app, find the right chat (search for the contact's name, click the result), CHECK that the chat header shows the right person, click the message box, type the message, then send it. The step that sends (pressing Enter or clicking Send) must have irreversible=true and confirm="what will be sent to whom".
- If two contacts or results could be right, use ask_user. If you cannot find something after a few careful tries, use give_up and say why.
- Folders: use list_folder first. Before the first move_file, use ask_user to show the plan in plain words (which files go where). Only move after a yes. You can only touch the allowed folders, and you can never delete anything.
- Never type passwords, codes or payment details, and never go through a login or payment page: stop with ask_user or give_up so the person can do it.
- "Close yourself" or "quit" means quit_lumina.
- Write say, confirm, question and summary in the SAME LANGUAGE as the goal. say is one short friendly sentence for the person (leave it empty if there is nothing worth saying). When the goal is finished use done with a short summary.
Never describe what you cannot see. Never invent coordinates: if the element is not visible, scroll or look somewhere else first.`;

class Operator {
  /** deps: { computer, generate(opts)→text, send(event), settings()→{on,confirm}, quit(), log(line), fast? } */
  constructor(d) { this.d = d; this.task = null; this.seq = 0; this.waits = new Map(); }
  get running() { return !!this.task; }

  async start(goal) {
    const s = this.d.settings();
    if (!s.on) { this.d.send({ type: 'task.fail', reason: 'Computer control is switched off. Turn it on in the Vortex Desk control app, under Computer control.' }); return false; }
    if (this.task) { this.d.send({ type: 'task.fail', reason: 'I am already doing something. Press Esc to stop me first.' }); return false; }
    const t = this.task = { id: 't' + (++this.seq), goal: String(goal || '').slice(0, 400), stopped: false, hist: [], approvedMoves: false, t0: Date.now(), abort: new AbortController(), windows: null };
    this.d.send({ type: 'task.start', goal: t.goal }); this.d.log(`task start: ${t.goal}`);
    try { await this.loop(t); }
    catch (e) {
      if (t.stopped) { this.d.send({ type: 'task.fail', reason: 'Stopped.', stopped: true }); }
      else { this.d.log('task error: ' + e.message); this.d.send({ type: 'task.fail', reason: friendly(e) }); }
    } finally { this.task = null; for (const [, w] of this.waits) w(false); this.waits.clear(); this.d.send({ type: 'task.end' }); }
    return true;
  }
  stop() { const t = this.task; if (!t) return; t.stopped = true; t.abort.abort(); for (const [, w] of this.waits) w(false); this.waits.clear(); }
  answer(id, yes) { const w = this.waits.get(id); if (w) { this.waits.delete(id); w(!!yes); } }

  /** shows a yes/no card and waits for the person */
  ask(t, summary, detail) {
    const id = t.id + 'q' + (++this.seq);
    this.d.send({ type: 'task.confirm', id, summary, detail: detail || '' });
    return new Promise(res => { this.waits.set(id, res); setTimeout(() => { if (this.waits.has(id)) { this.waits.delete(id); res(false); } }, 120000); });
  }

  async observe(t, forceWindows) {
    if (forceWindows || !t.windows) { try { t.windows = await this.d.computer.windows(); } catch (_) { t.windows = t.windows || []; } }
    const shot = await this.d.computer.shot();
    return { shot, windows: t.windows };
  }

  async decide(t, obs, n) {
    const roots = this.d.computer.roots();
    const text = [`GOAL: ${t.goal}`, `Step ${n + 1} of at most ${MAX_STEPS}.`,
      `Open windows: ${obs.windows.length ? obs.windows.slice(0, 25).map(w => `${w.name} "${w.title.slice(0, 60)}" (pid ${w.pid})`).join('; ') : 'none found'}`,
      `Folders you may use: ${roots.length ? roots.join('; ') : 'none allowed yet'}`,
      `What you did so far:\n${t.hist.slice(-10).map((h, i) => `${i + 1}. ${h}`).join('\n') || '(nothing yet)'}`].join('\n');
    const raw = await this.d.generate({ system: SYSTEM, schema: SCHEMA, temperature: .2, maxTokens: 700, signal: t.abort.signal,
      contents: [{ role: 'user', parts: [{ text }, { inlineData: { mimeType: 'image/jpeg', data: obs.shot.jpeg } }] }] });
    let o; try { o = JSON.parse(raw); } catch (_) { throw new Error('I could not understand my own plan'); }
    if (!o || !o.action || !ACTIONS.includes(o.action.type)) throw new Error('I made a plan I cannot do');
    return o;
  }

  async loop(t) {
    for (let n = 0; n < MAX_STEPS; n++) {
      if (t.stopped) throw new Error('stopped');
      if (Date.now() - t.t0 > MAX_MS) throw new Error('this is taking too long');
      const obs = await this.observe(t, n === 0 || t.refresh); t.refresh = false;
      const o = await this.decide(t, obs, n);
      if (t.stopped) throw new Error('stopped');
      const a = o.action;
      if (o.say) this.d.send({ type: 'task.say', text: o.say });
      this.d.send({ type: 'task.step', text: describe(a, o) });
      const r = await this.act(t, o);
      if (r.end) return;
      t.hist.push(`${a.type}${brief(a)} → ${r.result}`);
      await sleep(this.d.fast ? 0 : r.settle || 700);          // not rushing: let the screen settle before looking again
    }
    throw new Error('I tried many steps and could not finish');
  }

  async act(t, o) {
    const a = o.action, c = this.d.computer, ok = (result, settle) => ({ result, settle });
    // anything that cannot be undone needs a yes first
    if (o.irreversible && this.d.settings().confirm) {
      const yes = await this.ask(t, o.confirm || o.say || 'Do this now?', o.thought);
      if (t.stopped) throw new Error('stopped');
      if (!yes) return ok('the person said NO to that step, so it was not done', 300);
    }
    switch (a.type) {
      case 'find_app': { const m = await c.findApp(a.query || a.app); return ok(m.length ? 'installed: ' + m.map(x => `${x.name} (id ${x.id})`).join('; ') : `no installed app matches "${a.query || a.app}"`, 200); }
      case 'open_app': { const name = await c.openApp(a.app || a.query); t.refresh = true; return ok(`opened ${name}; wait for it to appear`, 3500); }
      case 'focus_window': {
        const ws = t.windows || [], w = ws.find(x => (a.pid && x.pid === a.pid) || (a.title && x.title.toLowerCase().includes(String(a.title).toLowerCase())) || (a.app && x.name.toLowerCase() === String(a.app).toLowerCase()));
        if (!w) { t.refresh = true; return ok('that window was not found in the list', 300); }
        await c.focus(w); return ok(`brought "${w.title.slice(0, 40)}" to the front`, 700);
      }
      case 'click': case 'double_click': case 'right_click': {
        await c.click(a, { button: a.type === 'right_click' ? 'right' : 'left', double: a.type === 'double_click' });
        return ok(`${a.type.replace('_', ' ')}ed ${a.target || 'there'}`.replace('clicked', 'clicked'), 900);
      }
      case 'type': {
        if (SECRET.test(`${a.target || ''} ${o.thought || ''}`)) return ok('REFUSED: I never type passwords, codes or payment details; ask the person to do that part', 200);
        if (!a.text) return ok('nothing to type', 100);
        await c.type(a.text); return ok(`typed "${String(a.text).slice(0, 60)}"`, 500);
      }
      case 'key': {
        const k = String(a.key || '').toLowerCase().replace(/\s/g, '');
        if (BLOCKED_KEYS.has(k)) return ok(`REFUSED: ${k} is not allowed`, 100);
        await c.keys(k); return ok(`pressed ${k}`, 800);
      }
      case 'scroll': await c.scroll(a.clicks || -3); return ok(`scrolled ${a.clicks || -3}`, 700);
      case 'wait': await sleep(this.d.fast ? 0 : Math.min(5000, a.ms || 1500)); return ok('waited', 300);
      case 'create_folder': return ok('created ' + c.createFolder(a.path), 200);
      case 'list_folder': { const l = c.listFolder(a.path); return ok(`${a.path} has ${l.length} items: ` + l.slice(0, 60).map(x => `${x.type === 'folder' ? '[folder] ' : ''}${x.name}`).join(', '), 200); }
      case 'move_file': {
        if (!t.approvedMoves) return ok('REFUSED: ask_user for a yes to your plan before moving anything', 100);
        return ok(`moved to ${c.moveFile(a.src, a.dst)}`, 200);
      }
      case 'ask_user': { const yes = await this.ask(t, a.question || 'Is that OK?', o.thought); if (t.stopped) throw new Error('stopped'); if (yes) t.approvedMoves = true; return ok(yes ? 'the person said YES' : 'the person said NO', 200); }
      case 'quit_lumina': this.d.send({ type: 'task.done', summary: a.summary || o.say || '' }); setTimeout(() => this.d.quit(), 2600); return { end: true };
      case 'done': this.d.send({ type: 'task.done', summary: a.summary || o.say || 'Done.' }); return { end: true };
      case 'give_up': this.d.send({ type: 'task.fail', reason: a.summary || o.say || 'I could not do that.' }); return { end: true };
    }
    return ok('unknown action', 100);
  }
}

const brief = a => a.query ? ` "${a.query}"` : a.app ? ` "${a.app}"` : a.target ? ` ${a.target}` : a.text ? ` "${String(a.text).slice(0, 30)}"` : a.key ? ` ${a.key}` : a.path ? ` ${a.path}` : '';
const describe = (a, o) => ({ find_app: `Looking for ${a.query || a.app}`, open_app: `Opening ${a.app || a.query}`, focus_window: 'Bringing the window forward', click: `Clicking ${a.target || ''}`, double_click: `Opening ${a.target || ''}`, right_click: `Right-clicking ${a.target || ''}`, type: 'Typing', key: `Pressing ${a.key}`, scroll: 'Scrolling', wait: 'Waiting a moment', create_folder: 'Making a folder', list_folder: 'Looking in a folder', move_file: 'Moving a file', ask_user: 'Asking you', quit_lumina: 'Saying goodbye', done: 'Finished', give_up: 'Stopping' })[a.type] || a.type;
const friendly = e => { const m = String(e.message || e); if (/ 429$|429/.test(m)) return 'Gemini is out of free requests for now, so I cannot see the screen. Try again in a little while.'; if (/too long|too many/.test(m)) return m; if (/no Gemini key/.test(m)) return 'I need the Gemini key to see the screen.'; return m.slice(0, 160); };

module.exports = { Operator, SCHEMA, ACTIONS };
