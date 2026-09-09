/**
 * Research Survey Analytics Dashboard
 * Survey Inventory Controller
 */

let allSurveys = [];

function getPublicSurveyUrl(id) {
  return `${window.location.origin}/survey.html?id=${encodeURIComponent(id)}`;
}

function getDeadlineDetails(responseDeadline) {
  if (!responseDeadline) return null;
  const deadline = new Date(responseDeadline);
  if (Number.isNaN(deadline.getTime())) return null;
  const hasPassed = deadline.getTime() <= Date.now();
  const formatted = deadline.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  return { hasPassed, formatted };
}

function getResponseLimitDetails(responseLimit, responseCount) {
  if (!Number.isSafeInteger(responseLimit) || responseLimit < 1) return null;
  const reached = responseCount >= responseLimit;
  return {
    reached,
    label: `${responseCount} / ${responseLimit}${reached ? ' · Limit reached' : ' responses'}`
  };
}

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
      const deadline = getDeadlineDetails(survey.response_deadline);
      const responseLimit = getResponseLimitDetails(survey.response_limit, survey.response_count);

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
          <button type="button" class="btn btn-secondary btn-sm" onclick="openShareDialog(${survey.id})" title="Share survey">
            <span>↗</span> Share
          </button>
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
          ${survey.one_response_per_browser ? '<div style="font-size: 12px; color: var(--color-text-muted); margin-top: 5px;">Repeat protection: On (same browser)</div>' : ''}
          ${deadline ? `<div class="survey-deadline ${deadline.hasPassed ? 'is-passed' : ''}">${deadline.hasPassed ? 'Response deadline passed' : `Responses close: ${escapeHtml(deadline.formatted)}`}</div>` : ''}
        </td>
        <td>
          <span class="badge ${badgeClass}">${escapeHtml(survey.status)}</span>
          ${deadline && deadline.hasPassed ? '<span class="badge badge-deadline-passed">Expired</span>' : ''}
        </td>
        <td>
          <strong style="color: var(--color-primary); font-size: 15px;">${responseLimit ? escapeHtml(responseLimit.label) : survey.response_count}</strong>
          ${responseLimit && responseLimit.reached ? '<div class="survey-limit-reached">Response limit reached</div>' : ''}
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
  const url = getPublicSurveyUrl(id);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Survey link copied to clipboard.', 'success'))
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
  showToast('Survey link copied to clipboard.', 'success');
}

function ensureShareDialog() {
  let dialog = document.getElementById('share-survey-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'share-survey-dialog';
  dialog.className = 'custom-modal share-survey-modal';
  dialog.setAttribute('aria-labelledby', 'share-dialog-title');
  document.body.appendChild(dialog);
  return dialog;
}

function makeQrFilename(title) {
  const safeTitle = String(title || 'survey')
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${safeTitle || 'survey'}-qr.png`;
}

function downloadQrCode(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast('QR code downloaded.', 'success');
}

function qrToPngDataUrl(qr, cellSize = 6, margin = 4) {
  const moduleCount = qr.getModuleCount();
  const pixelSize = (moduleCount + margin * 2) * cellSize;
  const canvas = document.createElement('canvas');
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const context = canvas.getContext('2d');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, pixelSize, pixelSize);
  context.fillStyle = '#000000';
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (qr.isDark(row, column)) {
        context.fillRect(
          (column + margin) * cellSize,
          (row + margin) * cellSize,
          cellSize,
          cellSize
        );
      }
    }
  }
  return canvas.toDataURL('image/png');
}

function openShareDialog(id) {
  const survey = allSurveys.find(item => Number(item.id) === Number(id));
  if (!survey || survey.status !== 'active') {
    showToast('Only active surveys can be publicly shared.', 'error');
    return;
  }

  if (typeof qrcode !== 'function') {
    showToast('QR generator failed to load. Please refresh and try again.', 'error');
    return;
  }

  const url = getPublicSurveyUrl(survey.id);
  const dialog = ensureShareDialog();
  dialog.innerHTML = `
    <div class="share-dialog-header">
      <div>
        <p class="share-dialog-kicker">Public survey sharing</p>
        <h2 class="modal-title" id="share-dialog-title">Share ${escapeHtml(survey.title)}</h2>
      </div>
      <button type="button" class="share-dialog-close" id="share-dialog-close" aria-label="Close share dialog">&times;</button>
    </div>
    <p class="modal-desc">Scan this QR code or copy the public URL to invite respondents.</p>
    <div class="share-dialog-content">
      <div class="share-qr-frame" id="share-qr-code" aria-label="QR code for ${escapeHtml(survey.title)}"></div>
      <div class="share-url-group">
        <label class="form-label" for="share-public-url">Public survey URL</label>
        <input id="share-public-url" class="form-input share-public-url" type="text" readonly value="${escapeHtml(url)}">
        <p class="share-url-help">This URL uses the current application domain and survey ID ${escapeHtml(survey.id)}.</p>
      </div>
    </div>
    <div class="modal-actions share-dialog-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="share-copy-link">Copy Link</button>
      <button type="button" class="btn btn-primary btn-sm" id="share-download-qr">Download QR</button>
      <button type="button" class="btn btn-secondary btn-sm" id="share-close-btn">Close</button>
    </div>
  `;

  const qr = qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  const qrDataUrl = qrToPngDataUrl(qr);
  const qrImage = document.createElement('img');
  qrImage.src = qrDataUrl;
  qrImage.alt = `QR code for ${survey.title}`;
  qrImage.className = 'share-qr-image';
  dialog.querySelector('#share-qr-code').replaceChildren(qrImage);

  const closeDialog = () => dialog.close();
  dialog.querySelector('#share-dialog-close').onclick = closeDialog;
  dialog.querySelector('#share-close-btn').onclick = closeDialog;
  dialog.querySelector('#share-copy-link').onclick = () => copySurveyLink(survey.id);
  dialog.querySelector('#share-download-qr').onclick = () => downloadQrCode(qrDataUrl, makeQrFilename(survey.title));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeDialog();
  }, { once: true });

  dialog.showModal();
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
