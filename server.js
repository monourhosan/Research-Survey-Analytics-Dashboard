/**
 * Research Survey Analytics Dashboard
 * Main Application Server (Node.js + Express.js)
 * 
 * Features:
 * - Express Session authentication
 * - Clean RESTful endpoints for Admin & Public Survey operations
 * - Deterministic Rule-Based Automated Insight Engine
 * - Native RFC 4180 CSV generation (no external CSV libraries)
 * - Safe parameterized queries and foreign key constraints
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const {
  dbRun,
  dbGet,
  dbAll,
  initDatabase,
  verifyPassword,
  hashPassword,
  createUserAccount,
  USER_ROLES,
  isValidUserRole
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy (required for session cookies behind Vercel / Edge reverse proxies)
app.set('trust proxy', 1);

// Session configuration
app.use(
  session({
    secret: 'cse499-research-survey-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Ensure database tables and initial seed data are initialized before handling requests
let dbInitPromise = null;
function ensureDbReady() {
  if (!dbInitPromise) {
    dbInitPromise = initDatabase().catch(err => {
      console.error('[SERVER] Database initialization failure:', err);
      dbInitPromise = null;
      throw err;
    });
  }
  return dbInitPromise;
}

app.use(async (req, res, next) => {
  try {
    await ensureDbReady();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database initialization failure', details: err.message });
  }
});

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

function safeTeamMember(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: Number(user.is_active) === 1,
    createdAt: user.created_at || null,
    updatedAt: user.updated_at || null,
    lastLoginAt: user.last_login_at || null
  };
}

const TEAM_MEMBER_PASSWORD_MIN_LENGTH = 10;
const TEAM_MEMBER_PASSWORD_MAX_LENGTH = 128;
const TEAM_MEMBER_NAME_MAX_LENGTH = 120;

function normalizeTeamMemberName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > TEAM_MEMBER_NAME_MAX_LENGTH) return { error: `Display name is required and must not exceed ${TEAM_MEMBER_NAME_MAX_LENGTH} characters.` };
  return { value: name };
}

function normalizeTeamMemberEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: 'A valid email address is required.' };
  return { value: email };
}

function normalizeTeamMemberPassword(value) {
  if (typeof value !== 'string' || value.length < TEAM_MEMBER_PASSWORD_MIN_LENGTH || value.length > TEAM_MEMBER_PASSWORD_MAX_LENGTH) return { error: `Password must contain ${TEAM_MEMBER_PASSWORD_MIN_LENGTH}-${TEAM_MEMBER_PASSWORD_MAX_LENGTH} characters.` };
  return { value };
}

function generateTemporaryPassword() {
  // Returned only in the immediate create/reset response; it is never persisted or logged.
  return `Research-${crypto.randomBytes(12).toString('base64url')}`;
}

async function findTeamMember(memberId) {
  return dbGet(
    `SELECT id, name, email, role, is_active, created_at, updated_at, last_login_at
     FROM users WHERE id = ? AND role = ?`,
    [memberId, USER_ROLES.TEAM_MEMBER]
  );
}

function isUniqueConstraintError(error) {
  return /unique constraint|users\.email/i.test(error && error.message);
}

async function getActiveSessionUser(req) {
  if (!req.session || !Number.isSafeInteger(req.session.userId)) return null;
  const user = await dbGet(
    'SELECT id, name, email, role, is_active FROM users WHERE id = ?',
    [req.session.userId]
  );
  if (!user || Number(user.is_active) !== 1 || !isValidUserRole(user.role)) return null;
  return user;
}

function invalidateSession(req) {
  if (req.session) req.session.destroy(() => {});
}

/** Authenticates the persisted account on every protected request. */
async function requireAuth(req, res, next) {
  try {
    const user = await getActiveSessionUser(req);
    if (!user) {
      invalidateSession(req);
      return res.status(401).json({ error: 'Unauthorized: Please log in to access this resource' });
    }
    req.currentUser = user;
    req.session.userRole = user.role;
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Unable to verify the current session.' });
  }
}

/** Restricts existing administrator workspace APIs to trusted admin accounts. */
async function requireAdmin(req, res, next) {
  try {
    const user = await getActiveSessionUser(req);
    if (!user) {
      invalidateSession(req);
      return res.status(401).json({ error: 'Unauthorized: Please log in to access this resource' });
    }
    if (user.role !== USER_ROLES.ADMIN) {
      return res.status(403).json({ error: 'Forbidden: Administrator access is required.' });
    }
    req.currentUser = user;
    req.session.userRole = user.role;
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Unable to verify the current session.' });
  }
}

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function normalizeResponseDeadline(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value.trim())) {
    return { error: 'Response deadline must be a valid date and time with a timezone.' };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { error: 'Response deadline must be a valid date and time.' };
  }

  return { value: parsed.toISOString() };
}

function isSurveyExpired(responseDeadline) {
  if (!responseDeadline) return false;
  const deadlineMs = Date.parse(responseDeadline);
  return Number.isFinite(deadlineMs) && deadlineMs <= Date.now();
}

const MAX_RESPONSE_LIMIT = 1000000;

function normalizeResponseLimit(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_RESPONSE_LIMIT) {
    return { error: `Response limit must be a whole number from 1 to ${MAX_RESPONSE_LIMIT.toLocaleString()}.` };
  }
  return { value };
}

function isSurveyResponseLimitReached(responseLimit, responseCount) {
  return Number.isSafeInteger(responseLimit) && responseLimit > 0 && responseCount >= responseLimit;
}

function normalizeOneResponsePerBrowser(value) {
  if (value === undefined || value === null) return { value: 0 };
  if (typeof value === 'boolean') return { value: value ? 1 : 0 };
  if (value === 0 || value === 1) return { value };
  return { error: 'Browser duplicate-response protection must be enabled or disabled.' };
}

const MAX_COLLECTION_NAME_LENGTH = 100;
const MAX_COLLECTION_DESCRIPTION_LENGTH = 1000;
const MAX_TEMPLATE_NAME_LENGTH = 120;
const MAX_NOTE_LENGTH = 4000;
const WORKSPACE_VIEW_TYPES = new Set(['workspace', 'analytics']);
const VALID_QUESTION_TYPES = new Set(['text', 'multiple_choice', 'rating', 'yes_no']);

function parsePositiveId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeTargetResponses(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_RESPONSE_LIMIT) {
    return { error: `Target responses must be a whole number from 1 to ${MAX_RESPONSE_LIMIT.toLocaleString()}.` };
  }
  return { value };
}

function normalizeOptionalCollectionId(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  const id = parsePositiveId(value);
  return id ? { value: id } : { error: 'Collection must be a valid collection ID.' };
}

function normalizeName(value, maxLength, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return { error: `${label} is required.` };
  if (normalized.length > maxLength) return { error: `${label} must not exceed ${maxLength} characters.` };
  return { value: normalized };
}

function safeJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

async function recordActivity(action, surveyId = null, details = null) {
  const detailsJson = details ? JSON.stringify(details) : null;
  await dbRun(
    'INSERT INTO activity_logs (survey_id, action, details_json) VALUES (?, ?, ?)',
    [surveyId, action, detailsJson]
  );
}

async function assertCollectionExists(collectionId) {
  if (!collectionId) return true;
  const collection = await dbGet('SELECT id FROM collections WHERE id = ?', [collectionId]);
  return Boolean(collection);
}

function computeReadiness(survey, questions) {
  const checks = [];
  const add = (key, label, passed, blocking = true, detail = '') => checks.push({ key, label, passed, blocking, detail });
  add('title', 'Survey title', Boolean(survey.title && survey.title.trim()), true);
  add('description', 'Research description', Boolean(survey.description && survey.description.trim()), false, 'Recommended for participants.');
  add('questions', 'At least one question', questions.length > 0, true);
  questions.forEach((question, index) => {
    add(`question-${question.id || index}-text`, `Question ${index + 1} text`, Boolean(question.question_text && question.question_text.trim()), true);
    add(`question-${question.id || index}-type`, `Question ${index + 1} type`, VALID_QUESTION_TYPES.has(question.question_type), true);
    if (question.question_type === 'multiple_choice') {
      const options = Array.isArray(question.options) ? question.options : safeJson(question.options_json, []);
      const nonBlankOptions = options.filter(option => typeof option === 'string' && option.trim());
      add(`question-${question.id || index}-options`, `Question ${index + 1} options`, nonBlankOptions.length >= 2 && nonBlankOptions.length <= 6 && nonBlankOptions.length === options.length, true);
    }
  });
  const deadlineValid = !survey.response_deadline || Number.isFinite(Date.parse(survey.response_deadline));
  add('deadline', 'Response deadline', deadlineValid, true);
  const targetValid = survey.target_responses === null || survey.target_responses === undefined || (Number.isSafeInteger(survey.target_responses) && survey.target_responses > 0 && survey.target_responses <= MAX_RESPONSE_LIMIT);
  add('target', 'Target responses', targetValid, true);
  const limitValid = survey.response_limit === null || survey.response_limit === undefined || (Number.isSafeInteger(survey.response_limit) && survey.response_limit > 0 && survey.response_limit <= MAX_RESPONSE_LIMIT);
  add('limit', 'Maximum responses', limitValid, true);
  add('target-limit', 'Target fits maximum response limit', !survey.target_responses || !survey.response_limit || survey.target_responses <= survey.response_limit, true);
  if (survey.status === 'active') add('future-deadline', 'Active deadline is in the future', !survey.response_deadline || !isSurveyExpired(survey.response_deadline), true);
  const passed = checks.filter(check => check.passed).length;
  const blocking = checks.filter(check => !check.passed && check.blocking);
  return { percentage: Math.round((passed / Math.max(checks.length, 1)) * 100), checks, blocking, ready: blocking.length === 0 };
}

function calculateCollectionState(survey) {
  const responses = Number(survey.response_count || 0);
  const target = Number(survey.target_responses || 0);
  const progress = target > 0 ? Math.min(100, Math.round((responses / target) * 100)) : null;
  const deadlineMs = survey.response_deadline ? Date.parse(survey.response_deadline) : NaN;
  const endingSoon = survey.status === 'active' && Number.isFinite(deadlineMs) && deadlineMs > Date.now() && deadlineMs - Date.now() <= 3 * 24 * 60 * 60 * 1000;
  let label = survey.status === 'closed' ? 'Closed' : 'No responses yet';
  if (survey.status === 'active' && responses > 0) label = 'Collecting';
  if (survey.status === 'active' && target > 0 && responses >= target) label = 'Target reached';
  else if (survey.status === 'active' && target > 0 && responses / target >= 0.8) label = 'Near target';
  else if (endingSoon) label = 'Ending soon';
  return { target_progress: progress, responses_remaining: target > 0 ? Math.max(0, target - responses) : null, collection_state: label, ending_soon: endingSoon };
}

const ATTENTION_APPROACHING_DEADLINE_DAYS = 3;
const ATTENTION_BEHIND_TARGET_DAYS = 7;
const ATTENTION_CAPACITY_WARNING_PERCENT = 90;
const ATTENTION_ITEM_LIMIT = 5;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RESPONSE_ACTIVITY_RANGES = new Set([7, 30, 90]);
const RESPONSE_HEATMAP_DAYS = 84;
const TARGET_MILESTONES = Object.freeze([25, 50, 75, 100]);
const ACHIEVEMENT_BADGE_DEFINITIONS = Object.freeze([
  { id: 'target_reached', label: 'Target Reached', description: 'The configured response target has been reached.', priority: 100 },
  { id: 'closing_soon', label: 'Closing Soon', description: 'The active response deadline is within three days.', priority: 90 },
  { id: 'fast_growth', label: 'Fast Growth', description: 'Responses grew strongly compared with the previous seven days.', priority: 80 },
  { id: 'high_activity', label: 'High Activity', description: 'At least 10 accepted responses arrived in the last seven days.', priority: 70 },
  { id: 'fully_ready', label: 'Fully Ready', description: 'All applicable readiness checks currently pass.', priority: 60 }
]);

function calculateDaysRemaining(deadline, nowMs) {
  const deadlineMs = Date.parse(deadline || '');
  if (!Number.isFinite(deadlineMs)) return null;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / DAY_IN_MS));
}

function toUtcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getResponseActivityWindow(rangeDays, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const currentStart = addUtcDays(today, -(rangeDays - 1));
  const currentEnd = addUtcDays(today, 1);
  const previousStart = addUtcDays(currentStart, -rangeDays);
  return { currentStart, currentEnd, previousStart };
}

async function buildResponseActivity(rangeDays, now = new Date()) {
  const { currentStart, currentEnd, previousStart } = getResponseActivityWindow(rangeDays, now);
  const currentStartKey = `${toUtcDateKey(currentStart)} 00:00:00`;
  const currentEndKey = `${toUtcDateKey(currentEnd)} 00:00:00`;
  const previousStartKey = `${toUtcDateKey(previousStart)} 00:00:00`;
  const rows = await dbAll(`
    SELECT substr(submitted_at, 1, 10) AS date, COUNT(*) AS count
    FROM responses
    WHERE submitted_at >= ? AND submitted_at < ?
    GROUP BY substr(submitted_at, 1, 10)
  `, [previousStartKey, currentEndKey]);
  const countsByDate = new Map(rows.map(row => [row.date, Number(row.count || 0)]));
  const points = [];
  let currentTotal = 0;
  let previousTotal = 0;

  for (let offset = 0; offset < rangeDays * 2; offset += 1) {
    const date = addUtcDays(previousStart, offset);
    const count = countsByDate.get(toUtcDateKey(date)) || 0;
    if (offset < rangeDays) previousTotal += count;
    else {
      currentTotal += count;
      points.push({ date: toUtcDateKey(date), count });
    }
  }

  return {
    rangeDays,
    currentTotal,
    previousTotal,
    growthPercent: previousTotal > 0 ? Number((((currentTotal - previousTotal) / previousTotal) * 100).toFixed(1)) : null,
    points
  };
}

