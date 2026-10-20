// Checks the dictation recipe end to end WITHOUT touching your microphone or typing anywhere:
// a Microsoft voice speaks a sentence, Gemini writes it down with each style. Needs the Gemini key.   node scripts/test-dictation.js
const fs = require('fs');
const path = require('path');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const key = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'keys.local.json'), 'utf8')).gemini.trim();
const P = { natural: "Transcribe this audio and write it the way a careful person would type it: punctuation and capital letters, no um or uh, no false starts. Keep the speaker's own words and language.", polished: 'Transcribe this audio and polish it: fix grammar, make the sentences clear and professional, keep the meaning and the language.' };
(async () => {
  const tts = new MsEdgeTTS(); await tts.setMetadata('en-US-GuyNeural', OUTPUT_FORMAT.RAW_16KHZ_16BIT_MONO_PCM);
  const { audioStream } = tts.toStream('hey maya, um, can you send me the the invoice for for october, thanks');
  const chunks = []; audioStream.on('data', d => chunks.push(d)); await new Promise(r => audioStream.on('close', r)); tts.close();
  const pcm = Buffer.concat(chunks), h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const b64 = Buffer.concat([h, pcm]).toString('base64');
  for (const style of ['natural', 'polished']) {
    for (const model of ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: P[style] + ' Reply with ONLY the text, nothing else.' }, { inlineData: { mimeType: 'audio/wav', data: b64 } }] }], generationConfig: { temperature: 0 } }) });
      if (!r.ok) { console.log(style, model, r.status); continue; }
      const j = await r.json(); console.log(`${style.padEnd(8)} →`, ((j.candidates[0].content.parts || []).map(p => p.text || '').join('')).trim()); break;
    }
  }
  process.exit(0);
})().catch(e => { console.log('failed:', e.message); process.exit(1); });
