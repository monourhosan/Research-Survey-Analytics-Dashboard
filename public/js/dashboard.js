/**
 * Research Survey Analytics Dashboard
 * Dashboard Overview Controller
 */

let selectedActivityRange = 7;
let dashboardRequestController = null;
let latestResponseActivity = null;
let activityResizeFrame = null;

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initAdminAuth();
  if (!user) return;

  document.querySelectorAll('[data-activity-range]').forEach(button => {
    button.addEventListener('click', () => {
      const range = Number(button.dataset.activityRange);
      if (!Number.isSafeInteger(range) || range === selectedActivityRange) return;
      selectedActivityRange = range;
      syncActivityRangeControls();
      loadDashboardData();
    });
  });
  window.addEventListener('resize', () => {
    if (!latestResponseActivity || activityResizeFrame) return;
    activityResizeFrame = window.requestAnimationFrame(() => {
      activityResizeFrame = null;
      drawResponseActivityChart(latestResponseActivity);
    });
  });
  loadDashboardData();
});

async function loadDashboardData() {
  const tbody = document.getElementById('recent-surveys-tbody');
  const activityStatus = document.getElementById('response-activity-status');
  if (dashboardRequestController) dashboardRequestController.abort();
  dashboardRequestController = new AbortController();
  const requestController = dashboardRequestController;
  activityStatus.textContent = 'Loading activity data…';

  try {
    const res = await fetch(`/api/dashboard?range=${selectedActivityRange}`, { signal: requestController.signal });
    if (!res.ok) throw new Error('Failed to load dashboard data');

    const data = await res.json();

    // Populate metric cards
    document.getElementById('stat-total-surveys').textContent = data.totalSurveys || 0;
    document.getElementById('stat-active-surveys').textContent = data.activeSurveys || 0;
    document.getElementById('stat-closed-surveys').textContent = data.closedSurveys || 0;
    document.getElementById('stat-total-responses').textContent = data.totalResponses || 0;
    renderAttentionItems(data.attentionItems || [], data.totalAttentionItems || 0);
    renderUpcomingResearch(data.upcomingResearch || []);
    renderResponseActivity(data.responseActivity);

    // Render Recent Surveys
    if (!data.recentSurveys || data.recentSurveys.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-title">No surveys created yet</div>
            <div class="empty-state-desc">Create your first research survey to start collecting and analyzing responses.</div>
            <a href="create-survey.html" class="btn btn-primary btn-sm">Create Survey</a>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    data.recentSurveys.forEach(survey => {
      const tr = document.createElement('tr');

      const dateStr = new Date(survey.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });

      const badgeClass = survey.status === 'active' 
        ? 'badge-active' 
        : survey.status === 'closed' 
          ? 'badge-closed' 
          : 'badge-draft';

      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; color: var(--color-text);">${escapeHtml(survey.title)}</div>
          ${survey.description ? `<div style="font-size: 12px; color: var(--color-text-muted); max-width: 380px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(survey.description)}</div>` : ''}
        </td>
        <td>
          <span class="badge ${badgeClass}">${escapeHtml(survey.status)}</span>
        </td>
        <td>
          <strong style="color: var(--color-primary);">${survey.response_count}</strong>
        </td>
        <td style="color: var(--color-text-muted); font-size: 13px;">
          ${dateStr}
        </td>
        <td style="text-align: right;">
          <div class="table-actions" style="justify-content: flex-end;">
            <a href="analytics.html?id=${survey.id}" class="btn btn-secondary btn-sm" title="View Analytics">
              <span>📈</span> Analytics
            </a>
            <a href="create-survey.html?edit=${survey.id}" class="btn btn-secondary btn-sm" title="Manage Survey">
              Manage
            </a>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Dashboard load error:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state" style="color: #dc2626;">
          <div class="empty-state-title">Error loading overview data</div>
          <div class="empty-state-desc">Please check server connection and try again.</div>
        </td>
      </tr>
    `;
    renderAttentionError();
    renderUpcomingResearchError();
    renderResponseActivityError();
    showToast('Failed to load dashboard metrics', 'error');
  }
}

function syncActivityRangeControls() {
  document.querySelectorAll('[data-activity-range]').forEach(button => {
    const isActive = Number(button.dataset.activityRange) === selectedActivityRange;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function formatActivityDate(date) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function renderResponseActivity(activity) {
  const total = document.getElementById('response-activity-total');
  const growth = document.getElementById('response-activity-growth');
  const summary = document.getElementById('response-activity-summary');
  const status = document.getElementById('response-activity-status');
  if (!activity || !Array.isArray(activity.points)) {
    renderResponseActivityError();
    return;
  }

  latestResponseActivity = activity;
  total.textContent = activity.currentTotal || 0;
  summary.textContent = `${activity.currentTotal || 0} accepted responses across the last ${activity.rangeDays} days.`;
  if (activity.previousTotal === 0 && activity.currentTotal > 0) {
    growth.textContent = 'New activity compared with the previous period';
    growth.className = 'activity-growth is-positive';
  } else if (activity.growthPercent === null || activity.growthPercent === undefined) {
    growth.textContent = 'No change from the previous period';
    growth.className = 'activity-growth';
  } else {
    const prefix = activity.growthPercent > 0 ? '+' : '';
    growth.textContent = `${prefix}${activity.growthPercent}% vs previous ${activity.rangeDays} days`;
    growth.className = `activity-growth ${activity.growthPercent > 0 ? 'is-positive' : activity.growthPercent < 0 ? 'is-negative' : ''}`;
  }
  status.textContent = activity.currentTotal ? `Daily counts shown from ${formatActivityDate(activity.points[0].date)} to ${formatActivityDate(activity.points[activity.points.length - 1].date)}.` : `No accepted responses in the last ${activity.rangeDays} days.`;
  drawResponseActivityChart(activity);
}

function renderResponseActivityError() {
  latestResponseActivity = null;
  document.getElementById('response-activity-summary').textContent = 'Response activity is currently unavailable.';
  document.getElementById('response-activity-growth').textContent = 'Try refreshing the dashboard.';
  document.getElementById('response-activity-status').textContent = 'Activity data could not be loaded.';
  const canvas = document.getElementById('response-activity-chart');
  canvas.setAttribute('aria-label', 'Response activity chart unavailable. Refresh the dashboard to try again.');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawResponseActivityChart(activity) {
  const canvas = document.getElementById('response-activity-chart');
  const context = canvas.getContext('2d');
  const points = activity.points || [];
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.parentElement.clientWidth || 640;
  const height = 220;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const padding = { top: 18, right: 14, bottom: 35, left: 34 };
  const chartWidth = Math.max(1, width - padding.left - padding.right);
  const chartHeight = Math.max(1, height - padding.top - padding.bottom);
  const maxCount = Math.max(1, ...points.map(point => Number(point.count || 0)));
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim() || '#cccccc';
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim() || '#555555';
  const lineColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#181818';

  context.font = '11px system-ui, sans-serif';
  context.fillStyle = textColor;
  context.strokeStyle = gridColor;
  context.lineWidth = 1;
  for (let tick = 0; tick <= 3; tick += 1) {
    const y = padding.top + (chartHeight / 3) * tick;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(String(Math.round(maxCount - (maxCount / 3) * tick)), 2, y + 4);
  }

  if (!points.length) return;
  const step = points.length === 1 ? 0 : chartWidth / (points.length - 1);
  const pointAt = (point, index) => ({
    x: padding.left + step * index,
    y: padding.top + chartHeight - ((Number(point.count || 0) / maxCount) * chartHeight)
  });
  context.beginPath();
  points.forEach((point, index) => {
    const { x, y } = pointAt(point, index);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  context.lineTo(padding.left, padding.top + chartHeight);
  context.closePath();
  context.fillStyle = 'rgba(24, 24, 24, 0.10)';
  context.fill();

  context.beginPath();
  points.forEach((point, index) => {
    const { x, y } = pointAt(point, index);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = lineColor;
  context.lineWidth = 2;
  context.stroke();
  const labelStep = Math.max(1, Math.ceil(points.length / (width < 480 ? 3 : 6)));
  points.forEach((point, index) => {
    const { x, y } = pointAt(point, index);
    context.fillStyle = lineColor;
    context.beginPath();
    context.arc(x, y, 3, 0, Math.PI * 2);
    context.fill();
    if (index % labelStep === 0 || index === points.length - 1) {
      context.fillStyle = textColor;
      context.textAlign = index === 0 ? 'left' : index === points.length - 1 ? 'right' : 'center';
      context.fillText(formatActivityDate(point.date), x, height - 11);
    }
  });
  canvas.setAttribute('aria-label', `Response activity chart for the last ${activity.rangeDays} days: ${activity.currentTotal} accepted responses. Daily counts range from zero to ${maxCount}.`);
}

function upcomingStatusLabel(status) {
  return ({
    target_reached: 'Target reached',
    deadline_passed: 'Deadline passed',
    needs_attention: 'Needs attention',
    almost_there: 'Almost there',
    on_track: 'On track',
    collecting: 'Collecting'
  })[status] || 'Collecting';
}

function formatUpcomingDeadline(deadline) {
  return new Date(deadline).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
}

function upcomingDeadlineText(item) {
  if (!item.deadline) return '';
  if (item.status === 'deadline_passed') return `Deadline passed · ${formatUpcomingDeadline(item.deadline)}`;
  const days = Number(item.daysRemaining || 0);
  return `${formatUpcomingDeadline(item.deadline)} · ${days} day${days === 1 ? '' : 's'} remaining`;
}

function renderUpcomingResearch(items) {
  const list = document.getElementById('upcoming-research-list');
  list.setAttribute('aria-busy', 'false');
  if (!items.length) {
    list.innerHTML = '<div class="upcoming-empty-state"><strong>No active studies with deadlines or targets</strong><span>Add a response deadline or target in a survey’s settings to plan collection here.</span></div>';
    return;
  }

  list.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('article');
    row.className = 'upcoming-research-item';
    const hasTarget = Number.isSafeInteger(item.targetResponses) && item.targetResponses > 0;
    const responseCount = Number(item.responseCount || 0);
    const progress = hasTarget ? Math.max(0, Math.min(100, Number(item.progressPercent || 0))) : null;
    const summary = hasTarget
      ? `${responseCount} / ${item.targetResponses} responses · ${progress}% toward target`
      : `${responseCount} accepted response${responseCount === 1 ? '' : 's'}`;
    row.innerHTML = `
      <div class="upcoming-research-main">
        <div class="upcoming-research-title-row">
          <h3>${escapeHtml(item.title)}</h3>
          <span class="upcoming-status upcoming-status-${escapeHtml(item.status || 'collecting')}">${escapeHtml(upcomingStatusLabel(item.status))}</span>
        </div>
        <p class="upcoming-research-summary">${escapeHtml(summary)}</p>
        ${hasTarget ? `<div class="upcoming-progress-wrap"><progress value="${progress}" max="100" aria-label="${escapeHtml(item.title)} is ${progress}% toward its response target"></progress><span>${progress}%</span></div>` : ''}
        ${item.deadline ? `<p class="upcoming-deadline">${escapeHtml(upcomingDeadlineText(item))}</p>` : ''}
      </div>
      <a class="btn btn-secondary btn-sm upcoming-research-action" href="analytics.html?id=${encodeURIComponent(item.surveyId)}">Analytics <span aria-hidden="true">→</span></a>
    `;
    list.appendChild(row);
  });
}

function renderUpcomingResearchError() {
  const list = document.getElementById('upcoming-research-list');
  list.setAttribute('aria-busy', 'false');
  list.innerHTML = '<div class="upcoming-empty-state">Upcoming study details could not be loaded. Refresh the dashboard to try again.</div>';
}

function attentionActionFor(item) {
  if (item.type === 'target_achieved') {
    return { href: `analytics.html?id=${encodeURIComponent(item.surveyId)}`, label: 'Analytics' };
  }
  if (item.type === 'draft_not_ready') {
    return { href: `create-survey.html?edit=${encodeURIComponent(item.surveyId)}`, label: 'Complete draft' };
  }
  return { href: `create-survey.html?edit=${encodeURIComponent(item.surveyId)}`, label: 'Review' };
}

function attentionContext(item) {
  const details = [];
  if (item.targetResponses) details.push(`${item.responseCount} / ${item.targetResponses} responses`);
  else if (item.responseLimit) details.push(`${item.responseCount} / ${item.responseLimit} capacity`);
  else if (Number.isFinite(item.responseCount)) details.push(`${item.responseCount} responses`);
  if (item.daysRemaining !== null && item.daysRemaining !== undefined && item.type !== 'deadline_passed') {
    details.push(`${item.daysRemaining} day${item.daysRemaining === 1 ? '' : 's'} remaining`);
  }
  if (item.readinessPercentage !== undefined) details.push(`${item.readinessPercentage}% ready`);
  return details.join(' · ');
}

function renderAttentionItems(items, total) {
  const list = document.getElementById('attention-required-list');
  const count = document.getElementById('attention-required-count');
  const itemCount = Number(total || items.length || 0);
  count.textContent = itemCount;
  count.setAttribute('aria-label', `${itemCount} survey${itemCount === 1 ? '' : 's'} need attention`);
  list.setAttribute('aria-busy', 'false');

  if (!items.length) {
    list.innerHTML = '<div class="attention-empty-state"><strong>No surveys need attention right now.</strong><span>Your active surveys, targets, and draft checks are currently on track.</span></div>';
    return;
  }

  list.innerHTML = '';
  items.forEach(item => {
    const action = attentionActionFor(item);
    const row = document.createElement('article');
    row.className = `attention-item attention-${escapeHtml(item.severity || 'warning')}`;
    const context = attentionContext(item);
    row.innerHTML = `
      <div class="attention-indicator" aria-hidden="true">${item.severity === 'success' ? '✓' : '!'}</div>
      <div class="attention-item-copy">
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.message)}</p>
        ${context ? `<span class="attention-context">${escapeHtml(context)}</span>` : ''}
      </div>
      <a class="btn btn-secondary btn-sm attention-action" href="${action.href}">${action.label} <span aria-hidden="true">→</span></a>
    `;
    list.appendChild(row);
  });

  if (itemCount > items.length) {
    const more = document.createElement('p');
    more.className = 'attention-more';
    more.textContent = `${itemCount - items.length} additional survey${itemCount - items.length === 1 ? '' : 's'} also need attention.`;
    list.appendChild(more);
  }
}

function renderAttentionError() {
  const list = document.getElementById('attention-required-list');
  const count = document.getElementById('attention-required-count');
  count.textContent = '—';
  count.setAttribute('aria-label', 'Attention data unavailable');
  list.setAttribute('aria-busy', 'false');
  list.innerHTML = '<div class="attention-empty-state">Attention items could not be loaded. Refresh the dashboard to try again.</div>';
}