function responseHeatmapLevel(count, maxDailyCount) {
  const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
  const safeMax = Number.isFinite(maxDailyCount) && maxDailyCount > 0 ? maxDailyCount : 0;
  if (!safeCount || !safeMax) return 0;
  if (safeMax === 1) return 4;
  const ratio = safeCount / safeMax;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

async function buildResponseHeatmap(now = new Date()) {
  const { currentStart, currentEnd } = getResponseActivityWindow(RESPONSE_HEATMAP_DAYS, now);
  const rows = await dbAll(`
    SELECT substr(submitted_at, 1, 10) AS date, COUNT(*) AS count
    FROM responses
    WHERE submitted_at >= ? AND submitted_at < ?
    GROUP BY substr(submitted_at, 1, 10)
  `, [toSqlUtcTimestamp(currentStart), toSqlUtcTimestamp(currentEnd)]);
  const countsByDate = new Map(rows.map(row => [row.date, Number(row.count || 0)]));
  const rawDays = Array.from({ length: RESPONSE_HEATMAP_DAYS }, (_, offset) => {
    const date = toUtcDateKey(addUtcDays(currentStart, offset));
    return { date, count: countsByDate.get(date) || 0 };
  });
  const maxDailyCount = Math.max(0, ...rawDays.map(day => day.count));
  const days = rawDays.map(day => ({ ...day, level: responseHeatmapLevel(day.count, maxDailyCount) }));
  return {
    startDate: days[0].date,
    endDate: days[days.length - 1].date,
    totalResponses: days.reduce((total, day) => total + day.count, 0),
    maxDailyCount,
    days
  };
}

function getResponsePulseWindow(now = new Date()) {
  const current = new Date(now);
  const todayStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  return {
    todayStart,
    tomorrowStart: addUtcDays(todayStart, 1),
    lastHourStart: new Date(current.getTime() - (60 * 60 * 1000))
  };
}

function toSqlUtcTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function sqliteTimestampToIso(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const timestamp = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

async function buildResponsePulse(now = new Date()) {
  const { todayStart, tomorrowStart, lastHourStart } = getResponsePulseWindow(now);
  const summary = await dbGet(`
    SELECT
      COUNT(*) AS total_responses,
      COALESCE(SUM(CASE WHEN submitted_at >= ? AND submitted_at < ? THEN 1 ELSE 0 END), 0) AS today_count,
      COALESCE(SUM(CASE WHEN submitted_at >= ? THEN 1 ELSE 0 END), 0) AS last_hour_count,
      MAX(submitted_at) AS latest_response_at
    FROM responses
  `, [
    toSqlUtcTimestamp(todayStart),
    toSqlUtcTimestamp(tomorrowStart),
    toSqlUtcTimestamp(lastHourStart)
  ]);
  const activeSurveyRow = await dbGet("SELECT COUNT(*) AS count FROM surveys WHERE status = 'active'");
  return {
    totalResponses: Number(summary?.total_responses || 0),
    todayCount: Number(summary?.today_count || 0),
    lastHourCount: Number(summary?.last_hour_count || 0),
    latestResponseAt: sqliteTimestampToIso(summary?.latest_response_at),
    activeSurveyCount: Number(activeSurveyRow?.count || 0)
  };
}

const RESEARCH_HEALTH_WEIGHTS = Object.freeze({ readiness: 25, collection: 35, deadline: 20, recentActivity: 20 });

function clampUnit(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function researchHealthLabel(score) {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Healthy';
  if (score >= 50) return 'Needs Attention';
  return 'At Risk';
}

function calculateResearchHealth(components) {
  const available = Object.values(components).filter(component => component && component.normalized !== null && component.normalized !== undefined);
  const availableWeight = available.reduce((total, component) => total + component.weight, 0);
  const weightedScore = available.reduce((total, component) => total + (clampUnit(component.normalized) * component.weight), 0);
  const score = availableWeight ? Math.round((weightedScore / availableWeight) * 100) : 0;
  return {
    score: Math.max(0, Math.min(100, score)),
    availableWeight,
    limitedData: available.length <= 1
  };
}

function healthComponent(normalized, weight) {
  return normalized === null || normalized === undefined
    ? { score: null, weight, available: false, normalized: null }
    : { score: Math.round(clampUnit(normalized) * 100), weight, available: true, normalized: clampUnit(normalized) };
}

function deadlineRunwayNormalized(deadline, targetResponses, responseCount, nowMs = Date.now()) {
  if (!deadline || !Number.isFinite(Date.parse(deadline))) return null;
  if (Number.isSafeInteger(targetResponses) && targetResponses > 0 && responseCount >= targetResponses) return 1;
  const daysRemaining = calculateDaysRemaining(deadline, nowMs);
  if (Date.parse(deadline) <= nowMs) return 0;
  if (daysRemaining > 14) return 1;
  if (daysRemaining >= 8) return 0.85;
  if (daysRemaining >= 4) return 0.65;
  if (daysRemaining >= 2) return 0.4;
  if (daysRemaining === 1) return 0.2;
  return 0.1;
}

function recentActivityNormalized(currentCount, previousCount, totalCount) {
  if (currentCount > 0 && previousCount === 0) return 1;
  if (currentCount > 0 && currentCount >= previousCount) return 1;
  if (currentCount > 0 && currentCount >= previousCount * 0.5) return 0.7;
  if (currentCount > 0) return 0.4;
  if (totalCount > 0) return 0.15;
  return 0;
}

function highestTargetMilestone(responseCount, targetResponses) {
  const responses = Number(responseCount);
  const target = Number(targetResponses);
  if (!Number.isFinite(responses) || responses < 0 || !Number.isSafeInteger(target) || target < 1) return null;
  const progress = (responses / target) * 100;
  return TARGET_MILESTONES.reduce((highest, milestone) => progress >= milestone ? milestone : highest, null);
}

function buildAchievementBadges(survey, questions, recentCounts = {}, nowMs = Date.now()) {
  const responseCount = Number(survey.response_count || 0);
  const targetResponses = Number.isSafeInteger(survey.target_responses) ? survey.target_responses : null;
  const deadlineMs = Date.parse(survey.response_deadline || '');
  const currentCount = Number(recentCounts.currentCount || 0);
  const previousCount = Number(recentCounts.previousCount || 0);
  const readiness = computeReadiness(survey, questions || []);
  const conditions = {
    target_reached: Boolean(targetResponses && responseCount >= targetResponses),
    closing_soon: survey.status === 'active' && Number.isFinite(deadlineMs) && deadlineMs > nowMs && deadlineMs - nowMs <= ATTENTION_APPROACHING_DEADLINE_DAYS * DAY_IN_MS,
    fast_growth: currentCount >= 5 && previousCount > 0 && currentCount >= previousCount * 1.5,
    high_activity: currentCount >= 10,
    fully_ready: readiness.ready
  };
  return ACHIEVEMENT_BADGE_DEFINITIONS
    .filter(definition => conditions[definition.id])
    .map(definition => ({ ...definition }));
}

function buildSurveyAchievements(surveys, questionsBySurvey, responseCountsBySurvey, nowMs = Date.now()) {
  return surveys
    .filter(survey => !survey.is_archived)
    .map(survey => {
      const responseCount = Number(survey.response_count || 0);
      const targetResponses = Number.isSafeInteger(survey.target_responses) ? survey.target_responses : null;
      const recent = responseCountsBySurvey.get(Number(survey.id)) || { currentCount: 0, previousCount: 0, totalCount: responseCount };
      return {
        surveyId: survey.id,
        title: survey.title,
        status: survey.status,
        responseCount,
        targetResponses,
        highestTargetMilestone: highestTargetMilestone(responseCount, targetResponses),
        badges: buildAchievementBadges(survey, questionsBySurvey.get(survey.id) || [], recent, nowMs)
      };
    })
    .sort((a, b) => {
      const priorityDifference = (b.badges[0]?.priority || 0) - (a.badges[0]?.priority || 0);
      return priorityDifference || a.title.localeCompare(b.title) || a.surveyId - b.surveyId;
    });
}

async function buildMilestoneSurveySnapshot(now = new Date()) {
  const surveys = await dbAll(`
    SELECT s.id, s.title, s.description, s.status, s.is_archived, s.response_deadline, s.response_limit, s.target_responses,
      COUNT(r.id) AS response_count
    FROM surveys s
    LEFT JOIN responses r ON s.id = r.survey_id
    WHERE s.is_archived = 0 AND s.target_responses IS NOT NULL
    GROUP BY s.id
  `);
  const surveyIds = surveys.map(survey => survey.id);
  const questions = surveyIds.length
    ? await dbAll(`SELECT id, survey_id, question_text, question_type, options_json, is_required, sort_order
      FROM questions WHERE survey_id IN (${surveyIds.map(() => '?').join(', ')}) ORDER BY survey_id, sort_order, id`, surveyIds)
    : [];
  const questionsBySurvey = new Map();
  questions.forEach(question => {
    const items = questionsBySurvey.get(question.survey_id) || [];
    items.push(question);
    questionsBySurvey.set(question.survey_id, items);
  });
  const responseCounts = await getResearchHealthResponseCounts(surveyIds, now);
  return buildSurveyAchievements(surveys, questionsBySurvey, responseCounts, now.getTime());
}

function researchHealthSummary(survey, nowMs = Date.now()) {
  const responses = Number(survey.response_count || 0);
  const target = Number.isSafeInteger(survey.target_responses) ? survey.target_responses : null;
  const deadline = survey.response_deadline && Number.isFinite(Date.parse(survey.response_deadline)) ? survey.response_deadline : null;
  const responseText = target ? `${responses} of ${target} target responses` : `${responses} accepted response${responses === 1 ? '' : 's'}`;
  if (!deadline) return target ? `${responseText}; no deadline configured.` : `${responseText}; no target or deadline configured.`;
  if (Date.parse(deadline) <= nowMs) return `${responseText}; deadline has passed.`;
  const daysRemaining = calculateDaysRemaining(deadline, nowMs);
  return `${responseText} with ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining.`;
}

async function getResearchHealthResponseCounts(surveyIds, now = new Date()) {
  if (!surveyIds.length) return new Map();
  const { currentStart, currentEnd, previousStart } = getResponseActivityWindow(7, now);
  const rows = await dbAll(`
    SELECT survey_id,
      COALESCE(SUM(CASE WHEN submitted_at >= ? AND submitted_at < ? THEN 1 ELSE 0 END), 0) AS current_count,
      COALESCE(SUM(CASE WHEN submitted_at >= ? AND submitted_at < ? THEN 1 ELSE 0 END), 0) AS previous_count,
      COUNT(*) AS total_count
    FROM responses
    WHERE survey_id IN (${surveyIds.map(() => '?').join(', ')})
    GROUP BY survey_id
  `, [
    toSqlUtcTimestamp(currentStart), toSqlUtcTimestamp(currentEnd),
    toSqlUtcTimestamp(previousStart), toSqlUtcTimestamp(currentStart),
    ...surveyIds
  ]);
  return new Map(rows.map(row => [Number(row.survey_id), {
    currentCount: Number(row.current_count || 0),
    previousCount: Number(row.previous_count || 0),
    totalCount: Number(row.total_count || 0)
  }]));
}

function buildResearchHealth(surveys, questionsBySurvey, responseCountsBySurvey, nowMs = Date.now()) {
  return surveys
    .filter(survey => survey.status === 'active' && !survey.is_archived)
    .map(survey => {
      const responseCount = Number(survey.response_count || 0);
      const targetResponses = Number.isSafeInteger(survey.target_responses) ? survey.target_responses : null;
      const readiness = computeReadiness(survey, questionsBySurvey.get(survey.id) || []);
      const recent = responseCountsBySurvey.get(Number(survey.id)) || { currentCount: 0, previousCount: 0, totalCount: 0 };
      const components = {
        readiness: healthComponent(readiness.percentage / 100, RESEARCH_HEALTH_WEIGHTS.readiness),
        collection: healthComponent(targetResponses ? responseCount / targetResponses : null, RESEARCH_HEALTH_WEIGHTS.collection),
        deadline: healthComponent(deadlineRunwayNormalized(survey.response_deadline, targetResponses, responseCount, nowMs), RESEARCH_HEALTH_WEIGHTS.deadline),
        recentActivity: healthComponent(recentActivityNormalized(recent.currentCount, recent.previousCount, recent.totalCount), RESEARCH_HEALTH_WEIGHTS.recentActivity)
      };
      const calculated = calculateResearchHealth(components);
      Object.values(components).forEach(component => { delete component.normalized; });
      return {
        surveyId: survey.id,
        title: survey.title,
        score: calculated.score,
        label: researchHealthLabel(calculated.score),
        availableWeight: calculated.availableWeight,
        limitedData: calculated.limitedData,
        components,
        summary: researchHealthSummary(survey, nowMs)
      };
    })
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title) || a.surveyId - b.surveyId);
}

function buildAttentionItems(surveys, questionsBySurvey, nowMs = Date.now()) {
  const items = [];
  const add = (survey, type, severity, message, extra = {}) => {
    const responseCount = Number(survey.response_count || 0);
    const targetResponses = Number.isSafeInteger(survey.target_responses) ? survey.target_responses : null;
    const responseLimit = Number.isSafeInteger(survey.response_limit) ? survey.response_limit : null;
    items.push({
      surveyId: survey.id,
      title: survey.title,
      type,
      severity,
      message,
      responseCount,
      targetResponses,
      responseLimit,
      deadline: survey.response_deadline || null,
      daysRemaining: calculateDaysRemaining(survey.response_deadline, nowMs),
      progressPercent: targetResponses ? Math.min(100, Math.round((responseCount / targetResponses) * 100)) : null,
      ...extra
    });
  };

  for (const survey of surveys) {
    const responseCount = Number(survey.response_count || 0);
    const target = Number.isSafeInteger(survey.target_responses) ? survey.target_responses : null;
    const limit = Number.isSafeInteger(survey.response_limit) ? survey.response_limit : null;
    const deadlineMs = Date.parse(survey.response_deadline || '');
    const hasDeadline = Number.isFinite(deadlineMs);
    const daysRemaining = hasDeadline ? calculateDaysRemaining(survey.response_deadline, nowMs) : null;

    if (survey.status === 'active' && hasDeadline && deadlineMs <= nowMs) {
      add(survey, 'deadline_passed', 'critical', 'Response deadline has passed.');
    }
    if (survey.status === 'active' && hasDeadline && deadlineMs > nowMs && daysRemaining <= ATTENTION_APPROACHING_DEADLINE_DAYS) {
      add(survey, 'deadline_approaching', 'warning', `Response deadline is within ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`);
    }
    if (survey.status === 'active' && target && responseCount >= target) {
      add(survey, 'target_achieved', 'success', `Target reached: ${responseCount} / ${target} responses.`);
    }
    if (survey.status === 'active' && target && hasDeadline && deadlineMs > nowMs && daysRemaining <= ATTENTION_BEHIND_TARGET_DAYS && responseCount / target < 0.75) {
      const severity = daysRemaining <= ATTENTION_APPROACHING_DEADLINE_DAYS ? 'high' : 'warning';
      add(survey, 'behind_target_near_deadline', severity, `Below target: ${responseCount} / ${target} responses with ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining.`);
    }
    if (survey.status === 'active' && limit && responseCount < limit && responseCount / limit >= ATTENTION_CAPACITY_WARNING_PERCENT / 100) {
      add(survey, 'capacity_almost_full', 'warning', `Response capacity is nearly full: ${responseCount} / ${limit}.`);
    }
    if (survey.status === 'draft') {
      const readiness = computeReadiness(survey, questionsBySurvey.get(survey.id) || []);
      if (!readiness.ready) {
        add(survey, 'draft_not_ready', 'warning', `${readiness.blocking.length} publishing check${readiness.blocking.length === 1 ? '' : 's'} still need attention.`, { readinessPercentage: readiness.percentage });
      }
    }
  }

  const severityOrder = { critical: 0, high: 1, warning: 2, success: 3 };
  return items.sort((a, b) => {
    const severityDifference = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDifference) return severityDifference;
    const aDeadline = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
    const bDeadline = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
    if (aDeadline !== bDeadline) return aDeadline - bDeadline;
    const titleDifference = a.title.localeCompare(b.title);
    return titleDifference || a.surveyId - b.surveyId;
  });
}

