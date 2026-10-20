/* Two "hold a key and talk" gestures that work from any app. Windows has no "released" event for a modifier-only shortcut,
   so this reads the keyboard state a few times a second (one native call; the full scan only runs while a gesture is starting).
     hold Ctrl + Alt (left)   → talk to Lumina: let go and she answers
     hold the RIGHT Ctrl alone → dictate: let go and your words are typed where your cursor is (Esc cancels)
   Pressing any other key with them cancels the gesture, and the right Alt key (AltGr, used to type characters) is ignored. */
let api = null;
function load() {
  if (api !== null) return api;
  try { api = require('koffi').load('user32.dll').func('int16 __stdcall GetAsyncKeyState(int vk)'); } catch (_) { api = false; }
  return api;
}
const SKIP = new Set([0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5]);       // Shift, Ctrl, Alt (left and right)
const HOLD_MS = 320;

class PushToTalk {
  /** talk(phase) for Ctrl+Alt, dictate(phase) for right Ctrl: phase is 'start', 'end' or 'cancel' */
  constructor(talk, dictate) { this.talk = talk; this.dictate = dictate; this.g = { talk: this.fresh(), dict: this.fresh() }; this.timer = null; }
  fresh() { return { since: 0, active: false, dirty: false }; }
  start() {
    const f = load(); if (!f) return;
    const isDown = vk => (f(vk) & 0x8000) !== 0;
    const other = () => { for (let vk = 0x08; vk <= 0xFE; vk++) { if (!SKIP.has(vk) && isDown(vk)) return vk; } return 0; };
    const step = (g, held, fire) => {
      if (held) {
        if (!g.since) { g.since = Date.now(); g.dirty = false; }
        if (!g.active) {
          if (!g.dirty && other()) g.dirty = true;
          if (!g.dirty && Date.now() - g.since >= HOLD_MS) { g.active = true; fire('start'); }
        } else if (isDown(0x1B)) { g.active = false; g.dirty = true; fire('cancel'); }       // Esc while dictating
      } else { if (g.active) { g.active = false; fire('end'); } g.since = 0; g.dirty = false; }
    };
    this.timer = setInterval(() => {
      const lctrl = isDown(0xA2), rctrl = isDown(0xA3), lalt = isDown(0xA4), ralt = isDown(0xA5), shift = isDown(0x10);
      step(this.g.talk, (lctrl || rctrl) && lalt, this.talk);
      step(this.g.dict, rctrl && !lctrl && !lalt && !ralt && !shift, this.dictate);
    }, 35);
  }
  stop() { clearInterval(this.timer); }
}

module.exports = { PushToTalk };
