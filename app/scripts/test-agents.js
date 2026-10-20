// Tests the multi-agent parts: installing and removing hooks for each agent (in a temporary home, your real files are never touched)
// and how the relay translates each agent's event names.   node scripts/test-agents.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-agents-'));
process.env.VORTEX_HOME = tmp; process.env.VORTEX_PIPE_SUFFIX = '-agents'; process.env.VORTEX_DATA_DIR = path.join(tmp, 'data');
const agents = require('../src/agents');
const { Agent } = require('../src/agent');
const { Rules } = require('../src/rules');
const { startPipe } = require('../src/pipe');

let ok = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

(async () => {
  console.log('installers');
  // someone else's settings that must survive
  fs.mkdirSync(path.join(tmp, '.gemini', 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.gemini', 'settings.json'), JSON.stringify({ theme: 'dark', hooks: { BeforeTool: [{ matcher: 'other', hooks: [{ type: 'command', command: 'custom.exe' }] }] } }));
  for (const id of ['gemini', 'cursor', 'codex', 'copilot', 'muse', 'antigravity']) {
    await t(`${id}: install, twice, remove`, () => {
      assert.strictEqual(agents.status(id).installed, false);
      assert(agents.install(id).ok); assert(agents.install(id).ok);
      assert.strictEqual(agents.status(id).installed, true);
      const file = agents.status(id).file, text = fs.readFileSync(file, 'utf8');
      assert.strictEqual((text.match(/vortex-hook\.js/g) || []).length > 0, true);
      if (id === 'gemini') { const g = read(file); assert.strictEqual(g.theme, 'dark'); assert.strictEqual(g.hooks.BeforeTool.length, 2); assert.strictEqual(g.hooks.BeforeTool[0].matcher, 'other'); }
      assert(agents.remove(id).ok);
      assert.strictEqual(agents.status(id).installed, false);
      if (id === 'gemini') { const g = read(file); assert.strictEqual(g.theme, 'dark'); assert.strictEqual(g.hooks.BeforeTool.length, 1); }
      if (id === 'copilot') assert.strictEqual(fs.existsSync(file), false);               // the file was ours alone, so it goes
    });
  }
  await t('a broken settings file is left alone', () => {
    fs.writeFileSync(path.join(tmp, '.cursor', 'hooks.json'), '{ nope'); const r = agents.install('cursor');
    assert.strictEqual(r.ok, false); assert.strictEqual(fs.readFileSync(path.join(tmp, '.cursor', 'hooks.json'), 'utf8'), '{ nope');
  });

  console.log('the relay and the agents');
  const seen = [];
  const agent = new Agent(new Rules(path.join(tmp, 'rules.json')), e => { if (e.type === 'permission.request') setTimeout(() => agent.decide(e.id, 'allow'), 100); seen.push(e); }, () => []);
  const pipe = startPipe(process.env.VORTEX_DATA_DIR, (ev, reply, onClose) => { seen.push({ type: 'raw', ev }); agent.handle(ev, reply, onClose); });
  const hook = path.join(__dirname, '..', 'hook', 'vortex-hook.js');
  const run = (argv, payload, env = {}) => new Promise(res => { const p = spawn(process.execPath, [hook, ...argv], { env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: '', ...env } }); let out = ''; p.stdout.on('data', d => out += d); p.on('close', () => res(out)); p.stdin.end(JSON.stringify(payload)); });
  await t('Gemini: BeforeTool becomes PreToolUse, with its own pill, and is only watched', async () => {
    const out = await run(['--agent', 'gemini', 'PreToolUse'], { tool_name: 'run_shell_command', tool_input: { command: 'ls' }, cwd: 'D:/p', session_id: 'g1' });
    assert.strictEqual(out, ''); const raw = seen.filter(s => s.type === 'raw').pop().ev;
    assert.strictEqual(raw.hook_event_name, 'PreToolUse'); assert.strictEqual(raw.vortex_agent, 'gemini');
  });
  await t('Antigravity: toolCall and conversationId are understood', async () => {
    await run(['--agent', 'antigravity', 'PreToolUse'], { toolCall: { name: 'run_command', args: { command: 'x' } }, conversationId: 'c9', cwd: 'D:/p' });
    const raw = seen.filter(s => s.type === 'raw').pop().ev; assert.strictEqual(raw.tool_name, 'run_command'); assert.strictEqual(raw.session_id, 'c9');
  });
  await t('Copilot asks with permissionRequest and gets a bare decision back', async () => {
    const out = await run(['--agent', 'copilot', 'permissionRequest'], { tool_name: 'bash', tool_input: { command: 'git push origin main' }, cwd: 'D:/p' });
    assert.deepStrictEqual(JSON.parse(out), { permissionDecision: 'allow' });
  });
  await t('Codex asks with PermissionRequest and gets the hookSpecificOutput form', async () => {
    const out = await run(['--agent', 'codex'], { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: 'D:/p' });
    assert.strictEqual(JSON.parse(out).hookSpecificOutput.decision.behavior, 'allow');
  });
  await t('a session started from the Claude desktop app still gets the question', async () => {
    const out = await run([], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: 'D:/p' }, { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' });
    assert.strictEqual(JSON.parse(out).hookSpecificOutput.permissionDecision, 'allow');
  });
  await t('pills: each agent gets its own, with a state', async () => {
    await run(['--agent', 'cursor', 'beforeSubmitPrompt'], { cwd: 'D:/p', session_id: 'k1' });
    await new Promise(r => setTimeout(r, 400));
    const last = seen.filter(s => s.type === 'pills').pop(); const names = last.pills.map(p => p.id);
    assert(names.includes('cursor') && names.includes('gemini'), names.join()); assert.strictEqual(last.pills.find(p => p.id === 'cursor').state, 'thinking');
  });
  pipe.close();
  console.log(`\n${ok} passed${process.exitCode ? ', some FAILED' : ''}`);
  process.exit(process.exitCode || 0);
})();
