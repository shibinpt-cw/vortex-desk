// Developer helper: fetches one Gemini voice sample per model and measures it (loudness, clipping, "hiss" ratio, byte order).
// A clean voice has a low hiss ratio (about 0.05-0.4); static / wrong byte order gives something near 2.   node scripts/voice-quality.js [model ...]
const fs = require('fs');
const path = require('path');
const key = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'keys.local.json'), 'utf8')).gemini.trim();
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];
function measure(u8, le) {
  const n = Math.floor(u8.length / 2), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let s = 0, d = 0, pk = 0, clip = 0, prev = 0;
  for (let i = 0; i < n; i++) { const v = dv.getInt16(i * 2, le) / 32768; s += v * v; d += (v - prev) * (v - prev); prev = v; if (Math.abs(v) > pk) pk = Math.abs(v); if (Math.abs(v) > .99) clip++; }
  return { seconds: (n / 24000).toFixed(1), rms: Math.sqrt(s / n).toFixed(3), peak: pk.toFixed(2), clipped: (clip / n * 100).toFixed(2) + '%', hiss: (d / Math.max(s, 1e-9)).toFixed(2) };
}
(async () => {
  for (const m of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Hi! I am Lumina. What are we building today? I can help you with that.' }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } } }) });
    if (!r.ok) { console.log(m.padEnd(32), r.status); continue; }
    const j = await r.json(), part = j.candidates[0].content.parts.find(x => x.inlineData);
    let u8 = new Uint8Array(Buffer.from(part.inlineData.data, 'base64'));
    const isWav = u8[0] === 82 && u8[1] === 73;
    const info = `${part.inlineData.mimeType}  ${u8.length} bytes${isWav ? '  (wav header)' : ''}`;
    if (isWav) { const dv = new DataView(u8.buffer, u8.byteOffset); console.log('   wav fmt:', 'format', dv.getUint16(20, true), 'channels', dv.getUint16(22, true), 'rate', dv.getUint32(24, true), 'bits', dv.getUint16(34, true)); u8 = u8.slice(44); }
    console.log(m.padEnd(32), info);
    console.log('   little-endian:', JSON.stringify(measure(u8, true)));
    console.log('   big-endian   :', JSON.stringify(measure(u8, false)));
  }
})();
