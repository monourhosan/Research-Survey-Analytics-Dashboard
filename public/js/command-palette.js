/*
 * Command Palette search model.
 * This file is intentionally dependency-free so the ranking rules can be tested in Node.js.
 */
(function registerCommandPaletteUtils(root) {
  const COMMAND_PALETTE_LIMIT = 10;

  function normalizeCommandQuery(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase()
      .replace(/\s+/g, ' ');
  }

  function getWorkspaceActions() {
    return [
      { id: 'new-survey', label: 'New Survey', description: 'Build a blank research survey', href: 'create-survey.html', icon: '+', aliases: ['create', 'new', 'survey'] },
      { id: 'templates', label: 'Templates / Create from Template', description: 'Start from a saved questionnaire', href: 'create-survey.html?openTemplates=1', icon: '▣', aliases: ['template', 'templates', 'temp'] },
      { id: 'new-collection', label: 'New Collection', description: 'Group related research studies', href: 'surveys.html?quickAction=collection', icon: '⊞', aliases: ['collection', 'group'] },
      { id: 'compare-surveys', label: 'Compare Surveys', description: 'Select two to four studies to compare', href: 'surveys.html?quickAction=compare', icon: '⇄', aliases: ['compare', 'comparison'] },
      { id: 'survey-inventory', label: 'Survey Inventory / All Surveys', description: 'Open the research workspace', href: 'surveys.html', icon: '▤', aliases: ['inventory', 'all surveys', 'workspace'] },
      { id: 'activity', label: 'Activity', description: 'Review recent workspace activity', href: 'surveys.html#activity-list', icon: '◷', aliases: ['recent activity', 'history'] },
      { id: 'dashboard', label: 'Dashboard', description: 'Return to the research overview', href: 'dashboard.html', icon: '▦', aliases: ['home', 'overview'] },
      { id: 'open-analytics', label: 'Open Analytics', description: 'Choose a survey to analyze', href: 'surveys.html?quickAction=analytics', icon: '⌁', aliases: ['analytics', 'analysis', 'ana'] }
    ];
  }

  function commandMatchScore(command, query) {
    const normalizedQuery = normalizeCommandQuery(query);
    if (!normalizedQuery) return 0;
    const candidates = [command.label, command.description, ...(command.aliases || [])].map(normalizeCommandQuery);
    if (candidates.some(candidate => candidate === normalizedQuery)) return 0;
    if (candidates.some(candidate => candidate.startsWith(normalizedQuery))) return 1;
    if (candidates.some(candidate => candidate.split(/\s+/).some(word => word.startsWith(normalizedQuery)))) return 2;
    if (candidates.some(candidate => candidate.includes(normalizedQuery))) return 3;
    return null;
  }

  function buildSurveyCommands(surveys) {
    if (!Array.isArray(surveys)) return [];
    return surveys.flatMap(survey => {
      const id = Number(survey?.id);
      const title = String(survey?.title || '').trim();
      if (!Number.isSafeInteger(id) || id < 1 || !title || Number(survey.is_archived) === 1) return [];
      const lifecycleAction = survey.status === 'draft' ? 'Edit' : 'Manage';
      return [
        {
          id: `survey-${id}-manage`, label: `${lifecycleAction}: ${title}`, description: `${title} · ${survey.status || 'survey'}`, href: `create-survey.html?edit=${encodeURIComponent(id)}`,
          icon: '✎', category: 'Surveys', aliases: [title, lifecycleAction, 'open']
        },
        {
          id: `survey-${id}-analytics`, label: `Analytics: ${title}`, description: `Open response analytics for ${title}`, href: `analytics.html?id=${encodeURIComponent(id)}`,
          icon: '⌁', category: 'Surveys', aliases: [title, 'analytics', 'analysis', 'ana']
        }
      ];
    });
  }

  function rankCommands(commands, query, limit = COMMAND_PALETTE_LIMIT) {
    return (Array.isArray(commands) ? commands : [])
      .map((command, index) => ({ command, index, score: commandMatchScore(command, query) }))
      .filter(item => item.score !== null)
      .sort((left, right) => left.score - right.score || left.index - right.index)
      .slice(0, Math.max(0, limit))
      .map(item => item.command);
  }

  function nextCommandIndex(currentIndex, resultCount, direction) {
    if (!Number.isSafeInteger(resultCount) || resultCount < 1) return -1;
    if (!Number.isSafeInteger(currentIndex) || currentIndex < 0) return direction < 0 ? resultCount - 1 : 0;
    return Math.max(0, Math.min(resultCount - 1, currentIndex + (direction < 0 ? -1 : 1)));
  }

  const utils = { COMMAND_PALETTE_LIMIT, normalizeCommandQuery, getWorkspaceActions, commandMatchScore, buildSurveyCommands, rankCommands, nextCommandIndex };
  if (root) root.CommandPaletteUtils = utils;
  if (typeof module !== 'undefined' && module.exports) module.exports = utils;
})(typeof window === 'undefined' ? globalThis : window);
