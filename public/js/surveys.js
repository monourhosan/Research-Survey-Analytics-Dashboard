/**
 * Research Survey Analytics Dashboard
 * Survey Inventory Controller
 */

let allSurveys = [];
let allCollections = [];

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
  ['survey-status-filter', 'survey-collection-filter', 'survey-archived-filter', 'survey-pinned-filter'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadAllSurveys);
  });
  document.getElementById('btn-new-collection').addEventListener('click', () => openCollectionDialog());
  document.getElementById('btn-save-workspace-view').addEventListener('click', saveWorkspaceView);
  document.getElementById('btn-compare-surveys').addEventListener('click', openComparison);

  await Promise.all([loadWorkspace(), loadCollections(), loadSavedViews(), loadAllSurveys()]);
});

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadWorkspace() {
  try {
    const data = await apiJson('/api/workspace');
    document.getElementById('workspace-total-studies').textContent = data.total_studies;
    document.getElementById('workspace-active-studies').textContent = data.active;
    document.getElementById('workspace-draft-studies').textContent = data.drafts;
    document.getElementById('workspace-total-responses').textContent = data.total_responses;
    const activity = await apiJson('/api/activity?limit=5');
    document.getElementById('activity-list').replaceChildren(...activity.map(renderActivityRow));
    if (!activity.length) document.getElementById('activity-list').innerHTML = '<p class="workspace-loading">No recorded administrator activity yet.</p>';
  } catch (err) { console.error(err); }
}

function renderActivityRow(item) {
  const row = document.createElement('div'); row.className = 'activity-row';
  const action = String(item.action || '').replace(/^SURVEY_/, '').replace(/_/g, ' ').toLowerCase();
  const date = new Date(item.created_at).toLocaleString();
  row.innerHTML = `<div><strong>${escapeHtml(item.survey_title || 'Research workspace')}</strong><small>${escapeHtml(action.charAt(0).toUpperCase() + action.slice(1))} · ${escapeHtml(date)}</small></div>`;
  return row;
}

async function loadCollections() {
  try {
    const data = await apiJson('/api/collections');
    allCollections = data.collections || [];
    const select = document.getElementById('survey-collection-filter');
    const selected = select.value;
    select.innerHTML = '<option value="">All collections</option>';
    allCollections.forEach(collection => { const option = document.createElement('option'); option.value = collection.id; option.textContent = collection.name; select.appendChild(option); });
    select.value = selected;
    const list = document.getElementById('collections-list'); list.replaceChildren();
    allCollections.forEach(collection => list.appendChild(renderCollectionRow(collection)));
    if (!allCollections.length) list.innerHTML = '<p class="workspace-loading">Create a collection to organize related studies.</p>';
  } catch (err) { showToast(err.message, 'error'); }
}

function renderCollectionRow(collection) {
  const row = document.createElement('div'); row.className = 'collection-row';
  row.innerHTML = `<div><strong>${escapeHtml(collection.name)}</strong><small>${collection.survey_count} studies · ${collection.active_count || 0} active · ${collection.total_responses || 0} responses${collection.next_deadline ? ` · next deadline ${escapeHtml(new Date(collection.next_deadline).toLocaleDateString())}` : ''}</small></div><div class="collection-actions"><button type="button" class="btn btn-secondary btn-sm" aria-label="Edit ${escapeHtml(collection.name)}" onclick="openCollectionDialog(${collection.id})">Edit</button><button type="button" class="btn btn-secondary btn-sm" aria-label="Delete ${escapeHtml(collection.name)}" onclick="deleteCollection(${collection.id})">Delete</button></div>`;
  return row;
}

