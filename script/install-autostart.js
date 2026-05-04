const { LABEL, PLIST_PATH, setLaunchAtLogin } = require('../lib/launch-at-login');

const enabled = setLaunchAtLogin(true);
if (!enabled) {
  throw new Error(`Failed to enable ${LABEL}`);
}

console.log(`Installed ${LABEL} at ${PLIST_PATH}`);
