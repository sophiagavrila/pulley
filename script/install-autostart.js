const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LABEL = 'com.sophiagavrila.pr-dashboard';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(LAUNCH_AGENTS_DIR, `${LABEL}.plist`);

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/env</string>
        <string>npx</string>
        <string>electron</string>
        <string>${escapeXml(PROJECT_ROOT)}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/pr-dashboard.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/pr-dashboard.err</string>
</dict>
</plist>
`;

fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
fs.writeFileSync(PLIST_PATH, plist, { mode: 0o644 });

try {
  execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
} catch {
  // It is fine if the agent was not loaded yet.
}

execFileSync('launchctl', ['load', PLIST_PATH], { stdio: 'inherit' });
console.log(`Installed ${LABEL} at ${PLIST_PATH}`);
