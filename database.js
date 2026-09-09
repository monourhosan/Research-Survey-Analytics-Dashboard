/**
 * Research Survey Analytics Dashboard
 * 100% WASM & Edge Compatible Database Management Module
 * Powered by WebAssembly SQLite (sql.js)
 * 
 * Features:
 * - 100% WebAssembly execution: Zero native C++ or node-gyp bindings
 * - Compatible with Wasmer Edge, Vercel Serverless, Cloudflare, and Node.js
 * - Seamless disk persistence when disk is writable (data/survey.db)
 * - Resilient in-memory fallback when filesystem is read-only (EROFS safe)
 * - Automatic foreign key constraint enforcement
 * - Idempotent default admin seeding (admin@research.local / Admin123!)
 * - Complete async/await Promise API: dbRun, dbGet, dbAll
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

let SQL = null;
let db = null;
let dbInitPromise = null;
let writableDbPath = null;
let saveTimeout = null;

// Determine possible database paths
const localDataDir = path.join(__dirname, 'data');
const localDbPath = path.join(localDataDir, 'survey.db');

// Detect serverless / edge runtime
const isServerless = process.env.VERCEL === '1' ||
  process.env.WASMER === '1' ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.LAMBDA_TASK_ROOT;

/**
 * Determine the most suitable database storage location
 */
function resolveStoragePath() {
  if (isServerless) {
    return path.join(os.tmpdir(), 'survey.db');
  }
  return localDbPath;
}

/**
 * Safely persists current in-memory database to disk if filesystem is writable
 */
function persistDatabase() {
  if (!db || !writableDbPath) return;

  try {
    const dir = path.dirname(writableDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(writableDbPath, buffer);
  } catch (err) {
    // If the environment is strictly read-only (common in sandboxed WASM Edge runtimes),
    // silently keep running in-memory without crashing the application.
    if (err.code !== 'EROFS' && err.code !== 'EACCES') {
      console.warn('[DB] Persistent disk sync notice:', err.message);
    }
  }
}

/**
 * Debounced persistence trigger to minimize disk I/O on rapid writes
 */
function schedulePersist() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    persistDatabase();
  }, 100);
}

/**
 * Resilient SQLite Engine Loader
 * 1. Checks if sql-wasm.wasm is present on disk.
 * 2. If present, initializes the WebAssembly build (sql.js).
 * 3. If missing (common on Vercel / serverless without wasm bundling),
 *    gracefully and immediately loads the self-contained pure JavaScript build (sql-asm.js).
 * This eliminates "Error: ENOENT: no such file or directory, open '.../sql-wasm.wasm'" entirely.
 */
async function loadSqlEngine() {
  // 1. On Serverless / Vercel: use self-contained pure JS SQLite (sql-asm.js)
  // This eliminates ENOENT errors when .wasm files are excluded from lambda bundles
  if (isServerless) {
    try {
      console.log('[DB] Serverless runtime detected: Using self-contained SQLite (sql-asm.js)');
      const initAsm = require('sql.js/dist/sql-asm.js');
      return await initAsm();
    } catch (err) {
      console.warn('[DB] Could not load sql-asm.js, attempting WASM search:', err.message);
    }
  }

  // 2. In local Node.js environments: check if sql-wasm.wasm exists
  let wasmPath = null;
  try {
    const candidate = require.resolve('sql.js/dist/sql-wasm.wasm');
    if (fs.existsSync(candidate)) {
      wasmPath = candidate;
    }
  } catch (e) {}

  if (!wasmPath) {
    const candidatePaths = [
      path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
      path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
      path.join('/var/task', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        wasmPath = p;
        break;
      }
    }
  }

  if (wasmPath) {
    try {
      const initWasm = require('sql.js');
      const engine = await initWasm({
        locateFile: () => wasmPath
      });
      console.log('[DB] SQLite engine: WebAssembly (sql-wasm.wasm)');
      return engine;
    } catch (err) {
      console.warn('[DB] WASM loader error, switching to pure JS asm.js:', err.message);
    }
  }

  // Pure JavaScript asm.js fallback: 100% self-contained, 0 file dependencies
  console.log('[DB] SQLite engine: Self-contained Pure JavaScript (sql-asm.js)');
  const initAsm = require('sql.js/dist/sql-asm.js');
  return await initAsm();
}

/**
 * Initialize WebAssembly / asm.js SQLite and load/create database
 */
