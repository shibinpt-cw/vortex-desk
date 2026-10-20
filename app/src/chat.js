/* Talking to other AI providers from the main process (so the keys never reach a web page, and there is no browser CORS trouble).
   One small function per wire format: "OpenAI-style" covers OpenAI, DeepSeek, Qwen, Moonshot, OpenRouter and LM Studio; Anthropic and Ollama have their own. */
const PROVIDERS = {
  openai:     { name: 'OpenAI',      kind: 'openai',    base: 'https://api.openai.com/v1', key: true },
  deepseek:   { name: 'DeepSeek',    kind: 'openai',    base: 'https://api.deepseek.com', key: true },
  qwen:       { name: 'Qwen',        kind: 'openai',    base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', key: true },
  moonshot:   { name: 'Moonshot',    kind: 'openai',    base: 'https://api.moonshot.ai/v1', key: true },
  openrouter: { name: 'OpenRouter',  kind: 'openai',    base: 'https://openrouter.ai/api/v1', key: true },
  lmstudio:   { name: 'LM Studio',   kind: 'openai',    base: 'http://localhost:1234/v1', key: false, local: true },
  claude:     { name: 'Claude',      kind: 'anthropic', base: 'https://api.anthropic.com/v1', key: true },
  ollama:     { name: 'Ollama',      kind: 'ollama',    base: 'http://localhost:11434', key: false, local: true }
};

const withTimeout = (ms = 90000) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; };
async function call(url, opt) {
  const t = withTimeout(opt.timeout);
  try {
    const r = await fetch(url, { method: opt.method || 'GET', headers: opt.headers, body: opt.body ? JSON.stringify(opt.body) : undefined, signal: t.signal });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_) { /* not json */ }
    if (!r.ok) { const m = (j && ((j.error && (j.error.message || j.error)) || j.message)) || text.slice(0, 200); const e = new Error(`${r.status}: ${String(m).slice(0, 220)}`); e.status = r.status; throw e; }
    return j;
  } catch (e) { if (e.name === 'AbortError') throw new Error('it took too long to answer'); throw e; } finally { t.done(); }
}

/* the user's turn may carry pictures (parts shaped like Gemini's: {text} or {inlineData:{mimeType,data}}) */
function splitParts(parts) {
  const texts = [], images = [], pdfs = [];
  for (const p of parts || []) {
    if (p.text) texts.push(p.text);
    else if (p.inlineData && /^image\//.test(p.inlineData.mimeType)) images.push(p.inlineData);
    else if (p.inlineData && p.inlineData.mimeType === 'application/pdf') pdfs.push(p.inlineData);
  }
  return { texts, images, pdfs };
}

async function ask({ provider, model, system, history = [], text = '', parts = [], key = '', base = '', maxTokens = 600 }) {
  const P = PROVIDERS[provider]; if (!P) throw new Error('unknown provider ' + provider);
  if (P.key && !key) throw new Error(`no ${P.name} key`);
  const root = (base || P.base).replace(/\/$/, '');
  const { texts, images, pdfs } = splitParts(parts);
  const userText = [...texts, text].filter(Boolean).join('\n\n');
  if (P.kind === 'openai') {
    const content = images.length ? [{ type: 'text', text: userText }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))] : userText;
    const j = await call(root + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(provider === 'openrouter' ? { 'X-Title': 'Vortex Desk' } : {}) },
      body: { model, messages: [{ role: 'system', content: system }, ...history.map(h => ({ role: h.role, content: h.text })), { role: 'user', content }], max_tokens: maxTokens, temperature: .8 } });
    const m = j && j.choices && j.choices[0] && j.choices[0].message; if (!m) throw new Error('empty answer');
    return { text: typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join('') };
  }
  if (P.kind === 'anthropic') {
    const content = [...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.data } })), ...pdfs.map(d => ({ type: 'document', source: { type: 'base64', media_type: d.mimeType, data: d.data } })), { type: 'text', text: userText || '(see the attachment)' }];
    const j = await call(root + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: maxTokens, system, messages: [...history.map(h => ({ role: h.role, content: h.text })), { role: 'user', content }] } });
    return { text: ((j && j.content) || []).map(c => c.text || '').join('') };
  }
  // Ollama
  const j = await call(root + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 180000,
    body: { model, stream: false, messages: [{ role: 'system', content: system }, ...history.map(h => ({ role: h.role, content: h.text })), { role: 'user', content: userText, ...(images.length ? { images: images.map(i => i.data) } : {}) }] } });
  return { text: (j && j.message && j.message.content) || '' };
}

/** the models this key can use (newest-looking first) */
async function models({ provider, key = '', base = '' }) {
  const P = PROVIDERS[provider]; if (!P) return [];
  const root = (base || P.base).replace(/\/$/, '');
  let ids = [];
  if (P.kind === 'openai') { const j = await call(root + '/models', { headers: key ? { Authorization: 'Bearer ' + key } : {}, timeout: 15000 }); ids = (j.data || []).map(m => m.id); }
  else if (P.kind === 'anthropic') { const j = await call(root + '/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout: 15000 }); ids = (j.data || []).map(m => m.id); }
  else { const j = await call(root + '/api/tags', { timeout: 8000 }); ids = (j.models || []).map(m => m.name); }
  if (provider === 'openai') ids = ids.filter(i => /^(gpt|o\d|chatgpt)/.test(i) && !/(audio|realtime|transcribe|tts|image|embedding|moderation|search|instruct)/.test(i));
  return [...new Set(ids)].sort().reverse();
}

module.exports = { PROVIDERS, ask, models };
