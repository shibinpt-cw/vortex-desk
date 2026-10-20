// Checks the Gemini key and the voice: asks Gemini to say a line, saves it as a .wav you can play. The key is never printed.
//   node scripts/test-voice.js [voice name] [text]
const fs = require('fs');
const path = require('path');
const keys = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'keys.local.json'), 'utf8'));
const voice = process.argv[2] || (keys.voice && keys.voice.name) || 'Aoede';
const text = process.argv[3] || 'Hi! I am Lumina. What are we building today?';
const model = 'gemini-2.5-flash-preview-tts';

(async () => {
  if (!keys.gemini) { console.log('No Gemini key in config/keys.local.json'); process.exit(1); }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys.gemini.trim() },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Say this warmly and naturally: ' + text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } })
  });
  const body = await r.text();
  if (!r.ok) { console.log('Gemini answered', r.status, body.replace(keys.gemini, '***').slice(0, 400)); process.exit(1); }
  const part = JSON.parse(body).candidates[0].content.parts[0].inlineData;
  const pcm = Buffer.from(part.data, 'base64');
  const rate = Number((/rate=(\d+)/.exec(part.mimeType) || [])[1]) || 24000;
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const out = path.join(__dirname, '..', '..', 'config', `voice-test-${voice}.wav`);
  fs.writeFileSync(out, Buffer.concat([h, pcm]));
  console.log(`OK: voice ${voice}, ${(pcm.length / 2 / rate).toFixed(1)} s of audio (${part.mimeType}) → ${out}`);
})().catch(e => { console.log('failed:', e.message); process.exit(1); });
