# PR Dashboard

macOS menu bar app for tracking your open pull requests, review requests, and PR state-change alerts.

## Requirements

- macOS
- Node.js and npm
- GitHub CLI (`gh`) authenticated with access to the repositories you want to monitor

The app reads PR data through the local `gh` CLI session. It does not store GitHub tokens or other secrets in this repository.

## Run locally

```bash
npm install
npm start
```

## Launch at login

```bash
npm run install-autostart
```

To disable launch at login:

```bash
npm run uninstall-autostart
```

The autostart script generates a LaunchAgent plist locally at `~/Library/LaunchAgents/com.sophiagavrila.pr-dashboard.plist` using the current checkout path.
