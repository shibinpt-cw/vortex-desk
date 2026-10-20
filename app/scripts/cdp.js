// Developer helper: runs a JavaScript snippet inside the running app window (needs the app started with --remote-debugging-port=9223).
//   node scripts/cdp.js "document.title"
const code = process.argv[2];
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const want = process.env.CDP_MATCH;                       // e.g. CDP_MATCH=control.html to talk to the control window
  const page = list.find(t => t.type === 'page' && (!want || t.url.includes(want)));
  if (!page) { console.log('no page'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: code, awaitPromise: true, returnByValue: true } }));
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) { console.log(JSON.stringify(d.result.result.value !== undefined ? d.result.result.value : d.result, null, 1)); ws.close(); process.exit(0); } };
  setTimeout(() => { console.log('timeout'); process.exit(2); }, 60000);
})();
