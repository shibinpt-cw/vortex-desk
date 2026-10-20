#!/usr/bin/env node
/* Hook relay for Vortex Desk. Coding agents (Claude Code, Gemini CLI, Codex, Cursor, Copilot CLI ...) run this for each hook event
   and pass the event as JSON on stdin.
     node vortex-hook.js [--agent <name>] [EventName]
   - asking events (a permission question): waits for your answer in Vortex Desk and prints it in the format that agent expects
   - everything else: tells Vortex Desk what is happening and exits straight away
   If Vortex Desk is not running this does nothing, so the agent behaves exactly as it normally would. */
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* every agent has its own names for the same moments: translate them to one set */
const ALIASES = {
  BeforeTool: 'PreToolUse', AfterTool: 'PostToolUse', BeforeAgent: 'UserPromptSubmit', AfterAgent: 'Stop',
  PreInvocation: 'UserPromptSubmit', PostInvocation: 'PostToolUse',
  sessionStart: 'SessionStart', sessionEnd: 'SessionEnd', beforeSubmitPrompt: 'UserPromptSubmit', userPromptSubmitted: 'UserPromptSubmit',
  preToolUse: 'PreToolUse', postToolUse: 'PostToolUse', postToolUseFailure: 'PostToolUse', permissionRequest: 'PermissionRequest',
  agentStop: 'Stop', stop: 'Stop', notification: 'Notification', 'session.created': 'SessionStart', 'session.idle': 'Stop', 'session.deleted': 'SessionEnd',
  'tool.execute.before': 'PreToolUse', 'tool.execute.after': 'PostToolUse', 'permission.asked': 'PermissionRequest'
};
const args = process.argv.slice(2);
let agent = '';
const pos = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--agent') agent = (args[++i] || '').toLowerCase(); else pos.push(args[i]); }

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', main);
process.stdin.on('error', () => process.exit(0));

function main() {
  let ev;
  try { ev = JSON.parse(raw || '{}'); } catch (_) { process.exit(0); }
  const name = pos[0] || ev.hook_event_name || ev.event || ev.hookEventName || '';
  ev.hook_event_name = ALIASES[name] || name;
  if (!/^[a-z0-9-]{1,24}$/.test(agent)) agent = String(ev.vortex_agent || '').toLowerCase();
  if (!/^[a-z0-9-]{1,24}$/.test(agent)) agent = process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop' ? 'claude-desktop' : 'claude-code';
  ev.vortex_agent = agent;
  // a few agents name the same things differently
  if (ev.toolCall && !ev.tool_name) { ev.tool_name = ev.toolCall.name; ev.tool_input = ev.toolCall.args || ev.toolCall.input || {}; }
  if (!ev.session_id) ev.session_id = ev.conversationId || ev.sessionId || '';
  if (!ev.tool_name && ev.toolName) { ev.tool_name = ev.toolName; ev.tool_input = ev.toolArgs || ev.tool_input || {}; }

  const dir = process.env.VORTEX_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'vortex-desk');
  let token;
  try { token = fs.readFileSync(path.join(dir, 'pipe-token'), 'utf8').trim(); } catch (_) { process.exit(0); }
  // asking moments: Claude Code asks on PreToolUse (that is where we install it); every other agent has a real PermissionRequest event
  const blocking = ev.hook_event_name === 'PermissionRequest' || (ev.hook_event_name === 'PreToolUse' && (agent === 'claude-code' || agent === 'claude-desktop'));
  const sock = net.connect(`\\\\.\\pipe\\vortex-desk-${os.userInfo().username}${process.env.VORTEX_PIPE_SUFFIX || ''}`);
  let out = '';
  const bail = setTimeout(() => answer(null), blocking ? 116000 : 3000);
  sock.setEncoding('utf8');
  sock.on('error', () => process.exit(0));
  sock.on('connect', () => {
    sock.write(JSON.stringify({ token, event: ev }) + '\n', () => { if (!blocking) { clearTimeout(bail); process.exit(0); } });
  });
  sock.on('data', d => { out += d; });
  sock.on('end', () => { clearTimeout(bail); let r = null; try { r = JSON.parse(out); } catch (_) { /* no decision */ } answer(r); });

  function answer(r) {
    const d = r && (r.decision === 'allow' || r.decision === 'deny') ? r.decision : null;
    const why = (r && r.reason) || '';
    if (blocking && d) {
      let o;
      if (ev.hook_event_name === 'PermissionRequest') {
        // Copilot and Muse take a bare decision; Claude Code, Codex and the rest use the hookSpecificOutput form
        o = (agent === 'copilot' || agent === 'muse')
          ? { permissionDecision: d }
          : { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: d, ...(d === 'deny' ? { message: why || 'Denied in Vortex Desk' } : {}) } } };
      } else {
        o = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d, permissionDecisionReason: why } };
      }
      process.stdout.write(JSON.stringify(o));
    } else if (blocking && agent === 'copilot' && ev.hook_event_name === 'PermissionRequest') {
      process.stdout.write(JSON.stringify({ permissionDecision: 'ask' }));      // Copilot is fail-closed: nobody answered, so it asks in its own terminal
    }
    process.exit(0);
  }
}
