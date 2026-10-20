/* Vortex Desk rules engine.
   classify()  → how risky is this tool call, and how do we describe it to a human
   evaluate()  → allow / deny / ask, using the built-in policy plus the user's saved rules
   Rules live in rules.json next to the app's settings. */
const fs = require('fs');
const path = require('path');

const SENSITIVE_FILE = /(^|[\\/])(\.env(\..+)?|.*\.pem|.*\.key|.*\.pfx|id_(rsa|ed25519|ecdsa).*|credentials(\.json)?|\.npmrc|\.netrc|secrets?\.[a-z]+|.*\.kdbx)$|[\\/]\.(ssh|aws|gnupg)[\\/]/i;
const DANGER_CMD = [
  /\brm\s+(-[a-z]*r[a-z]*\s+-[a-z]*f|-[a-z]*f[a-z]*r|-[a-z]*r[a-z]*f|-rf|-fr)\b/i,
  /\brm\s+-[a-z]*r/i,
  /\b(del|erase)\s+.*\/[sq]\b/i,
  /\bremove-item\b.*-recurse/i,
  /\brmdir\s+\/s\b/i,
  /\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\b(mkfs|format\s+[a-z]:|diskpart|shutdown|reboot)\b/i,
  /\bchmod\s+-R\s+7/i,
  /(curl|wget|iwr|invoke-webrequest)[^|]*\|\s*(sh|bash|zsh|iex|powershell|pwsh)\b/i,
  /\bnpm\s+unpublish\b/i
];
const RISKY_CMD = [
  /\bgit\s+(push|pull|fetch|clone|merge|rebase|checkout|switch|stash|tag|commit|add|rm|mv|restore)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|uninstall|publish|update|upgrade|link)\b/i,
  /\b(pip|pip3|uv|cargo|go|gem|composer)\s+(install|add|get|publish|remove)\b/i,
  /\b(curl|wget|iwr|invoke-webrequest|ssh|scp|sftp|ftp|nc|ncat)\b/i,
  /\b(docker|kubectl|terraform|helm|aws|gcloud|az|vercel|netlify|fly|heroku)\b/i,
  /\b(rm|del|erase|mv|move|rename|copy|cp|mkdir|md|touch|chmod|chown|kill|taskkill|sudo|runas|powershell|pwsh|cmd)\b/i,
  /[>]{1,2}\s*\S/,           // writes to a file
  /`|\$\(/                   // command substitution
];
const SAFE_CMD = [
  /^(ls|dir|pwd|cd|echo|cat|type|head|tail|wc|which|where|whoami|date|hostname|tree|stat|file|sort|uniq|diff|cmp|basename|dirname|realpath)(\s|$)/i,
  /^(grep|rg|ag|findstr|select-string)(\s|$)/i,
  /^find\s(?!.*(-delete|-exec|-ok))/i,
  /^git\s+(status|diff|log|show|branch|remote\s+-v|rev-parse|ls-files|blame|describe|config\s+--get)(\s|$)/i,
  /^(node|python|python3|npm|pnpm|yarn|go|cargo|rustc|java|dotnet|git|tsc)\s+(-v|--version|version)\s*$/i,
  /^(npm|pnpm|yarn)\s+(test|run\s+(test|lint|typecheck|build|check)[\w:-]*|ls|list|outdated)(\s|$)/i,
  /^(pytest|jest|vitest|mocha|go\s+test|cargo\s+(test|check)|dotnet\s+test)(\s|$)/i,
  /^(eslint|prettier\s+--check|tsc\s+--noEmit|ruff\s+check)(\s|$)/i
];
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'BashOutput', 'KillShell', 'ExitPlanMode', 'Task']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const home = require('os').homedir();
const nice = p => (p || '').replace(home, '~').replace(/\\/g, '/');
const firstFile = i => i.file_path || i.path || i.notebook_path || '';

function splitSegments(cmd) {
  // split on && || ; and | so "git status && npm test" is judged part by part
  return cmd.split(/&&|\|\||;|\||\r?\n/).map(s => s.trim()).filter(Boolean);
}

function classifyBash(cmd) {
  const c = (cmd || '').trim();
  if (DANGER_CMD.some(r => r.test(c))) return 'danger';
  if (SENSITIVE_FILE.test(c.split(/\s+/).pop() || '') || /\b(\.env|id_rsa|\.ssh|\.aws|credentials)\b/i.test(c)) return 'sensitive';
  const segs = splitSegments(c);
  if (segs.length && segs.every(s => SAFE_CMD.some(r => r.test(s)) && !/[>]|`|\$\(/.test(s))) return 'safe';
  if (RISKY_CMD.some(r => r.test(c))) return 'risky';
  return 'risky';
}