function buildUpcomingResearch(surveys, nowMs = Date.now(), limit = 5) {
  const items = surveys
    .filter(survey => survey.status === 'active' && !survey.is_archived)
    .filter(survey => survey.response_deadline || Number.isSafeInteger(survey.target_responses))
    .map(survey => {
      const responseCount = Number(survey.response_count || 0);
      const targetResponses = Number.isSafeInteger(survey.target_responses) ? survey.target_responses : null;
      const deadline = survey.response_deadline || null;
      const deadlineMs = Date.parse(deadline || '');
      const hasDeadline = Number.isFinite(deadlineMs);
      const deadlinePassed = hasDeadline && deadlineMs <= nowMs;
      const daysRemaining = hasDeadline ? calculateDaysRemaining(deadline, nowMs) : null;
      const progressPercent = targetResponses
        ? Number(Math.min(100, (responseCount / targetResponses) * 100).toFixed(1))
        : null;

      let status = 'collecting';
      if (deadlinePassed) status = 'deadline_passed';
      else if (targetResponses && responseCount >= targetResponses) status = 'target_reached';
      else if (targetResponses && hasDeadline && daysRemaining <= ATTENTION_BEHIND_TARGET_DAYS && progressPercent < 75) status = 'needs_attention';
      else if (targetResponses && progressPercent >= 90) status = 'almost_there';
      else if (targetResponses) status = 'on_track';

      return {
        surveyId: survey.id,
        title: survey.title,
        responseCount,
        targetResponses,
        progressPercent,
        deadline,
        daysRemaining,
        status
      };
    });

  const groupFor = item => {
    if (item.status === 'deadline_passed') return 0;
    if (item.deadline) return 1;
    return 2;
  };
  return items.sort((a, b) => {
    const groupDifference = groupFor(a) - groupFor(b);
    if (groupDifference) return groupDifference;
    if (groupFor(a) === 1) {
      const deadlineDifference = Date.parse(a.deadline) - Date.parse(b.deadline);
      if (deadlineDifference) return deadlineDifference;
    }
    if (groupFor(a) === 2) {
      const progressDifference = (a.progressPercent ?? Number.POSITIVE_INFINITY) - (b.progressPercent ?? Number.POSITIVE_INFINITY);
      if (progressDifference) return progressDifference;
    }
    const titleDifference = a.title.localeCompare(b.title);
    return titleDifference || a.surveyId - b.surveyId;
  }).slice(0, limit);
}

async function getSurveyResponseCount(surveyId) {
  const row = await dbGet('SELECT COUNT(*) AS count FROM responses WHERE survey_id = ?', [surveyId]);
  return row ? row.count : 0;
}

function responseLimitReachedPayload(survey, responseCount) {
  return {
    id: survey.id,
    title: survey.title,
    status: survey.status,
    response_limit: survey.response_limit,
    response_count: responseCount,
    code: 'SURVEY_RESPONSE_LIMIT_REACHED',
    error: 'This survey has reached its maximum number of responses and is no longer accepting submissions.'
  };
}

let responseSubmissionQueue = Promise.resolve();
function serializeResponseSubmission(task) {
  const result = responseSubmissionQueue.then(task, task);
  responseSubmissionQueue = result.catch(() => undefined);
  return result;
}

/* ==========================================================================
   1. AUTHENTICATION API
   ========================================================================== */

/**
 * POST /api/auth/login
 * Verifies email and password, creates user session
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, accessMode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await dbGet(
      'SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );
    const isValid = user && verifyPassword(password, user.password_hash);
    if (!isValid || Number(user.is_active) !== 1 || !isValidUserRole(user.role)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (accessMode !== undefined && (!isValidUserRole(accessMode) || accessMode !== user.role)) {
      return res.status(403).json({ error: 'This account is not authorized for the selected access type.' });
    }

    // Store only the minimal trusted identity. Name/email are always read from
    // the active database record rather than retained in a browser session.
    req.session.userId = user.id;
    req.session.userRole = user.role;
    delete req.session.userName;
    delete req.session.userEmail;
    await dbRun('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    return res.json({
      success: true,
      user: safeUser(user)
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error during authentication' });
  }
});

/**
 * POST /api/auth/logout
 * Destroys current admin session
 */
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true, message: 'Logged out successfully' });
  });
});

/**
 * GET /api/auth/me
 * Checks current session state
 */
app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await getActiveSessionUser(req);
    if (!user) {
      invalidateSession(req);
      return res.json({ authenticated: false });
    }
    return res.json({ authenticated: true, user: safeUser(user) });
  } catch (err) {
    return res.json({ authenticated: false });
  }
});

// Current workspace APIs were historically administrator-only. Keep that
// authorization on the server so a team member cannot gain capabilities by
// altering the UI or request payload. Public respondent routes stay outside.
app.use([
  '/api/dashboard',
  '/api/surveys',
  '/api/workspace',
  '/api/collections',
  '/api/templates',
  '/api/activity',
  '/api/saved-views'
], requireAdmin);

/* ===========================================================================
   1B. ADMINISTRATOR TEAM MANAGEMENT API
   =========================================================================== */

app.get('/api/team-members', requireAdmin, async (req, res) => {
  try {
    const members = await dbAll(
      `SELECT id, name, email, role, is_active, created_at, updated_at, last_login_at
       FROM users WHERE role = ? ORDER BY is_active DESC, name COLLATE NOCASE ASC`,
      [USER_ROLES.TEAM_MEMBER]
    );
    return res.json({ teamMembers: members.map(safeTeamMember) });
  } catch (_) {
    return res.status(500).json({ error: 'Unable to load team members.' });
  }
});

app.post('/api/team-members', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (role !== undefined && role !== USER_ROLES.TEAM_MEMBER) return res.status(400).json({ error: 'New accounts can only be created as team members.' });
    const normalizedName = normalizeTeamMemberName(name);
    const normalizedEmail = normalizeTeamMemberEmail(email);
    if (normalizedName.error || normalizedEmail.error) return res.status(400).json({ error: normalizedName.error || normalizedEmail.error });
    const generatedPassword = password === undefined || password === null || password === '';
    const temporaryPassword = generatedPassword ? generateTemporaryPassword() : password;
    const normalizedPassword = normalizeTeamMemberPassword(temporaryPassword);
    if (normalizedPassword.error) return res.status(400).json({ error: normalizedPassword.error });
    const member = await createUserAccount({ name: normalizedName.value, email: normalizedEmail.value, password: normalizedPassword.value, role: USER_ROLES.TEAM_MEMBER, createdByUserId: req.currentUser.id, mustChangePassword: true });
    await recordActivity('team_member_created', null, { teamMemberId: member.id, email: member.email });
    return res.status(201).json({ member: safeTeamMember(member), ...(generatedPassword ? { temporaryPassword } : {}) });
  } catch (error) {
    if (isUniqueConstraintError(error)) return res.status(409).json({ error: 'A member with that email already exists.' });
    return res.status(400).json({ error: error.message || 'Unable to create team member.' });
  }
});

app.put('/api/team-members/:id', requireAdmin, async (req, res) => {
  try {
    const memberId = parsePositiveId(req.params.id);
    if (!memberId) return res.status(400).json({ error: 'A valid team member ID is required.' });
    if (req.body && req.body.role !== undefined && req.body.role !== USER_ROLES.TEAM_MEMBER) return res.status(400).json({ error: 'Team member roles cannot be changed here.' });
    if (!await findTeamMember(memberId)) return res.status(404).json({ error: 'Team member not found.' });
    const normalizedName = normalizeTeamMemberName(req.body && req.body.name);
    const normalizedEmail = normalizeTeamMemberEmail(req.body && req.body.email);
    if (normalizedName.error || normalizedEmail.error) return res.status(400).json({ error: normalizedName.error || normalizedEmail.error });
    await dbRun('UPDATE users SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND role = ?', [normalizedName.value, normalizedEmail.value, memberId, USER_ROLES.TEAM_MEMBER]);
    const member = await findTeamMember(memberId);
    await recordActivity('team_member_updated', null, { teamMemberId: memberId, email: member.email });
    return res.json({ member: safeTeamMember(member) });
  } catch (error) {
    if (isUniqueConstraintError(error)) return res.status(409).json({ error: 'A member with that email already exists.' });
    return res.status(400).json({ error: 'Unable to update team member.' });
  }
});

async function setTeamMemberActive(req, res, isActive) {
  try {
    const memberId = parsePositiveId(req.params.id);
    if (!memberId) return res.status(400).json({ error: 'A valid team member ID is required.' });
    if (!await findTeamMember(memberId)) return res.status(404).json({ error: 'Team member not found.' });
    await dbRun('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND role = ?', [isActive ? 1 : 0, memberId, USER_ROLES.TEAM_MEMBER]);
    const member = await findTeamMember(memberId);
    await recordActivity(isActive ? 'team_member_enabled' : 'team_member_disabled', null, { teamMemberId: memberId, email: member.email });
    return res.json({ member: safeTeamMember(member) });
  } catch (_) {
    return res.status(500).json({ error: `Unable to ${isActive ? 'reactivate' : 'disable'} team member.` });
  }
}

app.post('/api/team-members/:id/disable', requireAdmin, (req, res) => setTeamMemberActive(req, res, false));
app.post('/api/team-members/:id/enable', requireAdmin, (req, res) => setTeamMemberActive(req, res, true));

app.post('/api/team-members/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const memberId = parsePositiveId(req.params.id);
    if (!memberId) return res.status(400).json({ error: 'A valid team member ID is required.' });
    const existing = await findTeamMember(memberId);
    if (!existing) return res.status(404).json({ error: 'Team member not found.' });
    const suppliedPassword = req.body && req.body.password;
    const generatedPassword = suppliedPassword === undefined || suppliedPassword === null || suppliedPassword === '';
    const temporaryPassword = generatedPassword ? generateTemporaryPassword() : suppliedPassword;
    const normalizedPassword = normalizeTeamMemberPassword(temporaryPassword);
    if (normalizedPassword.error) return res.status(400).json({ error: normalizedPassword.error });
    await dbRun(`UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND role = ?`, [hashPassword(normalizedPassword.value), memberId, USER_ROLES.TEAM_MEMBER]);
    await recordActivity('team_member_password_reset', null, { teamMemberId: memberId, email: existing.email });
    return res.json({ member: safeTeamMember(await findTeamMember(memberId)), ...(generatedPassword ? { temporaryPassword } : {}) });
  } catch (_) {
    return res.status(500).json({ error: 'Unable to reset team member password.' });
  }
});

/* ==========================================================================
   2. DASHBOARD API
   ========================================================================== */

/**
 * GET /api/dashboard
 * Aggregates high-level survey statistics and recent surveys for the admin overview
 */
