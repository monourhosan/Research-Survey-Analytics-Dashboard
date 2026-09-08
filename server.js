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
const {
  dbRun,
  dbGet,
  dbAll,
  initDatabase,
  verifyPassword
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

/**
 * Authentication Middleware: Enforces that route is only accessible by logged-in admin
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized: Please log in to access this resource' });
  }
  next();
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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Set session data
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
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
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({
      authenticated: true,
      user: {
        id: req.session.userId,
        name: req.session.userName,
        email: req.session.userEmail
      }
    });
  }
  return res.json({ authenticated: false });
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
        s.created_at,
        COUNT(r.id) AS response_count
      FROM surveys s
      LEFT JOIN responses r ON s.id = r.survey_id
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 5
    `);

    return res.json({
      totalSurveys: totalSurveysRow ? totalSurveysRow.count : 0,
      activeSurveys: activeSurveysRow ? activeSurveysRow.count : 0,
      closedSurveys: closedSurveysRow ? closedSurveysRow.count : 0,
      totalResponses: totalResponsesRow ? totalResponsesRow.count : 0,
      recentSurveys
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard metrics' });
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
    const surveys = await dbAll(`
      SELECT 
        s.id, 
        s.title, 
        s.description, 
        s.status, 
        s.created_at,
        s.updated_at,
        COUNT(r.id) AS response_count
      FROM surveys s
      LEFT JOIN responses r ON s.id = r.survey_id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `);
    return res.json(surveys);
  } catch (err) {
    console.error('Surveys list error:', err);
    return res.status(500).json({ error: 'Failed to retrieve surveys' });
  }
});

/**
 * POST /api/surveys
 * Creates a new survey with optional questions in a single operation
 */
app.post('/api/surveys', requireAuth, async (req, res) => {
  try {
    const { title, description, questions, status } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Survey title is required' });
    }

    if (title.trim().length > 255) {
      return res.status(400).json({ error: 'Survey title must not exceed 255 characters' });
    }

    const surveyStatus = status === 'active' ? 'active' : 'draft';

    // If attempting to publish directly, validate at least one question exists
    if (surveyStatus === 'active' && (!questions || questions.length === 0)) {
      return res.status(400).json({ error: 'Cannot publish a survey with no questions' });
    }

    // Insert survey
    const result = await dbRun(
      'INSERT INTO surveys (title, description, status) VALUES (?, ?, ?)',
      [title.trim(), description ? description.trim() : '', surveyStatus]
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
    const survey = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);

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
    const surveyId = parseInt(req.params.id, 10);
    const { title, description, questions } = req.body;

    const existing = await dbGet('SELECT * FROM surveys WHERE id = ?', [surveyId]);
    if (!existing) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Survey title cannot be empty' });
    }

    await dbRun(
      'UPDATE surveys SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [title.trim(), description ? description.trim() : '', surveyId]
    );

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

    await dbRun(
      "UPDATE surveys SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [surveyId]
    );

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
    const survey = await dbGet('SELECT id, title, description, status FROM surveys WHERE id = ?', [surveyId]);

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

    // Insert response record
    const respResult = await dbRun(
      'INSERT INTO responses (survey_id) VALUES (?)',
      [surveyId]
    );
    const responseId = respResult.lastID;

    // Insert answers
    for (const q of questions) {
      const val = answers[q.id];
      if (val !== undefined && val !== null && String(val).trim().length > 0) {
        await dbRun(
          'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
          [responseId, q.id, String(val).trim()]
        );
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Your response has been recorded successfully.',
      responseId
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
