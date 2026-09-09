/**
 * Research Survey Analytics Dashboard
 * Survey Creator & Question Builder Controller
 */

let questionsList = [];
let editingSurveyId = null;
let hasExistingResponses = false;
const LOCAL_DRAFT_SCHEMA_VERSION = 1;
const LOCAL_DRAFT_DEBOUNCE_MS = 1000;
let localDraftSaveTimer = null;
let localDraftStorageAvailable = true;
let builderReadyForLocalDrafts = false;
let hasUnsavedBuilderChanges = false;
let pendingRecoveryDraft = null;

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initAdminAuth();
  if (!user) return;

  const urlParams = new URLSearchParams(window.location.search);
  editingSurveyId = urlParams.get('edit');

  if (editingSurveyId) {
    document.getElementById('page-heading').textContent = 'Manage Research Survey';
    await loadExistingSurvey(editingSurveyId);
  } else {
    // Add default initial question for convenient authoring
    addQuestion('rating', 'Overall, how satisfied are you with our service?', true);
  }

  // Bind top & bottom buttons
  document.getElementById('btn-add-question').addEventListener('click', () => addQuestion());
  document.getElementById('btn-preview-survey').addEventListener('click', openSurveyPreview);
  document.getElementById('btn-preview-survey-bottom').addEventListener('click', openSurveyPreview);
  document.getElementById('btn-save-draft').addEventListener('click', () => submitSurvey('draft'));
  document.getElementById('btn-save-draft-bottom').addEventListener('click', () => submitSurvey('draft'));
  document.getElementById('btn-publish-survey').addEventListener('click', () => submitSurvey('active'));
  document.getElementById('btn-publish-survey-bottom').addEventListener('click', () => submitSurvey('active'));

  document.getElementById('survey-title').addEventListener('input', scheduleLocalDraftSave);
  document.getElementById('survey-description').addEventListener('input', scheduleLocalDraftSave);
  document.getElementById('response-deadline').addEventListener('input', scheduleLocalDraftSave);
  document.getElementById('response-limit-enabled').addEventListener('change', () => {
    syncResponseLimitFields();
    scheduleLocalDraftSave();
  });
  document.getElementById('response-limit').addEventListener('input', scheduleLocalDraftSave);
  document.getElementById('one-response-per-browser').addEventListener('change', scheduleLocalDraftSave);
  document.getElementById('btn-restore-local-draft').addEventListener('click', restorePendingLocalDraft);
  document.getElementById('btn-discard-local-draft').addEventListener('click', discardPendingLocalDraft);

  builderReadyForLocalDrafts = true;
  offerLocalDraftRecovery();
});

window.addEventListener('beforeunload', event => {
  if (!hasUnsavedBuilderChanges) return;
  event.preventDefault();
  event.returnValue = '';
});

function getLocalDraftKey() {
  return editingSurveyId
    ? `rsad:survey-builder-draft:survey-${editingSurveyId}`
    : 'rsad:survey-builder-draft:new';
}

function getDraftStatusElement() {
  return document.getElementById('draft-save-status');
}

function setDraftStatus(message, state = '') {
  const status = getDraftStatusElement();
  if (!status) return;
  status.textContent = message;
  status.className = `draft-save-status${state ? ` is-${state}` : ''}`;
}

function cloneDraftQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).map(question => ({
    id: question.id,
    question_text: String(question.question_text || ''),
    question_type: question.question_type || 'multiple_choice',
    options: Array.isArray(question.options) ? question.options.map(option => String(option)) : [],
    is_required: Boolean(question.is_required)
  }));
}

function getCurrentDraftContent() {
  return {
    title: document.getElementById('survey-title').value,
    description: document.getElementById('survey-description').value,
    response_deadline: document.getElementById('response-deadline').value,
    response_limit_enabled: document.getElementById('response-limit-enabled').checked,
    response_limit: document.getElementById('response-limit').value,
    one_response_per_browser: document.getElementById('one-response-per-browser').checked,
    questions: cloneDraftQuestions(questionsList)
  };
}

