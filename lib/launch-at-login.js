const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LABEL = 'com.sophiagavrila.pulley';
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

function buildLaunchAgentPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
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
    <string>/tmp/pulley.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/pulley.err</string>
</dict>
</plist>
`;
}

function ensureLaunchAgentPlist() {
  fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  fs.writeFileSync(PLIST_PATH, buildLaunchAgentPlist(), { mode: 0o644 });
}

function isLaunchAtLogin() {
  try {
    const out = execFileSync('launchctl', ['list', LABEL], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.includes(LABEL);
  } catch {
    return false;
  }
}

function setLaunchAtLogin(enabled) {
  if (enabled) {
    ensureLaunchAgentPlist();
    if (!isLaunchAtLogin()) {
      execFileSync('launchctl', ['load', PLIST_PATH], { stdio: 'ignore' });
    }
    return isLaunchAtLogin();
  }

  if (isLaunchAtLogin()) {
    execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
  }
  if (fs.existsSync(PLIST_PATH)) {
    fs.rmSync(PLIST_PATH);
  }
  return isLaunchAtLogin();
}

module.exports = {
  LABEL,
  PLIST_PATH,
  buildLaunchAgentPlist,
  ensureLaunchAgentPlist,
  isLaunchAtLogin,
  setLaunchAtLogin,
};
