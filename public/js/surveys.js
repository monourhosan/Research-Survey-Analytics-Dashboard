/**
 * Research Survey Analytics Dashboard
 * Survey Inventory Controller
 */

let allSurveys = [];

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initAdminAuth();
  if (!user) return;

  document.getElementById('survey-search').addEventListener('input', renderSurveyRows);
  document.getElementById('survey-status-filter').addEventListener('change', renderSurveyRows);

  await loadAllSurveys();
});

async function loadAllSurveys() {
  const tbody = document.getElementById('surveys-tbody');

  try {
    const res = await fetch('/api/surveys');
    if (!res.ok) throw new Error('Failed to load surveys');

    allSurveys = await res.json();

    renderSurveyRows();
  } catch (err) {
    console.error('Surveys list error:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state" style="color: #dc2626;">
          <div class="empty-state-title">Failed to load surveys</div>
          <div class="empty-state-desc">Please ensure the server is active and refresh.</div>
        </td>
      </tr>
    `;
    document.getElementById('survey-filter-count').textContent = 'Survey list unavailable';
    showToast('Failed to load surveys', 'error');
  }
}

function renderSurveyRows() {
  const tbody = document.getElementById('surveys-tbody');
  const searchTerm = document.getElementById('survey-search').value.trim().toLowerCase();
  const status = document.getElementById('survey-status-filter').value;
  const countEl = document.getElementById('survey-filter-count');

  const surveys = allSurveys.filter(survey => {
    const searchableText = `${survey.title || ''} ${survey.description || ''}`.toLowerCase();
    const matchesSearch = !searchTerm || searchableText.includes(searchTerm);
    const matchesStatus = status === 'all' || survey.status === status;
    return matchesSearch && matchesStatus;
  });

  countEl.textContent = `Showing ${surveys.length} of ${allSurveys.length} surveys`;

  if (allSurveys.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">No surveys found</div>
          <div class="empty-state-desc">You have not created any surveys yet. Click the button below to start your first research project.</div>
          <a href="create-survey.html" class="btn btn-primary btn-sm">Create New Survey</a>
        </td>
      </tr>
    `;
    return;
  }

  if (surveys.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <div class="empty-state-icon">🔎</div>
          <div class="empty-state-title">No matching surveys</div>
          <div class="empty-state-desc">Try another search term or include more survey statuses.</div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="clearSurveyFilters()">Clear Filters</button>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  surveys.forEach(survey => {
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

      // Build context-sensitive action buttons
      let statusActionBtn = '';
      if (survey.status === 'draft') {
        statusActionBtn = `
          <button type="button" class="btn btn-teal btn-sm" onclick="publishSurvey(${survey.id})" title="Publish survey">
            Publish
          </button>
        `;
      } else if (survey.status === 'active') {
        statusActionBtn = `
          <button type="button" class="btn btn-secondary btn-sm" onclick="copySurveyLink(${survey.id})" title="Copy public response link">
            <span>🔗</span> Copy Link
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeSurvey(${survey.id})" title="Close survey">
            Close
          </button>
        `;
      }

      // Delete button: enabled only if 0 responses
      const deleteBtn = survey.response_count === 0
        ? `<button type="button" class="btn btn-danger btn-sm" onclick="deleteSurvey(${survey.id})" title="Delete survey">Delete</button>`
        : `<button type="button" class="btn btn-secondary btn-sm" disabled style="opacity: 0.45; cursor: not-allowed;" title="Cannot delete survey with existing responses">Delete</button>`;

      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; color: var(--color-text); font-size: 15px;">${escapeHtml(survey.title)}</div>
          ${survey.description ? `<div style="font-size: 12.5px; color: var(--color-text-muted); margin-top: 2px;">${escapeHtml(survey.description)}</div>` : ''}
        </td>
        <td>
          <span class="badge ${badgeClass}">${escapeHtml(survey.status)}</span>
        </td>
        <td>
          <strong style="color: var(--color-primary); font-size: 15px;">${survey.response_count}</strong>
        </td>
        <td style="color: var(--color-text-muted); font-size: 13px;">
          ${dateStr}
        </td>
        <td style="text-align: right;">
          <div class="table-actions" style="justify-content: flex-end;">
            <a href="analytics.html?id=${survey.id}" class="btn btn-secondary btn-sm">
              <span>📈</span> Analytics
            </a>
            <a href="create-survey.html?edit=${survey.id}" class="btn btn-secondary btn-sm">
              Manage
            </a>
            ${statusActionBtn}
            ${deleteBtn}
          </div>
        </td>
      `;
    tbody.appendChild(tr);
  });
}

function clearSurveyFilters() {
  document.getElementById('survey-search').value = '';
  document.getElementById('survey-status-filter').value = 'all';
  renderSurveyRows();
  document.getElementById('survey-search').focus();
}

// Copy Public Link to Clipboard
function copySurveyLink(id) {
  const url = `${window.location.origin}/survey.html?id=${id}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Public survey link copied to clipboard!', 'success'))
      .catch(() => fallbackCopy(url));
  } else {
    fallbackCopy(url);
  }
}

function fallbackCopy(url) {
  const input = document.createElement('input');
  input.value = url;
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
  showToast('Public survey link copied to clipboard!', 'success');
}

// Publish Survey
function publishSurvey(id) {
  showConfirmDialog(
    'Publish Survey',
    'Publishing will make this survey active and open for respondent submissions. Proceed?',
    async () => {
      try {
        const res = await fetch(`/api/surveys/${id}/publish`, { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast('Survey published successfully!', 'success');
          loadAllSurveys();
        } else {
          showToast(data.error || 'Failed to publish survey', 'error');
        }
      } catch (err) {
        showToast('Network error while publishing survey', 'error');
      }
    },
    'Publish Survey',
    false
  );
}

// Close Survey
function closeSurvey(id) {
  showConfirmDialog(
    'Close Survey',
    'Are you sure you want to close this survey? Respondents will no longer be able to submit new answers, but existing analytics will be preserved.',
    async () => {
      try {
        const res = await fetch(`/api/surveys/${id}/close`, { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast('Survey closed successfully', 'info');
          loadAllSurveys();
        } else {
          showToast(data.error || 'Failed to close survey', 'error');
        }
      } catch (err) {
        showToast('Network error while closing survey', 'error');
      }
    },
    'Close Survey',
    true
  );
}

// Delete Survey
function deleteSurvey(id) {
  showConfirmDialog(
    'Delete Survey',
    'Are you sure you want to permanently delete this survey? This action cannot be undone.',
    async () => {
      try {
        const res = await fetch(`/api/surveys/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast('Survey deleted successfully', 'success');
          loadAllSurveys();
        } else {
          showToast(data.error || 'Failed to delete survey', 'error');
        }
      } catch (err) {
        showToast('Network error while deleting survey', 'error');
      }
    },
    'Delete Survey',
    true
  );
}
