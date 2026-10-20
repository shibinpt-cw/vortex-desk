// Tests how we talk to the other AI providers, against a tiny local fake server (no real keys, no internet).
//   node scripts/test-chat-providers.js
const assert = require('assert');
const http = require('http');
const chat = require('../src/chat');
let ok = 0;
const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { console.error('  ✗', n, '\n   ', e.message); process.exitCode = 1; } };
const seen = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const body = b ? JSON.parse(b) : null; seen.push({ url: req.url, auth: req.headers.authorization, xkey: req.headers['x-api-key'], ver: req.headers['anthropic-version'], body });
    res.setHeader('Content-Type', 'application/json'); const U = req.url.split('?')[0];
    if (U === '/v1/chat/completions') res.end(JSON.stringify({ choices: [{ message: { content: '{"reply":"hello from openai","mood":"happy"}' } }] }));
    else if (U === '/v1/models' && req.headers['x-api-key']) res.end(JSON.stringify({ data: [{ id: 'claude-a' }, { id: 'claude-b' }] }));
    else if (U === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3' }, { id: 'gpt-4o-mini' }, { id: 'whisper-1' }] }));
    else if (U === '/v1/messages') res.end(JSON.stringify({ content: [{ type: 'text', text: 'hello from claude' }] }));
    else if (U === '/api/chat') res.end(JSON.stringify({ message: { content: 'hello from ollama' } }));
    else if (U === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'llama3' }, { name: 'qwen3' }] }));
    else if (U === '/bad/chat/completions') { res.statusCode = 401; res.end(JSON.stringify({ error: { message: 'bad key' } })); }
    else { res.statusCode = 404; res.end('{}'); }
  });
});
srv.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  console.log('providers');
  await t('OpenAI-style: key, system, history and a picture go out; the text comes back', async () => {
    const r = await chat.ask({ provider: 'deepseek', model: 'm', system: 'SYS', history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }], text: 'hi', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }], key: 'k1', base: base + '/v1' });
    assert.strictEqual(r.text, '{"reply":"hello from openai","mood":"happy"}');
    const s = seen.pop(); assert.strictEqual(s.auth, 'Bearer k1'); assert.strictEqual(s.body.messages[0].content, 'SYS'); assert.strictEqual(s.body.messages.length, 4);
    assert.strictEqual(s.body.messages[3].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
  });
  await t('Anthropic: x-api-key, version header, pictures as image blocks', async () => {
    const r = await chat.ask({ provider: 'claude', model: 'm', system: 'SYS', text: 'hi', parts: [{ inlineData: { mimeType: 'image/png', data: 'BBBB' } }], key: 'k2', base: base + '/v1' });
    assert.strictEqual(r.text, 'hello from claude'); const s = seen.pop();
    assert.strictEqual(s.xkey, 'k2'); assert.strictEqual(s.ver, '2023-06-01'); assert.strictEqual(s.body.system, 'SYS'); assert.strictEqual(s.body.messages[0].content[0].type, 'image');
  });
  await t('Ollama: no key needed, local address', async () => { const r = await chat.ask({ provider: 'ollama', model: 'llama3', system: 'S', text: 'hi', base }); assert.strictEqual(r.text, 'hello from ollama'); });
  await t('a missing key is reported before anything is sent', async () => { const n = seen.length; await assert.rejects(chat.ask({ provider: 'openai', model: 'x', system: '', text: 'hi' }), /no OpenAI key/); assert.strictEqual(seen.length, n); });
  await t('a refused key gives a readable error', async () => { await assert.rejects(chat.ask({ provider: 'openai', model: 'x', system: '', text: 'hi', key: 'bad', base: base + '/bad' }), /401: bad key/); });
  await t('model lists: OpenAI hides embeddings and speech; Ollama lists what is installed', async () => {
    assert.deepStrictEqual(await chat.models({ provider: 'openai', key: 'k', base: base + '/v1' }), ['gpt-4o-mini', 'gpt-4o']);
    assert.deepStrictEqual(await chat.models({ provider: 'claude', key: 'k', base: base + '/v1' }), ['claude-b', 'claude-a']);
    assert.deepStrictEqual(await chat.models({ provider: 'ollama', base }), ['qwen3', 'llama3']);
  });
  srv.close(); console.log(`\n${ok} passed${process.exitCode ? ', some FAILED' : ''}`); process.exit(process.exitCode || 0);
});
