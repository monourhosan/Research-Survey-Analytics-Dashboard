/**
 * Research Survey Analytics Dashboard
 * Dashboard Overview Controller
 */

let selectedActivityRange = 7;
let dashboardRequestController = null;
let latestResponseActivity = null;
let activityResizeFrame = null;
const RESPONSE_PULSE_INTERVAL_MS = 45 * 1000;
let responsePulseIntervalId = null;
let responsePulseRequestController = null;
let responsePulseBaseline = null;
let responsePulseLastSuccessfulAt = 0;
let responsePulseCelebrationTimer = null;
let milestoneCelebrationTimer = null;
const commandPaletteState = {
  activeIndex: -1,
  previousFocus: null,
  results: [],
  surveys: null,
  surveyRequest: null,
  surveyError: ''
};

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initAdminAuth();
  if (!user) return;
  setCommandCenterIdentity(user);

  initializeCommandPalette();
  syncDashboardQuickActions();

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
  document.addEventListener('visibilitychange', handleResponsePulseVisibility);
  await loadDashboardData();
  startResponsePulsePolling();
});

function commandCenterGreetingForHour(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function commandCenterCount(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? Math.floor(numericValue) : 0;
}

function commandCenterLabel(value, singular, plural = `${singular}s`) {
  const count = commandCenterCount(value);
  return `${count} ${count === 1 ? singular : plural}`;
}

function setCommandCenterIdentity(user) {
  const greeting = document.getElementById('command-center-greeting');
  if (!greeting) return;
  const displayName = typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : 'Researcher';
  greeting.textContent = `${commandCenterGreetingForHour()}, ${displayName}`;
}

function renderCommandCenterSummary(data) {
  const commandCenter = document.getElementById('research-command-center');
  const summary = document.getElementById('command-center-summary');
  const status = document.getElementById('command-center-status');
  if (!commandCenter || !summary || !status) return;
  const activeSurveys = commandCenterCount(data?.activeSurveys);
  const totalResponses = commandCenterCount(data?.totalResponses);
  summary.textContent = `${commandCenterLabel(activeSurveys, 'active survey')} · ${commandCenterLabel(totalResponses, 'total response')}`;
  status.textContent = 'Workspace ready';
  commandCenter.dataset.workspaceState = 'ready';
}

function renderCommandCenterError() {
  const commandCenter = document.getElementById('research-command-center');
  const summary = document.getElementById('command-center-summary');
  const status = document.getElementById('command-center-status');
  if (!commandCenter || !summary || !status) return;
  summary.textContent = 'Your research summary could not be loaded.';
  status.textContent = 'Workspace data unavailable';
  commandCenter.dataset.workspaceState = 'error';
}

function renderDashboardMetrics(data) {
  const metricValues = [
    ['stat-total-surveys', data?.totalSurveys],
    ['stat-active-surveys', data?.activeSurveys],
    ['stat-closed-surveys', data?.closedSurveys],
    ['stat-total-responses', data?.totalResponses]
  ];
  const animateMetric = window.DashboardMetricUtils?.animateMetric;
  metricValues.forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (!element) return;
    if (typeof animateMetric === 'function') {
      animateMetric(element, value);
    } else {
      element.textContent = String(Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);
    }
  });
}

function renderWeeklyChallenge(responseHeatmap) {
  const card = document.getElementById('weekly-challenge-card');
  const description = document.getElementById('weekly-challenge-description');
  const state = document.getElementById('weekly-challenge-state');
  const count = document.getElementById('weekly-challenge-count');
  const percent = document.getElementById('weekly-challenge-percent');
  const progress = document.getElementById('weekly-challenge-progress');
  const message = document.getElementById('weekly-challenge-message');
  if (!card || !description || !state || !count || !percent || !progress || !message || !window.WeeklyChallengeUtils) return;
  const { weeklyResponseCount, resolveWeeklyChallenge, weeklyChallengeMessage } = window.WeeklyChallengeUtils;
  const challenge = resolveWeeklyChallenge(weeklyResponseCount(responseHeatmap?.days));
  const responseWord = challenge.current === 1 ? 'response' : 'responses';
  card.setAttribute('aria-busy', 'false');
  card.dataset.challengeState = challenge.complete ? 'complete' : 'active';
  description.textContent = `Collect ${challenge.target} responses this UTC week (Monday–Sunday).`;
  state.textContent = challenge.complete ? 'Completed' : (challenge.current === 0 ? 'Ready' : 'In progress');
  count.textContent = `${challenge.current.toLocaleString()} / ${challenge.target.toLocaleString()} ${responseWord}`;
  percent.textContent = `${challenge.percentage}%`;
  progress.value = challenge.percentage;
  progress.textContent = `${challenge.percentage}%`;
  message.textContent = challenge.complete
    ? `Great work — this week's dashboard goal is complete with ${challenge.current.toLocaleString()} ${responseWord}.`
    : weeklyChallengeMessage(challenge);
}

