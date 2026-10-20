const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vortexHost', {
  getKeys: () => ipcRenderer.invoke('keys'),
  chat: a => ipcRenderer.invoke('chat-ask', a),
  models: p => ipcRenderer.invoke('chat-models', p),
  tts: (text, voice) => ipcRenderer.invoke('tts-edge', { text, voice }),
  onEvent: cb => ipcRenderer.on('event', (_e, ev) => cb(ev)),
  onVoice: cb => ipcRenderer.on('voice', () => cb()),
  onKeys: cb => ipcRenderer.on('keys-changed', () => cb()),
  decide: (id, decision, rule) => ipcRenderer.send('decide', { id, decision, rule }),
  rect: r => ipcRenderer.send('rect', r),
  quit: () => ipcRenderer.send('quit'),
  menu: () => ipcRenderer.send('menu'),
  watch: on => ipcRenderer.send('watch', !!on),
  size: k => ipcRenderer.send('size', k),
  openControl: page => ipcRenderer.send('open-control', page),
  assist: cfg => ipcRenderer.send('assist-set', cfg),
  lookNow: () => ipcRenderer.send('assist-look'),
  onScreen: cb => ipcRenderer.on('screen', (_e, f) => cb(f)),
  onPtt: cb => ipcRenderer.on('ptt', (_e, p) => cb(p)),
  onDictate: cb => ipcRenderer.on('dictate', (_e, p) => cb(p)),
  paste: text => ipcRenderer.invoke('dictation-paste', text),
  openShowcase: () => ipcRenderer.send('open-showcase'),
  openStars: () => ipcRenderer.send('open-stars'),
  meet: on => ipcRenderer.send('meet-set', !!on),
  onWake: cb => ipcRenderer.on('wake', () => cb()),
  task: goal => ipcRenderer.send('task-start', goal),
  taskStop: () => ipcRenderer.send('task-stop'),
  taskAnswer: (id, yes) => ipcRenderer.send('task-answer', { id, yes: !!yes })
});

window.addEventListener('DOMContentLoaded', () => {
  if (/[?&]showcase=1/.test(location.search)) return;          // the showcase window is a normal window
  document.documentElement.classList.add('app');
  document.body.classList.add('app');
});
