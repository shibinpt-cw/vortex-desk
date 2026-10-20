// Developer helper: which Gemini chat/vision models answer right now with this key? (free keys have a separate small limit per model)
//   node scripts/probe-models.js        — the key is never printed
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const key = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'keys.local.json'), 'utf8')).gemini.trim();
// a tiny valid PNG (64x64, dark blue) built here so no image file is needed
function png() {
  const w = 64, h = 64, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 20; raw[o + 1] = 40; raw[o + 2] = 120 + (x > 32 ? 80 : 0); } }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = ~0; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ihdr), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]).toString('base64');
}
(async () => {
  const list = await (await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } })).json();
  const names = (list.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''))
    .filter(n => /flash|pro|lite/.test(n) && !/tts|image|audio|live|omni|nano|lyria|research|embedding|customtools/.test(n));
  const img = png();
  for (const m of names) {
    const t = Date.now();
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: img } }, { text: 'What colour is this? One word.' }] }], generationConfig: { maxOutputTokens: 20 } }) });
    let note = ''; if (!r.ok) { try { note = (await r.json()).error.message.replace(/\s+/g, ' ').slice(0, 70); } catch (_) { /* no body */ } }
    console.log(m.padEnd(34), String(r.status).padEnd(4), (Date.now() - t) + 'ms', note);
  }
})();
