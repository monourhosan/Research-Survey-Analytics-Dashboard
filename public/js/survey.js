/**
 * Research Survey Analytics Dashboard
 * Public Respondent Form Controller
 */

let currentSurveyData = null;

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const surveyId = urlParams.get('id');

  if (!surveyId) {
    showSurveyMessage('Invalid Survey URL', 'Please verify the public survey link provided by the researcher.');
    return;
  }

  loadPublicSurvey(surveyId);
});

async function loadPublicSurvey(surveyId) {
  const container = document.getElementById('survey-form-container');
  const titleEl = document.getElementById('survey-title');
  const descEl = document.getElementById('survey-desc');

  try {
    const res = await fetch(`/api/public/surveys/${surveyId}`);
    const data = await res.json();

    if (res.status === 404) {
      showSurveyMessage('Survey Not Found', 'The requested research survey does not exist or has been removed.');
      return;
    }

    if (data.status === 'closed') {
      titleEl.textContent = data.title;
      showSurveyMessage('Survey Closed', data.error || 'This survey is no longer accepting responses.');
      return;
    }

    if (data.code === 'SURVEY_EXPIRED') {
      titleEl.textContent = data.title || 'Survey Expired';
      showSurveyMessage('Survey Expired', data.error || 'This survey response deadline has passed.');
      return;
    }

    if (!res.ok) {
      showSurveyMessage('Unable to Access Survey', data.error || 'This survey is not currently accepting responses.');
      return;
    }

    currentSurveyData = data;
    titleEl.textContent = data.title;
    document.title = `${data.title} - Research Survey`;

    if (data.description) {
      descEl.textContent = data.description;
      descEl.style.display = 'block';
    } else {
      descEl.style.display = 'none';
    }

    renderRespondentForm(data);
  } catch (err) {
    console.error('Error loading public survey:', err);
    showSurveyMessage('Connection Error', 'Unable to load survey. Please check your internet connection and reload the page.');
  }
}

function showSurveyMessage(title, message) {
  const container = document.getElementById('survey-form-container');
  container.innerHTML = `
    <div class="confirmation-container">
      <div class="confirmation-icon" style="background: var(--palette-gray-light); color: var(--color-primary);">ℹ</div>
      <h2 class="confirmation-title">${escapeHtml(title)}</h2>
      <p class="confirmation-message">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderRespondentForm(data) {
  const container = document.getElementById('survey-form-container');

  if (!data.questions || data.questions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No questions found</div>
        <div class="empty-state-desc">This survey does not currently contain any questions.</div>
      </div>
    `;
    return;
  }

  let html = `
    <form id="respondent-form" novalidate>
      <section class="survey-progress" aria-labelledby="survey-progress-label">
        <div class="survey-progress-heading">
          <span id="survey-progress-label">Response progress</span>
          <span id="survey-progress-text" aria-live="polite">0 of ${data.questions.length} answered</span>
        </div>
        <div
          id="survey-progress-track"
          class="survey-progress-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="${data.questions.length}"
          aria-valuenow="0"
          aria-label="Questions answered"
        >
          <div id="survey-progress-bar" class="survey-progress-bar"></div>
        </div>
      </section>
  `;

  data.questions.forEach((q, index) => {
    html += `
      <div class="respondent-question-card" data-qid="${q.id}">
        <div class="respondent-q-title">
          ${index + 1}. ${escapeHtml(q.question_text)}
          ${q.is_required ? `<span class="required-star" title="Required question">*</span>` : ''}
        </div>
    `;

    if (q.question_type === 'rating') {
      html += `
        <div class="rating-options-group">
          ${[1, 2, 3, 4, 5].map(val => `
            <label class="rating-option-label">
              <input type="radio" name="q_${q.id}" value="${val}" ${q.is_required ? 'required' : ''}>
              <span>${val}</span>
            </label>
          `).join('')}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--color-text-muted); margin-top: 8px;">
          <span>1 = Very Dissatisfied / Poor</span>
          <span>5 = Very Satisfied / Excellent</span>
        </div>
      `;
    } else if (q.question_type === 'multiple_choice') {
      html += `
        <div class="choice-list">
          ${(q.options || []).map((opt, oIdx) => `
            <label class="choice-item">
              <input type="radio" name="q_${q.id}" value="${escapeHtml(opt)}" ${q.is_required && oIdx === 0 ? 'required' : ''}>
              <span>${escapeHtml(opt)}</span>
            </label>
          `).join('')}
        </div>
      `;
    } else if (q.question_type === 'yes_no') {
      html += `
        <div class="choice-list" style="flex-direction: row; gap: 16px;">
          <label class="choice-item" style="flex: 1;">
            <input type="radio" name="q_${q.id}" value="Yes" ${q.is_required ? 'required' : ''}>
            <span>Yes</span>
          </label>
          <label class="choice-item" style="flex: 1;">
            <input type="radio" name="q_${q.id}" value="No">
            <span>No</span>
          </label>
        </div>
      `;
    } else if (q.question_type === 'text') {
      html += `
        <input 
          type="text" 
          name="q_${q.id}" 
          class="form-input" 
          placeholder="Your answer..." 
          ${q.is_required ? 'required' : ''}
          maxlength="1000"
        >
      `;
    }

    html += `</div>`;
  });

  html += `
      <section class="consent-panel" aria-labelledby="consent-title">
        <h2 id="consent-title" class="consent-title">Research participation consent</h2>
        <p>
          Participation is voluntary. Your answers will be submitted for the stated research purpose.
          Avoid including sensitive personal information unless the researcher specifically requests it.
        </p>
        <label class="consent-check" for="research-consent">
          <input type="checkbox" id="research-consent" required>
          <span>I understand this notice and consent to submit my response.</span>
        </label>
      </section>
      <div style="margin-top: 32px;">
        <button type="submit" id="btn-submit-survey" class="btn btn-primary" style="width: 100%; padding: 12px; font-size: 16px;">
          Submit Response
        </button>
      </div>
    </form>
  `;

  container.innerHTML = html;

  // Bind Form Submission
  const form = document.getElementById('respondent-form');
  form.addEventListener('submit', handleFormSubmit);
  form.addEventListener('input', handleResponseChange);
  form.addEventListener('change', handleResponseChange);
  updateSurveyProgress();
}

