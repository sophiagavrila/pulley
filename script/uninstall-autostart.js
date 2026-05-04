const { LABEL, setLaunchAtLogin } = require('../lib/launch-at-login');

setLaunchAtLogin(false);

console.log(`Uninstalled ${LABEL}`);