app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const requestedAttentionLimit = parsePositiveId(req.query.attentionLimit);
    const attentionLimit = requestedAttentionLimit ? Math.min(requestedAttentionLimit, 100) : ATTENTION_ITEM_LIMIT;
    const requestedUpcomingLimit = parsePositiveId(req.query.upcomingLimit);
    const upcomingLimit = requestedUpcomingLimit ? Math.min(requestedUpcomingLimit, 100) : 5;
    const requestedRange = Number.parseInt(req.query.range, 10);
    const responseActivityRange = RESPONSE_ACTIVITY_RANGES.has(requestedRange) ? requestedRange : 7;
    const totalSurveysRow = await dbGet('SELECT COUNT(*) AS count FROM surveys');
    const activeSurveysRow = await dbGet("SELECT COUNT(*) AS count FROM surveys WHERE status = 'active'");
    const closedSurveysRow = await dbGet("SELECT COUNT(*) AS count FROM surveys WHERE status = 'closed'");
    const totalResponsesRow = await dbGet('SELECT COUNT(*) AS count FROM responses');

    // Fetch recent 5 surveys with response counts
    const recentSurveys = await dbAll(`
      SELECT 
        s.id, 
        s.title, 
        s.description, 
        s.status, 
        s.response_deadline,
        s.response_limit,
        s.one_response_per_browser,
        s.created_at,
        COUNT(r.id) AS response_count
      FROM surveys s
      LEFT JOIN responses r ON s.id = r.survey_id
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 5
    `);

    const attentionSurveys = await dbAll(`
      SELECT s.id, s.title, s.description, s.status, s.is_archived, s.response_deadline, s.response_limit, s.target_responses,
        COUNT(r.id) AS response_count
      FROM surveys s
      LEFT JOIN responses r ON s.id = r.survey_id
      WHERE s.is_archived = 0
      GROUP BY s.id
    `);
    const attentionSurveyIds = attentionSurveys.map(survey => survey.id);
    const attentionQuestions = attentionSurveyIds.length
      ? await dbAll(`SELECT id, survey_id, question_text, question_type, options_json, is_required, sort_order
        FROM questions WHERE survey_id IN (${attentionSurveyIds.map(() => '?').join(', ')}) ORDER BY survey_id, sort_order, id`, attentionSurveyIds)
      : [];
    const questionsBySurvey = new Map();
    attentionQuestions.forEach(question => {
      const questions = questionsBySurvey.get(question.survey_id) || [];
      questions.push(question);
      questionsBySurvey.set(question.survey_id, questions);
    });
    const now = new Date();
    const allAttentionItems = buildAttentionItems(attentionSurveys, questionsBySurvey, now.getTime());
    const upcomingResearchBase = buildUpcomingResearch(attentionSurveys, now.getTime(), upcomingLimit);
    const responseActivity = await buildResponseActivity(responseActivityRange);
    const responseHeatmap = await buildResponseHeatmap();
    const responsePulse = await buildResponsePulse();
    const researchHealthResponseCounts = await getResearchHealthResponseCounts(attentionSurveyIds, now);
    const researchHealth = buildResearchHealth(attentionSurveys, questionsBySurvey, researchHealthResponseCounts);
    const surveyAchievements = buildSurveyAchievements(attentionSurveys, questionsBySurvey, researchHealthResponseCounts, now.getTime());
    const achievementsBySurvey = new Map(surveyAchievements.map(item => [Number(item.surveyId), item]));
    const upcomingResearch = upcomingResearchBase.map(item => ({ ...item, badges: achievementsBySurvey.get(Number(item.surveyId))?.badges || [] }));
    const decoratedRecentSurveys = recentSurveys.map(survey => ({
      ...survey,
      badges: achievementsBySurvey.get(Number(survey.id))?.badges || [],
      highestTargetMilestone: achievementsBySurvey.get(Number(survey.id))?.highestTargetMilestone ?? null
    }));
    const decoratedResearchHealth = researchHealth.map(item => ({ ...item, badges: achievementsBySurvey.get(Number(item.surveyId))?.badges || [] }));

    return res.json({
      totalSurveys: totalSurveysRow ? totalSurveysRow.count : 0,
      activeSurveys: activeSurveysRow ? activeSurveysRow.count : 0,
      closedSurveys: closedSurveysRow ? closedSurveysRow.count : 0,
      totalResponses: totalResponsesRow ? totalResponsesRow.count : 0,
      recentSurveys: decoratedRecentSurveys,
      attentionItems: allAttentionItems.slice(0, attentionLimit),
      totalAttentionItems: allAttentionItems.length,
      upcomingResearch,
      responseActivity,
      responseHeatmap,
      responsePulse,
      researchHealth: decoratedResearchHealth,
      surveyAchievements
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard metrics' });
  }
});

app.get('/api/dashboard/pulse', requireAuth, async (_req, res) => {
  try {
    const now = new Date();
    const pulse = await buildResponsePulse(now);
    return res.json({ ...pulse, milestoneSurveys: await buildMilestoneSurveySnapshot(now) });
  } catch (err) {
    console.error('Dashboard response pulse error:', err);
    return res.status(500).json({ error: 'Failed to load response pulse' });
  }
});

/* ==========================================================================
   3. SURVEYS MANAGEMENT API (Admin)
   ========================================================================== */

/**
 * GET /api/surveys
 * List all surveys with status and response count
 */
app.get('/api/surveys', requireAuth, async (req, res) => {
  try {
    const archived = req.query.archived === 'true' ? 1 : 0;
    const pinnedOnly = req.query.pinned === 'true';
    const collectionId = req.query.collection_id ? parsePositiveId(req.query.collection_id) : null;
    if (req.query.collection_id && !collectionId) return res.status(400).json({ error: 'Collection filter must be a valid ID.' });
    const where = ['s.is_archived = ?'];
    const params = [archived];
    if (pinnedOnly) where.push('s.is_pinned = 1');
    if (collectionId) { where.push('s.collection_id = ?'); params.push(collectionId); }
    const surveys = await dbAll(`
      SELECT 
        s.id, 
        s.title, 
        s.description, 
        s.status, 
        s.response_deadline,
        s.response_limit,
        s.one_response_per_browser,
        s.collection_id,
        s.is_archived,
        s.is_pinned,
        s.target_responses,
        s.created_at,
        s.updated_at,
        c.name AS collection_name,
        COUNT(r.id) AS response_count
      FROM surveys s
      LEFT JOIN collections c ON c.id = s.collection_id
      LEFT JOIN responses r ON s.id = r.survey_id
      WHERE ${where.join(' AND ')}
      GROUP BY s.id
      ORDER BY s.is_pinned DESC, s.updated_at DESC, s.created_at DESC
    `, params);
    return res.json(surveys.map(survey => ({ ...survey, ...calculateCollectionState(survey) })));
  } catch (err) {
    console.error('Surveys list error:', err);
    return res.status(500).json({ error: 'Failed to retrieve surveys' });
  }
});

/* ========================================================================
   RESEARCH WORKSPACE API (admin only)
   ======================================================================== */

app.get('/api/workspace', requireAuth, async (req, res) => {
  try {
    const summary = await dbGet(`SELECT
      COUNT(*) AS total_studies,
      SUM(CASE WHEN is_archived = 0 AND status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN is_archived = 0 AND status = 'draft' THEN 1 ELSE 0 END) AS drafts,
      SUM(CASE WHEN is_archived = 0 AND status = 'closed' THEN 1 ELSE 0 END) AS closed
      FROM surveys`);
    const responseTotal = await dbGet('SELECT COUNT(*) AS total_responses FROM responses');
    const tracked = await dbAll(`SELECT s.*, COUNT(r.id) AS response_count
      FROM surveys s LEFT JOIN responses r ON r.survey_id = s.id
      WHERE s.is_archived = 0 GROUP BY s.id`);
    const states = tracked.map(calculateCollectionState);
    return res.json({
      total_studies: summary.total_studies || 0,
      active: summary.active || 0,
      drafts: summary.drafts || 0,
      closed: summary.closed || 0,
      total_responses: responseTotal.total_responses || 0,
      near_target: states.filter(item => item.collection_state === 'Near target').length,
      ending_soon: states.filter(item => item.ending_soon).length
    });
  } catch (err) {
    console.error('Workspace summary error:', err);
    return res.status(500).json({ error: 'Failed to load workspace summary.' });
  }
});

app.get('/api/collections', requireAuth, async (req, res) => {
  try {
    const collections = await dbAll(`SELECT c.*, COUNT(s.id) AS survey_count,
      SUM(CASE WHEN s.status = 'active' AND s.is_archived = 0 THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN s.status = 'draft' AND s.is_archived = 0 THEN 1 ELSE 0 END) AS draft_count,
      SUM(CASE WHEN s.status = 'closed' AND s.is_archived = 0 THEN 1 ELSE 0 END) AS closed_count,
      COALESCE(SUM((SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id)), 0) AS total_responses,
      MIN(CASE WHEN s.status = 'active' AND s.response_deadline IS NOT NULL AND datetime(s.response_deadline) > datetime('now') THEN s.response_deadline END) AS next_deadline
      FROM collections c LEFT JOIN surveys s ON s.collection_id = c.id
      GROUP BY c.id ORDER BY c.name COLLATE NOCASE ASC`);
    const unassigned = await dbGet(`SELECT COUNT(*) AS survey_count, COALESCE(SUM((SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id)), 0) AS total_responses
      FROM surveys s WHERE s.collection_id IS NULL AND s.is_archived = 0`);
    return res.json({ collections, unassigned: unassigned || { survey_count: 0, total_responses: 0 } });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load collections.' });
  }
});

app.post('/api/collections', requireAuth, async (req, res) => {
  try {
    const name = normalizeName(req.body.name, MAX_COLLECTION_NAME_LENGTH, 'Collection name');
    if (name.error) return res.status(400).json({ error: name.error });
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (description.length > MAX_COLLECTION_DESCRIPTION_LENGTH) return res.status(400).json({ error: `Collection description must not exceed ${MAX_COLLECTION_DESCRIPTION_LENGTH} characters.` });
    const result = await dbRun('INSERT INTO collections (name, description) VALUES (?, ?)', [name.value, description]);
    const collection = await dbGet('SELECT * FROM collections WHERE id = ?', [result.lastID]);
    await recordActivity('COLLECTION_CREATED', null, { collection_id: collection.id, name: collection.name });
    return res.status(201).json(collection);
  } catch (err) {
    return res.status(400).json({ error: 'Collection name already exists or could not be created.' });
  }
});

app.put('/api/collections/:id', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Collection ID must be valid.' });
    const existing = await dbGet('SELECT * FROM collections WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Collection not found.' });
    const name = normalizeName(req.body.name, MAX_COLLECTION_NAME_LENGTH, 'Collection name');
    if (name.error) return res.status(400).json({ error: name.error });
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (description.length > MAX_COLLECTION_DESCRIPTION_LENGTH) return res.status(400).json({ error: `Collection description must not exceed ${MAX_COLLECTION_DESCRIPTION_LENGTH} characters.` });
    await dbRun('UPDATE collections SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name.value, description, id]);
    const collection = await dbGet('SELECT * FROM collections WHERE id = ?', [id]);
    await recordActivity('COLLECTION_UPDATED', null, { collection_id: id, name: collection.name });
    return res.json(collection);
  } catch (_) { return res.status(400).json({ error: 'Collection could not be updated. Names must be unique.' }); }
});

app.delete('/api/collections/:id', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    const collection = id && await dbGet('SELECT * FROM collections WHERE id = ?', [id]);
    if (!collection) return res.status(404).json({ error: 'Collection not found.' });
    await dbRun('UPDATE surveys SET collection_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE collection_id = ?', [id]);
    await dbRun('DELETE FROM collections WHERE id = ?', [id]);
    await recordActivity('COLLECTION_DELETED', null, { collection_id: id, name: collection.name });
    return res.json({ success: true, message: 'Collection deleted; its surveys are now unassigned.' });
  } catch (_) { return res.status(500).json({ error: 'Failed to delete collection.' }); }
});

app.get('/api/surveys/:id/readiness', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    const survey = id && await dbGet('SELECT * FROM surveys WHERE id = ?', [id]);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const questions = await dbAll('SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order, id', [id]);
    return res.json(computeReadiness(survey, questions));
  } catch (_) { return res.status(500).json({ error: 'Failed to calculate survey readiness.' }); }
});

app.post('/api/surveys/:id/duplicate', requireAuth, async (req, res) => {
  const sourceId = parsePositiveId(req.params.id);
  try {
    const source = sourceId && await dbGet('SELECT * FROM surveys WHERE id = ?', [sourceId]);
    if (!source) return res.status(404).json({ error: 'Survey not found.' });
    const questions = await dbAll('SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order, id', [sourceId]);
    const copyTitle = typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim() : `Copy of ${source.title}`;
    if (copyTitle.length > 255) return res.status(400).json({ error: 'Survey title must not exceed 255 characters.' });
    const deadline = source.response_deadline && !isSurveyExpired(source.response_deadline) ? source.response_deadline : null;
    await dbRun('BEGIN TRANSACTION');
    try {
      const created = await dbRun(`INSERT INTO surveys (title, description, status, response_deadline, response_limit, one_response_per_browser, collection_id, is_archived, is_pinned, target_responses)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, 0, 0, ?)`, [copyTitle, source.description || '', deadline, source.response_limit || null, source.one_response_per_browser || 0, source.collection_id || null, source.target_responses || null]);
      for (const question of questions) await dbRun(`INSERT INTO questions (survey_id, question_text, question_type, options_json, is_required, sort_order) VALUES (?, ?, ?, ?, ?, ?)`, [created.lastID, question.question_text, question.question_type, question.options_json, question.is_required, question.sort_order]);
      await dbRun('COMMIT');
      await recordActivity('SURVEY_DUPLICATED', created.lastID, { source_survey_id: sourceId });
      return res.status(201).json({ id: created.lastID, title: copyTitle, status: 'draft' });
    } catch (err) { await dbRun('ROLLBACK'); throw err; }
  } catch (err) { return res.status(500).json({ error: 'Failed to duplicate survey.' }); }
});