function getQuestionAnswer(question) {
  const qName = `q_${question.id}`;

  if (question.question_type === 'rating' || question.question_type === 'multiple_choice' || question.question_type === 'yes_no') {
    const selected = document.querySelector(`input[name="${qName}"]:checked`);
    return selected ? selected.value : null;
  }

  if (question.question_type === 'text') {
    const input = document.querySelector(`input[name="${qName}"]`);
    return input ? input.value.trim() : null;
  }

  return null;
}

function handleResponseChange(event) {
  const questionCard = event.target.closest('.respondent-question-card');
  if (questionCard) {
    questionCard.classList.remove('question-error');
    const oldMessage = questionCard.querySelector('.question-error-message');
    if (oldMessage) oldMessage.remove();
  }

  updateSurveyProgress();
}

function updateSurveyProgress() {
  if (!currentSurveyData || !currentSurveyData.questions) return;

  const total = currentSurveyData.questions.length;
  const answered = currentSurveyData.questions.reduce((count, question) => {
    const value = getQuestionAnswer(question);
    return count + (value !== null && String(value).trim().length > 0 ? 1 : 0);
  }, 0);
  const percentage = total > 0 ? Math.round((answered / total) * 100) : 0;

  const progressText = document.getElementById('survey-progress-text');
  const progressTrack = document.getElementById('survey-progress-track');
  const progressBar = document.getElementById('survey-progress-bar');

  if (!progressText || !progressTrack || !progressBar) return;

  progressText.textContent = `${answered} of ${total} answered`;
  progressTrack.setAttribute('aria-valuenow', String(answered));
  progressBar.style.width = `${percentage}%`;
  progressTrack.classList.toggle('is-complete', answered === total);
}

function highlightRequiredQuestion(question) {
  const card = document.querySelector(`.respondent-question-card[data-qid="${question.id}"]`);
  if (!card) return;

  card.classList.add('question-error');
  let message = card.querySelector('.question-error-message');
  if (!message) {
    message = document.createElement('div');
    message.className = 'question-error-message';
    message.setAttribute('role', 'alert');
    message.textContent = 'This required question needs an answer.';
    card.appendChild(message);
  }

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const firstInput = card.querySelector('input');
  if (firstInput) firstInput.focus({ preventScroll: true });
}

async function handleFormSubmit(e) {
  e.preventDefault();

  if (!currentSurveyData || !currentSurveyData.questions) return;

  const submitBtn = document.getElementById('btn-submit-survey');
  const answers = {};

  document.querySelectorAll('.respondent-question-card.question-error').forEach(card => {
    card.classList.remove('question-error');
    const message = card.querySelector('.question-error-message');
    if (message) message.remove();
  });

  // Gather & Validate answers
  for (const q of currentSurveyData.questions) {
    const val = getQuestionAnswer(q);

    if (q.is_required && (!val || String(val).trim().length === 0)) {
      showToast(`Please answer required question: "${q.question_text}"`, 'error');
      highlightRequiredQuestion(q);
      return;
    }

    if (val !== null && String(val).trim().length > 0) {
      answers[q.id] = val;
    }
  }

  const consentCheckbox = document.getElementById('research-consent');
  if (!consentCheckbox.checked) {
    showToast('Please confirm the research participation notice before submitting.', 'error');
    consentCheckbox.focus();
    return;
  }

  // Prevent accidental double submission
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting response...';

  try {
    const res = await fetch(`/api/public/surveys/${currentSurveyData.id}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      renderThankYouScreen();
    } else {
      if (data.code === 'SURVEY_EXPIRED') {
        showSurveyMessage('Survey Expired', data.error || 'This survey response deadline has passed.');
        return;
      }
      showToast(data.error || 'Failed to submit response', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Response';
    }
  } catch (err) {
    console.error('Submission failed:', err);
    showToast('Network error while submitting response. Please try again.', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Response';
  }
}

function renderThankYouScreen() {
  const container = document.getElementById('survey-form-container');
  container.innerHTML = `
    <div class="confirmation-container">
      <div class="confirmation-icon">✓</div>
      <h2 class="confirmation-title">Thank You!</h2>
      <p class="confirmation-message">Your response has been recorded successfully. Thank you for contributing to our research study.</p>
    </div>
  `;
}
