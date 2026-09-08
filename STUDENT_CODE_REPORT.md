# Student Code Review Report: Important Parts You Must Know
**Project:** Research Survey Analytics Dashboard (CSE499 Internship Project)

This guide walks you through the exact lines and functions in your codebase that you should review before your presentation. University teachers typically focus on **database integrity, authentication security, API structure, algorithms, and visualization logic**.

---

## 1. Quick Overview of What Was Built

You have a complete, 3-tier web application built with zero complex frameworks:

1. **Frontend**: Pure HTML5, CSS3 (using `:root` custom properties), and Vanilla JavaScript.
2. **Backend**: Node.js with Express.js REST APIs and `express-session`.
3. **Database**: SQLite3 with enforced relational integrity (`PRAGMA foreign_keys = ON;`).
4. **Visualizations**: Native HTML5 `<canvas>` 2D context charts (no Chart.js).
5. **Signature Feature**: Deterministic Rule-Based **Automated Insight Engine** (pure JavaScript logic, not AI).
6. **Data Portability**: Built-in RFC 4180 CSV export generator.

---

## 2. The 7 Most Important Code Sections to Study

Here are the 7 core components your professors are most likely to ask about, along with the exact files and lines:

---

### Part 1: SQLite Schema & Relational Integrity
- **File**: `database.js` (Lines 35–135)
- **Key Concepts**: Relational tables, `PRAGMA foreign_keys = ON`, `CASCADE` deletes.

```javascript
// database.js (Line 35)
// By default, SQLite has foreign keys turned OFF. You MUST enable them:
db.run('PRAGMA foreign_keys = ON;', (err) => {
  if (err) console.error('Failed to enable foreign keys:', err.message);
});
```

#### Why it matters in defense:
Teachers love asking: *"What happens to questions and responses if a survey is deleted?"*
- **Your Answer**: *"Because I added `ON DELETE CASCADE` to foreign keys, child rows in `questions`, `responses`, and `answers` are automatically cleaned up if their parent survey is removed. Also, I explicitly block deleting surveys that have active responses to prevent accidental data loss."*

---

### Part 2: Password Security Using Node.js Built-in `crypto`
- **File**: `database.js` (Lines 42–66)
- **Key Concepts**: `scrypt`, cryptographic salts, timing attack prevention.

```javascript
// database.js (Line 42)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  // Uses timingSafeEqual to avoid timing attacks
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}
```

#### Why it matters in defense:
Teachers will ask: *"How are passwords stored in your database?"*
- **Your Answer**: *"Passwords are never stored in plain text. I used Node's built-in `crypto.scryptSync` with a 16-byte random salt. Verification uses `crypto.timingSafeEqual` so attackers cannot measure response times to guess passwords."*

---

### Part 3: Session Authentication Middleware
- **File**: `server.js` (Lines 44–52)
- **Key Concepts**: Express middleware, HTTP 401 Unauthorized, cookies.

```javascript
// server.js (Line 44)
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ 
      error: 'Unauthorized: Please log in to access this resource' 
    });
  }
  next();
}
```

#### Why it matters in defense:
Teachers will ask: *"How do you prevent unauthorized users from seeing the dashboard or deleting surveys?"*
- **Your Answer**: *"I created a `requireAuth` middleware. Any admin route passes through this function first. If the session cookie does not contain a valid `userId`, the request is immediately rejected with HTTP 401."*

---

### Part 4: The Automated Research Insight Engine
- **File**: `server.js` (Lines 465–660)
- **Key Concepts**: Deterministic rule-based algorithms, percentages, modes, averages.

```javascript
// server.js (Line 550)
// Rating questions: compute mean, positive %, and sentiment rules
const avg = answeredCount > 0 ? Math.round((sum / answeredCount) * 10) / 10 : 0;
const positivePct = answeredCount > 0 ? Math.round((positiveCount / answeredCount) * 100) : 0;

if (positivePct >= 70) {
  insights.push(`${positivePct}% of respondents reported a positive rating (4 or 5 stars).`);
}

if (overallRatingAvg >= 4.0) {
  insights.unshift('Overall respondent sentiment is strongly positive based on average rating metrics.');
}
```