function describeBash(cmd) {
  const c = (cmd || '').trim();
  const rules = [
    [/^git\s+push/i, 'Push commits to the remote'], [/^git\s+commit/i, 'Create a commit'], [/^git\s+(pull|fetch)/i, 'Fetch changes from the remote'],
    [/^git\s+(status|diff|log|show)/i, 'Look at the git history'], [/^git\s+reset\s+--hard/i, 'Throw away local changes'],
    [/\brm\s+-[a-z]*r/i, 'Delete files recursively'], [/^(npm|pnpm|yarn)\s+(i|install|add)/i, 'Install packages'],
    [/^(npm|pnpm|yarn)\s+(test|run\s+test)/i, 'Run the tests'], [/^(npm|pnpm|yarn)\s+run\s+build/i, 'Build the project'],
    [/^(npm|pnpm|yarn)\s+publish/i, 'Publish a package'], [/^(curl|wget|iwr)/i, 'Download or call a web address'],
    [/^(ls|dir|tree)/i, 'List files'], [/^(cat|type|head|tail)/i, 'Read a file'], [/^(grep|rg|findstr)/i, 'Search the files'],
    [/^docker/i, 'Run a Docker command'], [/^(pip|pip3|uv)\s+install/i, 'Install Python packages']
  ];
  const hit = rules.find(([r]) => r.test(c));
  return hit ? hit[1] : 'Run a command';
}

