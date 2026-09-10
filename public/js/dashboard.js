/**
 * Research Survey Analytics Dashboard
 * Dashboard Overview Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initAdminAuth();
  if (!user) return;

  loadDashboardData();
});

async function loadDashboardData() {
  const tbody = document.getElementById('recent-surveys-tbody');

  try {
    const res = await fetch('/api/dashboard');
    if (!res.ok) throw new Error('Failed to load dashboard data');

    const data = await res.json();

    // Populate metric cards
    document.getElementById('stat-total-surveys').textContent = data.totalSurveys || 0;
    document.getElementById('stat-active-surveys').textContent = data.activeSurveys || 0;
    document.getElementById('stat-closed-surveys').textContent = data.closedSurveys || 0;
    document.getElementById('stat-total-responses').textContent = data.totalResponses || 0;
    renderAttentionItems(data.attentionItems || [], data.totalAttentionItems || 0);

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
    showToast('Failed to load dashboard metrics', 'error');
  }
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