function templatePayloadFromSurvey(survey, questions) {
  return {
    description: survey.description || '',
    response_limit: survey.response_limit || null,
    target_responses: survey.target_responses || null,
    one_response_per_browser: Boolean(survey.one_response_per_browser),
    questions: questions.map(question => ({
      question_text: question.question_text,
      question_type: question.question_type,
      options: safeJson(question.options_json, []),
      is_required: Boolean(question.is_required),
      sort_order: question.sort_order
    }))
  };
}

app.get('/api/templates', requireAuth, async (_req, res) => {
  try { return res.json(await dbAll('SELECT id, name, description, created_at, updated_at FROM survey_templates ORDER BY updated_at DESC, id DESC')); }
  catch (_) { return res.status(500).json({ error: 'Failed to load templates.' }); }
});

app.post('/api/surveys/:id/templates', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    const survey = id && await dbGet('SELECT * FROM surveys WHERE id = ?', [id]);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const name = normalizeName(req.body.name || `${survey.title} Template`, MAX_TEMPLATE_NAME_LENGTH, 'Template name');
    if (name.error) return res.status(400).json({ error: name.error });
    const questions = await dbAll('SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order, id', [id]);
    const result = await dbRun('INSERT INTO survey_templates (name, description, template_json) VALUES (?, ?, ?)', [name.value, typeof req.body.description === 'string' ? req.body.description.trim() : '', JSON.stringify(templatePayloadFromSurvey(survey, questions))]);
    const template = await dbGet('SELECT id, name, description, created_at, updated_at FROM survey_templates WHERE id = ?', [result.lastID]);
    await recordActivity('TEMPLATE_CREATED', id, { template_id: template.id, name: template.name });
    return res.status(201).json(template);
  } catch (_) { return res.status(500).json({ error: 'Failed to save survey as a template.' }); }
});

app.post('/api/templates/:id/create-survey', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    const template = id && await dbGet('SELECT * FROM survey_templates WHERE id = ?', [id]);
    if (!template) return res.status(404).json({ error: 'Template not found.' });
    const payload = safeJson(template.template_json, null);
    if (!payload || !Array.isArray(payload.questions)) return res.status(400).json({ error: 'Template data is invalid.' });
    const title = normalizeName(req.body.title || `New ${template.name}`, 255, 'Survey title');
    if (title.error) return res.status(400).json({ error: title.error });
    await dbRun('BEGIN TRANSACTION');
    try {
      const created = await dbRun(`INSERT INTO surveys (title, description, status, response_limit, target_responses, one_response_per_browser, is_archived, is_pinned)
        VALUES (?, ?, 'draft', ?, ?, ?, 0, 0)`, [title.value, payload.description || '', payload.response_limit || null, payload.target_responses || null, payload.one_response_per_browser ? 1 : 0]);
      for (let index = 0; index < payload.questions.length; index += 1) {
        const q = payload.questions[index];
        if (!VALID_QUESTION_TYPES.has(q.question_type) || !String(q.question_text || '').trim()) continue;
        const options = q.question_type === 'multiple_choice' ? JSON.stringify(Array.isArray(q.options) ? q.options : []) : null;
        await dbRun('INSERT INTO questions (survey_id, question_text, question_type, options_json, is_required, sort_order) VALUES (?, ?, ?, ?, ?, ?)', [created.lastID, String(q.question_text).trim(), q.question_type, options, q.is_required ? 1 : 0, Number.isSafeInteger(q.sort_order) ? q.sort_order : index]);
      }
      await dbRun('COMMIT');
      await recordActivity('SURVEY_CREATED', created.lastID, { template_id: id, source: 'template' });
      return res.status(201).json({ id: created.lastID, title: title.value, status: 'draft' });
    } catch (err) { await dbRun('ROLLBACK'); throw err; }
  } catch (_) { return res.status(500).json({ error: 'Failed to create survey from template.' }); }
});

app.put('/api/templates/:id', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    const template = id && await dbGet('SELECT id, name, description FROM survey_templates WHERE id = ?', [id]);
    if (!template) return res.status(404).json({ error: 'Template not found.' });
    const name = normalizeName(req.body.name, MAX_TEMPLATE_NAME_LENGTH, 'Template name');
    if (name.error) return res.status(400).json({ error: name.error });
    const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 1000) : template.description;
    await dbRun('UPDATE survey_templates SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name.value, description, id]);
    const updated = await dbGet('SELECT id, name, description, created_at, updated_at FROM survey_templates WHERE id = ?', [id]);
    await recordActivity('TEMPLATE_UPDATED', null, { template_id: id, name: updated.name });
    return res.json(updated);
  } catch (_) { return res.status(500).json({ error: 'Failed to update template.' }); }
});

app.delete('/api/templates/:id', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    const template = id && await dbGet('SELECT id, name FROM survey_templates WHERE id = ?', [id]);
    if (!template) return res.status(404).json({ error: 'Template not found.' });
    await dbRun('DELETE FROM survey_templates WHERE id = ?', [id]);
    await recordActivity('TEMPLATE_DELETED', null, { template_id: id, name: template.name });
    return res.json({ success: true });
  } catch (_) { return res.status(500).json({ error: 'Failed to delete template.' }); }
});

app.post('/api/surveys/:id/archive', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    const survey = id && await dbGet('SELECT * FROM surveys WHERE id = ?', [id]);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    if (survey.status === 'active') return res.status(400).json({ error: 'Close an active survey before archiving it.' });
    await dbRun('UPDATE surveys SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    await recordActivity('SURVEY_ARCHIVED', id);
    return res.json({ success: true, is_archived: 1 });
  } catch (_) { return res.status(500).json({ error: 'Failed to archive survey.' }); }
});

app.post('/api/surveys/:id/restore', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    const survey = id && await dbGet('SELECT id FROM surveys WHERE id = ?', [id]);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    await dbRun('UPDATE surveys SET is_archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    await recordActivity('SURVEY_RESTORED', id);
    return res.json({ success: true, is_archived: 0 });
  } catch (_) { return res.status(500).json({ error: 'Failed to restore survey.' }); }
});

app.post('/api/surveys/:id/pin', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id); const survey = id && await dbGet('SELECT id, is_pinned FROM surveys WHERE id = ?', [id]);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const pinned = req.body && req.body.pinned === false ? 0 : 1;
    await dbRun('UPDATE surveys SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [pinned, id]);
    await recordActivity(pinned ? 'SURVEY_PINNED' : 'SURVEY_UNPINNED', id);
    return res.json({ success: true, is_pinned: pinned });
  } catch (_) { return res.status(500).json({ error: 'Failed to update survey pin.' }); }
});

app.get('/api/surveys/:id/notes', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    const survey = id && await dbGet('SELECT id FROM surveys WHERE id = ?', [id]);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    return res.json(await dbAll('SELECT * FROM survey_notes WHERE survey_id = ? ORDER BY created_at DESC, id DESC', [id]));
  } catch (_) { return res.status(500).json({ error: 'Failed to load research notes.' }); }
});

app.post('/api/surveys/:id/notes', requireAuth, async (req, res) => {
  try {
    const surveyId = parsePositiveId(req.params.id);
    const survey = surveyId && await dbGet('SELECT id FROM surveys WHERE id = ?', [surveyId]);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const note = normalizeName(req.body.note_text, MAX_NOTE_LENGTH, 'Research note');
    if (note.error) return res.status(400).json({ error: note.error });
    const result = await dbRun('INSERT INTO survey_notes (survey_id, note_text) VALUES (?, ?)', [surveyId, note.value]);
    const created = await dbGet('SELECT * FROM survey_notes WHERE id = ?', [result.lastID]);
    await recordActivity('NOTE_CREATED', surveyId, { note_id: created.id });
    return res.status(201).json(created);
  } catch (_) { return res.status(500).json({ error: 'Failed to create research note.' }); }
});

app.put('/api/notes/:id', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id); const note = id && await dbGet('SELECT * FROM survey_notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Research note not found.' });
    const text = normalizeName(req.body.note_text, MAX_NOTE_LENGTH, 'Research note');
    if (text.error) return res.status(400).json({ error: text.error });
    await dbRun('UPDATE survey_notes SET note_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [text.value, id]);
    const updated = await dbGet('SELECT * FROM survey_notes WHERE id = ?', [id]);
    await recordActivity('NOTE_UPDATED', note.survey_id, { note_id: id });
    return res.json(updated);
  } catch (_) { return res.status(500).json({ error: 'Failed to update research note.' }); }
});

app.delete('/api/notes/:id', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id); const note = id && await dbGet('SELECT * FROM survey_notes WHERE id = ?', [id]);
    if (!note) return res.status(404).json({ error: 'Research note not found.' });
    await dbRun('DELETE FROM survey_notes WHERE id = ?', [id]);
    await recordActivity('NOTE_DELETED', note.survey_id, { note_id: id });
    return res.json({ success: true });
  } catch (_) { return res.status(500).json({ error: 'Failed to delete research note.' }); }
});

app.get('/api/activity', requireAuth, async (req, res) => {
  try {
    const limitValue = typeof req.query.limit === 'string' ? req.query.limit.trim() : '';
    const requested = /^[1-9]\d*$/.test(limitValue) ? Number(limitValue) : 20;
    const limit = Number.isSafeInteger(requested) ? Math.min(Math.max(requested, 1), 100) : 20;
    const rows = await dbAll(`SELECT a.*, s.title AS survey_title FROM activity_logs a LEFT JOIN surveys s ON s.id = a.survey_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT ?`, [limit]);
    return res.json(rows.map(row => {
      const details = safeJson(row.details_json, null);
      return {
        ...row,
        details,
        // Camel-case aliases support compact dashboard renderers while retaining
        // the existing activity-history fields for current callers.
        surveyId: row.survey_id || null,
        surveyTitle: row.survey_title || null,
        createdAt: row.created_at
      };
    }));
  } catch (_) { return res.status(500).json({ error: 'Failed to load activity history.' }); }
});

function validateSavedViewPayload(viewType, surveyId, filters) {
  if (!WORKSPACE_VIEW_TYPES.has(viewType) || !filters || typeof filters !== 'object' || Array.isArray(filters)) return { error: 'Saved view type or filters are invalid.' };
  if (viewType === 'workspace') {
    const allowed = new Set(['status', 'collection_id', 'archived', 'pinned', 'search', 'sort']);
    if (Object.keys(filters).some(key => !allowed.has(key))) return { error: 'Workspace view contains unsupported filters.' };
    if (filters.status && !['all', 'draft', 'active', 'closed'].includes(filters.status)) return { error: 'Workspace status filter is invalid.' };
    if (filters.collection_id && !parsePositiveId(filters.collection_id)) return { error: 'Workspace collection filter is invalid.' };
  }
  if (viewType === 'analytics') {
    if (!surveyId) return { error: 'Analytics saved views require a survey.' };
    const filter = parseDateFilters({ from: filters.from, to: filters.to });
    if (filter.error) return { error: filter.error };
  }
  return { value: filters };
}

app.get('/api/saved-views', requireAuth, async (req, res) => {
  try {
    const type = req.query.view_type;
    if (type && !WORKSPACE_VIEW_TYPES.has(type)) return res.status(400).json({ error: 'Saved view type is invalid.' });
    const surveyId = req.query.survey_id ? parsePositiveId(req.query.survey_id) : null;
    const where = []; const params = [];
    if (type) { where.push('view_type = ?'); params.push(type); }
    if (surveyId) { where.push('survey_id = ?'); params.push(surveyId); }
    const rows = await dbAll(`SELECT * FROM saved_views ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC`, params);
    return res.json(rows.map(row => ({ ...row, filters: safeJson(row.filters_json, {}) })));
  } catch (_) { return res.status(500).json({ error: 'Failed to load saved views.' }); }
});

app.post('/api/saved-views', requireAuth, async (req, res) => {
  try {
    const name = normalizeName(req.body.name, 100, 'Saved view name');
    if (name.error) return res.status(400).json({ error: name.error });
    const type = req.body.view_type;
    const surveyId = req.body.survey_id === undefined || req.body.survey_id === null ? null : parsePositiveId(req.body.survey_id);
    const validation = validateSavedViewPayload(type, surveyId, req.body.filters);
    if (validation.error) return res.status(400).json({ error: validation.error });
    if (surveyId && !await dbGet('SELECT id FROM surveys WHERE id = ?', [surveyId])) return res.status(404).json({ error: 'Survey not found.' });
    const result = await dbRun('INSERT INTO saved_views (name, view_type, survey_id, filters_json) VALUES (?, ?, ?, ?)', [name.value, type, surveyId, JSON.stringify(validation.value)]);
    const saved = await dbGet('SELECT * FROM saved_views WHERE id = ?', [result.lastID]);
    return res.status(201).json({ ...saved, filters: safeJson(saved.filters_json, {}) });
  } catch (_) { return res.status(500).json({ error: 'Failed to save view.' }); }
});

app.put('/api/saved-views/:id', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id); const existing = id && await dbGet('SELECT * FROM saved_views WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Saved view not found.' });
    const name = normalizeName(req.body.name === undefined ? existing.name : req.body.name, 100, 'Saved view name');
    if (name.error) return res.status(400).json({ error: name.error });
    const filters = req.body.filters === undefined ? safeJson(existing.filters_json, {}) : req.body.filters;
    const validation = validateSavedViewPayload(existing.view_type, existing.survey_id, filters);
    if (validation.error) return res.status(400).json({ error: validation.error });
    await dbRun('UPDATE saved_views SET name = ?, filters_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name.value, JSON.stringify(filters), id]);
    const saved = await dbGet('SELECT * FROM saved_views WHERE id = ?', [id]);
    return res.json({ ...saved, filters: safeJson(saved.filters_json, {}) });
  } catch (_) { return res.status(500).json({ error: 'Failed to update saved view.' }); }
});

