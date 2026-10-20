/* The local channel the Claude Code hook talks to: a Windows named pipe, one JSON line in, one JSON line out.
   A random token (kept in the user's own app-data folder) proves the caller is a program running as the same user. */
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PIPE = `\\\\.\\pipe\\vortex-desk-${os.userInfo().username}${process.env.VORTEX_PIPE_SUFFIX || ''}`;   // the suffix lets the tests run next to the real app

function startPipe(dataDir, onMessage) {
  const token = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'pipe-token'), token);
  const srv = net.createServer(sock => {
    let buf = '', done = false;
    const closers = [];
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('close', () => { done = true; closers.forEach(f => f()); });
    sock.on('data', d => {
      if (done || buf === null) return;
      buf += d;
      if (buf.length > 4e6) { sock.destroy(); return; }
      const i = buf.indexOf('\n');
      if (i < 0) return;
      const line = buf.slice(0, i); buf = null;
      let m;
      try { m = JSON.parse(line); } catch (_) { sock.end(); return; }
      if (m.token !== token) { sock.end(); return; }
      onMessage(m.event, reply => { try { if (!done) sock.end(JSON.stringify(reply) + '\n'); } catch (_) { /* gone */ } }, cb => closers.push(cb));
    });
  });
  srv.on('error', e => console.error('pipe error:', e.message));
  srv.listen(PIPE);
  return { close: () => srv.close(), token };
}

module.exports = { startPipe, PIPE };