async function initDatabase() {
  if (db) return db;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    try {
      if (!SQL) {
        SQL = await loadSqlEngine();
      }

      writableDbPath = resolveStoragePath();

      let initialBuffer = null;

      // 1. Try loading from writable location (e.g. data/survey.db or /tmp/survey.db)
      if (fs.existsSync(writableDbPath)) {
        try {
          initialBuffer = fs.readFileSync(writableDbPath);
          console.log('[DB] Loaded existing database from:', writableDbPath);
        } catch (e) {
          console.warn('[DB] Could not read database at', writableDbPath, e.message);
        }
      }

      // 2. If in serverless and /tmp is empty, try loading bundled seed from repo
      if (!initialBuffer && isServerless && fs.existsSync(localDbPath)) {
        try {
          initialBuffer = fs.readFileSync(localDbPath);
          console.log('[DB] Loaded bundled seed database into serverless memory.');
        } catch (e) {
          console.warn('[DB] Could not read bundled seed database:', e.message);
        }
      }

      // 3. Initialize SQLite WASM instance
      if (initialBuffer && initialBuffer.length > 0) {
        db = new SQL.Database(initialBuffer);
      } else {
        db = new SQL.Database();
        console.log('[DB] Initialized fresh in-memory SQLite database.');
      }

      // Enable foreign keys
      db.run('PRAGMA foreign_keys = ON;');

      // 4. Create Tables if not present
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS surveys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'draft',
          response_deadline TEXT,
          response_limit INTEGER,
          one_response_per_browser INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Backward-compatible migration for databases created before response deadlines.
      const surveyColumns = await dbAll('PRAGMA table_info(surveys)');
      if (!surveyColumns.some(column => column.name === 'response_deadline')) {
        db.run('ALTER TABLE surveys ADD COLUMN response_deadline TEXT');
      }
      if (!surveyColumns.some(column => column.name === 'response_limit')) {
        db.run('ALTER TABLE surveys ADD COLUMN response_limit INTEGER');
      }
      if (!surveyColumns.some(column => column.name === 'one_response_per_browser')) {
        db.run('ALTER TABLE surveys ADD COLUMN one_response_per_browser INTEGER NOT NULL DEFAULT 0');
      }
      if (!surveyColumns.some(column => column.name === 'collection_id')) {
        db.run('ALTER TABLE surveys ADD COLUMN collection_id INTEGER');
      }
      if (!surveyColumns.some(column => column.name === 'is_archived')) {
        db.run('ALTER TABLE surveys ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0');
      }
      if (!surveyColumns.some(column => column.name === 'is_pinned')) {
        db.run('ALTER TABLE surveys ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
      }
      if (!surveyColumns.some(column => column.name === 'target_responses')) {
        db.run('ALTER TABLE surveys ADD COLUMN target_responses INTEGER');
      }

      db.run(`
        CREATE TABLE IF NOT EXISTS collections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS survey_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          template_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS survey_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          survey_id INTEGER NOT NULL,
          note_text TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
        );
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS activity_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          survey_id INTEGER,
          action TEXT NOT NULL,
          details_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE SET NULL
        );
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS saved_views (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          view_type TEXT NOT NULL,
          survey_id INTEGER,
          filters_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
        );
      `);

      db.run('CREATE INDEX IF NOT EXISTS idx_surveys_collection ON surveys(collection_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_surveys_workspace ON surveys(is_archived, is_pinned, status)');
      db.run('CREATE INDEX IF NOT EXISTS idx_notes_survey ON survey_notes(survey_id, created_at DESC)');
      db.run('CREATE INDEX IF NOT EXISTS idx_activity_survey ON activity_logs(survey_id, created_at DESC)');
      db.run('CREATE INDEX IF NOT EXISTS idx_saved_views_type ON saved_views(view_type, survey_id)');

      db.run(`
        CREATE TABLE IF NOT EXISTS questions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          survey_id INTEGER NOT NULL,
          question_text TEXT NOT NULL,
          question_type TEXT NOT NULL,
          options_json TEXT,
          is_required INTEGER DEFAULT 1,
          sort_order INTEGER DEFAULT 0,
          FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
        );
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS responses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          survey_id INTEGER NOT NULL,
          submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
        );
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS answers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          response_id INTEGER NOT NULL,
          question_id INTEGER NOT NULL,
          answer_text TEXT,
          FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE,
          FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
        );
      `);

      // 5. Seed default admin if not existing
      const adminEmail = 'admin@research.local';
      const existingAdmin = await dbGet('SELECT id FROM users WHERE email = ?', [adminEmail]);
      if (!existingAdmin) {
        const defaultPassword = 'Admin123!';
        const passwordHash = hashPassword(defaultPassword);
        await dbRun(
          'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
          ['Research Admin', adminEmail, passwordHash]
        );
        console.log(`[SEED] Demo administrator created: ${adminEmail} (password: ${defaultPassword})`);
      }

      // 6. Auto-seed demo survey if surveys table is empty
      try {
        const surveyCountRow = await dbGet('SELECT COUNT(*) as count FROM surveys');
        if (!surveyCountRow || surveyCountRow.count === 0) {
          await seedDemoSurvey();
        }
      } catch (err) {
        console.warn('[SEED] Could not check or auto-seed demo survey:', err.message);
      }

      // Persist initial state
      persistDatabase();
      console.log('[DB] SQLite WASM Database engine fully ready.');
      return db;
    } catch (err) {
      console.error('[DB] Fatal error initializing WASM database:', err);
      dbInitPromise = null;
      throw err;
    }
  })();

  return dbInitPromise;
}

