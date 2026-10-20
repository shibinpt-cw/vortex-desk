// Developer helper: listens to an app window for a few seconds and prints every error it throws.
//   node scripts/errors.js <part of page url> [seconds]      (app started with --remote-debugging-port=9223)
(async () => {
  const page = (await (await fetch('http://127.0.0.1:9223/json')).json()).find(t => t.type === 'page' && t.url.includes(process.argv[2] || ''));
  if (!page) { console.log('no such page'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl); const seen = {};
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.method === 'Runtime.exceptionThrown') { const e = d.params.exceptionDetails; const k = (e.exception && e.exception.description || e.text).split('\n').slice(0, 3).join(' | '); seen[k] = (seen[k] || 0) + 1; }
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') { const k = 'console.error: ' + d.params.args.map(a => a.value || a.description).join(' ').slice(0, 200); seen[k] = (seen[k] || 0) + 1; }
  };
  await new Promise(r => ws.onopen = r);
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  await new Promise(r => setTimeout(r, (Number(process.argv[3]) || 4) * 1000));
  console.log(Object.keys(seen).length ? Object.entries(seen).map(([k, v]) => `${v}×  ${k}`).join('\n') : 'no errors');
  process.exit(0);
})();
