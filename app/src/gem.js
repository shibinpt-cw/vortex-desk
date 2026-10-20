/* Gemini from the main process, for the parts that do not live in a web page (the computer operator).
   Free keys have a separate small limit per model, so this tries the next model when one is out of requests or busy. */
const MODELS = ['gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite-preview', 'gemini-3.5-flash-lite'];
const bad = {}, noThink = {};

async function call(key, model, body, signal) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal });
  if (!r.ok) { const e = new Error('gemini ' + r.status); e.status = r.status; throw e; }
  const j = await r.json(), parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  if (!parts || !parts.length) throw Object.assign(new Error('gemini empty'), { status: 0 });
  return parts.map(p => p.text || '').join('');
}

/** → the model's text. opts: { system, contents, schema, temperature, maxTokens, signal } */
async function generate(key, opts, again = false) {
  if (!key) throw new Error('no Gemini key');
  const gc = { temperature: opts.temperature ?? .3, maxOutputTokens: opts.maxTokens || 900 };
  if (opts.schema) { gc.responseMimeType = 'application/json'; gc.responseSchema = opts.schema; }
  const now = Date.now(), live = MODELS.filter(m => !(bad[m] > now));
  let last;
  for (const model of live.length ? live : MODELS) {
    for (const think of [true, false]) {
      if (think && noThink[model]) continue;
      const body = { contents: opts.contents, generationConfig: think && model.includes('flash') ? { ...gc, thinkingConfig: { thinkingBudget: 0 } } : gc };
      if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
      try {
        const t = await call(key, model, body, opts.signal);
        if (MODELS[0] !== model) { MODELS.splice(MODELS.indexOf(model), 1); MODELS.unshift(model); }
        return t;
      } catch (e) {
        last = e;
        if (e.name === 'AbortError') throw e;
        if (e.status === 401 || e.status === 403) throw e;
        if (e.status === 429) bad[model] = Date.now() + 600000; else if (e.status === 404) bad[model] = Date.now() + 1800000; else if (e.status === 503) bad[model] = Date.now() + 60000;
        if (think && e.status === 400) { noThink[model] = true; continue; }
        break;
      }
    }
  }
  if (!again && last && (last.status === 429 || last.status === 503)) { await new Promise(r => setTimeout(r, 1800)); for (const m of MODELS) delete bad[m]; return generate(key, opts, true); }
  throw last || new Error('Gemini did not answer');
}

module.exports = { generate };
