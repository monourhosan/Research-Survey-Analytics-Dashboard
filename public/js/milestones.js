/* Browser-local acknowledgement state for server-derived target milestones. */
(function registerMilestoneUtils(root) {
  const MILESTONE_STORAGE_KEY = 'research-dashboard-milestones:v1';
  const VALID_MILESTONES = new Set([25, 50, 75, 100]);

  function normalizeMilestone(value) {
    const milestone = Number(value);
    return VALID_MILESTONES.has(milestone) ? milestone : null;
  }

  function decideMilestoneAcknowledgement(stored, currentMilestone, targetResponses) {
    const current = normalizeMilestone(currentMilestone);
    const target = Number(targetResponses);
    if (!current || !Number.isSafeInteger(target) || target < 1) return { milestone: null, target: null, celebration: null, baseline: false };
    const prior = stored && typeof stored === 'object' ? stored : null;
    const previousMilestone = normalizeMilestone(prior?.milestone);
    const previousTarget = Number(prior?.target);
    if (!previousMilestone || previousTarget !== target) return { milestone: current, target, celebration: null, baseline: true };
    return { milestone: Math.max(previousMilestone, current), target, celebration: current > previousMilestone ? current : null, baseline: false };
  }

  function readMilestoneState(storage) {
    try {
      const raw = storage?.getItem(MILESTONE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }

  function writeMilestoneState(storage, state) {
    try { storage?.setItem(MILESTONE_STORAGE_KEY, JSON.stringify(state)); return true; } catch (_) { return false; }
  }

  function evaluateMilestoneAcknowledgements(surveys, storage) {
    const state = readMilestoneState(storage);
    const celebrations = [];
    let changed = false;
    (Array.isArray(surveys) ? surveys : []).forEach(survey => {
      const id = Number(survey?.surveyId);
      if (!Number.isSafeInteger(id) || id < 1) return;
      const decision = decideMilestoneAcknowledgement(state[String(id)], survey.highestTargetMilestone, survey.targetResponses);
      if (!decision.milestone) return;
      const next = { milestone: decision.milestone, target: decision.target };
      if (JSON.stringify(state[String(id)] || {}) !== JSON.stringify(next)) { state[String(id)] = next; changed = true; }
      if (decision.celebration) celebrations.push({ surveyId: id, title: String(survey.title || 'Research survey'), responseCount: Number(survey.responseCount || 0), targetResponses: decision.target, milestone: decision.celebration });
    });
    if (changed) writeMilestoneState(storage, state);
    return celebrations.sort((left, right) => right.milestone - left.milestone || left.surveyId - right.surveyId);
  }

  const utils = { MILESTONE_STORAGE_KEY, normalizeMilestone, decideMilestoneAcknowledgement, readMilestoneState, writeMilestoneState, evaluateMilestoneAcknowledgements };
  if (root) root.MilestoneUtils = utils;
  if (typeof module !== 'undefined' && module.exports) module.exports = utils;
})(typeof window === 'undefined' ? globalThis : window);
