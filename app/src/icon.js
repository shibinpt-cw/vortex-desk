/* A tiny generated tray icon (a glowing violet-to-teal orb), so the app needs no image files. */
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function orbPng(size = 32) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = (size - 1) / 2, R = size * 0.42;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c), o = y * (size * 4 + 1) + 1 + x * 4;
      const t = Math.min(1, Math.max(0, (x + y) / (2 * size)));
      const a = Math.max(0, Math.min(1, (R + 1.2 - d) / 1.6));
      const glow = Math.max(0, 1 - d / (size * 0.5)) * 0.35;
      const hl = Math.max(0, 1 - Math.hypot(x - c * 0.7, y - c * 0.7) / (size * 0.28)) * 120;
      raw[o] = Math.min(255, 150 * (1 - t) + 70 * t + hl);
      raw[o + 1] = Math.min(255, 120 * (1 - t) + 210 * t + hl);
      raw[o + 2] = Math.min(255, 255 * (1 - t) + 220 * t + hl);
      raw[o + 3] = Math.round(255 * Math.max(a, glow));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { orbPng };
