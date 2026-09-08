/**
 * Research Survey Analytics Dashboard
 * Survey Creator & Question Builder Controller
 */

let questionsList = [];
let editingSurveyId = null;
let hasExistingResponses = false;

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
  document.getElementById('btn-save-draft').addEventListener('click', () => submitSurvey('draft'));
  document.getElementById('btn-save-draft-bottom').addEventListener('click', () => submitSurvey('draft'));
  document.getElementById('btn-publish-survey').addEventListener('click', () => submitSurvey('active'));
  document.getElementById('btn-publish-survey-bottom').addEventListener('click', () => submitSurvey('active'));
});

// Load existing survey when in manage/edit mode
async function loadExistingSurvey(id) {
  try {
    const res = await fetch(`/api/surveys/${id}`);
    if (!res.ok) throw new Error('Survey not found');

    const data = await res.json();
    document.getElementById('survey-title').value = data.title;
    document.getElementById('survey-description').value = data.description || '';

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
}

// Remove Question
function removeQuestion(index) {
  if (hasExistingResponses) {
    showToast('Questions cannot be removed because survey responses already exist', 'error');
    return;
  }

  questionsList.splice(index, 1);
  renderQuestions();
}

// Reorder Up
function moveQuestionUp(index) {
  if (index <= 0) return;
  const temp = questionsList[index];
  questionsList[index] = questionsList[index - 1];
  questionsList[index - 1] = temp;
  renderQuestions();
}

// Reorder Down
function moveQuestionDown(index) {
  if (index >= questionsList.length - 1) return;
  const temp = questionsList[index];
  questionsList[index] = questionsList[index + 1];
  questionsList[index + 1] = temp;
  renderQuestions();
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
          oninput="questionsList[${index}].question_text = this.value"
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
            onchange="questionsList[${index}].is_required = this.checked"
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
        oninput="questionsList[${questionIndex}].options[${optIdx}] = this.value"
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

// Validate & Submit Survey
async function submitSurvey(targetStatus) {
  const titleInput = document.getElementById('survey-title');
  const descInput = document.getElementById('survey-description');

  const title = titleInput.value.trim();
  const description = descInput.value.trim();

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
