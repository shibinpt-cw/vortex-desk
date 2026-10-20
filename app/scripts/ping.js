// Sends a fake "Claude Code started working" event to the running app, to check the pipe.
const net = require('net'), fs = require('fs'), os = require('os'), path = require('path');
const tok = fs.readFileSync(path.join(process.env.APPDATA, 'vortex-desk', 'pipe-token'), 'utf8').trim();
const s = net.connect(`\\\\.\\pipe\\vortex-desk-${os.userInfo().username}`);
s.on('connect', () => s.write(JSON.stringify({ token: tok, event: process.argv[2] && process.argv[2].startsWith('{') ? JSON.parse(process.argv[2]) : { hook_event_name: process.argv[2] || 'UserPromptSubmit', cwd: process.cwd() } }) + '\n'));
s.setEncoding('utf8'); s.on('data', d => { console.log('app answered:', d.trim()); process.exit(0); });
s.on('error', e => { console.log('could not reach the app:', e.message); process.exit(1); });
setTimeout(() => { console.log('no answer'); process.exit(2); }, 120000);