function getDraftFingerprint(content) {
  return JSON.stringify({
    title: content.title,
    description: content.description,
    response_deadline: content.response_deadline || '',
    response_limit_enabled: Boolean(content.response_limit_enabled),
    response_limit: content.response_limit || '',
    one_response_per_browser: Boolean(content.one_response_per_browser),
    questions: content.questions.map(question => ({
      question_text: question.question_text,
      question_type: question.question_type,
      options: question.options,
      is_required: question.is_required
    }))
  });
}

function readLocalDraft() {
  try {
    const rawDraft = window.localStorage.getItem(getLocalDraftKey());
    if (!rawDraft) return null;
    const draft = JSON.parse(rawDraft);
    if (draft.schemaVersion !== LOCAL_DRAFT_SCHEMA_VERSION || !draft.content || !Array.isArray(draft.content.questions)) {
      return null;
    }
    return draft;
  } catch (err) {
    console.warn('Local draft recovery is unavailable:', err);
    localDraftStorageAvailable = false;
    return null;
  }
}

function clearLocalDraft() {
  try {
    window.localStorage.removeItem(getLocalDraftKey());
  } catch (err) {
    console.warn('Unable to clear local survey draft:', err);
  }
}

function saveLocalDraft() {
  localDraftSaveTimer = null;
  const content = getCurrentDraftContent();

  try {
    window.localStorage.setItem(getLocalDraftKey(), JSON.stringify({
      schemaVersion: LOCAL_DRAFT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      content,
      fingerprint: getDraftFingerprint(content)
    }));
    hasUnsavedBuilderChanges = false;
    localDraftStorageAvailable = true;
    const savedTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());
    setDraftStatus(`Draft saved locally at ${savedTime}`, 'saved');
  } catch (err) {
    console.warn('Unable to save local survey draft:', err);
    localDraftStorageAvailable = false;
    setDraftStatus('Local draft storage is unavailable', 'error');
  }
}

function scheduleLocalDraftSave() {
  if (!builderReadyForLocalDrafts) return;

  hasUnsavedBuilderChanges = true;
  setDraftStatus('Unsaved changes');
  window.clearTimeout(localDraftSaveTimer);
  localDraftSaveTimer = window.setTimeout(() => {
    setDraftStatus('Saving draft...', 'saving');
    saveLocalDraft();
  }, LOCAL_DRAFT_DEBOUNCE_MS);
}

function offerLocalDraftRecovery() {
  const storedDraft = readLocalDraft();
  const notice = document.getElementById('draft-recovery-notice');
  if (!storedDraft || !notice) return;

  if (storedDraft.fingerprint === getDraftFingerprint(getCurrentDraftContent())) return;
  pendingRecoveryDraft = storedDraft;
  notice.hidden = false;
  setDraftStatus('Local draft available', 'saved');
}

function restorePendingLocalDraft() {
  if (!pendingRecoveryDraft) return;
  const { content } = pendingRecoveryDraft;
  document.getElementById('survey-title').value = content.title || '';
  document.getElementById('survey-description').value = content.description || '';
  document.getElementById('response-deadline').value = content.response_deadline || '';
  document.getElementById('response-limit-enabled').checked = Boolean(content.response_limit_enabled);
  document.getElementById('response-limit').value = content.response_limit || '';
  document.getElementById('one-response-per-browser').checked = Boolean(content.one_response_per_browser);
  syncResponseLimitFields();
  questionsList = cloneDraftQuestions(content.questions);
  renderQuestions();
  hasUnsavedBuilderChanges = false;
  pendingRecoveryDraft = null;
  document.getElementById('draft-recovery-notice').hidden = true;
  setDraftStatus('Local draft restored', 'saved');
  showToast('Local survey draft restored', 'success');
}

