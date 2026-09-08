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
    showToast('Failed to load dashboard metrics', 'error');
  }
}