function renderWeeklyChallengeError() {
  const card = document.getElementById('weekly-challenge-card');
  const description = document.getElementById('weekly-challenge-description');
  const state = document.getElementById('weekly-challenge-state');
  const count = document.getElementById('weekly-challenge-count');
  const percent = document.getElementById('weekly-challenge-percent');
  const progress = document.getElementById('weekly-challenge-progress');
  const message = document.getElementById('weekly-challenge-message');
  if (!card || !description || !state || !message) return;
  card.setAttribute('aria-busy', 'false');
  card.dataset.challengeState = 'error';
  description.textContent = 'This UTC week’s response goal could not be loaded.';
  state.textContent = 'Unavailable';
  if (count) count.textContent = '— / — responses';
  if (percent) percent.textContent = '—%';
  if (progress) {
    progress.value = 0;
    progress.textContent = '0%';
  }
  message.textContent = 'Refresh the dashboard to try again.';
}

function workspaceActions() {
  return window.CommandPaletteUtils?.getWorkspaceActions?.() || [];
}

function syncDashboardQuickActions() {
  const actionsById = new Map(workspaceActions().map(action => [action.id, action]));
  document.querySelectorAll('[data-workspace-action]').forEach(link => {
    const action = actionsById.get(link.dataset.workspaceAction);
    if (action) link.href = action.href;
  });
}

function initializeCommandPalette() {
  const dialog = document.getElementById('command-palette-dialog');
  const opener = document.getElementById('btn-command-palette');
  const closeButton = document.getElementById('btn-command-palette-close');
  const input = document.getElementById('command-palette-input');
  if (!dialog || !opener || !closeButton || !input || dialog.dataset.initialized === 'true') return;
  dialog.dataset.initialized = 'true';

  opener.addEventListener('click', openCommandPalette);
  closeButton.addEventListener('click', closeCommandPalette);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeCommandPalette();
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeCommandPalette();
  });
  dialog.addEventListener('close', restoreCommandPaletteFocus);
  dialog.addEventListener('keydown', trapCommandPaletteFocus);
  input.addEventListener('input', () => {
    commandPaletteState.activeIndex = 0;
    renderCommandPaletteResults();
  });
  input.addEventListener('keydown', handleCommandPaletteKeys);
  document.addEventListener('keydown', event => {
    const isShortcut = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLocaleLowerCase() === 'k';
    if (!isShortcut) return;
    event.preventDefault();
    if (dialog.open) closeCommandPalette();
    else openCommandPalette();
  });
}

function openCommandPalette() {
  const dialog = document.getElementById('command-palette-dialog');
  const input = document.getElementById('command-palette-input');
  if (!dialog || !input || dialog.open) return;
  commandPaletteState.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  commandPaletteState.activeIndex = 0;
  commandPaletteState.surveyError = '';
  input.value = '';
  dialog.showModal();
  document.body.classList.add('command-palette-open');
  renderCommandPaletteResults();
  window.requestAnimationFrame(() => input.focus());
  loadPaletteSurveys();
}

function closeCommandPalette() {
  const dialog = document.getElementById('command-palette-dialog');
  if (dialog?.open) dialog.close();
}

function restoreCommandPaletteFocus() {
  document.body.classList.remove('command-palette-open');
  const previous = commandPaletteState.previousFocus;
  commandPaletteState.previousFocus = null;
  if (previous?.isConnected) previous.focus();
}