function discardPendingLocalDraft() {
  clearLocalDraft();
  pendingRecoveryDraft = null;
  document.getElementById('draft-recovery-notice').hidden = true;
  setDraftStatus('Local draft discarded');
  showToast('Local survey draft discarded', 'info');
}

// Load existing survey when in manage/edit mode
async function loadExistingSurvey(id) {
  try {
    const res = await fetch(`/api/surveys/${id}`);
    if (!res.ok) throw new Error('Survey not found');

    const data = await res.json();
    document.getElementById('survey-title').value = data.title;
    document.getElementById('survey-description').value = data.description || '';
    document.getElementById('response-deadline').value = toDateTimeLocalValue(data.response_deadline);
    document.getElementById('response-limit-enabled').checked = Number.isSafeInteger(data.response_limit) && data.response_limit > 0;
    document.getElementById('response-limit').value = data.response_limit || '';
    document.getElementById('one-response-per-browser').checked = data.one_response_per_browser === 1 || data.one_response_per_browser === true;
    syncResponseLimitFields();

    if (data.response_count > 0) {
      hasExistingResponses = true;
      showToast(`This survey has ${data.response_count} responses. Questions are locked to protect research integrity.`, 'info');
    }

    questionsList = [];
    if (Array.isArray(data.questions)) {
      data.questions.forEach(q => {
        questionsList.push({
          id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          options: q.options || ['Option 1', 'Option 2'],
          is_required: q.is_required
        });
      });
    }

    renderQuestions();
  } catch (err) {
    console.error('Error loading survey:', err);
    showToast('Failed to load survey details', 'error');
  }
}