/** → { risk, summary, cmd, details:[[k,v]…], key, rulePattern, auto } */
function classify(tool, input = {}, cwd = '') {
  const folder = nice(cwd);
  const base = { tool, folder };
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(input.command || '');
    const risk = classifyBash(cmd);
    const segs = splitSegments(cmd);
    const toks = (segs[0] || '').split(/\s+/);
    const pattern = risk === 'danger' ? cmd.trim() : toks.slice(0, /^(git|npm|pnpm|yarn|docker|cargo|go|pip|kubectl)$/i.test(toks[0]) ? 2 : 1).join(' ');
    return {
      ...base, risk, summary: input.description || describeBash(cmd), cmd: cmd.length > 220 ? cmd.slice(0, 217) + '…' : cmd, rulePattern: pattern, key: cmd,
      auto: risk === 'safe',
      details: [['Tool', tool], ['Folder', folder], ['Check', risk === 'safe' ? 'read-only command' : risk === 'danger' ? 'matches a dangerous pattern' : risk === 'sensitive' ? 'touches secrets' : 'changes something'], ['Timeout', input.timeout ? `${Math.round(input.timeout / 1000)} s` : '2 min']]
    };
  }
  if (EDIT_TOOLS.has(tool)) {
    const f = firstFile(input), sens = SENSITIVE_FILE.test(f);
    const add = typeof input.content === 'string' ? input.content.split('\n').length : typeof input.new_string === 'string' ? input.new_string.split('\n').length : (input.edits || []).length;
    const sub = path.basename(f || 'file');
    return {
      ...base, risk: sens ? 'sensitive' : 'safe', summary: sens ? 'Edit a file that may hold secrets' : tool === 'Write' ? `Write ${sub}` : `Edit ${sub}`,
      cmd: `${tool}  ${nice(f)}${add ? `   (${add} line${add === 1 ? '' : 's'})` : ''}`, rulePattern: sens ? nice(f) : (nice(cwd) || nice(path.dirname(f))), key: f, auto: false,
      details: [['Tool', tool], ['File', nice(f)], ['Check', sens ? 'secrets protection' : 'inside your project'], ['Changes', add ? `${add} line${add === 1 ? '' : 's'}` : 'see diff']]
    };
  }
  if (READ_ONLY_TOOLS.has(tool)) {
    const f = firstFile(input), sens = f && SENSITIVE_FILE.test(f);
    return {
      ...base, risk: sens ? 'sensitive' : 'safe', summary: sens ? 'Read a file that may hold secrets' : `${tool === 'Read' ? 'Read' : 'Look through'} the project`,
      cmd: `${tool}  ${nice(f || input.pattern || '')}`.trim(), rulePattern: nice(f) || tool, key: f || tool, auto: !sens,
      details: [['Tool', tool], ['Folder', folder], ['Check', sens ? 'secrets protection' : 'read-only']]
    };
  }
  if (tool === 'WebFetch' || tool === 'WebSearch') {
    return { ...base, risk: 'risky', summary: tool === 'WebFetch' ? 'Open a web page' : 'Search the web', cmd: String(input.url || input.query || ''), rulePattern: tool, key: String(input.url || input.query || ''), auto: false,
      details: [['Tool', tool], ['Folder', folder], ['Check', 'reaches the internet']] };
  }
  return { ...base, risk: 'risky', summary: `Use ${tool}`, cmd: tool + (Object.keys(input).length ? '  ' + JSON.stringify(input).slice(0, 120) : ''), rulePattern: tool, key: tool, auto: false,
    details: [['Tool', tool], ['Folder', folder], ['Check', 'unknown tool']] };
}

/* ───────── saved rules ───────── */
class Rules {
  constructor(file) {
    this.file = file;
    this.data = { autoAllowSafe: true, rules: [] };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (_) { /* first run */ }
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); } catch (_) { /* ignore */ } }
  match(c, cwd) {
    const proj = nice(cwd);
    return this.data.rules.find(r => {
      if (r.tool !== c.tool) return false;
      if ((c.risk === 'danger' || c.risk === 'sensitive') && r.risk !== c.risk) return false;   // a "git push" rule never covers "git push --force"
      if (r.scope === 'project' && r.project !== proj) return false;
      const k = String(c.key || '');
      // a rule for "cd" must not also approve "cd x; something else": for a chained or piped command only an exact match counts
      if ((c.tool === 'Bash' || c.tool === 'PowerShell') && /[;&|`\n>]|\$\(/.test(k)) return r.pattern === k;
      if (r.pattern === '*' || r.pattern === c.tool) return true;
      const pat = r.pattern.replace(/\\/g, '/'), key = nice(k);
      return key === pat || key.startsWith(pat + ' ') || key.startsWith(pat.endsWith('/') ? pat : pat + '/');
    });
  }
  add(c, cwd, scope, decision = 'allow') {
    const r = { tool: c.tool, pattern: c.rulePattern, scope: scope === 'everywhere' ? 'everywhere' : 'project', project: nice(cwd), decision, risk: c.risk, created: new Date().toISOString() };
    if (!this.data.rules.some(x => x.tool === r.tool && x.pattern === r.pattern && x.scope === r.scope && x.project === r.project)) { this.data.rules.push(r); this.save(); }
    return r;
  }
  /** → { action:'allow'|'deny'|'ask', reason } */
  evaluate(c, cwd) {
    const r = this.match(c, cwd);
    if (r) return { action: r.decision, reason: `Rule: ${r.decision} ${r.tool} ${r.pattern}` };
    if (c.auto && this.data.autoAllowSafe) return { action: 'allow', reason: 'Safe, read-only' };
    return { action: 'ask', reason: '' };
  }
}

module.exports = { classify, Rules, SENSITIVE_FILE };
