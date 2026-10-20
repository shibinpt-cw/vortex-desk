// Asks Gemini one question the way Lumina does (JSON reply + mood). The key is never printed.
//   node scripts/test-chat.js [model] [question]
const fs = require('fs');
const path = require('path');
const key = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'keys.local.json'), 'utf8')).gemini.trim();
const model = process.argv[2] || 'gemini-2.5-flash';
const q = process.argv[3] || 'Hey Lumina, what am I doing right now?';
(async () => {
  const gc = { temperature: .85, maxOutputTokens: 300, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { reply: { type: 'STRING' }, mood: { type: 'STRING', enum: ['happy', 'curious', 'understood', 'sad', 'done', 'idle'] } }, required: ['reply', 'mood'] } };
  if (model.includes('flash')) gc.thinkingConfig = { thinkingBudget: 0 };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: 'You are Lumina, a warm cosmic companion (she/her). One or two short sentences.\n\nCONTEXT\nThe user is coding in VS Code.' }] }, contents: [{ role: 'user', parts: [{ text: q }] }], generationConfig: gc })
  });
  console.log(r.status, (await r.text()).replace(key, '***').slice(0, 600));
})();