#### Why it matters in defense:
Teachers will ask: *"Is this Artificial Intelligence or Machine Learning?"*
- **Your Answer**: *"No. It is a deterministic rule-based engine written in pure JavaScript. It computes exact descriptive statistics (averages, distributions, modes) and generates factual, verifiable statements. This guarantees 100% explainability and zero hallucination."*

---

### Part 5: 7-Day Trend Velocity Calculation
- **File**: `server.js` (Lines 430–464)
- **Key Concepts**: Date arithmetic, SQLite `datetime('now', '-7 days')`, relative percentage change.

```javascript
// server.js (Line 432)
// Compares responses in [Now - 7 days, Now] vs [Now - 14 days, Now - 7 days]
const change = Math.round(((currentPeriod - previousPeriod) / previousPeriod) * 100);
growthLabel = change >= 0 ? `+${change}%` : `${change}%`;
```

#### Why it matters in defense:
Teachers will ask: *"How do you calculate response growth?"*
- **Your Answer**: *"I query responses submitted in the latest 7-day window and compare them against responses submitted in the previous 7-day window using standard percentage change: `((current - previous) / previous) * 100`. If there's no historical baseline, the system displays a clear note rather than fake numbers."*

---

### Part 6: Native RFC 4180 CSV Exporter (No Packages)
- **File**: `server.js` (Lines 665–728)
- **Key Concepts**: Text formatting, HTTP response headers, escaping commas and quotes.

```javascript
// server.js (Line 667)
function escapeCsv(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  // Fields with commas, quotes, or newlines must be double-quoted:
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Set standard download headers:
res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.setHeader('Content-Disposition', `attachment; filename="survey_${survey.id}.csv"`);
res.status(200).send(csvContent);
```

#### Why it matters in defense:
Teachers will ask: *"Did you use an npm library to generate CSVs?"*
- **Your Answer**: *"No. I implemented RFC 4180 escaping directly in JavaScript and streamed the result with `Content-Type: text/csv`. This demonstrates core protocol understanding without third-party dependencies."*

---

### Part 7: Pure HTML5 Canvas Chart Rendering
- **File**: `public/js/analytics.js` (Lines 265–330)
- **Key Concepts**: `<canvas>`, 2D rendering context (`ctx`), High-DPI scaling (`window.devicePixelRatio`).

```javascript
// public/js/analytics.js (Line 265)
function drawHorizontalBarChart(canvasId, data, defaultColor = '#1e3a8a') {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Scale canvas internally for sharp display on projector screens:
  canvas.width = displayWidth * dpr;
  canvas.height = totalHeight * dpr;
  ctx.scale(dpr, dpr);

  // Draw labels, background track, filled bar, and percentage values:
  data.forEach((item, index) => {
    // ... draws proportional bars and text using ctx.fillText and roundRect ...
  });
}
```

#### Why it matters in defense:
Teachers will ask: *"Why didn't you use Chart.js?"*
- **Your Answer**: *"Using native HTML5 `<canvas>` proves foundational proficiency in the browser's 2D graphics API, reduces page weight to zero external scripts, and ensures the charts render smoothly and crisply on any projector or laptop."*

---

## 3. Recommended Study Order Before Defense

1. **Step 1**: Read `DEFENSE_GUIDE.md` — Memorize the 30-second introduction and the 5-minute live demo steps.
2. **Step 2**: Open `database.js` — Review the 5 database tables and `hashPassword()`.
3. **Step 3**: Open `server.js` — Review how `/api/surveys/:id/analytics` calculates insights.
4. **Step 4**: Open `public/js/analytics.js` — Understand `drawHorizontalBarChart()`.
5. **Step 5**: Run the app locally (`npm start`) and practice the 5-minute demo on `http://localhost:3000`.
