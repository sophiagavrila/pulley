// SVG icon fragments
const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  spinner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>',
  refresh: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>',
};

let isLoading = false;
let launchAtLogin = false;

// Load initial launch-at-login state
window.api.getLaunchAtLogin().then(v => { launchAtLogin = v; });

// ── Render helpers ──

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatRelative(isoString) {
  if (!isoString) return '';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function pipelineHTML(stages) {
  // stages: [{label, state}] where state = done | current | problem | future
  return `<div class="pipeline">${stages.map((s, i) => {
    const dotClass = s.state;
    let dotContent = '';
    if (s.state === 'done') dotContent = ICONS.check;
    else if (s.state === 'problem') dotContent = ICONS.warn;
    else if (s.state === 'current') dotContent = ICONS.arrow;

    const stepHTML = `<div class="pipeline-step ${s.state}"><span class="step-dot ${dotClass}">${dotContent}</span>${s.label}</div>`;
    const connector = i < stages.length - 1
      ? `<span class="pipeline-connector ${s.state === 'done' ? 'done' : ''}"></span>`
      : '';
    return stepHTML + connector;
  }).join('')}</div>`;
}

function ciStatusHTML(pr) {
  if (pr.failingChecks && pr.failingChecks.length > 0) {
    return `<div class="pr-meta-item red">${ICONS.x} CI failing</div>`;
  }
  return `<div class="pr-meta-item green">${ICONS.checkCircle} CI passing</div>`;
}

function reviewersHTML(reviewers) {
  if (!reviewers || reviewers.length === 0) return '';
  return reviewers.map(r => {
    let dotClass;
    if (r.state === 'APPROVED') dotClass = 'approved';
    else if (r.state === 'CHANGES_REQUESTED') dotClass = r.stale ? 'stale' : 'changes-requested';
    else dotClass = 'commented';
    return `<div class="reviewer-chip"><span class="reviewer-dot ${dotClass}"></span>${r.login}</div>`;
  }).join('');
}

function prCardHTML(pr, category) {
  const isApplied = category === 'blocking_feedback' && pr.feedbackApplied;

  let accentClass;
  if (category === 'in_merge_queue') accentClass = 'purple';
  else if (isApplied) accentClass = 'amber';
  else accentClass = {
    ready_to_merge: 'green',
    blocking_feedback: 'red',
    ci_failing: 'red',
    ci_pending: 'amber',
    awaiting_review: 'blue',
  }[category];

  let actionChip;
  if (category === 'in_merge_queue') {
    const pos = pr.mergeQueue?.position;
    actionChip = `<span class="action-chip queue">In Queue${pos ? ` #${pos}` : ''}</span>`;
  } else if (isApplied) {
    actionChip = '<span class="action-chip rereview">Re-review Needed</span>';
  } else {
    actionChip = {
      ready_to_merge: '<span class="action-chip merge">Ship It</span>',
      blocking_feedback: '<span class="action-chip fix">Fix Required</span>',
      ci_failing: '<span class="action-chip fix">CI Failing</span>',
      ci_pending: '<span class="action-chip pending">CI Pending</span>',
      awaiting_review: '<span class="action-chip request">Need Review</span>',
    }[category];
  }

  // Pipeline stages
  let stages;
  if (category === 'in_merge_queue') {
    stages = [
      { label: 'Code', state: 'done' },
      { label: 'CI', state: 'done' },
      { label: 'Review', state: 'done' },
      { label: 'Queue', state: 'current' },
    ];
  } else if (category === 'ready_to_merge') {
    stages = [
      { label: 'Code', state: 'done' },
      { label: 'CI', state: 'done' },
      { label: 'Review', state: 'done' },
      { label: 'Merge', state: 'current' },
    ];
  } else if (category === 'blocking_feedback') {
    if (isApplied) {
      stages = [
        { label: 'Code', state: 'done' },
        { label: 'CI', state: pr.failingChecks?.length > 0 ? 'problem' : 'done' },
        { label: 'Review', state: 'current' },
        { label: 'Merge', state: 'future' },
      ];
    } else {
      stages = [
        { label: 'Code', state: 'done' },
        { label: 'CI', state: 'done' },
        { label: 'Review', state: 'problem' },
        { label: 'Merge', state: 'future' },
      ];
    }
  } else if (category === 'ci_failing' || category === 'ci_pending') {
    stages = [
      { label: 'Code', state: 'done' },
      { label: 'CI', state: 'problem' },
      { label: 'Review', state: 'future' },
      { label: 'Merge', state: 'future' },
    ];
  } else {
    stages = [
      { label: 'Code', state: 'done' },
      { label: 'CI', state: 'done' },
      { label: 'Review', state: 'current' },
      { label: 'Merge', state: 'future' },
    ];
  }

  return `
    <div class="pr-card">
      <div class="accent-bar ${accentClass}"></div>
      <div class="pr-card-inner">
        <div class="pr-left">
          <div class="pr-title-row">
            <span class="pr-repo">${pr.repo}</span>
            <span class="pr-num">#${pr.number}</span>
          </div>
          <div class="pr-title">
            <a data-url="${pr.url}">${pr.title}</a>
          </div>
          <div class="pr-meta">
            ${ciStatusHTML(pr)}
            <span class="pr-meta-divider"></span>
            <div class="pr-meta-item">${pr.changedFiles} file${pr.changedFiles !== 1 ? 's' : ''}</div>
            <span class="pr-meta-divider"></span>
            <div class="pr-meta-item">
              <span class="diff-text"><span class="a">+${pr.additions.toLocaleString()}</span> <span class="d">&minus;${pr.deletions}</span></span>
            </div>
          </div>
          ${pipelineHTML(stages)}
        </div>
        <div class="pr-right">
          ${actionChip}
          ${reviewersHTML(pr.reviewers)}
        </div>
      </div>
    </div>`;
}

function compactCardHTML(pr, fullWidth = false) {
  return `
    <div class="compact-card${fullWidth ? ' full-width' : ''}">
      <div class="cc-repo">
        ${pr.repo}
        <span class="pr-num">#${pr.number}</span>
      </div>
      <div class="cc-title"><a data-url="${pr.url}">${pr.title}</a></div>
      <div class="cc-meta">
        <span class="diff-text"><span class="a">+${pr.additions.toLocaleString()}</span> <span class="d">&minus;${pr.deletions}</span></span>
        &middot; ${pr.changedFiles} files
      </div>
      <div class="cc-action">Only Copilot reviewed. Request a human reviewer.</div>
    </div>`;
}

function reviewItemHTML(pr) {
  const badge = pr.isRereview
    ? '<span class="rereview-badge">RE-REVIEW</span>'
    : '';
  return `
    <div class="review-item">
      <div class="review-item-left">
        <div class="ri-repo">${pr.repo}${badge}</div>
        <div class="ri-title" data-url="${pr.url}">${pr.title}</div>
      </div>
      <span class="ri-num">#${pr.number}</span>
    </div>`;
}

// ── Main render ──

function render(data) {
  const root = document.getElementById('root');
  if (!data) {
    root.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">Fetching PR data...</div>
      </div>`;
    return;
  }

  const { authored, reviewRequests, fetchedAt, totalAuthored, totalReviewRequests } = data;

  const queueCount = (authored.in_merge_queue || []).length;
  const shipCount = (authored.ready_to_merge || []).length;
  const blockCount = (authored.blocking_feedback || []).length;
  const ciCount = (authored.ci_failing || []).length + (authored.ci_pending || []).length;
  const reviewCount = (authored.awaiting_review || []).length;

  let html = '';

  // Header
  html += `
    <div class="header">
      <div class="header-left">
        <h1>Pulley</h1>
        <div class="subtitle">${totalAuthored} open &middot; ${totalReviewRequests} to review</div>
      </div>
      <div class="header-right">
        <span class="last-updated">Updated ${formatRelative(fetchedAt)}</span>
        <button class="refresh-btn" id="testNotifBtn" title="Send test notification">
          Test Alert
        </button>
        <button class="refresh-btn${isLoading ? ' loading' : ''}" id="refreshBtn">
          ${ICONS.refresh} Refresh
        </button>
      </div>
    </div>
    <div class="settings-bar">
      <label class="toggle-label" title="Start Pulley when you log in">
        <span class="toggle-text">Launch at Login</span>
        <span class="toggle-switch${launchAtLogin ? ' on' : ''}" id="launchToggle">
          <span class="toggle-knob"></span>
        </span>
      </label>
      <button class="quit-btn" id="quitBtn">Quit</button>
    </div>`;

  // Summary strip
  html += `
    <div class="summary-strip">
      ${queueCount > 0 ? `
      <div class="summary-item">
        <div class="count purple">${queueCount}</div>
        <div class="label">Queue</div>
      </div>` : ''}
      <div class="summary-item">
        <div class="count green">${shipCount}</div>
        <div class="label">Ship</div>
      </div>
      <div class="summary-item">
        <div class="count red">${blockCount}</div>
        <div class="label">Blocked</div>
      </div>
      <div class="summary-item">
        <div class="count amber">${ciCount}</div>
        <div class="label">CI Issues</div>
      </div>
      ${queueCount === 0 ? `
      <div class="summary-item">
        <div class="count blue">${reviewCount}</div>
        <div class="label">Waiting</div>
      </div>` : ''}
    </div>`;

  // In merge queue
  if (queueCount > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-dot pulse" style="background:var(--purple)"></span>
          <span class="section-label" style="color:var(--purple)">In Merge Queue</span>
        </div>
        ${(authored.in_merge_queue || []).map(pr => prCardHTML(pr, 'in_merge_queue')).join('')}
      </div>`;
  }

  // Ready to ship
  if (shipCount > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-dot" style="background:var(--green)"></span>
          <span class="section-label" style="color:var(--green)">Ready to Ship</span>
        </div>
        ${(authored.ready_to_merge || []).map(pr => prCardHTML(pr, 'ready_to_merge')).join('')}
      </div>`;
  }

  // Blocking feedback
  if (blockCount > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-dot" style="background:var(--red)"></span>
          <span class="section-label" style="color:var(--red)">Blocking Feedback</span>
        </div>
        ${(authored.blocking_feedback || []).map(pr => prCardHTML(pr, 'blocking_feedback')).join('')}
      </div>`;
  }

  // CI issues
  const ciPRs = [...(authored.ci_failing || []), ...(authored.ci_pending || [])];
  if (ciPRs.length > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-dot pulse" style="background:var(--amber)"></span>
          <span class="section-label" style="color:var(--amber)">CI Issues</span>
        </div>
        ${(authored.ci_failing || []).map(pr => prCardHTML(pr, 'ci_failing')).join('')}
        ${(authored.ci_pending || []).map(pr => prCardHTML(pr, 'ci_pending')).join('')}
      </div>`;
  }

  // Awaiting review
  if (reviewCount > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-dot" style="background:var(--blue)"></span>
          <span class="section-label" style="color:var(--blue)">Awaiting Review</span>
          <span class="section-count">${reviewCount}</span>
        </div>
        <div class="compact-cards">
          ${(authored.awaiting_review || []).map((pr, i) => {
            const isLast = i === reviewCount - 1 && reviewCount % 2 === 1;
            return compactCardHTML(pr, isLast);
          }).join('')}
        </div>
      </div>`;
  }

  // Review requests
  if (reviewRequests.length > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-dot" style="background:var(--text-tertiary)"></span>
          <span class="section-label" style="color:var(--text-secondary)">PRs to Review</span>
          <span class="section-count">${reviewRequests.length}</span>
        </div>
        <div class="review-list">
          ${reviewRequests.map(pr => reviewItemHTML(pr)).join('')}
        </div>
      </div>`;
  }

  // Empty state
  if (totalAuthored === 0 && totalReviewRequests === 0) {
    html += `<div class="empty-state">No open PRs. You're all clear.</div>`;
  }

  root.innerHTML = html;
  bindEvents();
}

function bindEvents() {
  // Test notification button
  const testBtn = document.getElementById('testNotifBtn');
  if (testBtn) {
    testBtn.addEventListener('click', () => {
      window.api.testNotification();
    });
  }

  // Refresh button
  const btn = document.getElementById('refreshBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      isLoading = true;
      btn.classList.add('loading');
      window.api.requestRefresh();
    });
  }

  // External links
  document.querySelectorAll('[data-url]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      window.api.openExternal(el.dataset.url);
    });
  });

  // Launch at login toggle
  const toggle = document.getElementById('launchToggle');
  if (toggle) {
    toggle.addEventListener('click', async () => {
      launchAtLogin = await window.api.setLaunchAtLogin(!launchAtLogin);
      toggle.classList.toggle('on', launchAtLogin);
    });
  }

  // Quit button
  const quitBtn = document.getElementById('quitBtn');
  if (quitBtn) {
    quitBtn.addEventListener('click', () => window.api.quitApp());
  }
}

// ── IPC listener ──

window.api.onDataUpdate((data) => {
  isLoading = false;
  render(data);
});

// Initial loading state
render(null);