app.delete('/api/saved-views/:id', requireAuth, async (req, res) => {
  try { const id = parsePositiveId(req.params.id); const result = id && await dbRun('DELETE FROM saved_views WHERE id = ?', [id]); if (!result || !result.changes) return res.status(404).json({ error: 'Saved view not found.' }); return res.json({ success: true }); }
  catch (_) { return res.status(500).json({ error: 'Failed to delete saved view.' }); }
});

app.get('/api/surveys/compare', requireAuth, async (req, res) => {
  try {
    const rawIds = String(req.query.ids || '').split(',').filter(Boolean);
    const ids = [...new Set(rawIds.map(parsePositiveId).filter(Boolean))];
    if (ids.length < 2 || ids.length > 4) return res.status(400).json({ error: 'Select between 2 and 4 valid surveys to compare.' });
    const placeholders = ids.map(() => '?').join(',');
    const surveys = await dbAll(`SELECT s.*, c.name AS collection_name, COUNT(r.id) AS response_count,
      MIN(r.submitted_at) AS first_response, MAX(r.submitted_at) AS latest_response
      FROM surveys s LEFT JOIN collections c ON c.id = s.collection_id LEFT JOIN responses r ON r.survey_id = s.id
      WHERE s.id IN (${placeholders}) GROUP BY s.id`, ids);
    if (surveys.length !== ids.length) return res.status(404).json({ error: 'One or more surveys were not found.' });
    const comparisons = [];
    for (const survey of surveys) {
      const rating = await dbGet(`SELECT AVG(CAST(a.answer_text AS REAL)) AS average_rating,
        SUM(CASE WHEN CAST(a.answer_text AS REAL) >= 4 THEN 1 ELSE 0 END) AS positive_count,
        COUNT(a.id) AS rating_count
        FROM answers a JOIN questions q ON q.id = a.question_id WHERE q.survey_id = ? AND q.question_type = 'rating'`, [survey.id]);
      const weekly = await dbGet(`SELECT COUNT(*) AS count FROM responses WHERE survey_id = ? AND datetime(submitted_at) >= datetime('now', '-7 days')`, [survey.id]);
      comparisons.push({
        id: survey.id, title: survey.title, status: survey.status, is_archived: Boolean(survey.is_archived), collection_name: survey.collection_name || null,
        response_count: survey.response_count, target_responses: survey.target_responses || null,
        deadline: survey.response_deadline || null, first_response: survey.first_response || null, latest_response: survey.latest_response || null,
        average_rating: rating && rating.rating_count ? Number(Number(rating.average_rating).toFixed(2)) : null,
        positive_rating_percentage: rating && rating.rating_count ? Math.round((rating.positive_count / rating.rating_count) * 100) : null,
        latest_7_day_responses: weekly ? weekly.count : 0,
        ...calculateCollectionState(survey)
      });
    }
    return res.json({ surveys: ids.map(id => comparisons.find(survey => survey.id === id)) });
  } catch (err) { console.error('Comparison error:', err); return res.status(500).json({ error: 'Failed to compare surveys.' }); }
});

/**
 * POST /api/surveys
 * Creates a new survey with optional questions in a single operation
 */
app.post('/api/surveys', requireAuth, async (req, res) => {
  try {
    const { title, description, questions, status, response_deadline, response_limit, one_response_per_browser, target_responses, collection_id } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Survey title is required' });
    }

    if (title.trim().length > 255) {
      return res.status(400).json({ error: 'Survey title must not exceed 255 characters' });
    }

    const surveyStatus = status === 'active' ? 'active' : 'draft';
    const normalizedDeadline = normalizeResponseDeadline(response_deadline);
    if (normalizedDeadline.error) {
      return res.status(400).json({ error: normalizedDeadline.error });
    }
    const normalizedLimit = normalizeResponseLimit(response_limit);
    if (normalizedLimit.error) {
      return res.status(400).json({ error: normalizedLimit.error });
    }
    const normalizedBrowserProtection = normalizeOneResponsePerBrowser(one_response_per_browser);
    if (normalizedBrowserProtection.error) {
      return res.status(400).json({ error: normalizedBrowserProtection.error });
    }
    const normalizedTarget = normalizeTargetResponses(target_responses);
    if (normalizedTarget.error) return res.status(400).json({ error: normalizedTarget.error });
    if (normalizedTarget.value && normalizedLimit.value && normalizedTarget.value > normalizedLimit.value) {
      return res.status(400).json({ error: 'Target responses cannot exceed the maximum response limit.' });
    }
    const normalizedCollection = normalizeOptionalCollectionId(collection_id);
    if (normalizedCollection.error) return res.status(400).json({ error: normalizedCollection.error });
    if (!await assertCollectionExists(normalizedCollection.value)) return res.status(400).json({ error: 'Collection not found.' });

    if (surveyStatus === 'active' && isSurveyExpired(normalizedDeadline.value)) {
      return res.status(400).json({ error: 'An active survey response deadline must be in the future.' });
    }

    // If attempting to publish directly, validate at least one question exists
    if (surveyStatus === 'active' && (!questions || questions.length === 0)) {
      return res.status(400).json({ error: 'Cannot publish a survey with no questions' });
    }

    // Insert survey
    const result = await dbRun(
      'INSERT INTO surveys (title, description, status, response_deadline, response_limit, one_response_per_browser, target_responses, collection_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title.trim(), description ? description.trim() : '', surveyStatus, normalizedDeadline.value, normalizedLimit.value, normalizedBrowserProtection.value, normalizedTarget.value, normalizedCollection.value]
    );

    const surveyId = result.lastID;

    // Insert questions if provided
    if (Array.isArray(questions) && questions.length > 0) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qText = q.question_text ? q.question_text.trim() : '';
        const qType = q.question_type;
        const isReq = q.is_required ? 1 : 0;
        const sortOrder = q.sort_order !== undefined ? q.sort_order : i;

        if (!qText) continue;

        let optionsJson = null;
        if (qType === 'multiple_choice') {
          const opts = Array.isArray(q.options)
            ? q.options.filter(o => o && o.trim().length > 0)
            : [];
          if (opts.length < 2) {
            return res.status(400).json({ error: 'Multiple choice questions require at least 2 options' });
          }
          if (opts.length > 6) {
            return res.status(400).json({ error: 'Multiple choice questions cannot exceed 6 options' });
          }
          optionsJson = JSON.stringify(opts);
        }

        await dbRun(
          `INSERT INTO questions (survey_id, question_text, question_type, options_json, is_required, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [surveyId, qText, qType, optionsJson, isReq, sortOrder]
        );
      }
    }

    const createdSurvey = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);
    const createdQuestions = await dbAll('SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order ASC, id ASC', [surveyId]);
    await recordActivity('SURVEY_CREATED', surveyId, { collection_id: normalizedCollection.value, status: surveyStatus });

    return res.status(201).json({
      ...createdSurvey,
      questions: createdQuestions
    });
  } catch (err) {
    console.error('Survey create error:', err);
    return res.status(500).json({ error: 'Failed to create survey' });
  }
});

/**
 * GET /api/surveys/:id
 * Retrieve survey details and questions for editing / management
 */
app.get('/api/surveys/:id', requireAuth, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const survey = await dbGet('SELECT s.*, c.name AS collection_name FROM surveys s LEFT JOIN collections c ON c.id = s.collection_id WHERE s.id = ?', [surveyId]);

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    const questions = await dbAll(
      'SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order ASC, id ASC',
      [surveyId]
    );

    const responseCountRow = await dbGet(
      'SELECT COUNT(*) AS count FROM responses WHERE survey_id = ?',
      [surveyId]
    );

    return res.json({
      ...survey,
      response_count: responseCountRow ? responseCountRow.count : 0,
      ...calculateCollectionState({ ...survey, response_count: responseCountRow ? responseCountRow.count : 0 }),
      questions: questions.map(q => ({
        ...q,
        options: q.options_json ? JSON.parse(q.options_json) : []
      }))
    });
  } catch (err) {
    console.error('Survey get error:', err);
    return res.status(500).json({ error: 'Failed to fetch survey' });
  }
});

/**
 * PUT /api/surveys/:id
 * Update survey title, description, and replace/update questions
 */
app.put('/api/surveys/:id', requireAuth, async (req, res) => {
  try {
    const surveyId = parsePositiveId(req.params.id);
    const { title, description, questions } = req.body;

    if (!surveyId) return res.status(400).json({ error: 'Survey ID must be valid.' });

    const existing = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);
    if (!existing) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Survey title cannot be empty' });
    }

    const deadlineWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'response_deadline');
    const normalizedDeadline = deadlineWasProvided
      ? normalizeResponseDeadline(req.body.response_deadline)
      : { value: existing.response_deadline };
    if (normalizedDeadline.error) {
      return res.status(400).json({ error: normalizedDeadline.error });
    }
    const limitWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'response_limit');
    const normalizedLimit = limitWasProvided
      ? normalizeResponseLimit(req.body.response_limit)
      : { value: existing.response_limit };
    if (normalizedLimit.error) {
      return res.status(400).json({ error: normalizedLimit.error });
    }
    const browserProtectionWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'one_response_per_browser');
    const normalizedBrowserProtection = browserProtectionWasProvided
      ? normalizeOneResponsePerBrowser(req.body.one_response_per_browser)
      : { value: existing.one_response_per_browser || 0 };
    if (normalizedBrowserProtection.error) {
      return res.status(400).json({ error: normalizedBrowserProtection.error });
    }
    const targetWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'target_responses');
    const normalizedTarget = targetWasProvided ? normalizeTargetResponses(req.body.target_responses) : { value: existing.target_responses };
    if (normalizedTarget.error) return res.status(400).json({ error: normalizedTarget.error });
    if (normalizedTarget.value && normalizedLimit.value && normalizedTarget.value > normalizedLimit.value) {
      return res.status(400).json({ error: 'Target responses cannot exceed the maximum response limit.' });
    }
    const collectionWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'collection_id');
    const normalizedCollection = collectionWasProvided ? normalizeOptionalCollectionId(req.body.collection_id) : { value: existing.collection_id };
    if (normalizedCollection.error) return res.status(400).json({ error: normalizedCollection.error });
    if (!await assertCollectionExists(normalizedCollection.value)) return res.status(400).json({ error: 'Collection not found.' });

    if (existing.status === 'active' && isSurveyExpired(normalizedDeadline.value)) {
      return res.status(400).json({ error: 'An active survey response deadline must be in the future.' });
    }

    await dbRun(
      'UPDATE surveys SET title = ?, description = ?, response_deadline = ?, response_limit = ?, one_response_per_browser = ?, target_responses = ?, collection_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [title.trim(), description ? description.trim() : '', normalizedDeadline.value, normalizedLimit.value, normalizedBrowserProtection.value, normalizedTarget.value, normalizedCollection.value, surveyId]
    );
    await recordActivity('SURVEY_UPDATED', surveyId, {
      old_deadline: existing.response_deadline || null,
      new_deadline: normalizedDeadline.value || null,
      old_target: existing.target_responses || null,
      new_target: normalizedTarget.value || null,
      old_collection_id: existing.collection_id || null,
      new_collection_id: normalizedCollection.value || null
    });
    if (targetWasProvided && Number(existing.target_responses || 0) !== Number(normalizedTarget.value || 0)) {
      await recordActivity('TARGET_UPDATED', surveyId, { old_target: existing.target_responses || null, new_target: normalizedTarget.value || null });
    }
    if (collectionWasProvided && Number(existing.collection_id || 0) !== Number(normalizedCollection.value || 0)) {
      await recordActivity('SURVEY_MOVED_COLLECTION', surveyId, { old_collection_id: existing.collection_id || null, new_collection_id: normalizedCollection.value || null });
    }

    // If questions array passed, sync questions
    if (Array.isArray(questions)) {
      // Check if responses already exist before modifying questions
      const respCheck = await dbGet('SELECT COUNT(*) AS count FROM responses WHERE survey_id = ?', [surveyId]);
      if (respCheck && respCheck.count > 0) {
        // Only update title/description to preserve response data integrity
        return res.json({
          message: 'Survey details updated. Questions were locked because responses already exist.',
          surveyId
        });
      }

      // Safe to rewrite questions if 0 responses exist
      await dbRun('DELETE FROM questions WHERE survey_id = ?', [surveyId]);

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qText = q.question_text ? q.question_text.trim() : '';
        const qType = q.question_type;
        const isReq = q.is_required ? 1 : 0;
        const sortOrder = q.sort_order !== undefined ? q.sort_order : i;

        if (!qText) continue;

        let optionsJson = null;
        if (qType === 'multiple_choice') {
          const opts = Array.isArray(q.options)
            ? q.options.filter(o => o && o.trim().length > 0)
            : [];
          optionsJson = JSON.stringify(opts);
        }

        await dbRun(
          `INSERT INTO questions (survey_id, question_text, question_type, options_json, is_required, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [surveyId, qText, qType, optionsJson, isReq, sortOrder]
        );
      }
    }

    return res.json({ success: true, message: 'Survey updated successfully' });
  } catch (err) {
    console.error('Survey update error:', err);
    return res.status(500).json({ error: 'Failed to update survey' });
  }
});

/**
 * DELETE /api/surveys/:id
 * Allows deletion only if 0 responses exist to protect historical research data
 */
app.delete('/api/surveys/:id', requireAuth, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const survey = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    const responsesCountRow = await dbGet(
      'SELECT COUNT(*) AS count FROM responses WHERE survey_id = ?',
      [surveyId]
    );

    if (responsesCountRow && responsesCountRow.count > 0) {
      return res.status(400).json({
        error: `Cannot delete survey because it already has ${responsesCountRow.count} responses. Please close the survey instead.`
      });
    }

    await dbRun('DELETE FROM surveys WHERE id = ?', [surveyId]);
    return res.json({ success: true, message: 'Survey deleted successfully' });
  } catch (err) {
    console.error('Survey delete error:', err);
    return res.status(500).json({ error: 'Failed to delete survey' });
  }
});

