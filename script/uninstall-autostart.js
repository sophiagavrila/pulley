const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LABEL = 'com.sophiagavrila.pr-dashboard';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

try {
  execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
} catch {
  // It is fine if the agent was already unloaded.
}

if (fs.existsSync(PLIST_PATH)) {
  fs.rmSync(PLIST_PATH);
}

console.log(`Uninstalled ${LABEL}`);