async function loadAllSurveys() {
  const tbody = document.getElementById('surveys-tbody');

  try {
    const params = new URLSearchParams();
    if (document.getElementById('survey-archived-filter').checked) params.set('archived', 'true');
    if (document.getElementById('survey-pinned-filter').checked) params.set('pinned', 'true');
    if (document.getElementById('survey-collection-filter').value) params.set('collection_id', document.getElementById('survey-collection-filter').value);
    const res = await fetch(`/api/surveys?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to load surveys');

    allSurveys = await res.json();

    renderSurveyRows();
  } catch (err) {
    console.error('Surveys list error:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state" style="color: #dc2626;">
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
        <td colspan="6" class="empty-state">
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
        <td colspan="6" class="empty-state">
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
        <td><input type="checkbox" class="workspace-survey-select" value="${survey.id}" aria-label="Select ${escapeHtml(survey.title)} for comparison" onchange="syncCompareButton()"></td>
        <td>
          <div style="font-weight: 600; color: var(--color-text); font-size: 15px;">${escapeHtml(survey.title)}</div>
          ${survey.description ? `<div style="font-size: 12.5px; color: var(--color-text-muted); margin-top: 2px;">${escapeHtml(survey.description)}</div>` : ''}
          ${survey.collection_name ? `<div class="survey-workspace-meta">Collection: ${escapeHtml(survey.collection_name)}</div>` : '<div class="survey-workspace-meta">Unassigned collection</div>'}
          ${survey.target_responses ? `<div class="survey-workspace-meta">${survey.response_count} / ${survey.target_responses} target · ${escapeHtml(survey.collection_state || 'Collecting')}</div><div class="survey-progress-mini" aria-label="${survey.target_progress || 0}% of target"><span style="width:${survey.target_progress || 0}%"></span></div>` : ''}
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
          <div class="survey-row-actions">
            <a href="analytics.html?id=${survey.id}" class="btn btn-secondary btn-sm">
              <span>📈</span> Analytics
            </a>
            <a href="create-survey.html?edit=${survey.id}" class="btn btn-secondary btn-sm">
              Manage
            </a>
            <button type="button" class="btn btn-secondary btn-sm" onclick="duplicateSurvey(${survey.id})">Duplicate</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="togglePinSurvey(${survey.id}, ${survey.is_pinned ? 'false' : 'true'})" aria-label="${survey.is_pinned ? 'Unpin' : 'Pin'} ${escapeHtml(survey.title)}">${survey.is_pinned ? '★ Pinned' : '☆ Pin'}</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="openSurveyNotes(${survey.id})">Notes</button>
            ${survey.status !== 'active' ? `<button type="button" class="btn btn-secondary btn-sm" onclick="${survey.is_archived ? 'restoreSurvey' : 'archiveSurvey'}(${survey.id})">${survey.is_archived ? 'Restore' : 'Archive'}</button>` : ''}
            ${survey.status !== 'active' && !survey.is_archived ? `<button type="button" class="btn btn-secondary btn-sm" onclick="saveAsTemplate(${survey.id})">Template</button>` : ''}
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
  document.getElementById('survey-collection-filter').value = '';
  document.getElementById('survey-archived-filter').checked = false;
  document.getElementById('survey-pinned-filter').checked = false;
  loadAllSurveys();
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

function ensureWorkspaceDialog() {
  let dialog = document.getElementById('workspace-dialog');
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'workspace-dialog'; dialog.className = 'workspace-dialog'; document.body.appendChild(dialog); }
  return dialog;
}

function showWorkspaceDialog(title, content, bind) {
  const dialog = ensureWorkspaceDialog();
  dialog.innerHTML = `<div class="workspace-dialog-inner"><button type="button" class="share-dialog-close" aria-label="Close dialog">×</button><h2>${escapeHtml(title)}</h2>${content}</div>`;
  dialog.querySelector('.share-dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }, { once: true });
  bind?.(dialog); dialog.showModal();
}

function openCollectionDialog(id = null) {
  const collection = id ? allCollections.find(item => Number(item.id) === Number(id)) : null;
  showWorkspaceDialog(collection ? 'Edit collection' : 'Create collection', `<form id="collection-form"><div class="form-group"><label class="form-label" for="collection-name">Collection name</label><input id="collection-name" class="form-input" maxlength="100" required value="${escapeHtml(collection?.name || '')}"></div><div class="form-group"><label class="form-label" for="collection-description">Description</label><textarea id="collection-description" class="form-textarea" maxlength="1000">${escapeHtml(collection?.description || '')}</textarea></div><div class="modal-actions"><button class="btn btn-primary" type="submit">${collection ? 'Save collection' : 'Create collection'}</button></div></form>`, dialog => {
    dialog.querySelector('#collection-form').addEventListener('submit', async event => { event.preventDefault(); try { await apiJson(collection ? `/api/collections/${collection.id}` : '/api/collections', { method: collection ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: dialog.querySelector('#collection-name').value, description: dialog.querySelector('#collection-description').value }) }); dialog.close(); await Promise.all([loadCollections(), loadWorkspace(), loadAllSurveys()]); showToast('Collection saved.', 'success'); } catch (err) { showToast(err.message, 'error'); } });
  });
}

async function deleteCollection(id) {
  showConfirmDialog('Delete collection', 'Studies will remain available and become unassigned. Continue?', async () => { try { await apiJson(`/api/collections/${id}`, { method: 'DELETE' }); await Promise.all([loadCollections(), loadWorkspace(), loadAllSurveys()]); showToast('Collection deleted; surveys are unassigned.', 'success'); } catch (err) { showToast(err.message, 'error'); } }, 'Delete collection', true);
}

async function duplicateSurvey(id) {
  try { const created = await apiJson(`/api/surveys/${id}/duplicate`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }); showToast('Draft copy created.', 'success'); window.location.href = `create-survey.html?edit=${created.id}`; } catch (err) { showToast(err.message, 'error'); }
}

async function togglePinSurvey(id, pinned) {
  try { await apiJson(`/api/surveys/${id}/pin`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ pinned }) }); await loadAllSurveys(); showToast(pinned ? 'Survey pinned.' : 'Survey unpinned.', 'success'); } catch (err) { showToast(err.message, 'error'); }
}

async function archiveSurvey(id) { try { await apiJson(`/api/surveys/${id}/archive`, {method:'POST'}); await Promise.all([loadAllSurveys(), loadWorkspace()]); showToast('Survey archived.', 'success'); } catch (err) { showToast(err.message, 'error'); } }
async function restoreSurvey(id) { try { await apiJson(`/api/surveys/${id}/restore`, {method:'POST'}); await Promise.all([loadAllSurveys(), loadWorkspace()]); showToast('Survey restored.', 'success'); } catch (err) { showToast(err.message, 'error'); } }

function saveAsTemplate(id) {
  const survey = allSurveys.find(item => Number(item.id) === Number(id));
  showWorkspaceDialog('Save as template', `<form id="template-form"><div class="form-group"><label class="form-label" for="template-name">Template name</label><input id="template-name" class="form-input" maxlength="120" required value="${escapeHtml(survey?.title || '')} Template"></div><div class="modal-actions"><button class="btn btn-primary" type="submit">Save template</button></div></form>`, dialog => dialog.querySelector('#template-form').addEventListener('submit', async event => { event.preventDefault(); try { await apiJson(`/api/surveys/${id}/templates`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:dialog.querySelector('#template-name').value})}); dialog.close(); showToast('Template saved.', 'success'); } catch (err) { showToast(err.message, 'error'); } }));
}

async function openSurveyNotes(id) {
  try {
    const notes = await apiJson(`/api/surveys/${id}/notes`);
    const noteMarkup = notes.map(note => `<article class="note-item"><p>${escapeHtml(note.note_text)}</p><small>${escapeHtml(new Date(note.created_at).toLocaleString())}</small><div class="collection-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="editWorkspaceNote(${note.id}, ${id})">Edit</button><button type="button" class="btn btn-secondary btn-sm" onclick="deleteWorkspaceNote(${note.id}, ${id})">Delete</button></div></article>`).join('') || '<p class="workspace-loading">No private research notes yet.</p>';
    showWorkspaceDialog('Research Notes', `<div class="notes-list">${noteMarkup}</div><form id="note-form"><div class="form-group"><label class="form-label" for="new-note">New private note</label><textarea id="new-note" class="form-textarea" maxlength="4000" required></textarea></div><div class="modal-actions"><button class="btn btn-primary" type="submit">Add note</button></div></form>`, dialog => dialog.querySelector('#note-form').addEventListener('submit', async event => { event.preventDefault(); try { await apiJson(`/api/surveys/${id}/notes`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({note_text:dialog.querySelector('#new-note').value})}); dialog.close(); openSurveyNotes(id); } catch (err) { showToast(err.message, 'error'); } }));
  } catch (err) { showToast(err.message, 'error'); }
}

