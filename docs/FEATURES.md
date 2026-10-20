# Vortex Desk feature map

Everything the reference app (Coucou 0.5.0) does, compared with what Vortex Desk does today, and the order we build the rest in.
The code here is written from scratch from the behaviour described in its public docs; the names, character, icon and sounds are our own.

**✅ built · 🟡 partly · ⬜ planned (phase) · ❌ not planned (reason)**

## Agents and approvals
| Feature | Status |
|---|---|
| Claude Code live sessions, step by step | ✅ |
| Allow / Deny / Always from the island, with rules (project or everywhere) | ✅ |
| Gemini CLI, Codex, Cursor, Copilot CLI, Antigravity, Muse Code, Claude Desktop | ✅ one-click Connect in Agents & rules |
| Any other tool with `--agent <name>` | ✅ |
| One pill per agent with its own colour and state (thinking, working, finished, error) | ✅ |
| Approval cards for Codex, Copilot, Muse (their permission events) | ✅ |
| OpenCode, Amp, Hermes (they use plugins, not hook commands) | ⬜ phase 2 |
| Live diff: +N −M in the ticker, tap to read the whole diff | 🟡 code card shows what is written; full diff view ⬜ phase 2 |
| Questions from the agent (AskUserQuestion) answered in the island | ⬜ phase 2 |
| Jump to the agent's terminal window | ⬜ phase 2 |
| Claude / Codex plan-usage gauge | ⬜ phase 3 (needs their local login files) |

## Chat and files
| Feature | Status |
|---|---|
| Chat with Gemini | ✅ tested live |
| Chat with Claude, OpenAI, DeepSeek, Qwen, Moonshot, OpenRouter, Ollama, LM Studio | ✅ built and tested against fake servers; needs your keys to try live |
| Drop a file: crate scene, preview, ask about it | ✅ (photos, videos as frames, PDFs, text) |
| Send a file by email | 🟡 animation only; plan in docs/EMAIL_SETUP.md, waiting for your choice A or B |
| Drag the character onto a window to use it as context | 🟡 Companion mode looks at your whole screen instead; per-window ⬜ phase 3 |

## The character
| Feature | Status |
|---|---|
| Notch that peeks on hover, hides when idle, own window size | ✅ |
| Eyes follow the mouse, emotes, dizzy when poked, greeting on launch | ✅ |
| Her mood follows your day: working, chilling, asleep, music, meetings | ✅ (beyond the reference) |
| The character lives on the desktop outside the island | ⬜ phase 2 |
| Wardrobe and seasonal outfits | ⬜ phase 2 |
| Your own sounds folder (replace any sound with a file) | ⬜ phase 2 (sounds are synthesised today) |
| Customisable keyboard shortcuts | 🟡 fixed set today; editor ⬜ phase 2 |
| 10 languages for the interface | ⬜ phase 3 |

## Voice, dictation, notes
| Feature | Status |
|---|---|
| Talk to her: hold Ctrl+Alt, speak, let go; tap for hands-free | ✅ |
| Her human voice (Gemini, then free Microsoft voice, then system voice) | ✅ |
| Dictation anywhere: hold the right Ctrl key, speak, words are typed where the cursor is | ✅ (as said / natural / polished, names, replacements, snippets, stats) |
| Offline recognition (Parakeet-style, nothing leaves the PC) | ⬜ phase 4 (needs a local speech model, 600 MB+) |
| Notetaker: record a call, transcript per person, summary, to-dos | 🟡 Meeting & class listener gives the gist and tells you when you are asked; full notes ⬜ phase 2 |
| Wake word (“Hey Lumina”) | ⬜ phase 3 (needs a small local wake-word model) |
| Dictation statistics, weekly recap with a shareable image | 🟡 dictation stats ✅; coding recap ⬜ phase 2 |

## Services (pills)
| Feature | Status |
|---|---|
| GitHub (PRs, reviews, CI), Vercel, Stripe, Resend, Notion, Cal.com, n8n | ⬜ phase 2 (GitHub, Vercel, Stripe first) |
| Spotify / media pill with controls | ⬜ phase 3 |
| Crypto portfolio pill (16 networks, 5 exchanges) | ⬜ phase 4 |

## Phones
| Feature | Status |
|---|---|
| Android and iPhone apps, live activity, widgets | ❌ separate native apps (an Apple developer account is needed for iPhone) |
| Approve from your phone on the same Wi-Fi (a web page, paired with a QR code) | ⬜ phase 4 |

## Product
| Feature | Status |
|---|---|
| Control app (voice, keys, chats, memory, rules, agents, dictation, behaviour) | ✅ |
| Demo / showcase film recorded at 60 fps | ✅ |
| Keys encrypted on disk (Windows login) | ⬜ phase 2 (today they sit in a plain file in your user folder) |
| Installer (.exe) and auto-start, hook that does not need Node installed | ⬜ phase 2 |
| Private by design: no account, no telemetry | ✅ |

## Only in Vortex Desk
Companion mode (sees your screen, spots errors and shows the fix), meeting and class listener, memory, chats you can come back to, Lumina's corner (ideas, story, what her heart learned), star window, full vision (photos, video frames, PDFs).

---

# If you want to sell it: read this first

**The reference code is MIT.** MIT would let us reuse it as long as we keep their copyright notice. We did not copy it: everything is written new, so no notice is needed for our code.

**Their brand and art are not free.** Their licence keeps the names, the mascot, the icon, the sounds and the media for the author. We use none of them: Vortex Desk, Lumina, our logo, our synthesised sounds.

**Features are not protected.** Building the same kind of features is allowed.

**Things that must be sorted before selling**
1. **The free Microsoft voice** (`msedge-tts`) is an unofficial service. Fine for you at home, not for a product you sell. Swap it for a licensed voice (Azure Speech, ElevenLabs, or paid Gemini voices) first.
2. **Free Gemini keys have tiny daily limits.** Sell it as “bring your own key”, or run your own paid backend. The app is built for bring-your-own-key.
3. **Your logo came from an AI image tool.** Check that tool's terms allow commercial use.
4. **Trademarks:** “Vortex Desk” and “Lumina” are very common words; do a proper search in the countries you sell in.
5. **Recording and screen features need consent notices** (“tell people in the call you are using it”) and a privacy policy and terms of use.
6. **Windows will warn about an unsigned installer.** Buying a code-signing certificate fixes that.
7. **Dependencies are all MIT** (Electron, koffi, msedge-tts); keep `THIRD_PARTY_NOTICES.md` with the app.
