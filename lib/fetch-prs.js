const { exec, execFile } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

async function runGh(args) {
  try {
    const { stdout } = await execAsync(`gh ${args}`, {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, GH_PAGER: '' },
    });
    return JSON.parse(stdout);
  } catch (e) {
    console.error(`gh command failed: gh ${args}`, e.message);
    return null;
  }
}

const BOT_LOGINS = new Set([
  'copilot-pull-request-reviewer',
  'github-actions',
  'dependabot',
  'renovate',
]);

function checkState(c) {
  // StatusContext (commit status API) has `state`, not `status`/`conclusion`
  if (c.__typename === 'StatusContext') {
    if (c.state === 'SUCCESS') return 'passing';
    if (c.state === 'PENDING' || c.state === 'EXPECTED') return 'pending';
    return 'failing';
  }
  // CheckRun (GitHub Actions)
  if (c.status !== 'COMPLETED') return 'pending';
  if (c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED') return 'passing';
  return 'failing';
}

function categorizePR(pr) {
  // Merge queue takes priority — PR is actively being processed
  if (pr._mergeQueueEntry) return 'in_merge_queue';

  const reviews = pr.latestReviews || [];
  const humanReviews = reviews.filter(r => r.author?.login && !BOT_LOGINS.has(r.author.login));
  const hasApproval = humanReviews.some(r => r.state === 'APPROVED');
  const hasChangesRequested = humanReviews.some(r => r.state === 'CHANGES_REQUESTED');

  // Detect blocking feedback from PR comments (e.g., fleet-mode reviews posted as comments)
  const comments = pr.comments || [];
  const blockingComment = comments.find(c => {
    if (!c.author?.login || BOT_LOGINS.has(c.author.login)) return false;
    const body = (c.body || '').toLowerCase();
    return body.includes('blocking') || body.includes('must fix') || body.includes('required change');
  });

  const checks = pr.statusCheckRollup || [];
  const ciPassing = checks.length > 0 && checks.every(c => checkState(c) === 'passing');
  const ciFailing = checks.some(c => checkState(c) === 'failing');
  const ciPending = checks.some(c => checkState(c) === 'pending') && !ciFailing;

  if (hasApproval && ciPassing && !hasChangesRequested && !blockingComment) return 'ready_to_merge';
  if (hasChangesRequested || blockingComment) return 'blocking_feedback';
  if (ciFailing) return 'ci_failing';
  if (ciPending) return 'ci_pending';
  return 'awaiting_review';
}

function getReviewerInfo(pr) {
  const seen = new Set();
  const reviewers = [];

  // From formal reviews (latestReviews)
  for (const r of (pr.latestReviews || [])) {
    const login = r.author?.login;
    if (!login || BOT_LOGINS.has(login) || seen.has(login)) continue;
    seen.add(login);
    reviewers.push({ login, state: r.state, submittedAt: r.submittedAt });
  }

  // From PR comments — pick up humans who left substantive feedback but aren't in latestReviews
  for (const c of (pr.comments || [])) {
    const login = c.author?.login;
    if (!login || BOT_LOGINS.has(login) || seen.has(login)) continue;
    // Skip the PR author's own comments
    if (pr._authorLogin && login === pr._authorLogin) continue;
    const body = (c.body || '').toLowerCase();
    const isSubstantive = body.includes('blocking') || body.includes('must fix') ||
      body.includes('required change') || body.includes('review') || body.length > 200;
    if (isSubstantive) {
      seen.add(login);
      reviewers.push({ login, state: 'COMMENTED' });
    }
  }

  return reviewers;
}

function detectFeedbackApplied(pr) {
  const reviews = pr.latestReviews || [];
  const comments = pr.comments || [];
  const commits = pr.commits || [];

  if (commits.length === 0) return false;

  // Find latest blocking feedback timestamp
  let latestBlockingTime = 0;

  for (const r of reviews) {
    if (r.state === 'CHANGES_REQUESTED' && r.submittedAt) {
      const t = new Date(r.submittedAt).getTime();
      if (t > latestBlockingTime) latestBlockingTime = t;
    }
  }

  for (const c of comments) {
    if (!c.author?.login || BOT_LOGINS.has(c.author.login)) continue;
    if (pr._authorLogin && c.author.login === pr._authorLogin) continue;
    const body = (c.body || '').toLowerCase();
    if (body.includes('blocking') || body.includes('must fix') || body.includes('required change')) {
      const t = new Date(c.createdAt).getTime();
      if (t > latestBlockingTime) latestBlockingTime = t;
    }
  }

  if (latestBlockingTime === 0) return false;

  // Check if any commit was pushed after the blocking feedback
  const latestCommit = commits[commits.length - 1];
  const latestCommitTime = new Date(latestCommit.committedDate).getTime();

  return latestCommitTime > latestBlockingTime;
}

function getFailingChecks(pr) {
  return (pr.statusCheckRollup || [])
    .filter(c => checkState(c) === 'failing')
    .map(c => c.name || c.context || 'Unknown check');
}

async function fetchMergeQueueStatus(prs) {
  if (prs.length === 0) return {};

  // Build a batched GraphQL query with one alias per PR
  const fragments = prs.map((pr, i) => {
    const [owner, name] = pr._repo.split('/');
    return `pr${i}: repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${pr.number}) { mergeQueueEntry { position state enqueuedAt } } }`;
  });

  const query = `query { ${fragments.join(' ')} }`;

  try {
    const { stdout } = await execFileAsync('gh', ['api', 'graphql', '-f', `query=${query}`], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, GH_PAGER: '' },
    });

    const data = JSON.parse(stdout).data;
    const status = {};

    prs.forEach((pr, i) => {
      const entry = data[`pr${i}`]?.pullRequest?.mergeQueueEntry;
      if (entry) {
        status[`${pr._repo}#${pr.number}`] = entry;
      }
    });

    return status;
  } catch (e) {
    console.error('Failed to fetch merge queue status:', e.message);
    return {};
  }
}

