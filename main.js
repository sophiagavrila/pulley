const { app, ipcMain, shell, screen, BrowserWindow } = require('electron');
const { menubar } = require('menubar');
const path = require('path');
const { execFile } = require('child_process');
const { fetchPRData } = require('./lib/fetch-prs');

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const NOTIFICATION_WIDTH = 360;
const NOTIFICATION_HEIGHT = 90;
const NOTIFICATION_GAP = 8;
const NOTIFICATION_MARGIN = 16;
const NOTIFICATION_DURATION = 6000; // 6 seconds

const PLIST_PATH = path.join(app.getPath('home'), 'Library/LaunchAgents/com.sophiagavrila.pr-dashboard.plist');
const PLIST_LABEL = 'com.sophiagavrila.pr-dashboard';

function isLaunchAtLogin() {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`launchctl list ${PLIST_LABEL} 2>/dev/null`, { encoding: 'utf8' });
    return out.includes(PLIST_LABEL);
  } catch {
    return false;
  }
}

function setLaunchAtLogin(enabled) {
  const { execSync } = require('child_process');
  try {
    if (enabled) {
      execSync(`launchctl load "${PLIST_PATH}"`, { encoding: 'utf8' });
    } else {
      execSync(`launchctl unload "${PLIST_PATH}"`, { encoding: 'utf8' });
    }
  } catch (e) {
    console.error('Failed to toggle launch at login:', e.message);
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mb && mb.window) {
      mb.showWindow();
    }
  });
}

let mb;
let refreshTimer;
let latestData = null;

// ── Notification windows ──
let activeNotifications = [];

function getExternalDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  // Prefer the largest external display; fall back to primary
  const externals = displays.filter(d => d.id !== primary.id);
  if (externals.length > 0) {
    return externals.reduce((a, b) =>
      (b.workAreaSize.width * b.workAreaSize.height) >
      (a.workAreaSize.width * a.workAreaSize.height) ? b : a
    );
  }
  return primary;
}

