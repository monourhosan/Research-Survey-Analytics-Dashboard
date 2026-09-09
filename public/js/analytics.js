/**
 * Research Survey Analytics Dashboard
 * Analytics & HTML Canvas Visualization Controller
 * 
 * Features:
 * - Pure HTML5 Canvas chart renderer (no Chart.js or D3.js)
 * - High-DPI crisp rendering support (window.devicePixelRatio)
 * - Rule-Based Automated Insight Engine UI presenter
 * - RFC 4180 CSV download trigger
 * - Native PNG export for rendered Canvas charts
 */

let currentSurveyId = null;
let currentDateFilters = { from: '', to: '' };

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initAdminAuth();
  if (!user) return;

  const urlParams = new URLSearchParams(window.location.search);
  currentSurveyId = urlParams.get('id');

  if (!currentSurveyId) {
    showToast('Survey ID missing from URL', 'error');
    window.location.href = 'surveys.html';
    return;
  }

  currentDateFilters = {
    from: urlParams.get('from') || '',
    to: urlParams.get('to') || ''
  };

  const fromInput = document.getElementById('analytics-date-from');
  const toInput = document.getElementById('analytics-date-to');
  const today = new Date().toISOString().slice(0, 10);
  fromInput.max = today;
  toInput.max = today;
  fromInput.value = currentDateFilters.from;
  toInput.value = currentDateFilters.to;

  // Setup header action buttons
  document.getElementById('btn-copy-public-url').addEventListener('click', () => {
    const url = `${window.location.origin}/survey.html?id=${currentSurveyId}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => showToast('Public survey link copied to clipboard!', 'success'))
        .catch(() => fallbackCopy(url));
    } else {
      fallbackCopy(url);
    }
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    window.location.href = `/api/surveys/${currentSurveyId}/export.csv${buildDateQueryString()}`;
    showToast('Preparing CSV download...', 'info');
  });

  document.getElementById('analytics-filter-form').addEventListener('submit', event => {
    event.preventDefault();

    const from = fromInput.value;
    const to = toInput.value;
    if (from && to && from > to) {
      showToast('The start date cannot be later than the end date.', 'error');
      fromInput.focus();
      return;
    }

    currentDateFilters = { from, to };
    syncFilterUrl();
    loadAnalyticsData(currentSurveyId);
  });

  document.getElementById('btn-clear-filter').addEventListener('click', () => {
    currentDateFilters = { from: '', to: '' };
    fromInput.value = '';
    toInput.value = '';
    syncFilterUrl();
    loadAnalyticsData(currentSurveyId);
  });

  document.getElementById('btn-print-report').addEventListener('click', () => {
    window.print();
  });

  await loadAnalyticsData(currentSurveyId);
});

function buildDateQueryString() {
  const params = new URLSearchParams();
  if (currentDateFilters.from) params.set('from', currentDateFilters.from);
  if (currentDateFilters.to) params.set('to', currentDateFilters.to);
  const query = params.toString();
  return query ? `?${query}` : '';
}

function syncFilterUrl() {
  const url = new URL(window.location.href);
  if (currentDateFilters.from) url.searchParams.set('from', currentDateFilters.from);
  else url.searchParams.delete('from');
  if (currentDateFilters.to) url.searchParams.set('to', currentDateFilters.to);
  else url.searchParams.delete('to');
  window.history.replaceState({}, '', url);
}

function formatFilterDate(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function describeDateRange(filters) {
  if (!filters || !filters.isFiltered) return 'All recorded responses';
  if (filters.from && filters.to) {
    return `${formatFilterDate(filters.from)} to ${formatFilterDate(filters.to)}`;
  }
  if (filters.from) return `From ${formatFilterDate(filters.from)}`;
  return `Through ${formatFilterDate(filters.to)}`;
}

async function loadAnalyticsData(surveyId) {
  const applyButton = document.getElementById('btn-apply-filter');
  const analysisContainer = document.getElementById('questions-analysis-container');

  try {
    applyButton.disabled = true;
    applyButton.textContent = 'Loading...';
    analysisContainer.setAttribute('aria-busy', 'true');

    const res = await fetch(`/api/surveys/${surveyId}/analytics${buildDateQueryString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load survey analytics');

    renderAnalytics(data);
  } catch (err) {
    console.error('Analytics load error:', err);
    showToast(err.message || 'Failed to load survey analytics', 'error');
  } finally {
    applyButton.disabled = false;
    applyButton.textContent = 'Apply Filter';
    analysisContainer.removeAttribute('aria-busy');
  }
}

function renderAnalytics(data) {
  const survey = data.survey;
  const summary = data.summary;
  const filters = data.filters || { from: null, to: null, isFiltered: false };
  const rangeDescription = describeDateRange(filters);

  // Header
  document.getElementById('survey-title-display').textContent = survey.title;
  document.title = `${survey.title} - Analytics`;

  const dateStr = new Date(survey.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  document.getElementById('survey-meta-display').innerHTML = `
    Status: <span class="badge badge-${survey.status}">${survey.status}</span> &nbsp;•&nbsp; Created: ${dateStr}
  `;

  // Metric Cards
  document.getElementById('metric-total-responses').textContent = summary.totalResponses;
  document.getElementById('metric-total-meta').textContent = filters.isFiltered
    ? `${summary.totalResponses} of ${summary.allTimeTotalResponses} all-time submissions`
    : 'Completed submissions';

  document.getElementById('analytics-filter-status').textContent = filters.isFiltered
    ? `Showing ${summary.totalResponses} of ${summary.allTimeTotalResponses} responses - ${rangeDescription}`
    : `Showing all ${summary.allTimeTotalResponses} recorded responses`;
  document.getElementById('print-report-context').textContent =
    `${rangeDescription} - Generated ${new Date().toLocaleString()}`;

  if (summary.overallRatingAvg !== null) {
    document.getElementById('metric-avg-rating').textContent = `${summary.overallRatingAvg.toFixed(1)} / 5`;
  } else {
    document.getElementById('metric-avg-rating').textContent = 'N/A';
  }

  if (summary.latestResponseDate) {
    const latestDate = new Date(summary.latestResponseDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    document.getElementById('metric-latest-date').textContent = latestDate;
  } else {
    document.getElementById('metric-latest-date').textContent = 'No submissions';
  }

  const growthEl = document.getElementById('metric-growth-trend');
  const growthMeta = document.getElementById('metric-growth-meta');

  if (summary.hasTrendData) {
    growthEl.textContent = summary.growthLabel;
    if (summary.growthValue > 0) {
      growthEl.style.color = 'var(--color-primary)';
    } else if (summary.growthValue < 0) {
      growthEl.style.color = 'var(--color-text-muted)';
    } else {
      growthEl.style.color = 'var(--color-text)';
    }
    growthMeta.textContent = filters.isFiltered
      ? 'Latest 7 days vs. previous 7 days within filter'
      : 'vs. previous 7-day period';
  } else {
    growthEl.textContent = summary.growthLabel;
    growthMeta.textContent = filters.isFiltered
      ? 'No previous-period baseline within filter'
      : 'Not enough data for trend comparison';
  }

  // Automated Insights Section
  const insightsSection = document.getElementById('insights-section');
  const insightsList = document.getElementById('insights-list');

  if (data.insights && data.insights.length > 0) {
    insightsSection.style.display = 'block';
    insightsList.innerHTML = '';
    data.insights.forEach(text => {
      const li = document.createElement('li');
      li.className = 'insight-item';
      li.innerHTML = `
        <span class="insight-bullet">●</span>
        <span>${escapeHtml(text)}</span>
      `;
      insightsList.appendChild(li);
    });
  } else {
    insightsSection.style.display = 'none';
  }

  // Questions Analysis Section
  const container = document.getElementById('questions-analysis-container');
  container.innerHTML = '';

  if (!data.questions || data.questions.length === 0) {
    container.innerHTML = `
      <div class="empty-state card">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-title">No questions to analyze</div>
        <div class="empty-state-desc">This survey does not currently have any configured questions.</div>
      </div>
    `;
    return;
  }

  data.questions.forEach((q, index) => {
    const card = document.createElement('div');
    card.className = 'question-analysis-card';

    let typeLabel = 'Question';
    if (q.question_type === 'rating') typeLabel = 'Rating 1–5';
    else if (q.question_type === 'multiple_choice') typeLabel = 'Multiple Choice';
    else if (q.question_type === 'yes_no') typeLabel = 'Yes / No';
    else if (q.question_type === 'text') typeLabel = 'Text Response';

    card.innerHTML = `
      <div class="question-analysis-header">
        <div>
          <div class="question-number-badge">Question ${index + 1}</div>
          <h3 class="question-text-heading">${escapeHtml(q.question_text)}</h3>
        </div>
        <span class="question-type-tag">${typeLabel} (${q.answered_count} answered)</span>
      </div>
      <div id="q-content-${q.id}"></div>
    `;

    container.appendChild(card);

    const qContent = document.getElementById(`q-content-${q.id}`);

    if (q.answered_count === 0) {
      qContent.innerHTML = `
        <div class="empty-state" style="padding: 24px 0;">
          <div class="empty-state-desc">No responses recorded yet for this question.</div>
        </div>
      `;
      return;
    }

    // Render Question Details & Canvas Charts
    if (q.question_type === 'multiple_choice') {
      renderMultipleChoiceAnalysis(qContent, q);
    } else if (q.question_type === 'rating') {
      renderRatingAnalysis(qContent, q);
    } else if (q.question_type === 'yes_no') {
      renderYesNoAnalysis(qContent, q);
    } else if (q.question_type === 'text') {
      renderTextAnalysis(qContent, q);
    }
  });
}

/**
 * 1. Multiple Choice Canvas Chart & Table
 */
function renderMultipleChoiceAnalysis(container, q) {
  const canvasId = `chart-mc-${q.id}`;

  container.innerHTML = `
    <div class="chart-container">
      <canvas id="${canvasId}" class="survey-chart"></canvas>
    </div>
  `;
  addChartDownloadButton(container, canvasId, q.question_text);

  // Draw pure HTML5 Canvas horizontal bar chart
  setTimeout(() => {
    const chartData = q.distribution.map(d => ({
      label: d.option,
      count: d.count,
      percentage: d.percentage
    }));
    drawHorizontalBarChart(canvasId, chartData);
  }, 50);
}

/**
 * 2. Rating Analysis & Canvas Distribution Chart
 */
function renderRatingAnalysis(container, q) {
  const canvasId = `chart-rating-${q.id}`;

  container.innerHTML = `
    <div class="rating-summary-row">
      <div class="rating-score-box">
        <div class="rating-score-large">${q.average.toFixed(1)}</div>
        <div class="rating-score-stars">★★★★★</div>
        <div style="font-size: 11.5px; color: var(--color-text-muted); margin-top: 2px;">Average Score</div>
      </div>

      <div class="rating-breakdown-tags">
        <div class="breakdown-pill positive">
          Positive (4–5★): ${q.positivePct}% (${q.positiveCount})
        </div>
        <div class="breakdown-pill neutral">
          Neutral (3★): ${q.neutralPct}% (${q.neutralCount})
        </div>
        <div class="breakdown-pill negative">
          Negative (1–2★): ${q.negativePct}% (${q.negativeCount})
        </div>
      </div>
    </div>

    <div class="chart-container">
      <canvas id="${canvasId}" class="survey-chart"></canvas>
    </div>
  `;
  addChartDownloadButton(container, canvasId, q.question_text);

  setTimeout(() => {
    const chartData = q.distribution.slice().reverse().map(d => ({
      label: `Rating ${d.rating} ★`,
      count: d.count,
      percentage: d.percentage
    }));
    drawHorizontalBarChart(canvasId, chartData, '#181818');
  }, 50);
}

/**
 * 3. Yes/No Comparison Canvas Chart
 */
function renderYesNoAnalysis(container, q) {
  const canvasId = `chart-yn-${q.id}`;

  container.innerHTML = `
    <div class="chart-container">
      <canvas id="${canvasId}" class="survey-chart"></canvas>
    </div>
  `;
  addChartDownloadButton(container, canvasId, q.question_text);

  setTimeout(() => {
    const chartData = [
      { label: 'Yes', count: q.yesCount, percentage: q.yesPct, color: '#181818' },
      { label: 'No', count: q.noCount, percentage: q.noPct, color: '#aaaaaa' }
    ];
    drawHorizontalBarChart(canvasId, chartData, '#181818');
  }, 50);
}

/**
 * 4. Text Responses Table
 */
function renderTextAnalysis(container, q) {
  if (!q.recent_responses || q.recent_responses.length === 0) {
    container.innerHTML = `<div style="font-size: 13.5px; color: var(--color-text-muted);">No written text submissions recorded yet.</div>`;
    return;
  }

  const list = document.createElement('ul');
  list.className = 'text-responses-list';

  q.recent_responses.forEach(text => {
    const item = document.createElement('li');
    item.className = 'text-response-item';
    item.textContent = `"${text}"`; // Uses textContent to safely prevent XSS
    list.appendChild(item);
  });

  container.appendChild(list);
}

/**
 * Adds a compact, print-hidden export action only to cards with a real Canvas chart.
 */
function addChartDownloadButton(container, canvasId, questionText) {
  const chartContainer = container.querySelector(`#${canvasId}`)?.closest('.chart-container');
  if (!chartContainer) return;

  const actions = document.createElement('div');
  actions.className = 'chart-actions no-print';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary btn-sm';
  button.textContent = 'Download PNG';
  button.title = `Download chart for "${questionText}" as PNG`;
  button.setAttribute('aria-label', button.title);
  button.addEventListener('click', () => downloadChartAsPng(canvasId, questionText));

  actions.appendChild(button);
  chartContainer.appendChild(actions);
}

function sanitizeFilenamePart(value, fallback = 'chart') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return normalized || fallback;
}

function buildChartFilename(questionText) {
  const surveyPart = sanitizeFilenamePart(
    document.getElementById('survey-title-display')?.textContent,
    'survey'
  );
  const questionPart = sanitizeFilenamePart(questionText, 'chart');
  const filterPart = currentDateFilters.from || currentDateFilters.to
    ? `-${currentDateFilters.from || 'start'}-to-${currentDateFilters.to || 'end'}`
    : '';
  const filenameBase = `${surveyPart}-${questionPart}${filterPart}`.slice(0, 146);
  return `${filenameBase}.png`;
}

function downloadChartAsPng(canvasId, questionText) {
  const sourceCanvas = document.getElementById(canvasId);
  if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) {
    showToast('This chart is not ready to export yet.', 'error');
    return;
  }

  try {
    // Compose onto white so transparent Canvas pixels remain readable in documents.
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = sourceCanvas.width;
    exportCanvas.height = sourceCanvas.height;
    const exportContext = exportCanvas.getContext('2d');
    if (!exportContext) throw new Error('Canvas export context unavailable');
    exportContext.fillStyle = '#ffffff';
    exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportContext.drawImage(sourceCanvas, 0, 0);

    const triggerDownload = blob => {
      try {
        if (!blob) throw new Error('PNG encoding returned no data');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = buildChartFilename(questionText);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('PNG chart downloaded.', 'success');
      } catch (err) {
        console.error('Chart PNG encoding error:', err);
        showToast('Unable to export this chart as PNG.', 'error');
      }
    };

    if (typeof exportCanvas.toBlob === 'function') {
      exportCanvas.toBlob(triggerDownload, 'image/png');
    } else {
      const dataUrl = exportCanvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = buildChartFilename(questionText);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('PNG chart downloaded.', 'success');
    }
  } catch (err) {
    console.error('Chart PNG export error:', err);
    showToast('Unable to export this chart as PNG.', 'error');
  }
}

/**
 * ==========================================================================
 * HTML5 CANVAS CHART ENGINE (VANILLA JAVASCRIPT)
 * Zero external libraries (No Chart.js, No D3.js)
 * Supports Retina/High-DPI rendering and clean typography
 * ==========================================================================
 */
function drawHorizontalBarChart(canvasId, data, defaultColor = '#181818') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Chart layout metrics
  const barHeight = 28;
  const barGap = 16;
  const labelWidth = 160;
  const valueWidth = 100;
  const padding = 16;

  const totalHeight = padding * 2 + data.length * (barHeight + barGap) - barGap;
  const displayWidth = canvas.parentElement.clientWidth || 700;

  // Configure Canvas dimensions for crisp High-DPI screens
  canvas.width = displayWidth * dpr;
  canvas.height = totalHeight * dpr;
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${totalHeight}px`;

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, displayWidth, totalHeight);

  const availableBarWidth = Math.max(displayWidth - labelWidth - valueWidth - padding * 2, 100);

  // Maximum percentage scale reference
  const maxPercentage = 100;

  data.forEach((item, index) => {
    const y = padding + index * (barHeight + barGap);

    // 1. Draw Label
    ctx.fillStyle = '#181818';
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Truncate long labels gracefully
    let label = item.label;
    if (ctx.measureText(label).width > labelWidth - 10) {
      while (ctx.measureText(label + '...').width > labelWidth - 10 && label.length > 0) {
        label = label.slice(0, -1);
      }
      label += '...';
    }
    ctx.fillText(label, padding, y + barHeight / 2);

    // 2. Draw Background Bar Track
    const barX = padding + labelWidth;
    ctx.fillStyle = '#e8e4d5';
    roundRect(ctx, barX, y, availableBarWidth, barHeight, 5);
    ctx.fill();

    // 3. Draw Filled Bar
    const filledWidth = Math.max((item.percentage / maxPercentage) * availableBarWidth, item.count > 0 ? 6 : 0);
    ctx.fillStyle = item.color || defaultColor;
    roundRect(ctx, barX, y, filledWidth, barHeight, 5);
    ctx.fill();

    // 4. Draw Value / Percentage text
    const valueText = `${item.percentage}% (${item.count})`;
    ctx.fillStyle = '#555555';
    ctx.font = '500 12.5px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(valueText, barX + availableBarWidth + 12, y + barHeight / 2);
  });
}

/**
 * Canvas Rounded Rectangle Helper
 */
function roundRect(ctx, x, y, width, height, radius) {
  if (width < 2 * radius) radius = width / 2;
  if (height < 2 * radius) radius = height / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
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
