// Checks the free Microsoft neural voice: saves a short .mp3 in config/ you can play.
//   node scripts/test-edge-voice.js [voice] [text]
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');
const path = require('path');
const voice = process.argv[2] || 'en-US-AvaMultilingualNeural';
const text = process.argv[3] || 'Hi! I am Lumina. What are we building today?';
(async () => {
  const t = Date.now();
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  const chunks = [];
  audioStream.on('data', d => chunks.push(d));
  await new Promise((res, rej) => { audioStream.on('close', res); audioStream.on('error', rej); });
  const buf = Buffer.concat(chunks);
  const out = path.join(__dirname, '..', '..', 'config', `voice-test-${voice}.mp3`);
  fs.writeFileSync(out, buf);
  console.log(`OK ${voice}: ${buf.length} bytes in ${Date.now() - t} ms → ${out}`);
})().catch(e => { console.log('failed:', e.message); process.exit(1); });
