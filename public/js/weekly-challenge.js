/**
 * Dashboard-wide weekly activity goal. Response activity is grouped by UTC
 * dates in the existing API, so the challenge deliberately uses UTC weeks too.
 */
(function registerWeeklyChallengeUtils(globalScope) {
  const MILESTONE_TARGETS = Object.freeze([5, 10, 25, 50, 100, 200, 500, 1000]);
  const fallbackTargets = new Map();

  function safeCount(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : 0;
  }

  function utcDateKey(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString().slice(0, 10);
  }

  function getUtcWeekStartKey(now = new Date()) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const daysSinceMonday = (today.getUTCDay() + 6) % 7;
    today.setUTCDate(today.getUTCDate() - daysSinceMonday);
    return today.toISOString().slice(0, 10);
  }

  function weeklyResponseCount(days, now = new Date()) {
    const weekStart = getUtcWeekStartKey(now);
    const today = utcDateKey(now);
    return (Array.isArray(days) ? days : []).reduce((total, day) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date || '')) return total;
      return day.date >= weekStart && day.date <= today ? total + safeCount(day.count) : total;
    }, 0);
  }

  function nextWeeklyTarget(currentCount) {
    const current = safeCount(currentCount);
    const milestone = MILESTONE_TARGETS.find(target => target > current);
    if (milestone) return milestone;
    const step = Math.max(500, Math.pow(10, Math.floor(Math.log10(Math.max(current, 1)))) / 2);
    return Math.ceil((current + 1) / step) * step;
  }

  function challengeStorageKey(weekStart) {
    return `rsad_weekly_challenge_${weekStart}`;
  }

  function readStoredTarget(storage, key) {
    try {
      const target = Number(storage?.getItem?.(key));
      return Number.isSafeInteger(target) && target > 0 ? target : null;
    } catch (_) {
      return null;
    }
  }

  function resolveWeeklyChallenge(currentCount, now = new Date(), storage = globalScope?.localStorage) {
    const current = safeCount(currentCount);
    const weekStart = getUtcWeekStartKey(now);
    const key = challengeStorageKey(weekStart);
    let target = readStoredTarget(storage, key) || fallbackTargets.get(key);
    if (!target) {
      target = nextWeeklyTarget(current);
      fallbackTargets.set(key, target);
      try { storage?.setItem?.(key, String(target)); } catch (_) {}
    }
    const percentage = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    return { current, target, percentage, weekStart, key, complete: current >= target };
  }

  function responseLabel(count) {
    return `${count} response${count === 1 ? '' : 's'}`;
  }

  function weeklyChallengeMessage(challenge) {
    if (challenge.complete) return 'Challenge completed 🎉';
    if (challenge.current === 0) return 'Your weekly challenge is ready.';
    const remaining = Math.max(0, challenge.target - challenge.current);
    if (challenge.percentage >= 80) return `Almost there — only ${responseLabel(remaining)} remaining.`;
    if (challenge.percentage >= 50) return `Great progress — ${responseLabel(remaining)} remaining.`;
    return `${responseLabel(remaining)} remaining. Keep going!`;
  }

  const api = {
    challengeStorageKey,
    getUtcWeekStartKey,
    nextWeeklyTarget,
    resolveWeeklyChallenge,
    weeklyChallengeMessage,
    weeklyResponseCount
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.WeeklyChallengeUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