function trapCommandPaletteFocus(event) {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
    .filter(element => !element.hidden && element.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function commandPaletteCommands() {
  const staticCommands = workspaceActions().map(action => ({ ...action, category: 'Actions' }));
  return staticCommands.concat(window.CommandPaletteUtils?.buildSurveyCommands?.(commandPaletteState.surveys) || []);
}

function renderCommandPaletteResults() {
  const input = document.getElementById('command-palette-input');
  const results = document.getElementById('command-palette-results');
  const message = document.getElementById('command-palette-message');
  if (!input || !results || !message || !window.CommandPaletteUtils) return;
  commandPaletteState.results = window.CommandPaletteUtils.rankCommands(commandPaletteCommands(), input.value);
  if (commandPaletteState.activeIndex >= commandPaletteState.results.length) commandPaletteState.activeIndex = commandPaletteState.results.length - 1;
  if (commandPaletteState.activeIndex < 0 && commandPaletteState.results.length) commandPaletteState.activeIndex = 0;
  results.replaceChildren();
  commandPaletteState.results.forEach((command, index) => {
    const option = document.createElement('div');
    option.id = `command-palette-option-${index}`;
    option.className = `command-palette-option${index === commandPaletteState.activeIndex ? ' is-active' : ''}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', index === commandPaletteState.activeIndex ? 'true' : 'false');
    option.dataset.index = String(index);
    const icon = document.createElement('span'); icon.className = 'command-palette-option-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = command.icon || '→';
    const copy = document.createElement('span'); copy.className = 'command-palette-option-copy';
    const label = document.createElement('strong'); label.textContent = command.label;
    const description = document.createElement('small'); description.textContent = command.description || '';
    const category = document.createElement('span'); category.className = 'command-palette-option-category'; category.textContent = command.category || 'Actions';
    copy.append(label, description); option.append(icon, copy, category);
    option.addEventListener('mouseenter', () => { commandPaletteState.activeIndex = index; renderCommandPaletteResults(); });
    option.addEventListener('click', () => executeCommandPaletteResult(index));
    results.appendChild(option);
  });
  if (commandPaletteState.results.length) input.setAttribute('aria-activedescendant', `command-palette-option-${commandPaletteState.activeIndex}`);
  else input.removeAttribute('aria-activedescendant');
  if (commandPaletteState.surveyError) message.textContent = `${commandPaletteState.surveyError} Static commands remain available.`;
  else if (!commandPaletteState.results.length) message.textContent = 'No matching commands or surveys.';
  else message.textContent = `${commandPaletteState.results.length} command${commandPaletteState.results.length === 1 ? '' : 's'} available.`;
}

function handleCommandPaletteKeys(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    commandPaletteState.activeIndex = window.CommandPaletteUtils.nextCommandIndex(commandPaletteState.activeIndex, commandPaletteState.results.length, event.key === 'ArrowDown' ? 1 : -1);
    renderCommandPaletteResults();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    executeCommandPaletteResult(commandPaletteState.activeIndex);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeCommandPalette();
  }
}

function executeCommandPaletteResult(index) {
  const command = commandPaletteState.results[index];
  if (!command?.href) return;
  window.location.assign(command.href);
}

async function loadPaletteSurveys() {
  if (Array.isArray(commandPaletteState.surveys)) return;
  if (commandPaletteState.surveyRequest) return commandPaletteState.surveyRequest;
  commandPaletteState.surveyRequest = fetch('/api/surveys')
    .then(async response => {
      const surveys = await response.json();
      if (!response.ok || !Array.isArray(surveys)) throw new Error('Survey search is unavailable.');
      commandPaletteState.surveys = surveys;
      commandPaletteState.surveyError = '';
      renderCommandPaletteResults();
    })
    .catch(error => {
      console.warn('Command palette survey search error:', error);
      commandPaletteState.surveyError = 'Survey search could not be loaded.';
      renderCommandPaletteResults();
    })
    .finally(() => { commandPaletteState.surveyRequest = null; });
  return commandPaletteState.surveyRequest;
}

async function loadDashboardData() {
  const tbody = document.getElementById('recent-surveys-tbody');
  const activityStatus = document.getElementById('response-activity-status');
  const timeline = document.getElementById('recent-activity-timeline');
  if (dashboardRequestController) dashboardRequestController.abort();
  dashboardRequestController = new AbortController();
  const requestController = dashboardRequestController;
  activityStatus.textContent = 'Loading activity data…';
  timeline.setAttribute('aria-busy', 'true');
  const activityTimelineRequest = fetch('/api/activity?limit=6', { signal: requestController.signal })
    .then(async response => {
      if (!response.ok) throw new Error('Failed to load recent workspace activity');
      return response.json();
    });

  try {
    const res = await fetch(`/api/dashboard?range=${selectedActivityRange}`, { signal: requestController.signal });
    if (!res.ok) throw new Error('Failed to load dashboard data');

    const data = await res.json();

    // Populate metric cards
    renderDashboardMetrics(data);
    renderCommandCenterSummary(data);
    renderAttentionItems(data.attentionItems || [], data.totalAttentionItems || 0);
    renderUpcomingResearch(data.upcomingResearch || []);
    renderResponseActivity(data.responseActivity);
    renderResponseHeatmap(data.responseHeatmap);
    renderWeeklyChallenge(data.responseHeatmap);
    renderResponsePulse(data.responsePulse);
    renderResearchHealth(data.researchHealth || []);
    renderSurveyAchievements(data.surveyAchievements || []);
    evaluateMilestoneAchievements(data.surveyAchievements || []);
    try {
      renderActivityTimeline(await activityTimelineRequest);
    } catch (activityError) {
      if (activityError.name === 'AbortError') return;
      console.error('Recent activity timeline error:', activityError);
      renderActivityTimelineError();
    }

    // Render Recent Surveys
    if (!data.recentSurveys || data.recentSurveys.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">
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
          ${achievementBadgeMarkup(survey.badges, 2)}
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
            <a href="analytics.html?id=${survey.id}" class="btn btn-secondary btn-sm" title="View Analytics">Analytics</a>
            <a href="create-survey.html?edit=${survey.id}" class="btn btn-secondary btn-sm" title="Manage Survey">
              Manage
            </a>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    await activityTimelineRequest.catch(() => null);
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
    renderResponseHeatmapError();
    renderWeeklyChallengeError();
    renderActivityTimelineError();
    renderResponsePulseError();
    renderResearchHealthError();
    renderSurveyAchievementsError();
    renderCommandCenterError();
    showToast('Failed to load dashboard metrics', 'error');
  }
}

function achievementBadgeMarkup(badges, limit = 2) {
  if (!Array.isArray(badges) || !badges.length) return '';
  const visible = badges.slice(0, limit).map(badge => `<span class="achievement-badge achievement-badge-${escapeHtml(badge.id || 'default')}" title="${escapeHtml(badge.description || badge.label || 'Achievement')}">${escapeHtml(badge.label || 'Achievement')}</span>`).join('');
  const remaining = badges.length - limit;
  return `<span class="achievement-badges" aria-label="${escapeHtml(badges.map(badge => badge.label).join(', '))}">${visible}${remaining > 0 ? `<span class="achievement-badge achievement-badge-more" title="${escapeHtml(badges.slice(limit).map(badge => badge.label).join(', '))}">+${remaining}</span>` : ''}</span>`;
}

function renderSurveyAchievements(items) {
  const list = document.getElementById('milestone-achievements-list');
  if (!list) return;
  list.setAttribute('aria-busy', 'false');
  const meaningful = (Array.isArray(items) ? items : []).filter(item => item.highestTargetMilestone || item.badges?.length).slice(0, 5);
  if (!meaningful.length) {
    list.innerHTML = '<div class="milestone-achievements-empty">No milestones yet. Add a response target, deadline, or complete survey setup to unlock deterministic achievements.</div>';
    return;
  }
  list.innerHTML = '';
  meaningful.forEach(item => {
    const row = document.createElement('article');
    row.className = 'milestone-achievement-item';
    const hasTarget = Number.isSafeInteger(item.targetResponses) && item.targetResponses > 0;
    const progress = hasTarget ? Math.max(0, Math.min(100, Math.round((Number(item.responseCount || 0) / item.targetResponses) * 100))) : null;
    row.innerHTML = `
      <div class="milestone-achievement-main">
        <h3>${escapeHtml(item.title || 'Research survey')}</h3>
        <p>${hasTarget ? `${Number(item.responseCount || 0)} / ${item.targetResponses} responses · ${progress}% toward target` : 'Achievement status is based on the current survey setup and response activity.'}</p>
        ${achievementBadgeMarkup(item.badges, 3)}
      </div>
      ${hasTarget ? `<span class="milestone-progress" aria-label="${escapeHtml(item.title || 'Survey')} reached ${progress}% of its response target">${progress}%</span>` : ''}
    `;
    list.appendChild(row);
  });
}

function renderSurveyAchievementsError() {
  const list = document.getElementById('milestone-achievements-list');
  if (!list) return;
  list.setAttribute('aria-busy', 'false');
  list.innerHTML = '<div class="milestone-achievements-empty">Achievements could not be loaded. Refresh the dashboard to try again.</div>';
}

function evaluateMilestoneAchievements(surveys) {
  if (!window.MilestoneUtils || !Array.isArray(surveys)) return;
  const celebrations = window.MilestoneUtils.evaluateMilestoneAcknowledgements(surveys, window.localStorage);
  if (celebrations.length) showMilestoneCelebration(celebrations[0]);
}

function showMilestoneCelebration(achievement) {
  const banner = document.getElementById('milestone-celebration');
  if (!banner) return;
  const targetReached = achievement.milestone === 100;
  banner.textContent = targetReached
    ? `Target achieved! ${achievement.title} reached ${achievement.responseCount} / ${achievement.targetResponses} responses.`
    : `Target milestone reached! ${achievement.title} reached ${achievement.milestone}% of its response target.`;
  banner.hidden = false;
  banner.classList.remove('is-visible');
  window.requestAnimationFrame(() => banner.classList.add('is-visible'));
  if (milestoneCelebrationTimer) window.clearTimeout(milestoneCelebrationTimer);
  milestoneCelebrationTimer = window.setTimeout(() => {
    banner.classList.remove('is-visible');
    banner.hidden = true;
    milestoneCelebrationTimer = null;
  }, 6000);
}

function heatmapDateDetails(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  return {
    weekday: value.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
    full: value.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  };
}

function renderResponseHeatmap(heatmap) {
  const grid = document.getElementById('response-heatmap-grid');
  const labels = document.getElementById('response-heatmap-weekdays');
  const range = document.getElementById('response-heatmap-range');
  const selected = document.getElementById('response-heatmap-selected');
  if (!heatmap || !Array.isArray(heatmap.days) || heatmap.days.length !== 84) {
    renderResponseHeatmapError();
    return;
  }

  const firstDay = heatmapDateDetails(heatmap.days[0].date);
  labels.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${heatmap.days[0].date}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return `<span>${escapeHtml(date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }))}</span>`;
  }).join('');
  range.textContent = `${firstDay.full} to ${heatmapDateDetails(heatmap.days[heatmap.days.length - 1].date).full} · Last 12 weeks`;
  grid.setAttribute('aria-busy', 'false');
  grid.replaceChildren();
  if (!heatmap.totalResponses) selected.textContent = 'No responses were collected in this period.';
  else selected.textContent = 'Select a day to view its response count.';

  const selectDay = (button, day) => {
    grid.querySelectorAll('.response-heatmap-cell.is-selected').forEach(cell => cell.classList.remove('is-selected'));
    button.classList.add('is-selected');
    const details = heatmapDateDetails(day.date);
    selected.textContent = `Selected: ${details.full} — ${day.count} response${day.count === 1 ? '' : 's'}.`;
  };
  heatmap.days.forEach(day => {
    const count = Math.max(0, Number(day.count) || 0);
    const level = Math.max(0, Math.min(4, Number(day.level) || 0));
    const details = heatmapDateDetails(day.date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `response-heatmap-cell heatmap-level-${level}`;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', `${details.full}: ${count} response${count === 1 ? '' : 's'}`);
    button.setAttribute('title', `${details.full}: ${count} response${count === 1 ? '' : 's'}`);
    button.addEventListener('click', () => selectDay(button, { ...day, count }));
    button.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectDay(button, { ...day, count }); }
    });
    grid.appendChild(button);
  });
}

function renderResponseHeatmapError() {
  const grid = document.getElementById('response-heatmap-grid');
  const range = document.getElementById('response-heatmap-range');
  const selected = document.getElementById('response-heatmap-selected');
  grid.setAttribute('aria-busy', 'false');
  grid.replaceChildren();
  range.textContent = 'Response calendar is currently unavailable.';
  selected.textContent = 'Response calendar data could not be loaded. Refresh the dashboard to try again.';
}

function renderResearchHealth(items) {
  const list = document.getElementById('research-health-list');
  list.setAttribute('aria-busy', 'false');
  if (!Array.isArray(items) || !items.length) {
    list.innerHTML = '<div class="research-health-empty">No active, non-archived surveys are available for a health review.</div>';
    return;
  }

  const componentLabels = {
    readiness: 'Readiness',
    collection: 'Collection progress',
    deadline: 'Deadline runway',
    recentActivity: 'Recent activity'
  };
  list.replaceChildren();
  items.slice(0, 5).forEach(item => {
    const row = document.createElement('article');
    row.className = 'research-health-item';
    const components = Object.entries(componentLabels).map(([key, label]) => {
      const component = item.components?.[key];
      if (!component?.available || !Number.isFinite(component.score)) {
        return `<li><span>${escapeHtml(label)}</span><strong>Not configured</strong></li>`;
      }
      const score = Math.max(0, Math.min(100, Number(component.score)));
      return `<li><span>${escapeHtml(label)}</span><strong>${score}</strong><progress value="${score}" max="100" aria-label="${escapeHtml(label)}: ${score} out of 100"></progress></li>`;
    }).join('');
    const score = Math.max(0, Math.min(100, Number(item.score) || 0));
    row.innerHTML = `
      <div class="research-health-main">
        <div class="research-health-title-row"><h3>${escapeHtml(item.title || 'Research survey')}</h3>${achievementBadgeMarkup(item.badges, 2)}</div>
        <p class="research-health-summary">${escapeHtml(item.summary || 'Health is based on current authorized survey data.')}</p>
        <ul class="research-health-components">${components}</ul>
        ${item.limitedData ? '<span class="research-health-limited">Limited data: this score uses fewer available components.</span>' : ''}
      </div>
      <div class="research-health-score" aria-label="${escapeHtml(item.title || 'Survey')} health score: ${score} out of 100, ${escapeHtml(item.label || 'Unrated')}"><strong>${score}</strong><span>${escapeHtml(item.label || 'Unrated')}</span></div>
    `;
    list.appendChild(row);
  });
}

function renderResearchHealthError() {
  const list = document.getElementById('research-health-list');
  list.setAttribute('aria-busy', 'false');
  list.innerHTML = '<div class="research-health-empty">Research health could not be calculated. Refresh the dashboard to try again.</div>';
}

function responsePulseDelta(previousTotal, nextTotal) {
  if (!Number.isSafeInteger(nextTotal) || nextTotal < 0) return null;
  if (!Number.isSafeInteger(previousTotal) || previousTotal < 0) return null;
  return nextTotal > previousTotal ? nextTotal - previousTotal : null;
}

function pulseCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function renderResponsePulse(pulse) {
  const totalResponses = pulseCount(pulse?.totalResponses);
  const todayCount = pulseCount(pulse?.todayCount);
  const lastHourCount = pulseCount(pulse?.lastHourCount);
  const activeSurveyCount = pulseCount(pulse?.activeSurveyCount);
  if (totalResponses === null || todayCount === null || lastHourCount === null || activeSurveyCount === null) {
    renderResponsePulseError();
    return;
  }

  const card = document.querySelector('.dashboard-response-pulse-card');
  const status = document.getElementById('response-pulse-status');
  const latest = document.getElementById('response-pulse-latest');
  const hint = document.getElementById('response-pulse-hint');
  const delta = responsePulseDelta(responsePulseBaseline, totalResponses);
  responsePulseBaseline = totalResponses;
  responsePulseLastSuccessfulAt = Date.now();

  card.setAttribute('aria-busy', 'false');
  document.getElementById('response-pulse-today').textContent = todayCount;
  document.getElementById('response-pulse-last-hour').textContent = lastHourCount;
  if (activeSurveyCount > 0) {
    status.textContent = `Collecting · Auto-refreshing`;
    status.className = 'response-pulse-status is-collecting';
  } else {
    status.textContent = 'No active surveys';
    status.className = 'response-pulse-status';
  }

  const responseTime = pulse.latestResponseAt ? activityTimeDetails(pulse.latestResponseAt) : null;
  latest.textContent = responseTime ? responseTime.relative : 'No responses yet';
  if (responseTime?.absolute) {
    latest.setAttribute('title', responseTime.absolute);
    latest.setAttribute('datetime', pulse.latestResponseAt);
  } else {
    latest.removeAttribute('title');
    latest.removeAttribute('datetime');
  }
  hint.textContent = `Last checked just now · ${activeSurveyCount} active survey${activeSurveyCount === 1 ? '' : 's'}.`;
  hint.className = 'response-pulse-hint';
  if (delta) announceResponsePulseDelta(delta);
  if (Array.isArray(pulse.milestoneSurveys)) evaluateMilestoneAchievements(pulse.milestoneSurveys);
}

function announceResponsePulseDelta(delta) {
  const message = document.getElementById('response-pulse-new');
  if (responsePulseCelebrationTimer) window.clearTimeout(responsePulseCelebrationTimer);
  message.textContent = `+${delta} new response${delta === 1 ? '' : 's'}`;
  message.className = 'response-pulse-new is-new';
  responsePulseCelebrationTimer = window.setTimeout(() => {
    message.textContent = '';
    message.className = 'response-pulse-new';
    responsePulseCelebrationTimer = null;
  }, 5000);
}

function renderResponsePulseError() {
  const card = document.querySelector('.dashboard-response-pulse-card');
  const status = document.getElementById('response-pulse-status');
  const hint = document.getElementById('response-pulse-hint');
  card?.setAttribute('aria-busy', 'false');
  status.textContent = 'Refresh delayed';
  status.className = 'response-pulse-status';
  hint.textContent = 'Latest refresh failed; showing the last known response data.';
  hint.className = 'response-pulse-hint is-stale';
}

async function refreshResponsePulse() {
  if (document.hidden || responsePulseRequestController) return;
  const controller = new AbortController();
  responsePulseRequestController = controller;
  try {
    const response = await fetch('/api/dashboard/pulse', { signal: controller.signal });
    if (!response.ok) throw new Error('Failed to load response pulse');
    renderResponsePulse(await response.json());
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Dashboard response pulse error:', err);
      renderResponsePulseError();
    }
  } finally {
    if (responsePulseRequestController === controller) responsePulseRequestController = null;
  }
}

function startResponsePulsePolling() {
  if (document.hidden || responsePulseIntervalId !== null) return;
  responsePulseIntervalId = window.setInterval(refreshResponsePulse, RESPONSE_PULSE_INTERVAL_MS);
}

function stopResponsePulsePolling() {
  if (responsePulseIntervalId !== null) {
    window.clearInterval(responsePulseIntervalId);
    responsePulseIntervalId = null;
  }
  if (responsePulseRequestController) responsePulseRequestController.abort();
}

function handleResponsePulseVisibility() {
  if (document.hidden) {
    stopResponsePulsePolling();
    return;
  }
  if (!responsePulseLastSuccessfulAt || Date.now() - responsePulseLastSuccessfulAt >= RESPONSE_PULSE_INTERVAL_MS) {
    refreshResponsePulse();
  }
  startResponsePulsePolling();
}

function activityActionPresentation(item) {
  return window.ActivityFeedUtils?.activityPresentation?.(item) || { icon: 'activity', title: 'Workspace activity recorded', entity: 'Research workspace' };
}

function activityTimeDetails(value, now = Date.now()) {
  return window.ActivityFeedUtils?.activityTimeDetails?.(value, now) || { relative: 'Date unavailable', absolute: '', dateTime: '' };
}

function activityLinkFor(item) {
  const surveyId = Number(item.surveyId || item.survey_id);
  return Number.isSafeInteger(surveyId) && surveyId > 0
    ? `create-survey.html?edit=${encodeURIComponent(surveyId)}`
    : 'surveys.html';
}

function renderActivityTimeline(items) {
  const timeline = document.getElementById('recent-activity-timeline');
  timeline.setAttribute('aria-busy', 'false');
  if (!Array.isArray(items) || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'timeline-empty-state';
    const title = document.createElement('strong');
    title.textContent = 'No recent workspace activity yet.';
    const detail = document.createElement('span');
    detail.textContent = 'Actions such as publishing a survey or receiving responses will appear here.';
    empty.append(title, detail);
    timeline.replaceChildren(empty);
    return;
  }
  timeline.replaceChildren();
  items.forEach(item => {
    const presentation = activityActionPresentation(item);
    const time = activityTimeDetails(item.createdAt || item.created_at);
    const actorName = typeof item.actor?.name === 'string' && item.actor.name.trim() ? item.actor.name.trim() : '';
    const row = document.createElement('article');
    row.className = 'activity-feed-item';
    row.dataset.activityIcon = presentation.icon;
    const icon = createActivityFeedIcon(presentation.icon);
    const copy = document.createElement('div');
    copy.className = 'activity-feed-copy';
    const title = document.createElement('p');
    title.className = 'activity-feed-title';
    title.textContent = presentation.title;
    const entity = document.createElement('a');
    entity.className = 'activity-feed-entity';
    entity.href = activityLinkFor(item);
    entity.textContent = presentation.entity;
    const metadata = document.createElement('p');
    metadata.className = 'activity-feed-metadata';
    metadata.textContent = actorName ? `by ${actorName}` : 'System activity';
    copy.append(title, entity, metadata);
    const timestamp = document.createElement('time');
    timestamp.className = 'activity-feed-time';
    timestamp.textContent = time.relative;
    if (time.absolute) timestamp.title = time.absolute;
    if (time.dateTime) timestamp.dateTime = time.dateTime;
    row.append(icon, copy, timestamp);
    timeline.appendChild(row);
  });
}

function renderActivityTimelineError() {
  const timeline = document.getElementById('recent-activity-timeline');
  timeline.setAttribute('aria-busy', 'false');
  const error = document.createElement('div');
  error.className = 'timeline-empty-state';
  error.textContent = 'Recent workspace activity could not be loaded. Refresh the dashboard to try again.';
  timeline.replaceChildren(error);
}

function createActivityFeedIcon(iconName) {
  const paths = {
    response: 'M5 6.5h14v9H9l-4 3v-12Z M8 10.5h8',
    'survey-add': 'M6 3.5h8l4 4v13H6v-17Z M14 3.5v4h4 M12 11v6 M9 14h6',
    duplicate: 'M8 5h11v13H8z M5 8H4v11h11v-1',
    edit: 'm5 16 1-4 9-9 3 3-9 9-4 1Z M13.5 4.5l3 3',
    publish: 'M4 12h11 M11 7l5 5-5 5 M5 5v14',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3 M5 10h14v10H5z',
    archive: 'M4 5h16v4H4z M6 9h12v11H6z M10 13h4',
    restore: 'M8 7H4V3 M4 7a8 8 0 1 1-1 6',
    pin: 'm9 4 6 6 M8 5l7 7 M12 12l-4 4v2h8v-2l-4-4 M12 18v3',
    folder: 'M3 7h7l2 2h9v10H3z',
    target: 'M12 4a8 8 0 1 0 8 8 M12 8a4 4 0 1 0 4 4 M12 12l7-7',
    template: 'M6 3h9l3 3v15H6z M9 10h6 M9 14h6 M9 18h4',
    team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M2 20c0-3 2.5-5 6-5s6 2 6 5 M17 6a2.5 2.5 0 1 1 0 5 M16 15c2.5 0 4.5 1.5 5 4',
    shield: 'M12 3 19 6v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6z M9 12l2 2 4-4',
    note: 'M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5',
    download: 'M12 3v11 M8 10l4 4 4-4 M5 20h14',
    activity: 'M4 13h3l2-6 4 11 2-5h5'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[iconName] || paths.activity);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  const chip = document.createElement('div');
  chip.className = 'activity-feed-icon';
  chip.setAttribute('aria-hidden', 'true');
  chip.appendChild(svg);
  return chip;
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
        ${achievementBadgeMarkup(item.badges, 2)}
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
