// Developer helper: samples the app window's JavaScript for a few seconds and prints where the time goes.
//   node scripts/profile.js [seconds]   (app started with --remote-debugging-port=9223)
const secs = Number(process.argv[2] || 4);
(async () => {
  const page = (await (await fetch('http://127.0.0.1:9223/json')).json()).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const wait = {};
  const send = (method, params = {}) => new Promise(r => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (wait[d.id]) wait[d.id](d.result); };
  await new Promise(r => ws.onopen = r);
  await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start');
  await new Promise(r => setTimeout(r, secs * 1000));
  const { profile } = await send('Profiler.stop');
  const self = {}; const byId = {}; profile.nodes.forEach(n => byId[n.id] = n);
  profile.samples.forEach((s, i) => { const n = byId[s]; const k = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`; self[k] = (self[k] || 0) + (profile.timeDeltas[i] || 0); });
  const total = Object.values(self).reduce((a, b) => a + b, 0);
  Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log(`${(v / 1000).toFixed(0).padStart(6)} ms  ${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`));
  console.log('total sampled', (total / 1000).toFixed(0), 'ms over', secs, 's');
  process.exit(0);
})();
