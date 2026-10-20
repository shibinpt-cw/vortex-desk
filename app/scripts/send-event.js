// Developer helper: sends a pretend agent event through the real hook relay to the running app.
//   node scripts/send-event.js <agent> <EventName> [project-folder] [tool command]
const { spawn } = require('child_process');
const path = require('path');
const [agent = 'demo', event = 'UserPromptSubmit', cwd = 'D:/demo-project', command] = process.argv.slice(2);
const payload = { cwd, session_id: agent + '-1', prompt: 'hello' };
if (command) { payload.tool_name = 'Bash'; payload.tool_input = { command }; }
const p = spawn(process.execPath, [path.join(__dirname, '..', 'hook', 'vortex-hook.js'), '--agent', agent, event], { stdio: ['pipe', 'inherit', 'inherit'] });
p.stdin.end(JSON.stringify(payload));
p.on('close', c => console.log(`sent ${agent} ${event} (exit ${c})`));
