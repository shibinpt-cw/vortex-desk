# Third-party software in Vortex Desk

| Package | Licence | Use |
|---|---|---|
| Electron 44 (includes Chromium and Node.js) | MIT (Chromium and its bundled libraries have their own permissive licences, listed inside the Electron download) | the desktop shell |
| koffi 3 | MIT | calling Windows functions (keys held, foreground app) |
| msedge-tts 2 | MIT | the free Microsoft voice (unofficial service; replace before selling) |

Run `npm ls --all` in `app/` for the complete list before shipping a release.