function notify(title, body, url, type = 'info') {
  const display = getExternalDisplay();
  const workArea = display.workArea;

  // Stack from top-right, offset by existing active notifications
  const stackOffset = activeNotifications.length * (NOTIFICATION_HEIGHT + NOTIFICATION_GAP);

  const x = workArea.x + workArea.width - NOTIFICATION_WIDTH - NOTIFICATION_MARGIN;
  const y = workArea.y + NOTIFICATION_MARGIN + stackOffset;

  const win = new BrowserWindow({
    width: NOTIFICATION_WIDTH,
    height: NOTIFICATION_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-notif.js'),
    },
  });

  const colors = {
    merge:    { accent: '#46a758', bg: 'rgba(70,167,88,0.12)',  border: 'rgba(70,167,88,0.3)',  icon: 'check' },
    approved: { accent: '#46a758', bg: 'rgba(70,167,88,0.12)',  border: 'rgba(70,167,88,0.3)',  icon: 'check' },
    changes:  { accent: '#e5484d', bg: 'rgba(229,72,77,0.12)',  border: 'rgba(229,72,77,0.3)',  icon: 'x' },
    comment:  { accent: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', icon: 'chat' },
    review:   { accent: '#f0a000', bg: 'rgba(240,160,0,0.12)',  border: 'rgba(240,160,0,0.3)',  icon: 'eye' },
    info:     { accent: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', icon: 'chat' },
  };

  const c = colors[type] || colors.info;

  const iconSVGs = {
    check: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    x: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    chat: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    eye: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  };

  const escapedTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedBody = body.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: transparent;
    -webkit-font-smoothing: antialiased;
    cursor: pointer;
    user-select: none;
    -webkit-app-region: no-drag;
  }
  .toast {
    background: #111214;
    border: 1px solid ${c.border};
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
    animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    max-height: 82px;
    overflow: hidden;
  }
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  .toast.fadeOut {
    animation: slideOut 0.25s ease-in forwards;
  }
  @keyframes slideOut {
    from { transform: translateX(0);    opacity: 1; }
    to   { transform: translateX(100%); opacity: 0; }
  }
  .icon-box {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: ${c.bg};
    border: 1px solid ${c.border};
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .content { min-width: 0; flex: 1; }
  .title {
    font-size: 12px;
    font-weight: 700;
    color: #ecedee;
    letter-spacing: -0.01em;
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    font-size: 11px;
    font-weight: 500;
    color: #9ba1a6;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .close-btn {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.06);
    color: #6c7075;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    margin-top: 1px;
  }
  .close-btn:hover { background: rgba(255,255,255,0.12); color: #ecedee; }
  .progress {
    position: absolute;
    bottom: 0; left: 16px; right: 16px;
    height: 2px;
    border-radius: 1px;
    background: ${c.border};
    overflow: hidden;
  }
  .progress-bar {
    height: 100%;
    background: ${c.accent};
    border-radius: 1px;
    animation: drain ${NOTIFICATION_DURATION}ms linear forwards;
  }
  @keyframes drain {
    from { width: 100%; }
    to   { width: 0%; }
  }
</style></head>
<body>
  <div class="toast" id="toast">
    <div class="icon-box">${iconSVGs[c.icon]}</div>
    <div class="content">
      <div class="title">${escapedTitle}</div>
      <div class="body">${escapedBody}</div>
    </div>
    <button class="close-btn" id="closeBtn">&times;</button>
    <div class="progress"><div class="progress-bar"></div></div>
  </div>
  <script>
    document.getElementById('closeBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('toast').classList.add('fadeOut');
      setTimeout(() => window.notifAPI.dismiss(), 250);
    });
    document.getElementById('toast').addEventListener('click', () => {
      document.getElementById('toast').classList.add('fadeOut');
      setTimeout(() => window.notifAPI.clicked(), 250);
    });
  </script>
</body></html>`;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  win.once('ready-to-show', () => {
    win.showInactive();
  });

  // Track this notification
  activeNotifications.push(win);

  // IPC handlers for this window
  const onClicked = (event) => {
    if (event.sender === win.webContents) {
      if (url) shell.openExternal(url);
      if (!win.isDestroyed()) win.close();
    }
  };
  const onDismiss = (event) => {
    if (event.sender === win.webContents) {
      if (!win.isDestroyed()) win.close();
    }
  };
  ipcMain.on('notif-clicked', onClicked);
  ipcMain.on('notif-dismiss', onDismiss);

  // Auto-dismiss
  const dismissTimer = setTimeout(() => {
    if (!win.isDestroyed()) {
      win.webContents.executeJavaScript(
        "document.getElementById('toast').classList.add('fadeOut')"
      ).catch(() => {});
      setTimeout(() => {
        if (!win.isDestroyed()) win.close();
      }, 300);
    }
  }, NOTIFICATION_DURATION);

  win.on('closed', () => {
    clearTimeout(dismissTimer);
    ipcMain.removeListener('notif-clicked', onClicked);
    ipcMain.removeListener('notif-dismiss', onDismiss);
    activeNotifications = activeNotifications.filter(w => w !== win);
    repositionNotifications();
  });

  console.log(`[notification] ${title}: ${body}`);
}

function repositionNotifications() {
  const display = getExternalDisplay();
  const workArea = display.workArea;

  activeNotifications.forEach((win, i) => {
    if (win.isDestroyed()) return;
    const x = workArea.x + workArea.width - NOTIFICATION_WIDTH - NOTIFICATION_MARGIN;
    const y = workArea.y + NOTIFICATION_MARGIN + i * (NOTIFICATION_HEIGHT + NOTIFICATION_GAP);
    win.setPosition(x, y, false);
  });
}

// ── Notification state tracking ──
let prState = {};

function prKey(pr) {
  return `${pr.repoFull || pr.repo}#${pr.number}`;
}

function buildPRStateSnapshot(data) {
  const snapshot = {};

  // Track authored PRs
  for (const [category, prs] of Object.entries(data.authored)) {
    for (const pr of prs) {
      const key = prKey(pr);
      snapshot[key] = {
        category,
        source: 'authored',
        reviewDecision: pr.reviewDecision,
        reviewers: (pr.reviewers || []).map(r => `${r.login}:${r.state}`).sort().join(','),
        url: pr.url,
        title: pr.title,
        repo: pr.repo,
        number: pr.number,
        queuePosition: pr.mergeQueue?.position,
      };
    }
  }

  // Track engaged PRs (ones I've reviewed or commented on)
  for (const pr of (data.engaged || [])) {
    const key = prKey(pr);
    if (!snapshot[key]) {
      snapshot[key] = {
        category: pr.category,
        source: 'engaged',
        reviewDecision: pr.reviewDecision,
        reviewers: (pr.reviewers || []).map(r => `${r.login}:${r.state}`).sort().join(','),
        url: pr.url,
        title: pr.title,
        repo: pr.repo,
        number: pr.number,
      };
    }
  }

  return snapshot;
}

function detectAndNotify(newData) {
  const newSnapshot = buildPRStateSnapshot(newData);

  if (Object.keys(prState).length === 0) {
    prState = newSnapshot;
    return;
  }

  for (const [key, curr] of Object.entries(newSnapshot)) {
    const prev = prState[key];

    // ── Authored PRs: notify on all state changes ──
    if (curr.source === 'authored') {
      if (!prev && curr.category === 'ready_to_merge') {
        notify(`Ready to Ship`, `${curr.repo}#${curr.number}: ${curr.title}`, curr.url, 'merge');
        continue;
      }

      if (!prev) continue;

      if (prev.category !== 'ready_to_merge' && curr.category === 'ready_to_merge') {
        notify(`Ready to Ship`, `${curr.repo}#${curr.number} is approved with CI passing`, curr.url, 'merge');
      }

      if (prev.category !== 'in_merge_queue' && curr.category === 'in_merge_queue') {
        const pos = curr.queuePosition ? ` at position #${curr.queuePosition}` : '';
        notify(`Merge Queue`, `${curr.repo}#${curr.number} entered the queue${pos}`, curr.url, 'merge');
      }

      if (curr.reviewers !== prev.reviewers) {
        const currReviewers = curr.reviewers ? curr.reviewers.split(',') : [];
        const prevReviewers = prev.reviewers ? prev.reviewers.split(',') : [];
        const newReviews = currReviewers.filter(r => !prevReviewers.includes(r));

        for (const review of newReviews) {
          const [login, state] = review.split(':');
          if (state === 'APPROVED') {
            notify(`PR Approved`, `${login} approved ${curr.repo}#${curr.number}`, curr.url, 'approved');
          } else if (state === 'CHANGES_REQUESTED') {
            notify(`Changes Requested`, `${login} requested changes on ${curr.repo}#${curr.number}`, curr.url, 'changes');
          } else if (state === 'COMMENTED') {
            notify(`New Review Comment`, `${login} commented on ${curr.repo}#${curr.number}`, curr.url, 'comment');
          }
        }
      }

      if (prev.category !== 'blocking_feedback' && curr.category === 'blocking_feedback') {
        if (curr.reviewers === prev.reviewers) {
          notify(`Changes Requested`, `${curr.repo}#${curr.number}: ${curr.title}`, curr.url, 'changes');
        }
      }
    }

    // ── Engaged PRs: notify when someone responds (new review activity) ──
    if (curr.source === 'engaged' && prev) {
      if (curr.reviewers !== prev.reviewers) {
        const currReviewers = curr.reviewers ? curr.reviewers.split(',') : [];
        const prevReviewers = prev.reviewers ? prev.reviewers.split(',') : [];
        const newReviews = currReviewers.filter(r => !prevReviewers.includes(r));

        for (const review of newReviews) {
          const [login, state] = review.split(':');
          if (state === 'COMMENTED') {
            notify(`Activity on Reviewed PR`, `${login} responded on ${curr.repo}#${curr.number}`, curr.url, 'comment');
          }
        }
      }
    }
  }

  prState = newSnapshot;
}

// ── Menubar setup ──

function createMenubar() {
  const iconPath = path.join(__dirname, 'assets', 'iconTemplate.png');

  mb = menubar({
    index: `file://${path.join(__dirname, 'renderer', 'index.html')}`,
    icon: iconPath,
    preloadWindow: true,
    showDockIcon: false,
    browserWindow: {
      width: 440,
      height: 720,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#08090a',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
  });

  mb.on('ready', () => {
    console.log('PR Dashboard ready in menu bar');

    // Renderer error logging
    if (mb.window) {
      mb.window.webContents.on('render-process-gone', (event, details) => {
        console.error('[RENDERER GONE]', details.reason, details.exitCode);
      });
      mb.window.webContents.on('console-message', (event, level, message, line, sourceId) => {
        if (level >= 2) { // only errors
          console.log(`[RENDERER ERROR] ${message} (${sourceId}:${line})`);
        }
      });
    }

    refreshData();
    refreshTimer = setInterval(refreshData, REFRESH_INTERVAL);

  });

  mb.on('after-show', () => {
    if (latestData) {
      mb.window.webContents.send('pr-data', latestData);
    }
    refreshData();
  });

  ipcMain.on('request-refresh', () => {
    refreshData();
  });

  ipcMain.on('open-external', (_event, url) => {
    shell.openExternal(url);
  });

  ipcMain.on('test-notification', () => {
    // Use real PR data if available, otherwise sensible samples
    const samples = [];
    if (latestData) {
      const { authored } = latestData;
      if (authored.ready_to_merge.length > 0) {
        const pr = authored.ready_to_merge[0];
        const reviewer = (pr.reviewers || []).find(r => r.state === 'APPROVED');
        samples.push({
          title: 'Ready to Merge',
          body: reviewer
            ? `${reviewer.login} approved ${pr.repo}#${pr.number}`
            : `${pr.repo}#${pr.number} is approved with CI passing`,
          url: pr.url,
          type: 'merge',
        });
      }
      if (authored.blocking_feedback.length > 0) {
        const pr = authored.blocking_feedback[0];
        const reviewer = (pr.reviewers || []).find(r =>
          r.state === 'CHANGES_REQUESTED' || r.state === 'COMMENTED'
        );
        samples.push({
          title: 'Blocking Feedback',
          body: reviewer
            ? `${reviewer.login} left blocking feedback on ${pr.repo}#${pr.number}`
            : `Blocking feedback on ${pr.repo}#${pr.number}`,
          url: pr.url,
          type: 'changes',
        });
      }
      if (authored.awaiting_review.length > 0) {
        const pr = authored.awaiting_review[0];
        samples.push({
          title: 'New Review Comment',
          body: `copilot commented on ${pr.repo}#${pr.number}`,
          url: pr.url,
          type: 'comment',
        });
      }
      if (latestData.reviewRequests.length > 0) {
        const pr = latestData.reviewRequests[0];
        samples.push({
          title: 'Review Requested',
          body: `${pr.repo}#${pr.number}: ${pr.title}`,
          url: pr.url,
          type: 'review',
        });
      }
    }

    // Fall back if no data
    if (samples.length === 0) {
      samples.push({ title: 'Test Notification', body: 'PR Dashboard is working', url: null, type: 'info' });
    }

    // Fire up to 3 with stagger
    samples.slice(0, 3).forEach((s, i) => {
      setTimeout(() => notify(s.title, s.body, s.url, s.type), i * 400);
    });
  });

  ipcMain.handle('get-launch-at-login', () => isLaunchAtLogin());
  ipcMain.handle('set-launch-at-login', (_event, enabled) => {
    setLaunchAtLogin(enabled);
    return isLaunchAtLogin();
  });
  ipcMain.handle('quit-app', () => {
    setLaunchAtLogin(false);
    app.quit();
  });
}

async function refreshData() {
  try {
    console.log('Fetching PR data...');
    latestData = await fetchPRData();
    console.log(`PR data fetched: ${latestData.totalAuthored} authored, ${latestData.totalReviewRequests} to review`);

    // Detect state changes on authored + engaged PRs only
    detectAndNotify(latestData);

    const counts = latestData.authored;
    const actionItems =
      (counts.in_merge_queue || []).length +
      counts.ready_to_merge.length +
      counts.blocking_feedback.length +
      counts.ci_failing.length;
    const total = latestData.totalAuthored;

    mb.tray.setToolTip(
      `PRs: ${total} open, ${actionItems} need action`
    );

    if (mb.window) {
      mb.window.webContents.send('pr-data', latestData);
    }
  } catch (err) {
    console.error('Failed to fetch PR data:', err);
  }
}

app.on('ready', createMenubar);

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