async function editWorkspaceNote(noteId, surveyId) { const text = window.prompt('Edit research note'); if (text === null) return; try { await apiJson(`/api/notes/${noteId}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({note_text:text})}); ensureWorkspaceDialog().close(); openSurveyNotes(surveyId); } catch (err) { showToast(err.message,'error'); } }
async function deleteWorkspaceNote(noteId, surveyId) { try { await apiJson(`/api/notes/${noteId}`, {method:'DELETE'}); ensureWorkspaceDialog().close(); openSurveyNotes(surveyId); } catch (err) { showToast(err.message,'error'); } }

function syncCompareButton() { const selected = document.querySelectorAll('.workspace-survey-select:checked').length; document.getElementById('btn-compare-surveys').disabled = selected < 2 || selected > 4; }
async function openComparison() { const ids = [...document.querySelectorAll('.workspace-survey-select:checked')].map(input => input.value); try { const data = await apiJson(`/api/surveys/compare?ids=${ids.join(',')}`); const rows = [['Responses','response_count'],['Target progress','target_progress'],['Average rating','average_rating'],['Positive ratings','positive_rating_percentage'],['7-day responses','latest_7_day_responses'],['Deadline','deadline'],['Status','status']].map(([label,key]) => `<tr><th>${label}</th>${data.surveys.map(survey => `<td>${survey[key] === null || survey[key] === undefined ? '—' : key === 'target_progress' || key === 'positive_rating_percentage' ? `${survey[key]}%` : key === 'deadline' ? new Date(survey[key]).toLocaleDateString() : escapeHtml(String(survey[key]))}</td>`).join('')}</tr>`).join(''); showWorkspaceDialog('Compare surveys', `<div class="table-responsive"><table class="comparison-table"><thead><tr><th>Metric</th>${data.surveys.map(survey => `<th>${escapeHtml(survey.title)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`); } catch (err) { showToast(err.message, 'error'); } }

async function loadSavedViews() {
  const list = document.getElementById('saved-views-list');
  try {
    const views = await apiJson('/api/saved-views?view_type=workspace');
    if (!views.length) { list.innerHTML = '<p class="workspace-loading">Save a filter combination to return to it quickly.</p>'; return; }
    list.innerHTML = views.map(view => `<div class="collection-row"><div><strong>${escapeHtml(view.name)}</strong><small>Workspace filter view</small></div><div class="collection-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="applyWorkspaceView(${view.id})">Apply</button><button type="button" class="btn btn-secondary btn-sm" onclick="deleteWorkspaceView(${view.id})">Delete</button></div></div>`).join('');
  } catch (err) { list.innerHTML = '<p class="workspace-loading">Saved views could not be loaded.</p>'; }
}

async function applyWorkspaceView(id) {
  try {
    const views = await apiJson('/api/saved-views?view_type=workspace');
    const view = views.find(item => Number(item.id) === Number(id));
    if (!view) throw new Error('Saved view not found.');
    const filters = view.filters || {};
    document.getElementById('survey-status-filter').value = filters.status || 'all';
    document.getElementById('survey-collection-filter').value = filters.collection_id || '';
    document.getElementById('survey-archived-filter').checked = Boolean(filters.archived);
    document.getElementById('survey-pinned-filter').checked = Boolean(filters.pinned);
    document.getElementById('survey-search').value = filters.search || '';
    await loadAllSurveys();
    showToast(`Applied “${view.name}”.`, 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteWorkspaceView(id) {
  try { await apiJson(`/api/saved-views/${id}`, { method: 'DELETE' }); await loadSavedViews(); showToast('Saved view deleted.', 'success'); }
  catch (err) { showToast(err.message, 'error'); }
}

async function saveWorkspaceView() { const name = window.prompt('Name this workspace view'); if (!name) return; const filters = { status: document.getElementById('survey-status-filter').value, collection_id: document.getElementById('survey-collection-filter').value || null, archived: document.getElementById('survey-archived-filter').checked, pinned: document.getElementById('survey-pinned-filter').checked, search: document.getElementById('survey-search').value }; try { await apiJson('/api/saved-views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,view_type:'workspace',filters})}); await loadSavedViews(); showToast('Workspace view saved.', 'success'); } catch (err) { showToast(err.message,'error'); } }
