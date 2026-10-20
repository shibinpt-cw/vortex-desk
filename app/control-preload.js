const { contextBridge, ipcRenderer } = require('electron');
const inv = (c, a) => ipcRenderer.invoke(c, a);

contextBridge.exposeInMainWorld('ctl', {
  keys: () => inv('ctl:keys'),
  setKey: (provider, value) => inv('ctl:setKey', { provider, value }),
  testKey: (provider, value) => inv('ctl:testKey', { provider, value }),
  rules: () => inv('ctl:rules'),
  ruleDelete: i => inv('ctl:ruleDelete', i),
  ruleAuto: v => inv('ctl:ruleAuto', v),
  hook: what => inv('ctl:hook', what),
  agents: () => inv('ctl:agents'),
  agentSet: (id, on) => inv('ctl:agentSet', { id, on }),
  login: v => inv('ctl:login', v),
  ttsEdge: (text, voice) => inv('ctl:ttsEdge', { text, voice }),
  ttsGemini: (text, voice) => inv('ctl:ttsGemini', { text, voice }),
  about: () => inv('ctl:about'),
  open: what => inv('ctl:open', what),
  island: what => ipcRenderer.send('ctl:island', what),
  showcase: () => ipcRenderer.send('ctl:showcase'),
  stars: () => ipcRenderer.send('ctl:stars'),
  quit: () => ipcRenderer.send('ctl:quit'),
  computer: () => inv('ctl:computer'),
  computerSet: c => inv('ctl:computerSet', c),
  computerPick: () => inv('ctl:computerPick'),
  computerQuick: () => inv('ctl:computerQuick'),
  computerLog: () => inv('ctl:computerLog'),
  onGoto: cb => ipcRenderer.on('goto', (_e, p) => cb(p))
});
