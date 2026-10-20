// Copies the UI files (the single source of truth lives in ../prototype) into the app.
const fs = require('fs');
const path = require('path');
const from = n => path.join(__dirname, '..', '..', 'prototype', n);
const to = n => path.join(__dirname, '..', 'renderer', n);
fs.mkdirSync(path.dirname(to('x')), { recursive: true });
fs.copyFileSync(from('vortex-desk-ui.html'), to('index.html'));
fs.copyFileSync(from('stars.html'), to('stars.html'));
// the control app carries its logo inside the file, so it works from anywhere
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'logo-96.b64.txt'), 'utf8').trim();
fs.writeFileSync(to('control.html'), fs.readFileSync(from('control.html'), 'utf8').replace('__LOGO__', logo));
console.log('UI copied →', to('index.html'), '+ control.html');