/**
 * Ensures database is initialized before any query execution
 */
async function ensureDb() {
  if (!db) {
    await initDatabase();
  }
  return db;
}

/**
 * Execute INSERT, UPDATE, DELETE, or DDL
 * Returns { lastID, changes }
 */
async function dbRun(sql, params = []) {
  await ensureDb();
  try {
    db.run(sql, params);
    const changes = db.getRowsModified();
    const lastRow = db.exec('SELECT last_insert_rowid() AS id');
    const lastID = (lastRow && lastRow[0] && lastRow[0].values && lastRow[0].values[0])
      ? lastRow[0].values[0][0]
      : 0;

    schedulePersist();
    return { lastID, changes };
  } catch (err) {
    throw err;
  }
}

/**
 * Fetch a single row object or undefined
 */
async function dbGet(sql, params = []) {
  await ensureDb();
  let stmt;
  try {
    stmt = db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params);
    }
    if (stmt.step()) {
      return stmt.getAsObject();
    }
    return undefined;
  } finally {
    if (stmt) {
      stmt.free();
    }
  }
}

/**
 * Fetch all matching rows as an array of objects
 */
async function dbAll(sql, params = []) {
  await ensureDb();
  let stmt;
  try {
    stmt = db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params);
    }
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    if (stmt) {
      stmt.free();
    }
  }
}

/**
 * Utility to hash a plain-text password using Node.js crypto (scrypt with SHA-256 fallback)
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  if (typeof crypto.scryptSync === 'function') {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }
  // Edge runtime fallback using sha256
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return `sha256:${salt}:${hash}`;
}

/**
 * Utility to verify a plain-text password against a stored salted hash
 */
