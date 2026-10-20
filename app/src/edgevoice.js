/* Lumina's free fallback voice: Microsoft's neural "Read Aloud" voices (the same ones Edge uses).
   No key and no daily quota, but it is an unofficial Microsoft service, so it needs an internet connection and could change someday.
   Latin-script text uses the voice you picked (default: Ava, which speaks many languages); other scripts pick a matching female voice. */
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const SCRIPTS = [
  [/[ऀ-ॿ]/, 'hi-IN-SwaraNeural'], [/[ঀ-৿]/, 'bn-IN-TanishaaNeural'], [/[஀-௿]/, 'ta-IN-PallaviNeural'],
  [/[ఀ-౿]/, 'te-IN-ShrutiNeural'], [/[઀-૿]/, 'gu-IN-DhwaniNeural'], [/[ಀ-೿]/, 'kn-IN-SapnaNeural'],
  [/[ഀ-ൿ]/, 'ml-IN-SobhanaNeural'], [/[؀-ۿ]/, 'ar-SA-ZariyahNeural'], [/[぀-ヿ]/, 'ja-JP-NanamiNeural'],
  [/[가-힯]/, 'ko-KR-SunHiNeural'], [/[一-鿿]/, 'zh-CN-XiaoxiaoNeural'], [/[Ѐ-ӿ]/, 'ru-RU-SvetlanaNeural'],
  [/[฀-๿]/, 'th-TH-PremwadeeNeural']
];
const DEFAULT_VOICE = 'en-US-AvaMultilingualNeural';
const voiceFor = (text, pref) => { for (const [re, v] of SCRIPTS) if (re.test(text)) return v; return pref || DEFAULT_VOICE; };
const esc = t => t.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

class EdgeVoice {
  constructor() { this.tts = null; this.voice = ''; this.chain = Promise.resolve(); }
  reset() { try { if (this.tts) this.tts.close(); } catch (_) { /* closed */ } this.tts = null; this.voice = ''; }
  /** → Uint8Array of mp3 audio */
  speak(text, pref) {
    const voice = voiceFor(text, pref);
    const run = async () => {
      try {
        if (!this.tts || this.voice !== voice) {
          this.reset(); this.tts = new MsEdgeTTS();
          await this.tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3); this.voice = voice;
        }
        const { audioStream } = this.tts.toStream(esc(String(text).slice(0, 1500)));
        const chunks = [];
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('the Microsoft voice timed out')), 20000);
          audioStream.on('data', d => chunks.push(d));
          audioStream.on('close', () => { clearTimeout(t); res(); });
          audioStream.on('error', e => { clearTimeout(t); rej(e); });
        });
        const b = Buffer.concat(chunks);
        if (!b.length) throw new Error('the Microsoft voice returned nothing');
        return new Uint8Array(b);
      } catch (e) { this.reset(); throw e; }
    };
    const p = this.chain.then(run, run);          // one sentence at a time keeps the connection happy
    this.chain = p.catch(() => {});
    return p;
  }
}

module.exports = { EdgeVoice, voiceFor, DEFAULT_VOICE };
