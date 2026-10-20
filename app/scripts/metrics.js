// Developer helper: how often does the page lay out, restyle and paint? (app started with --remote-debugging-port=9223)
//   node scripts/metrics.js [seconds]
const secs = Number(process.argv[2] || 5);
(async () => {
  const page = (await (await fetch('http://127.0.0.1:9223/json')).json()).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const wait = {};
  const send = (method, params = {}) => new Promise(r => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (wait[d.id]) wait[d.id](d.result); };
  await new Promise(r => ws.onopen = r); await send('Performance.enable');
  const get = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const a = await get(); await new Promise(r => setTimeout(r, secs * 1000)); const b = await get();
  for (const k of ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'JSHeapUsedSize', 'Nodes', 'JSEventListeners'])
    console.log(k.padEnd(20), k.endsWith('Duration') ? ((b[k] - a[k]) / secs * 100).toFixed(1) + ' % of a core' : k.endsWith('Count') ? ((b[k] - a[k]) / secs).toFixed(1) + ' /s' : (b[k] / 1e6).toFixed(k === 'Nodes' || k === 'JSEventListeners' ? 3 : 1) + ' M');
  process.exit(0);
})();
