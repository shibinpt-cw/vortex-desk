// Adds (or removes) the Vortex Desk hook in Claude Code's user settings (~/.claude/settings.json).
//   node scripts/install-hook.js            show what would change, touch nothing
//   node scripts/install-hook.js --apply    make the change (a backup is saved next to the file)
//   node scripts/install-hook.js --remove   take the hook out again
const hook = require('../src/hookinstall');

const apply = process.argv.includes('--apply'), remove = process.argv.includes('--remove');
const r = remove ? hook.remove(false) : hook.install(false);
if (!r.ok) { console.error('Could not read', r.file, '-', r.error); process.exit(1); }
if (!r.changed) { console.log(remove ? 'Nothing to remove.' : 'The hook is already installed.'); process.exit(0); }
console.log(`${remove ? 'Removing the hook from' : 'Adding the hook to'} ${r.file}\n  command: ${r.command}\n  events : ${hook.EVENTS.join(', ')}`);
if (!apply && !remove) { console.log('\nDry run, nothing changed. Run again with --apply to install it.'); process.exit(0); }
r.apply();
console.log('Done. Backup saved as settings.json.vortex-backup. Restart Claude Code sessions to pick it up.');