function toDateTimeLocalValue(isoValue) {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function syncResponseLimitFields() {
  const enabled = document.getElementById('response-limit-enabled').checked;
  const fields = document.getElementById('response-limit-fields');
  const input = document.getElementById('response-limit');
  fields.hidden = !enabled;
  input.disabled = !enabled;
}

// Add Question Helper
function addQuestion(type = 'multiple_choice', text = '', isRequired = true, options = ['Option 1', 'Option 2']) {
  if (hasExistingResponses) {
    showToast('Questions cannot be added because survey responses already exist', 'error');
    return;
  }

  questionsList.push({
    question_text: text,
    question_type: type,
    is_required: isRequired,
    options: [...options]
  });

  renderQuestions();
  scheduleLocalDraftSave();
}

// Remove Question
function removeQuestion(index) {
  if (hasExistingResponses) {
    showToast('Questions cannot be removed because survey responses already exist', 'error');
    return;
  }

  questionsList.splice(index, 1);
  renderQuestions();
  scheduleLocalDraftSave();
}

// Reorder Up
function moveQuestionUp(index) {
  if (index <= 0) return;
  const temp = questionsList[index];
  questionsList[index] = questionsList[index - 1];
  questionsList[index - 1] = temp;
  renderQuestions();
  scheduleLocalDraftSave();
}

// Reorder Down
function moveQuestionDown(index) {
  if (index >= questionsList.length - 1) return;
  const temp = questionsList[index];
  questionsList[index] = questionsList[index + 1];
  questionsList[index + 1] = temp;
  renderQuestions();
  scheduleLocalDraftSave();
}

// Render Questions to DOM
function renderQuestions() {
  const container = document.getElementById('questions-container');
  container.innerHTML = '';

  if (questionsList.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="background: #ffffff; border: 1px dashed var(--color-border); border-radius: var(--radius-md);">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-title">No questions added yet</div>
        <div class="empty-state-desc">Click "Add Question" above to include your first research question.</div>
      </div>
    `;
    return;
  }

  questionsList.forEach((q, index) => {
    const card = document.createElement('div');
    card.className = 'question-builder-item';

    card.innerHTML = `
      <div class="question-builder-header">
        <div class="question-builder-order">Question ${index + 1}</div>
        <div class="question-order-controls">
          <button type="button" class="btn btn-secondary btn-sm" onclick="moveQuestionUp(${index})" ${index === 0 ? 'disabled' : ''} title="Move Up">↑</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="moveQuestionDown(${index})" ${index === questionsList.length - 1 ? 'disabled' : ''} title="Move Down">↓</button>
          ${!hasExistingResponses ? `<button type="button" class="btn btn-danger btn-sm" onclick="removeQuestion(${index})" title="Remove Question">✕ Remove</button>` : ''}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Question Text <span class="required-star">*</span></label>
        <input 
          type="text" 
          class="form-input" 
          value="${escapeHtml(q.question_text)}" 
          placeholder="Type your question prompt here..." 
          oninput="questionsList[${index}].question_text = this.value; scheduleLocalDraftSave()"
          ${hasExistingResponses ? 'disabled' : ''}
          required
        >
      </div>

      <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
        <div class="form-group" style="flex: 1; min-width: 200px; margin-bottom: 0;">
          <label class="form-label">Question Type</label>
          <select 
            class="form-select" 
            onchange="onTypeChange(${index}, this.value)"
            ${hasExistingResponses ? 'disabled' : ''}
          >
            <option value="text" ${q.question_type === 'text' ? 'selected' : ''}>Short Text</option>
            <option value="multiple_choice" ${q.question_type === 'multiple_choice' ? 'selected' : ''}>Multiple Choice (2–6 options)</option>
            <option value="rating" ${q.question_type === 'rating' ? 'selected' : ''}>Rating 1–5</option>
            <option value="yes_no" ${q.question_type === 'yes_no' ? 'selected' : ''}>Yes / No</option>
          </select>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; margin-top: 24px;">
          <input 
            type="checkbox" 
            id="req-chk-${index}" 
            ${q.is_required ? 'checked' : ''} 
            onchange="questionsList[${index}].is_required = this.checked; scheduleLocalDraftSave()"
            ${hasExistingResponses ? 'disabled' : ''}
          >
          <label for="req-chk-${index}" style="font-size: 13.5px; cursor: pointer; font-weight: 500;">Required response</label>
        </div>
      </div>

      <!-- Multiple Choice Options Container -->
      <div id="options-box-${index}" class="options-builder-container" style="display: ${q.question_type === 'multiple_choice' ? 'block' : 'none'};">
        <div style="font-weight: 600; font-size: 13px; color: var(--color-text); margin-bottom: 8px;">Answer Options (min 2, max 6):</div>
        <div id="options-list-${index}"></div>
        ${!hasExistingResponses ? `
          <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 8px;" onclick="addOption(${index})">
            + Add Option
          </button>
        ` : ''}
      </div>
    `;

    container.appendChild(card);

    if (q.question_type === 'multiple_choice') {
      renderOptionsForQuestion(index);
    }
  });
}

// On Type Change
function onTypeChange(index, newType) {
  questionsList[index].question_type = newType;
  if (newType === 'multiple_choice' && (!questionsList[index].options || questionsList[index].options.length < 2)) {
    questionsList[index].options = ['Option 1', 'Option 2'];
  }
  renderQuestions();
  scheduleLocalDraftSave();
}

// Add Option for Multiple Choice
function addOption(questionIndex) {
  const q = questionsList[questionIndex];
  if (!q.options) q.options = [];
  if (q.options.length >= 6) {
    showToast('Maximum 6 options allowed per question', 'error');
    return;
  }
  q.options.push(`Option ${q.options.length + 1}`);
  renderOptionsForQuestion(questionIndex);
  scheduleLocalDraftSave();
}

// Remove Option
function removeOption(questionIndex, optionIndex) {
  const q = questionsList[questionIndex];
  if (q.options.length <= 2) {
    showToast('Multiple choice questions require at least 2 options', 'error');
    return;
  }
  q.options.splice(optionIndex, 1);
  renderOptionsForQuestion(questionIndex);
  scheduleLocalDraftSave();
}

// Render Options List
function renderOptionsForQuestion(questionIndex) {
  const q = questionsList[questionIndex];
  const listContainer = document.getElementById(`options-list-${questionIndex}`);
  if (!listContainer) return;

  listContainer.innerHTML = '';
  q.options.forEach((opt, optIdx) => {
    const row = document.createElement('div');
    row.className = 'option-builder-row';
    row.innerHTML = `
      <span style="font-size: 13px; font-weight: 600; color: var(--color-text-muted); width: 20px;">${optIdx + 1}.</span>
      <input 
        type="text" 
        class="form-input form-sm" 
        value="${escapeHtml(opt)}" 
        placeholder="Option label" 
        oninput="questionsList[${questionIndex}].options[${optIdx}] = this.value; scheduleLocalDraftSave()"
        ${hasExistingResponses ? 'disabled' : ''}
        required
      >
      ${!hasExistingResponses && q.options.length > 2 ? `
        <button type="button" class="btn btn-secondary btn-sm" onclick="removeOption(${questionIndex}, ${optIdx})" title="Delete option">✕</button>
      ` : ''}
    `;
    listContainer.appendChild(row);
  });
}

function createPreviewElement(tagName, className = '', text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function getPreviewSurveyData() {
  const rawTitle = document.getElementById('survey-title').value.trim();
  const rawDescription = document.getElementById('survey-description').value.trim();
  const warnings = [];

  if (!rawTitle) warnings.push('Add a survey title before publishing. A placeholder title is shown in this preview.');
  if (questionsList.length === 0) warnings.push('This survey has no questions yet, so it cannot be published.');

  const questions = questionsList.map((question, index) => {
    const validOptions = (question.options || [])
      .map(option => String(option || '').trim())
      .filter(Boolean);

    if (!String(question.question_text || '').trim()) {
      warnings.push(`Question ${index + 1} has no question text.`);
    }
    if (question.question_type === 'multiple_choice' && validOptions.length < 2) {
      warnings.push(`Question ${index + 1} needs at least two non-empty multiple-choice options before publishing.`);
    }

    return {
      id: question.id || `preview-${index + 1}`,
      question_text: String(question.question_text || '').trim() || `Question ${index + 1} (draft)`,
      question_type: question.question_type || 'text',
      options: validOptions,
      is_required: Boolean(question.is_required)
    };
  });

  return {
    title: rawTitle || 'Untitled Research Survey',
    description: rawDescription,
    questions,
    warnings: [...new Set(warnings)]
  };
}

function addPreviewChoice(parent, name, value, labelText, className = 'choice-item') {
  const label = createPreviewElement('label', className);
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  const text = createPreviewElement('span', '', labelText);
  label.append(input, text);
  parent.appendChild(label);
}

function appendPreviewQuestionControl(card, question, index) {
  const name = `preview-q-${index + 1}`;

  if (question.question_type === 'rating') {
    const group = createPreviewElement('div', 'rating-options-group');
    [1, 2, 3, 4, 5].forEach(value => {
      const label = createPreviewElement('label', 'rating-option-label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = String(value);
      label.append(input, createPreviewElement('span', '', String(value)));
      group.appendChild(label);
    });
    card.appendChild(group);

    const hint = createPreviewElement('div', 'preview-rating-hint');
    hint.append(
      createPreviewElement('span', '', '1 = Very Dissatisfied / Poor'),
      createPreviewElement('span', '', '5 = Very Satisfied / Excellent')
    );
    card.appendChild(hint);
    return;
  }

  if (question.question_type === 'multiple_choice') {
    const group = createPreviewElement('div', 'choice-list');
    if (question.options.length === 0) {
      const empty = createPreviewElement('div', 'preview-incomplete-choice', 'No valid answer options have been configured yet.');
      group.appendChild(empty);
    } else {
      question.options.forEach(option => addPreviewChoice(group, name, option, option));
    }
    card.appendChild(group);
    return;
  }

  if (question.question_type === 'yes_no') {
    const group = createPreviewElement('div', 'choice-list preview-yes-no');
    addPreviewChoice(group, name, 'Yes', 'Yes');
    addPreviewChoice(group, name, 'No', 'No');
    card.appendChild(group);
    return;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.name = name;
  input.className = 'form-input';
  input.placeholder = 'Your answer...';
  input.maxLength = 1000;
  card.appendChild(input);
}

function ensureSurveyPreviewDialog() {
  let dialog = document.getElementById('survey-preview-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'survey-preview-dialog';
  dialog.className = 'custom-modal preview-survey-modal';
  dialog.setAttribute('aria-labelledby', 'survey-preview-dialog-title');
  document.body.appendChild(dialog);
  return dialog;
}

function openSurveyPreview() {
  const data = getPreviewSurveyData();
  const dialog = ensureSurveyPreviewDialog();
  dialog.replaceChildren();

  const dialogHeader = createPreviewElement('div', 'preview-dialog-header');
  const headingGroup = document.createElement('div');
  headingGroup.append(
    createPreviewElement('p', 'preview-dialog-kicker', 'Survey builder'),
    createPreviewElement('h2', 'modal-title', 'Survey preview')
  );
  headingGroup.lastElementChild.id = 'survey-preview-dialog-title';

  const closeButton = createPreviewElement('button', 'preview-dialog-close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close survey preview');
  dialogHeader.append(headingGroup, closeButton);

  const modeBanner = createPreviewElement('div', 'preview-mode-banner', 'Preview Mode — responses cannot be submitted.');
  modeBanner.setAttribute('role', 'status');
  dialog.append(dialogHeader, modeBanner);

  if (data.warnings.length > 0) {
    const warning = createPreviewElement('div', 'preview-warning');
    warning.setAttribute('role', 'status');
    warning.appendChild(createPreviewElement('strong', '', 'Before publishing: '));
    warning.appendChild(createPreviewElement('span', '', data.warnings.join(' ')));
    dialog.appendChild(warning);
  }

  const surveyCard = createPreviewElement('article', 'survey-public-card survey-preview-card');
  const publicHeader = createPreviewElement('header', 'survey-public-header');
  publicHeader.appendChild(createPreviewElement('span', 'preview-questionnaire-label', 'Research Questionnaire'));
  publicHeader.appendChild(createPreviewElement('h1', '', data.title));
  if (data.description) publicHeader.appendChild(createPreviewElement('p', '', data.description));
  surveyCard.appendChild(publicHeader);

  const body = createPreviewElement('div', 'survey-public-body');
  if (data.questions.length === 0) {
    body.appendChild(createPreviewElement('div', 'empty-state preview-empty-state', 'Add questions in the builder to see the respondent form here.'));
  } else {
    data.questions.forEach((question, index) => {
      const card = createPreviewElement('section', 'respondent-question-card');
      const questionTitle = createPreviewElement('div', 'respondent-q-title', `${index + 1}. ${question.question_text}`);
      if (question.is_required) {
        const required = createPreviewElement('span', 'required-star', '*');
        required.title = 'Required question';
        questionTitle.appendChild(required);
      }
      card.appendChild(questionTitle);
      appendPreviewQuestionControl(card, question, index);
      body.appendChild(card);
    });

    const consent = createPreviewElement('section', 'consent-panel');
    consent.append(
      createPreviewElement('h3', 'consent-title', 'Research participation consent'),
      createPreviewElement('p', '', 'Participation is voluntary. This preview shows the consent notice respondents will see before submitting.'),
    );
    const consentLabel = createPreviewElement('label', 'consent-check');
    const consentInput = document.createElement('input');
    consentInput.type = 'checkbox';
    consentInput.name = 'preview-consent';
    consentLabel.append(consentInput, createPreviewElement('span', '', 'I understand this notice and consent to submit my response.'));
    consent.appendChild(consentLabel);
    body.appendChild(consent);

    const submitButton = createPreviewElement('button', 'btn btn-primary preview-submit-disabled', 'Preview Only — Submission Disabled');
    submitButton.type = 'button';
    submitButton.disabled = true;
    body.appendChild(submitButton);
  }
  surveyCard.appendChild(body);
  dialog.appendChild(surveyCard);

  const footer = createPreviewElement('div', 'modal-actions preview-dialog-actions');
  const backButton = createPreviewElement('button', 'btn btn-secondary btn-sm', 'Back to editor');
  backButton.type = 'button';
  footer.appendChild(backButton);
  dialog.appendChild(footer);

  const closePreview = () => dialog.close();
  closeButton.addEventListener('click', closePreview);
  backButton.addEventListener('click', closePreview);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closePreview();
  }, { once: true });
  dialog.showModal();
}

// Validate & Submit Survey
async function submitSurvey(targetStatus) {
  const titleInput = document.getElementById('survey-title');
  const descInput = document.getElementById('survey-description');
  const deadlineInput = document.getElementById('response-deadline');
  const responseLimitEnabled = document.getElementById('response-limit-enabled');
  const responseLimitInput = document.getElementById('response-limit');
  const oneResponsePerBrowser = document.getElementById('one-response-per-browser');

  const title = titleInput.value.trim();
  const description = descInput.value.trim();
  let responseDeadline = null;
  let responseLimit = null;

  if (deadlineInput.value) {
    const parsedDeadline = new Date(deadlineInput.value);
    if (Number.isNaN(parsedDeadline.getTime())) {
      showToast('Please choose a valid response deadline.', 'error');
      deadlineInput.focus();
      return;
    }
    responseDeadline = parsedDeadline.toISOString();
    if (targetStatus === 'active' && parsedDeadline.getTime() <= Date.now()) {
      showToast('A published survey response deadline must be in the future.', 'error');
      deadlineInput.focus();
      return;
    }
  }

  if (responseLimitEnabled.checked) {
    const rawLimit = responseLimitInput.value.trim();
    const parsedLimit = Number(rawLimit);
    if (!rawLimit || !Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000000) {
      showToast('Maximum responses must be a whole number from 1 to 1,000,000.', 'error');
      responseLimitInput.focus();
      return;
    }
    responseLimit = parsedLimit;
  }

  if (!title) {
    showToast('Please provide a survey title', 'error');
    titleInput.focus();
    return;
  }

  if (targetStatus === 'active' && questionsList.length === 0) {
    showToast('Cannot publish survey: please add at least one question', 'error');
    return;
  }

  // Validate questions
  for (let i = 0; i < questionsList.length; i++) {
    const q = questionsList[i];
    if (!q.question_text || q.question_text.trim().length === 0) {
      showToast(`Question ${i + 1} text cannot be empty`, 'error');
      return;
    }

    if (q.question_type === 'multiple_choice') {
      const validOptions = (q.options || []).filter(o => o && o.trim().length > 0);
      if (validOptions.length < 2) {
        showToast(`Question ${i + 1} requires at least 2 non-empty options`, 'error');
        return;
      }
      if (validOptions.length > 6) {
        showToast(`Question ${i + 1} cannot have more than 6 options`, 'error');
        return;
      }
    }
  }

  const payload = {
    title,
    description,
    response_deadline: responseDeadline,
    response_limit: responseLimit,
    one_response_per_browser: oneResponsePerBrowser.checked,
    status: targetStatus,
    questions: questionsList
  };

  try {
    let res;
    if (editingSurveyId) {
      res = await fetch(`/api/surveys/${editingSurveyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/surveys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();

    if (res.ok) {
      window.clearTimeout(localDraftSaveTimer);
      hasUnsavedBuilderChanges = false;
      clearLocalDraft();
      showToast(targetStatus === 'active' ? 'Survey published successfully!' : 'Survey saved as draft!', 'success');
      setTimeout(() => {
        window.location.href = 'surveys.html';
      }, 700);
    } else {
      showToast(data.error || 'Failed to save survey', 'error');
    }
  } catch (err) {
    console.error('Survey save error:', err);
    showToast('Server error while saving survey', 'error');
  }
}
