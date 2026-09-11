/**
 * Safe presentation helpers for the authenticated workspace activity feed.
 * Activity records remain server-owned; this module only maps known actions
 * to readable labels and small, dependency-free icon names.
 */
(function registerActivityFeedUtils(globalScope) {
  const ACTION_PRESENTATIONS = Object.freeze({
    RESPONSE_SUBMITTED: { icon: 'response', title: 'New response received' },
    RESPONSE_RECEIVED: { icon: 'response', title: 'New response received' },
    SURVEY_CREATED: { icon: 'survey-add', title: 'Survey created' },
    SURVEY_DUPLICATED: { icon: 'duplicate', title: 'Survey duplicated' },
    SURVEY_UPDATED: { icon: 'edit', title: 'Survey updated' },
    SURVEY_PUBLISHED: { icon: 'publish', title: 'Survey published' },
    SURVEY_CLOSED: { icon: 'lock', title: 'Survey closed' },
    SURVEY_ARCHIVED: { icon: 'archive', title: 'Survey archived' },
    SURVEY_RESTORED: { icon: 'restore', title: 'Survey restored' },
    SURVEY_PINNED: { icon: 'pin', title: 'Survey pinned' },
    SURVEY_UNPINNED: { icon: 'pin', title: 'Survey unpinned' },
    SURVEY_MOVED_COLLECTION: { icon: 'folder', title: 'Survey collection updated' },
    TARGET_UPDATED: { icon: 'target', title: 'Response target updated' },
    TEMPLATE_CREATED: { icon: 'template', title: 'Template created' },
    TEMPLATE_UPDATED: { icon: 'edit', title: 'Template updated' },
    TEMPLATE_DELETED: { icon: 'archive', title: 'Template removed' },
    COLLECTION_CREATED: { icon: 'folder', title: 'Collection created' },
    COLLECTION_UPDATED: { icon: 'edit', title: 'Collection updated' },
    COLLECTION_DELETED: { icon: 'archive', title: 'Collection removed' },
    TEAM_MEMBER_CREATED: { icon: 'team', title: 'Team member added' },
    TEAM_MEMBER_UPDATED: { icon: 'team', title: 'Team member updated' },
    TEAM_MEMBER_DISABLED: { icon: 'team', title: 'Team access updated' },
    TEAM_MEMBER_ENABLED: { icon: 'team', title: 'Team access updated' },
    TEAM_MEMBER_PASSWORD_RESET: { icon: 'shield', title: 'Team access updated' },
    PASSWORD_CHANGED: { icon: 'shield', title: 'Account security updated' },
    NOTE_CREATED: { icon: 'note', title: 'Research note updated' },
    NOTE_UPDATED: { icon: 'note', title: 'Research note updated' },
    NOTE_DELETED: { icon: 'note', title: 'Research note updated' },
    SURVEY_EXPORTED: { icon: 'download', title: 'Survey data exported' },
    ANALYTICS_EXPORTED: { icon: 'download', title: 'Analytics exported' }
  });

  function safeText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  function activityPresentation(item = {}) {
    const action = safeText(item.action).toUpperCase();
    const details = item.details && typeof item.details === 'object' ? item.details : {};
    const presentation = ACTION_PRESENTATIONS[action] || { icon: 'activity', title: 'Workspace activity recorded' };
    const isPrivateNote = action.startsWith('NOTE_');
    const entity = safeText(item.surveyTitle || item.survey_title) ||
      (isPrivateNote ? 'Research workspace' : safeText(details.name)) ||
      (action.startsWith('TEAM_MEMBER_') ? 'Team workspace' : 'Research workspace');
    return { ...presentation, action, entity };
  }

  function activityTimeDetails(value, now = Date.now()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { relative: 'Date unavailable', absolute: '', dateTime: '' };
    const elapsedMs = Math.max(0, now - date.getTime());
    const minutes = Math.floor(elapsedMs / 60000);
    const absolute = date.toLocaleString();
    if (minutes < 1) return { relative: 'Just now', absolute, dateTime: date.toISOString() };
    if (minutes < 60) return { relative: `${minutes} minute${minutes === 1 ? '' : 's'} ago`, absolute, dateTime: date.toISOString() };
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return { relative: `${hours} hour${hours === 1 ? '' : 's'} ago`, absolute, dateTime: date.toISOString() };
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (date >= yesterday && date < today) return { relative: 'Yesterday', absolute, dateTime: date.toISOString() };
    return {
      relative: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      absolute,
      dateTime: date.toISOString()
    };
  }

  const api = { activityPresentation, activityTimeDetails };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.ActivityFeedUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