function verifyPassword(password, storedHash) {
  try {
    if (!storedHash) return false;

    if (storedHash.startsWith('sha256:')) {
      const parts = storedHash.split(':');
      const salt = parts[1];
      const key = parts[2];
      const testHash = crypto.createHash('sha256').update(salt + password).digest('hex');
      return key === testHash;
    }

    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;

    if (typeof crypto.scryptSync === 'function') {
      const keyBuffer = Buffer.from(key, 'hex');
      const derivedKey = crypto.scryptSync(password, salt, 64);
      return crypto.timingSafeEqual(keyBuffer, derivedKey);
    }

    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Auto-seed sample survey with questions and 25 realistic responses
 */
async function seedDemoSurvey() {
  const surveyTitle = 'Customer Satisfaction Survey';
  const existing = await dbGet('SELECT id FROM surveys WHERE title = ?', [surveyTitle]);
  if (existing) return;

  const surveyResult = await dbRun(
    `INSERT INTO surveys (title, description, status, created_at, updated_at) 
     VALUES (?, ?, 'active', datetime('now', '-14 days'), datetime('now'))`,
    [
      surveyTitle,
      'A comprehensive research survey assessing user satisfaction, product engagement, and support quality across multiple digital touchpoints.'
    ]
  );
  const surveyId = surveyResult.lastID;

  const q1 = await dbRun(
    `INSERT INTO questions (survey_id, question_text, question_type, options_json, is_required, sort_order)
     VALUES (?, ?, 'rating', NULL, 1, 1)`,
    [surveyId, 'How satisfied are you with our service?']
  );

  const q2 = await dbRun(
    `INSERT INTO questions (survey_id, question_text, question_type, options_json, is_required, sort_order)
     VALUES (?, ?, 'multiple_choice', ?, 1, 2)`,
    [
      surveyId,
      'Which service do you use most?',
      JSON.stringify(['Website', 'Mobile Application', 'Customer Support', 'Other'])
    ]
  );

  const q3 = await dbRun(
    `INSERT INTO questions (survey_id, question_text, question_type, options_json, is_required, sort_order)
     VALUES (?, ?, 'yes_no', NULL, 1, 3)`,
    [surveyId, 'Would you recommend our service to colleagues or peers?']
  );

  const q4 = await dbRun(
    `INSERT INTO questions (survey_id, question_text, question_type, options_json, is_required, sort_order)
     VALUES (?, ?, 'text', NULL, 0, 4)`,
    [surveyId, 'What could we improve in our platform or delivery?']
  );

  const q1Id = q1.lastID;
  const q2Id = q2.lastID;
  const q3Id = q3.lastID;
  const q4Id = q4.lastID;

  const sampleData = [
    { dayOffset: 13, r: 4, mc: 'Website', yn: 'Yes', t: 'Faster search results would be great.' },
    { dayOffset: 12, r: 5, mc: 'Mobile Application', yn: 'Yes', t: 'Smooth experience overall.' },
    { dayOffset: 11, r: 3, mc: 'Website', yn: 'No', t: 'Navigation is slightly confusing on mobile browser.' },
    { dayOffset: 11, r: 4, mc: 'Customer Support', yn: 'Yes', t: 'Helpful support staff.' },
    { dayOffset: 10, r: 5, mc: 'Website', yn: 'Yes', t: 'Very clean interface.' },
    { dayOffset: 10, r: 4, mc: 'Mobile Application', yn: 'Yes', t: 'Love the quick notifications.' },
    { dayOffset: 9,  r: 2, mc: 'Customer Support', yn: 'No', t: 'Response took over 24 hours.' },
    { dayOffset: 9,  r: 5, mc: 'Website', yn: 'Yes', t: 'Excellent research features.' },
    { dayOffset: 8,  r: 4, mc: 'Mobile Application', yn: 'Yes', t: 'Add dark mode support.' },
    { dayOffset: 8,  r: 5, mc: 'Website', yn: 'Yes', t: 'Very dependable platform.' },
    { dayOffset: 6,  r: 5, mc: 'Website', yn: 'Yes', t: 'Everything works as expected.' },
    { dayOffset: 6,  r: 4, mc: 'Mobile Application', yn: 'Yes', t: 'Very responsive touch controls.' },
    { dayOffset: 5,  r: 5, mc: 'Website', yn: 'Yes', t: 'Clear data presentation.' },
    { dayOffset: 5,  r: 4, mc: 'Website', yn: 'Yes', t: 'Export to CSV is very useful.' },
    { dayOffset: 4,  r: 5, mc: 'Mobile Application', yn: 'Yes', t: 'Intuitive interface layout.' },
    { dayOffset: 4,  r: 3, mc: 'Other', yn: 'Yes', t: 'Documentation could have more code samples.' },
    { dayOffset: 4,  r: 5, mc: 'Website', yn: 'Yes', t: 'Great service and uptime.' },
    { dayOffset: 3,  r: 4, mc: 'Website', yn: 'Yes', t: 'Filter options on reports would help.' },
    { dayOffset: 3,  r: 5, mc: 'Mobile Application', yn: 'Yes', t: 'Zero bugs found so far.' },
    { dayOffset: 2,  r: 4, mc: 'Customer Support', yn: 'Yes', t: 'Quick resolution of ticket.' },
    { dayOffset: 2,  r: 2, mc: 'Website', yn: 'No', t: 'Encountered page reload on slow 3G.' },
    { dayOffset: 1,  r: 5, mc: 'Website', yn: 'Yes', t: 'High quality analytics overview.' },
    { dayOffset: 1,  r: 4, mc: 'Mobile Application', yn: 'Yes', t: 'Fast login and verification.' },
    { dayOffset: 0,  r: 5, mc: 'Website', yn: 'Yes', t: 'Exceeded my expectations.' },
    { dayOffset: 0,  r: 4, mc: 'Website', yn: 'Yes', t: 'Keep up the good work!' }
  ];

  for (const item of sampleData) {
    const respResult = await dbRun(
      "INSERT INTO responses (survey_id, submitted_at) VALUES (?, datetime('now', ?))",
      [surveyId, `-${item.dayOffset} days`]
    );
    const respId = respResult.lastID;

    await dbRun(
      'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
      [respId, q1Id, String(item.r)]
    );
    await dbRun(
      'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
      [respId, q2Id, item.mc]
    );
    await dbRun(
      'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
      [respId, q3Id, item.yn]
    );
    if (item.t) {
      await dbRun(
        'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
        [respId, q4Id, item.t]
      );
    }
  }
  console.log(`[SEED] Auto-seeded demo survey "${surveyTitle}" with 25 responses.`);
}

module.exports = {
  get db() { return db; },
  dbRun,
  dbGet,
  dbAll,
  initDatabase,
  hashPassword,
  verifyPassword,
  persistDatabase
};