async function fetchPRData() {
  const detailFields = 'number,title,url,headRefName,updatedAt,additions,deletions,changedFiles,reviewDecision,latestReviews,statusCheckRollup,comments,commits,author';

  // ── 1. PRs I authored ──
  // Run all search queries in parallel
  const [authoredSearch, reviewedByMe, commentedByMe, reviewRequested] = await Promise.all([
    runGh('search prs --author @me --state open --json number,title,repository,updatedAt,url --limit 20'),
    runGh('search prs --reviewed-by @me --state open --json number,title,repository,updatedAt,url --limit 15'),
    runGh('search prs --commenter @me --state open --json number,title,repository,updatedAt,url --limit 15'),
    runGh('search prs --review-requested @me --state open --json number,title,repository,updatedAt,url --limit 10'),
  ]);

  const safeAuthored = authoredSearch || [];
  const safeReviewed = reviewedByMe || [];
  const safeCommented = commentedByMe || [];
  const safeReviewRequested = reviewRequested || [];

  // Deduplicate authored set
  const authoredKeys = new Set();
  const uniqueAuthored = [];
  for (const pr of safeAuthored) {
    const key = `${pr.repository?.nameWithOwner}#${pr.number}`;
    if (!authoredKeys.has(key)) {
      authoredKeys.add(key);
      uniqueAuthored.push(pr);
    }
  }

  // Deduplicate engaged set (reviewed + commented, excluding authored)
  const engagedKeys = new Set();
  const uniqueEngaged = [];
  for (const pr of [...safeReviewed, ...safeCommented]) {
    const key = `${pr.repository?.nameWithOwner}#${pr.number}`;
    if (!engagedKeys.has(key) && !authoredKeys.has(key)) {
      engagedKeys.add(key);
      uniqueEngaged.push(pr);
    }
  }

  // Fetch full details for all PRs in parallel
  const allSearchPRs = [
    ...uniqueAuthored.map(pr => ({ ...pr, _source: 'authored' })),
    ...uniqueEngaged.map(pr => ({ ...pr, _source: 'engaged' })),
  ];

  const detailResults = await Promise.all(
    allSearchPRs
      .filter(pr => pr.repository?.nameWithOwner)
      .map(async (searchPR) => {
        const repo = searchPR.repository.nameWithOwner;
        const details = await runGh(`pr view ${searchPR.number} --repo ${repo} --json ${detailFields}`);
        if (details) {
          details._repo = repo;
          details._repoName = searchPR.repository?.name || repo.split('/').pop();
          details._authorLogin = details.author?.login || '';
          details._source = searchPR._source;
        }
        return details;
      })
  );

  const authoredPRs = detailResults.filter(d => d && d._source === 'authored');
  const engagedPRs = detailResults.filter(d => d && d._source === 'engaged');

  // Fetch merge queue status for all PRs in a single GraphQL call
  const allPRs = [...authoredPRs, ...engagedPRs];
  const mergeQueueStatus = await fetchMergeQueueStatus(allPRs);
  for (const pr of allPRs) {
    const key = `${pr._repo}#${pr.number}`;
    if (mergeQueueStatus[key]) {
      pr._mergeQueueEntry = mergeQueueStatus[key];
    }
  }

  // Categorize authored PRs
  const categorized = {
    in_merge_queue: [],
    ready_to_merge: [],
    blocking_feedback: [],
    ci_failing: [],
    ci_pending: [],
    awaiting_review: [],
  };

  for (const pr of authoredPRs) {
    const category = categorizePR(pr);
    categorized[category].push(formatPR(pr));
  }

  // Categorize engaged PRs separately (for notification tracking)
  const engagedCategorized = [];
  for (const pr of engagedPRs) {
    engagedCategorized.push({
      ...formatPR(pr),
      category: categorizePR(pr),
    });
  }

  // Review requests (display only, no notifications)
  const reviewRequestList = safeReviewRequested.map(pr => {
    const key = `${pr.repository?.nameWithOwner}#${pr.number}`;
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      repo: pr.repository?.name || '',
      repoFull: pr.repository?.nameWithOwner || '',
      updatedAt: pr.updatedAt,
      isRereview: engagedKeys.has(key),
    };
  });

  return {
    authored: categorized,
    engaged: engagedCategorized,
    reviewRequests: reviewRequestList,
    fetchedAt: new Date().toISOString(),
    totalAuthored: authoredPRs.length,
    totalEngaged: engagedPRs.length,
    totalReviewRequests: reviewRequestList.length,
  };
}

function formatPR(pr) {
  const reviewers = getReviewerInfo(pr);
  const feedbackApplied = detectFeedbackApplied(pr);

  // Mark reviewers whose CHANGES_REQUESTED is older than the latest commit
  if (feedbackApplied) {
    const commits = pr.commits || [];
    const latestCommitTime = commits.length > 0
      ? new Date(commits[commits.length - 1].committedDate).getTime()
      : 0;
    for (const r of reviewers) {
      if (r.state === 'CHANGES_REQUESTED' && r.submittedAt) {
        r.stale = new Date(r.submittedAt).getTime() < latestCommitTime;
      }
    }
  }

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repo: pr._repoName,
    repoFull: pr._repo,
    branch: pr.headRefName,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    changedFiles: pr.changedFiles || 0,
    reviewDecision: pr.reviewDecision,
    reviewers,
    failingChecks: getFailingChecks(pr),
    updatedAt: pr.updatedAt,
    feedbackApplied,
    mergeQueue: pr._mergeQueueEntry || null,
  };
}

module.exports = { fetchPRData };