/**
 * POST /api/surveys/:id/publish
 * Sets survey status to 'active' after checking validation rules
 */
app.post('/api/surveys/:id/publish', requireAuth, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const survey = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    const questions = await dbAll('SELECT id FROM questions WHERE survey_id = ?', [surveyId]);
    if (!questions || questions.length === 0) {
      return res.status(400).json({ error: 'Cannot publish survey: at least one question is required' });
    }

    if (isSurveyExpired(survey.response_deadline)) {
      return res.status(400).json({ error: 'Cannot publish a survey with a response deadline in the past.' });
    }

    await dbRun(
      "UPDATE surveys SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [surveyId]
    );
    await recordActivity('SURVEY_PUBLISHED', surveyId);

    return res.json({ success: true, message: 'Survey published successfully', status: 'active' });
  } catch (err) {
    console.error('Publish error:', err);
    return res.status(500).json({ error: 'Failed to publish survey' });
  }
});

/**
 * POST /api/surveys/:id/close
 * Sets survey status to 'closed'
 */
app.post('/api/surveys/:id/close', requireAuth, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const survey = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    await dbRun(
      "UPDATE surveys SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [surveyId]
    );
    await recordActivity('SURVEY_CLOSED', surveyId);

    return res.json({ success: true, message: 'Survey closed successfully', status: 'closed' });
  } catch (err) {
    console.error('Close error:', err);
    return res.status(500).json({ error: 'Failed to close survey' });
  }
});

/* ==========================================================================
   4. QUESTIONS CRUD API (Granular question management)
   ========================================================================== */

/**
 * POST /api/surveys/:id/questions
 */
app.post('/api/surveys/:id/questions', requireAuth, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const { question_text, question_type, options, is_required, sort_order } = req.body;

    if (!question_text || question_text.trim().length === 0) {
      return res.status(400).json({ error: 'Question text is required' });
    }

    const validTypes = ['text', 'multiple_choice', 'rating', 'yes_no'];
    if (!validTypes.includes(question_type)) {
      return res.status(400).json({ error: 'Invalid question type' });
    }

    let optionsJson = null;
    if (question_type === 'multiple_choice') {
      const opts = Array.isArray(options) ? options.filter(o => o && o.trim().length > 0) : [];
      if (opts.length < 2 || opts.length > 6) {
        return res.status(400).json({ error: 'Multiple choice requires between 2 and 6 options' });
      }
      optionsJson = JSON.stringify(opts);
    }

    const result = await dbRun(
      `INSERT INTO questions (survey_id, question_text, question_type, options_json, is_required, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [surveyId, question_text.trim(), question_type, optionsJson, is_required ? 1 : 0, sort_order || 0]
    );

    return res.status(201).json({ success: true, id: result.lastID });
  } catch (err) {
    console.error('Question add error:', err);
    return res.status(500).json({ error: 'Failed to add question' });
  }
});

/**
 * DELETE /api/questions/:id
 */
app.delete('/api/questions/:id', requireAuth, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    await dbRun('DELETE FROM questions WHERE id = ?', [questionId]);
    return res.json({ success: true, message: 'Question deleted' });
  } catch (err) {
    console.error('Question delete error:', err);
    return res.status(500).json({ error: 'Failed to delete question' });
  }
});

/* ==========================================================================
   5. PUBLIC SURVEY API (Respondent View & Submission)
   ========================================================================== */

/**
 * GET /api/public/surveys/:id
 * Public endpoint to fetch active survey questions for respondents
 */
app.get('/api/public/surveys/:id', async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const survey = await dbGet('SELECT id, title, description, status, response_deadline, response_limit, one_response_per_browser FROM surveys WHERE id = ?', [surveyId]);

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    if (survey.status === 'closed') {
      return res.status(403).json({
        id: survey.id,
        title: survey.title,
        status: 'closed',
        error: 'This survey is no longer accepting responses.'
      });
    }

    if (survey.status === 'draft') {
      return res.status(403).json({
        error: 'This survey is currently in draft mode and not published.'
      });
    }

    if (isSurveyExpired(survey.response_deadline)) {
      return res.status(403).json({
        id: survey.id,
        title: survey.title,
        status: survey.status,
        response_deadline: survey.response_deadline,
        code: 'SURVEY_EXPIRED',
        error: 'This survey response deadline has passed and it is no longer accepting responses.'
      });
    }

    const responseCount = await getSurveyResponseCount(surveyId);
    if (isSurveyResponseLimitReached(survey.response_limit, responseCount)) {
      return res.status(403).json(responseLimitReachedPayload(survey, responseCount));
    }

    const questions = await dbAll(
      `SELECT id, question_text, question_type, options_json, is_required, sort_order 
       FROM questions 
       WHERE survey_id = ? 
       ORDER BY sort_order ASC, id ASC`,
      [surveyId]
    );

    return res.json({
      id: survey.id,
      title: survey.title,
      description: survey.description,
      status: survey.status,
      response_deadline: survey.response_deadline,
      response_limit: survey.response_limit,
      one_response_per_browser: survey.one_response_per_browser === 1,
      response_count: responseCount,
      questions: questions.map(q => ({
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.options_json ? JSON.parse(q.options_json) : [],
        is_required: q.is_required === 1,
        sort_order: q.sort_order
      }))
    });
  } catch (err) {
    console.error('Public survey get error:', err);
    return res.status(500).json({ error: 'Failed to load survey' });
  }
});

/**
 * POST /api/public/surveys/:id/responses
 * Saves public respondent answers atomically
 */
app.post('/api/public/surveys/:id/responses', async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const { answers } = req.body;

    const survey = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);
    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    if (survey.status !== 'active') {
      return res.status(403).json({ error: 'This survey is not currently accepting responses' });
    }

    if (isSurveyExpired(survey.response_deadline)) {
      return res.status(403).json({
        code: 'SURVEY_EXPIRED',
        error: 'This survey response deadline has passed and it is no longer accepting responses.'
      });
    }

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Answers must be provided' });
    }

    // Fetch questions to validate responses
    const questions = await dbAll('SELECT * FROM questions WHERE survey_id = ?', [surveyId]);

    // Validation loop
    for (const q of questions) {
      const val = answers[q.id];
      const isProvided = val !== undefined && val !== null && String(val).trim().length > 0;

      if (q.is_required && !isProvided) {
        return res.status(400).json({
          error: `Please answer required question: "${q.question_text}"`
        });
      }

      if (isProvided) {
        const strVal = String(val).trim();

        if (q.question_type === 'rating') {
          const num = parseInt(strVal, 10);
          if (isNaN(num) || num < 1 || num > 5) {
            return res.status(400).json({ error: 'Rating must be a valid number between 1 and 5' });
          }
        } else if (q.question_type === 'yes_no') {
          if (strVal !== 'Yes' && strVal !== 'No') {
            return res.status(400).json({ error: 'Yes/No questions require an answer of "Yes" or "No"' });
          }
        } else if (q.question_type === 'multiple_choice') {
          const validOptions = q.options_json ? JSON.parse(q.options_json) : [];
          if (!validOptions.includes(strVal)) {
            return res.status(400).json({ error: `Selected option is not valid for "${q.question_text}"` });
          }
        }
      }
    }

    const submissionResult = await serializeResponseSubmission(async () => {
      let transactionOpen = false;
      try {
        await dbRun('BEGIN IMMEDIATE TRANSACTION');
        transactionOpen = true;

        const currentSurvey = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);
        if (!currentSurvey || currentSurvey.status !== 'active') {
          await dbRun('ROLLBACK');
          transactionOpen = false;
          return { noLongerAccepting: true };
        }

        if (isSurveyExpired(currentSurvey.response_deadline)) {
          await dbRun('ROLLBACK');
          transactionOpen = false;
          return { expired: true };
        }

        const responseCount = await getSurveyResponseCount(surveyId);
        if (isSurveyResponseLimitReached(currentSurvey.response_limit, responseCount)) {
          await dbRun('ROLLBACK');
          transactionOpen = false;
          return { limitReached: true, responseCount, survey: currentSurvey };
        }

        const respResult = await dbRun('INSERT INTO responses (survey_id) VALUES (?)', [surveyId]);
        const responseId = respResult.lastID;

        for (const q of questions) {
          const val = answers[q.id];
          if (val !== undefined && val !== null && String(val).trim().length > 0) {
            await dbRun(
              'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
              [responseId, q.id, String(val).trim()]
            );
          }
        }

        await dbRun('COMMIT');
        transactionOpen = false;
        return { responseId };
      } catch (err) {
        if (transactionOpen) {
          try { await dbRun('ROLLBACK'); } catch (rollbackErr) { console.error('Response transaction rollback error:', rollbackErr); }
        }
        throw err;
      }
    });

    if (submissionResult.limitReached) {
      return res.status(403).json(responseLimitReachedPayload(submissionResult.survey, submissionResult.responseCount));
    }
    if (submissionResult.expired) {
      return res.status(403).json({
        code: 'SURVEY_EXPIRED',
        error: 'This survey response deadline has passed and it is no longer accepting responses.'
      });
    }
    if (submissionResult.noLongerAccepting) {
      return res.status(403).json({ error: 'This survey is not currently accepting responses' });
    }

    return res.status(201).json({
      success: true,
      message: 'Your response has been recorded successfully.',
      responseId: submissionResult.responseId
    });
  } catch (err) {
    console.error('Submit response error:', err);
    return res.status(500).json({ error: 'Failed to submit survey response' });
  }
});

/* ==========================================================================
   6. RESPONSES & ANALYTICS API (Admin)
   ========================================================================== */

/**
 * GET /api/surveys/:id/responses
 * Returns raw responses for data inspection
 */
app.get('/api/surveys/:id/responses', requireAuth, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const responses = await dbAll(
      'SELECT id, submitted_at FROM responses WHERE survey_id = ? ORDER BY submitted_at DESC',
      [surveyId]
    );

    const questions = await dbAll(
      'SELECT id, question_text, question_type FROM questions WHERE survey_id = ? ORDER BY sort_order ASC, id ASC',
      [surveyId]
    );

    const answers = await dbAll(`
      SELECT a.response_id, a.question_id, a.answer_text 
      FROM answers a
      JOIN responses r ON a.response_id = r.id
      WHERE r.survey_id = ?
    `, [surveyId]);

    // Group answers by response ID
    const answerMap = {};
    for (const ans of answers) {
      if (!answerMap[ans.response_id]) answerMap[ans.response_id] = {};
      answerMap[ans.response_id][ans.question_id] = ans.answer_text;
    }

    const formatted = responses.map(r => ({
      id: r.id,
      submitted_at: r.submitted_at,
      answers: answerMap[r.id] || {}
    }));

    return res.json({
      questions,
      responses: formatted
    });
  } catch (err) {
    console.error('Get responses error:', err);
    return res.status(500).json({ error: 'Failed to retrieve responses' });
  }
});

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates and normalizes optional YYYY-MM-DD analytics filters.
 * Keeping this logic on the server makes filtered metrics and exports trustworthy
 * even when a request does not come from the browser interface.
 */
function parseDateFilters(query) {
  const from = typeof query.from === 'string' ? query.from.trim() : '';
  const to = typeof query.to === 'string' ? query.to.trim() : '';

  const isRealIsoDate = value => {
    if (!value) return true;
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));

    return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day;
  };

  if (!isRealIsoDate(from) || !isRealIsoDate(to)) {
    return { error: 'Date filters must use a valid YYYY-MM-DD date.' };
  }

  if (from && to && from > to) {
    return { error: 'The start date cannot be later than the end date.' };
  }

  return {
    from,
    to,
    isFiltered: Boolean(from || to)
  };
}

/**
 * Builds a parameterized inclusive date filter for a response timestamp column.
 */
function buildResponseDateFilter(columnName, filters) {
  const conditions = [];
  const params = [];

  if (filters.from) {
    conditions.push(`${columnName} >= ?`);
    params.push(`${filters.from} 00:00:00`);
  }

  if (filters.to) {
    const exclusiveEnd = new Date(`${filters.to}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    conditions.push(`${columnName} < ?`);
    params.push(`${exclusiveEnd.toISOString().slice(0, 10)} 00:00:00`);
  }

  return {
    clause: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '',
    params
  };
}

/**
 * GET /api/surveys/:id/analytics
 * Comprehensive mathematical analytics + Deterministic Automated Insight Engine
 */
