// Developer helper: saves a picture of ONE app window (not the whole screen) so it can be checked.
//   node scripts/shot.js <part of the page url> <out.png>      (app started with --remote-debugging-port=9223)
const fs = require('fs');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find(t => t.type === 'page' && t.url.includes(process.argv[2] || ''));
  if (!page) { console.log('no such page'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) { fs.writeFileSync(process.argv[3] || 'shot.png', Buffer.from(d.result.data, 'base64')); console.log('saved', process.argv[3]); process.exit(0); } };
  setTimeout(() => { console.log('timeout'); process.exit(2); }, 15000);
})();
