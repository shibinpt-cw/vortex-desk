// Tests the careful "do things on the computer" loop with a pretend screen and a scripted brain (no real clicks, no internet).
//   node scripts/test-operator.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Operator } = require('../src/operator');
const { Computer } = require('../src/computer');

let ok = 0;
const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { console.error('  ✗', n, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };

/** a computer that only records what was asked of it */
function fakeComputer(roots = []) {
  const log = [];
  return { log, roots: () => roots,
    windows: async () => [{ pid: 1, name: 'notepad', title: 'Untitled', h: 5 }], shot: async () => ({ jpeg: 'AAAA' }),
    findApp: async q => { log.push('find ' + q); return /whats/i.test(q) ? [{ name: 'WhatsApp', id: 'WA!App' }] : []; },
    openApp: async q => { log.push('open ' + q); return 'WhatsApp'; }, focus: async () => log.push('focus'),
    click: async (a) => log.push('click ' + (a.target || '')), type: async x => log.push('type ' + x), keys: async k => log.push('key ' + k), scroll: async () => log.push('scroll'),
    createFolder: p => { log.push('mkdir ' + p); return p; }, listFolder: () => [], moveFile: (a, b) => { log.push(`move ${a} -> ${b}`); return b; } };
}
/** a brain that plays back a list of answers */
const script = steps => { let i = 0; return async () => JSON.stringify(steps[Math.min(i++, steps.length - 1)]); };
function make(steps, { comp = fakeComputer(), settings = { on: true, confirm: true }, answers = () => true } = {}) {
  const events = [];
  const op = new Operator({ computer: comp, generate: script(steps), send: e => { events.push(e); if (e.type === 'task.confirm') setImmediate(() => op.answer(e.id, answers(e))); }, settings: () => settings, quit: () => events.push({ type: 'QUIT' }), log: () => {}, fast: true });
  return { op, events, comp };
}
const A = (type, extra = {}, top = {}) => ({ thought: 'x', action: { type, ...extra }, ...top });

(async () => {
  console.log('doing things');
  const msg = [A('find_app', { query: 'whatsapp' }), A('open_app', { app: 'WhatsApp' }), A('click', { target: 'search', box: [40, 10, 60, 40] }), A('type', { text: 'Siyad', target: 'search box' }),
    A('click', { target: 'Siyad chat', box: [100, 10, 130, 40] }), A('type', { text: 'hi, how are you', target: 'message box' }),
    A('key', { key: 'enter' }, { irreversible: true, confirm: 'Send “hi, how are you” to Siyad on WhatsApp' }), A('done', { summary: 'Sent.' })];
  await t('a message: find, open, search, check, type, and a yes before it is sent', async () => {
    const { op, events, comp } = make(msg); await op.start('send hi to Siyad on WhatsApp');
    const q = events.filter(e => e.type === 'task.confirm'); assert.strictEqual(q.length, 1); assert(/Siyad/.test(q[0].summary));
    assert.deepStrictEqual(comp.log.slice(0, 2), ['find whatsapp', 'open WhatsApp']);
    assert(comp.log.includes('type hi, how are you') && comp.log[comp.log.length - 1] === 'key enter');
    assert.strictEqual(events.at(-2).type, 'task.done');
  });
  await t('saying NO to the send stops the message from going out', async () => {
    const { op, comp } = make(msg, { answers: () => false }); await op.start('send hi');
    assert(!comp.log.includes('key enter'));
  });
  await t('with "ask before sending" off, it just sends', async () => {
    const { op, comp, events } = make(msg, { settings: { on: true, confirm: false } }); await op.start('send hi');
    assert(comp.log.includes('key enter')); assert.strictEqual(events.filter(e => e.type === 'task.confirm').length, 0);
  });
  await t('computer control switched off: nothing happens', async () => {
    const { op, events, comp } = make(msg, { settings: { on: false, confirm: true } }); await op.start('x');
    assert.strictEqual(comp.log.length, 0); assert(events.some(e => e.type === 'task.fail' && /switched off/.test(e.reason)));
  });
  await t('passwords are never typed', async () => {
    const { op, comp } = make([A('type', { text: 'hunter2', target: 'password field' }), A('give_up', { summary: 'needs you' })]); await op.start('log in');
    assert(!comp.log.some(l => l.startsWith('type')));
  });
  await t('dangerous keys are refused', async () => {
    const { op, comp } = make([A('key', { key: 'Alt+F4' }), A('key', { key: 'Delete' }), A('done', {})]); await op.start('x');
    assert(!comp.log.some(l => l.startsWith('key')));
  });
  await t('"close yourself" quits after her goodbye', async () => {
    const { op, events } = make([A('quit_lumina', { summary: 'Bye!' })]); await op.start('close yourself'); await new Promise(r => setTimeout(r, 2800));
    assert(events.some(e => e.type === 'QUIT'));
  });
  await t('Esc stops her between steps', async () => {
    const { op, events } = make([A('wait', { ms: 1 })]); const p = op.start('loop forever'); setTimeout(() => op.stop(), 30); await p;
    assert(events.some(e => e.type === 'task.fail' && e.stopped));
  });
  await t('a task that never finishes gives up after 30 steps', async () => {
    const { op, events } = make([A('wait', { ms: 1 })]); await op.start('x'); assert(events.some(e => e.type === 'task.fail' && /many steps/.test(e.reason)));
  });

  console.log('folders');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-files-')), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-outside-'));
  fs.writeFileSync(path.join(tmp, 'a.txt'), '1'); fs.writeFileSync(path.join(tmp, 'b.jpg'), '2'); fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
  const real = new Computer({ roots: () => [tmp], native: {} });
  await t('make a folder and move files in, never overwriting', () => {
    real.createFolder(path.join(tmp, 'Photos')); const to = real.moveFile(path.join(tmp, 'b.jpg'), path.join(tmp, 'Photos'));
    assert(fs.existsSync(path.join(tmp, 'Photos', 'b.jpg')) && !fs.existsSync(path.join(tmp, 'b.jpg')));
    fs.writeFileSync(path.join(tmp, 'b.jpg'), '3'); const to2 = real.moveFile(path.join(tmp, 'b.jpg'), path.join(tmp, 'Photos')); assert(/b \(2\)\.jpg$/.test(to2));
  });
  await t('nothing outside the allowed folder can be touched', () => {
    assert.throws(() => real.moveFile(path.join(outside, 'secret.txt'), path.join(tmp, 'x.txt')), /outside the folders/);
    assert.throws(() => real.moveFile(path.join(tmp, 'a.txt'), path.join(outside, 'a.txt')), /outside the folders/);
    assert.throws(() => real.listFolder(outside), /outside the folders/);
    assert.throws(() => real.createFolder(path.join(tmp, '..', 'escape')), /outside the folders/);
  });
  await t('no folder allowed yet: she says so', () => assert.throws(() => new Computer({ roots: () => [], native: {} }).listFolder(tmp), /no folder is allowed yet/));
  await t('moving needs a yes to the plan first', async () => {
    const comp = new Computer({ roots: () => [tmp], native: {} }); comp.windows = async () => []; comp.shot = async () => ({ jpeg: 'A' });
    const plan = [A('move_file', { src: path.join(tmp, 'a.txt'), dst: path.join(tmp, 'Docs', 'a.txt') }), A('ask_user', { question: 'Move a.txt into Docs?' }), A('move_file', { src: path.join(tmp, 'a.txt'), dst: path.join(tmp, 'Docs', 'a.txt') }), A('done', {})];
    const { op } = make(plan, { comp }); await op.start('tidy up');
    assert(fs.existsSync(path.join(tmp, 'Docs', 'a.txt')));
  });
  console.log(`\n${ok} passed${process.exitCode ? ', some FAILED' : ''}`); process.exit(process.exitCode || 0);
})();