app.get('/api/surveys/:id/analytics', requireAuth, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const dateFilters = parseDateFilters(req.query);

    if (dateFilters.error) {
      return res.status(400).json({ error: dateFilters.error });
    }

    const survey = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    const allTimeTotalRow = await dbGet(
      'SELECT COUNT(*) AS count FROM responses WHERE survey_id = ?',
      [surveyId]
    );

    const responseDateFilter = buildResponseDateFilter('submitted_at', dateFilters);
    const answerDateFilter = buildResponseDateFilter('r.submitted_at', dateFilters);

    const totalResponsesRow = await dbGet(
      `SELECT COUNT(*) AS count FROM responses WHERE survey_id = ?${responseDateFilter.clause}`,
      [surveyId, ...responseDateFilter.params]
    );

    const allTimeTotalResponses = allTimeTotalRow ? allTimeTotalRow.count : 0;
    const totalResponses = totalResponsesRow ? totalResponsesRow.count : 0;

    const latestResponseRow = await dbGet(
      `SELECT submitted_at FROM responses WHERE survey_id = ?${responseDateFilter.clause} ORDER BY submitted_at DESC LIMIT 1`,
      [surveyId, ...responseDateFilter.params]
    );
    const latestResponseDate = latestResponseRow ? latestResponseRow.submitted_at : null;

    // 7-Day Trend Growth Calculation (intersected with the active date range)
    const current7DaysRow = await dbGet(`
      SELECT COUNT(*) AS count 
      FROM responses 
      WHERE survey_id = ? 
        AND submitted_at >= datetime('now', '-7 days')${responseDateFilter.clause}
    `, [surveyId, ...responseDateFilter.params]);

    const previous7DaysRow = await dbGet(`
      SELECT COUNT(*) AS count 
      FROM responses 
      WHERE survey_id = ? 
        AND submitted_at >= datetime('now', '-14 days') 
        AND submitted_at < datetime('now', '-7 days')${responseDateFilter.clause}
    `, [surveyId, ...responseDateFilter.params]);

    const currentPeriod = current7DaysRow ? current7DaysRow.count : 0;
    const previousPeriod = previous7DaysRow ? previous7DaysRow.count : 0;

    let growthLabel = 'No change';
    let growthValue = 0;
    let hasTrendData = false;

    if (previousPeriod > 0) {
      const change = Math.round(((currentPeriod - previousPeriod) / previousPeriod) * 100);
      growthValue = change;
      growthLabel = change >= 0 ? `+${change}%` : `${change}%`;
      hasTrendData = true;
    } else if (currentPeriod > 0 && previousPeriod === 0) {
      growthLabel = `+${currentPeriod} new`;
      growthValue = 100;
      hasTrendData = false; // insufficient baseline for standard percentage comparison
    } else {
      growthLabel = 'No change';
      growthValue = 0;
      hasTrendData = false;
    }

    // Questions and per-question analytics
    const questions = await dbAll(
      'SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order ASC, id ASC',
      [surveyId]
    );

    const questionAnalytics = [];
    const allRatingAverages = [];
    const insights = [];

    for (const q of questions) {
      const answers = await dbAll(`
        SELECT a.answer_text
        FROM answers a
        JOIN responses r ON a.response_id = r.id
        WHERE a.question_id = ?
          AND r.survey_id = ?${answerDateFilter.clause}
        ORDER BY r.submitted_at DESC, a.id DESC
      `, [q.id, surveyId, ...answerDateFilter.params]);

      const answeredCount = answers.length;

      if (q.question_type === 'multiple_choice') {
        const options = q.options_json ? JSON.parse(q.options_json) : [];
        const counts = {};
        options.forEach(opt => { counts[opt] = 0; });

        answers.forEach(a => {
          if (counts[a.answer_text] !== undefined) {
            counts[a.answer_text]++;
          }
        });

        const distribution = options.map(opt => {
          const count = counts[opt];
          const pct = answeredCount > 0 ? Math.round((count / answeredCount) * 1000) / 10 : 0;
          return { option: opt, count, percentage: pct };
        });

        // Determine most and least selected
        let mostSelected = null;
        let leastSelected = null;
        let maxCount = -1;
        let minCount = Infinity;

        distribution.forEach(d => {
          if (d.count > maxCount) {
            maxCount = d.count;
            mostSelected = d;
          }
          if (d.count < minCount) {
            minCount = d.count;
            leastSelected = d;
          }
        });

        questionAnalytics.push({
          id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          answered_count: answeredCount,
          distribution,
          most_selected: mostSelected && mostSelected.count > 0 ? mostSelected : null,
          least_selected: leastSelected
        });

        // Insights for multiple choice
        if (answeredCount > 0 && mostSelected && mostSelected.count > 0) {
          insights.push(
            `For "${q.question_text}", the most selected option was "${mostSelected.option}" with ${mostSelected.percentage}% of responses (${mostSelected.count} of ${answeredCount}).`
          );
          if (answeredCount >= 10 && leastSelected && leastSelected.option !== mostSelected.option) {
            insights.push(
              `The least selected option was "${leastSelected.option}" with ${leastSelected.percentage}% of responses.`
            );
          }
        }
      } else if (q.question_type === 'rating') {
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;

        answers.forEach(a => {
          const ratingVal = parseInt(a.answer_text, 10);
          if (counts[ratingVal] !== undefined) {
            counts[ratingVal]++;
            sum += ratingVal;
          }
        });

        const avg = answeredCount > 0 ? Math.round((sum / answeredCount) * 10) / 10 : 0;
        if (answeredCount > 0) {
          allRatingAverages.push(avg);
        }

        const positiveCount = counts[4] + counts[5];
        const neutralCount = counts[3];
        const negativeCount = counts[1] + counts[2];

        const positivePct = answeredCount > 0 ? Math.round((positiveCount / answeredCount) * 100) : 0;
        const neutralPct = answeredCount > 0 ? Math.round((neutralCount / answeredCount) * 100) : 0;
        const negativePct = answeredCount > 0 ? Math.round((negativeCount / answeredCount) * 100) : 0;

        // Find modal (most common) rating
        let maxRatingCount = -1;
        let modalRating = 5;
        for (let r = 5; r >= 1; r--) {
          if (counts[r] > maxRatingCount) {
            maxRatingCount = counts[r];
            modalRating = r;
          }
        }

        const distribution = [1, 2, 3, 4, 5].map(r => ({
          rating: r,
          count: counts[r],
          percentage: answeredCount > 0 ? Math.round((counts[r] / answeredCount) * 1000) / 10 : 0
        }));

        questionAnalytics.push({
          id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          answered_count: answeredCount,
          average: avg,
          counts,
          distribution,
          positiveCount,
          positivePct,
          neutralCount,
          neutralPct,
          negativeCount,
          negativePct,
          modalRating
        });

        // Insights for rating
        if (answeredCount > 0) {
          insights.push(
            `The average rating for "${q.question_text}" is ${avg.toFixed(1)} out of 5.`
          );

          if (positivePct >= 70) {
            insights.push(
              `${positivePct}% of respondents reported a positive rating (4 or 5 stars).`
            );
          } else if (positivePct >= 50) {
            insights.push(
              `More than half of respondents (${positivePct}%) reported a positive rating.`
            );
          }

          if (negativePct >= 30) {
            insights.push(
              `A notable portion of respondents (${negativePct}%) reported lower ratings (1 or 2 stars), highlighting an area for review.`
            );
          }

          if (maxRatingCount > 0) {
            insights.push(
              `Rating ${modalRating} was the most frequently selected rating (${maxRatingCount} responses).`
            );
          }
        }
      } else if (q.question_type === 'yes_no') {
        let yesCount = 0;
        let noCount = 0;

        answers.forEach(a => {
          if (a.answer_text === 'Yes') yesCount++;
          else if (a.answer_text === 'No') noCount++;
        });

        const yesPct = answeredCount > 0 ? Math.round((yesCount / answeredCount) * 1000) / 10 : 0;
        const noPct = answeredCount > 0 ? Math.round((noCount / answeredCount) * 1000) / 10 : 0;

        questionAnalytics.push({
          id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          answered_count: answeredCount,
          yesCount,
          noCount,
          yesPct,
          noPct,
          majority: yesCount > noCount ? 'Yes' : noCount > yesCount ? 'No' : 'Tied'
        });

        // Insights for Yes/No
        if (answeredCount > 0) {
          insights.push(
            `For "${q.question_text}", ${yesPct}% answered Yes and ${noPct}% answered No.`
          );
          if (yesPct >= 60) {
            insights.push(`A clear majority (${yesPct}%) confirmed with "Yes".`);
          } else if (noPct >= 60) {
            insights.push(`A clear majority (${noPct}%) responded with "No".`);
          }
        }
      } else if (q.question_type === 'text') {
        const recentTexts = answers.slice(0, 15).map(a => a.answer_text);
        questionAnalytics.push({
          id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          answered_count: answeredCount,
          recent_responses: recentTexts
        });
      }
    }

    // Overall Survey Rating (if rating questions present)
    let overallRatingAvg = null;
    if (allRatingAverages.length > 0) {
      const sum = allRatingAverages.reduce((acc, curr) => acc + curr, 0);
      overallRatingAvg = Math.round((sum / allRatingAverages.length) * 10) / 10;

      if (overallRatingAvg >= 4.0) {
        insights.unshift('Overall respondent sentiment is strongly positive based on average rating metrics.');
      } else if (overallRatingAvg >= 3.0) {
        insights.unshift('Overall respondent sentiment is moderately positive.');
      } else {
        insights.unshift('Survey results indicate an area that may require attention or improvement.');
      }
    }

    // Trend insight
    if (hasTrendData) {
      if (growthValue > 0) {
        insights.push(`Response activity increased by ${growthValue}% compared with the previous 7-day period.`);
      } else if (growthValue < 0) {
        insights.push(`Response activity decreased by ${Math.abs(growthValue)}% compared with the previous 7-day period.`);
      } else {
        insights.push('Response activity was stable with 0% change over the previous 7-day comparison window.');
      }
    }

    return res.json({
      survey: {
        id: survey.id,
        title: survey.title,
        description: survey.description,
        status: survey.status,
        created_at: survey.created_at
      },
      summary: {
        totalResponses,
        allTimeTotalResponses,
        latestResponseDate,
        growthLabel,
        growthValue,
        hasTrendData,
        overallRatingAvg
      },
      filters: {
        from: dateFilters.from || null,
        to: dateFilters.to || null,
        isFiltered: dateFilters.isFiltered
      },
      questions: questionAnalytics,
      insights
    });
  } catch (err) {
    console.error('Analytics error:', err);
    return res.status(500).json({ error: 'Failed to calculate survey analytics' });
  }
});

/* ==========================================================================
   7. CSV EXPORT API (Admin)
   ========================================================================== */

/**
 * Escapes CSV field per RFC 4180 rules
 */
function escapeCsv(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/surveys/:id/export.csv
 * Generates and downloads pure CSV formatted data
 */
app.get('/api/surveys/:id/export.csv', requireAuth, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id, 10);
    const dateFilters = parseDateFilters(req.query);

    if (dateFilters.error) {
      return res.status(400).send(dateFilters.error);
    }

    const survey = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);

    if (!survey) {
      return res.status(404).send('Survey not found');
    }

    const questions = await dbAll(
      'SELECT id, question_text FROM questions WHERE survey_id = ? ORDER BY sort_order ASC, id ASC',
      [surveyId]
    );

    const responseDateFilter = buildResponseDateFilter('submitted_at', dateFilters);
    const answerDateFilter = buildResponseDateFilter('r.submitted_at', dateFilters);

    const responses = await dbAll(
      `SELECT id, submitted_at FROM responses WHERE survey_id = ?${responseDateFilter.clause} ORDER BY submitted_at ASC`,
      [surveyId, ...responseDateFilter.params]
    );

    const answers = await dbAll(`
      SELECT a.response_id, a.question_id, a.answer_text 
      FROM answers a
      JOIN responses r ON a.response_id = r.id
      WHERE r.survey_id = ?${answerDateFilter.clause}
    `, [surveyId, ...answerDateFilter.params]);

    const answerMap = {};
    for (const ans of answers) {
      if (!answerMap[ans.response_id]) answerMap[ans.response_id] = {};
      answerMap[ans.response_id][ans.question_id] = ans.answer_text;
    }

    // CSV Header row
    const headers = ['Response ID', 'Submitted At', ...questions.map(q => q.question_text)];
    const csvRows = [headers.map(escapeCsv).join(',')];

    // Response rows
    for (const r of responses) {
      const row = [
        r.id,
        r.submitted_at,
        ...questions.map(q => {
          const ans = answerMap[r.id] ? answerMap[r.id][q.id] : '';
          return ans !== undefined ? ans : '';
        })
      ];
      csvRows.push(row.map(escapeCsv).join(','));
    }

    const csvContent = csvRows.join('\r\n');
    const safeTitle = survey.title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const rangeSuffix = dateFilters.isFiltered
      ? `_${dateFilters.from || 'start'}_to_${dateFilters.to || 'latest'}`
      : '';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="survey_${survey.id}_${safeTitle}${rangeSuffix}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('CSV Export error:', err);
    return res.status(500).send('Failed to generate CSV export');
  }
});

// Health check endpoint for Edge gateways and deployment monitors
app.get('/api/health', (req, res) => {
  return res.json({
    status: 'ok',
    runtime: 'wasm-edge-ready',
    timestamp: new Date().toISOString()
  });
});

// Fallback route redirecting root to dashboard
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard.html');
  }
  return res.redirect('/login.html');
});

// Start server directly when run via CLI / local Node.js / Wasmer Edge
if (require.main === module) {
  const HOST = process.env.HOST || '0.0.0.0';
  ensureDbReady()
    .catch(err => {
      console.warn('[SERVER] Notice during initial startup preparation:', err.message);
    })
    .finally(() => {
      app.listen(PORT, HOST, () => {
        console.log(`Research Survey Analytics Dashboard server running on http://${HOST}:${PORT}`);
      });
    });
}

// Export Express app for Vercel / serverless runtime
module.exports = app;
module.exports.getResponseActivityWindow = getResponseActivityWindow;
module.exports.getResponsePulseWindow = getResponsePulseWindow;
module.exports.calculateResearchHealth = calculateResearchHealth;
module.exports.researchHealthLabel = researchHealthLabel;
module.exports.deadlineRunwayNormalized = deadlineRunwayNormalized;
module.exports.recentActivityNormalized = recentActivityNormalized;
module.exports.buildResearchHealth = buildResearchHealth;
module.exports.buildResponseHeatmap = buildResponseHeatmap;
module.exports.responseHeatmapLevel = responseHeatmapLevel;
module.exports.highestTargetMilestone = highestTargetMilestone;
module.exports.buildAchievementBadges = buildAchievementBadges;
module.exports.buildSurveyAchievements = buildSurveyAchievements;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.USER_ROLES = USER_ROLES;
