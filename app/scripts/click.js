// Developer helper: a REAL (trusted) mouse click on an element inside an app window, so features that need a user gesture can be tested.
//   node scripts/click.js <part of page url> "<css selector>"      (app started with --remote-debugging-port=9223)
(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = list.find(t => t.type === 'page' && t.url.includes(process.argv[2]));
  if (!page) { console.log('no such page'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const wait = {};
  const send = (method, params = {}) => new Promise(r => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (wait[d.id]) wait[d.id](d.result); };
  await new Promise(r => ws.onopen = r);
  const r = await send('Runtime.evaluate', { expression: `(()=>{const b=document.querySelector(${JSON.stringify(process.argv[3])});if(!b)return null;const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`, returnByValue: true });
  const pt = r.result.value; if (!pt) { console.log('no such element'); process.exit(1); }
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  console.log('clicked', process.argv[3]); process.exit(0);
})();
