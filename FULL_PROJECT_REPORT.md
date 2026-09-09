# Research Survey Analytics Dashboard — Full Project Report

## 1. Executive Summary

**Research Survey Analytics Dashboard** is a full-stack web application built for academic researchers, university projects, and small research teams. It supports the complete survey lifecycle: secure administrator access, survey authoring, public response collection, data protection controls, analytics, export, and presentation-ready reporting.

The application was designed as a CSE499 internship/final-semester project. It deliberately uses a lightweight, transparent technology stack—HTML5, CSS3, Vanilla JavaScript, Node.js, Express, `express-session`, and `sql.js`—rather than a frontend framework or external charting library.

The current version includes a complete professional UI redesign. It retains the project’s original black, cream, and gray visual identity while improving layout, typography, accessibility, responsive behavior, navigation, form clarity, and reporting presentation.

---

## 2. Problem Statement

Academic researchers often need a focused way to build questionnaires, collect responses, and inspect results without the cost, vendor lock-in, or complexity of large commercial platforms. Manual spreadsheet analysis also makes it harder to produce timely evidence from response data.

This project addresses those needs with an integrated system that allows a researcher to:

- Create and publish research surveys.
- Collect anonymous public responses from a shareable link or QR code.
- Apply response deadlines, capacity limits, consent, and optional browser-level repeat-submission protection.
- Review distributions, ratings, trends, text responses, and deterministic research insights.
- Export CSV data, PNG chart images, and printable/PDF-ready reports.

---

## 3. Project Objectives

1. Provide a secure, easy-to-use administration area for survey management.
2. Support multiple research question formats without requiring respondent accounts.
3. Preserve research data integrity through validation, lifecycle controls, and relational storage.
4. Transform stored responses into understandable metrics and visualizations.
5. Keep the product lightweight and understandable for academic demonstration.
6. Provide professional presentation quality for internship defense and portfolio review.

---

## 4. Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript | Pages, forms, responsive UI, client interactions |
| Backend | Node.js and Express 4 | HTTP server, REST APIs, validation, authorization |
| Authentication | `express-session` | Cookie-based admin session management |
| Database | `sql.js` / SQLite | Embedded relational data storage |
| Password security | Node.js `crypto` with `scrypt` | Salted administrator password hashes |
| Charts | Native HTML5 Canvas | Custom question distribution visualizations |
| QR sharing | Local `qrcode-generator` library | Public survey QR generation and download |
| Deployment | Vercel configuration | Hosted production deployment |

### Key dependencies

- `express`
- `express-session`
- `sql.js`
- `qrcode-generator`

No React, Vue, Angular, Bootstrap, Tailwind, Chart.js, or D3.js is required.

---

## 5. System Architecture

```text
Browser
  │
  ├── Admin pages: login, dashboard, survey management, builder, analytics
  ├── Public page: participant survey form
  │
  ▼ HTTP / JSON / CSV
Express application (server.js)
  │
  ├── Session authentication and route protection
  ├── Survey and response validation
  ├── Analytics calculations and insight rules
  ├── CSV generation
  │
  ▼ Parameterized SQL
SQLite-compatible sql.js database (data/survey.db)
  │
  ├── users
  ├── surveys
  ├── questions
  ├── responses
  └── answers
```

### Architectural characteristics

- The browser communicates with REST endpoints using `fetch`.
- Administrator endpoints require an active session.
- Public survey viewing and submission are intentionally open to participants.
- The database is file-based and appropriate for a demonstration or small single-process deployment.
- Analytics are calculated from response records; no fabricated metrics are used.

---

## 6. Core Modules and Pages

| Page | Audience | Main purpose |
|---|---|---|
| `login.html` | Administrator | Sign in using the session-based authentication flow |
| `dashboard.html` | Administrator | View overall survey counts, active/closed status, total responses, and recent studies |
| `surveys.html` | Administrator | Search, filter, publish, close, edit, delete when safe, share, and open analytics |
| `create-survey.html` | Administrator | Create or edit survey metadata, settings, and questions |
| `survey.html` | Public participant | Complete a focused, mobile-friendly questionnaire |
| `analytics.html` | Administrator | Inspect metrics, automated insights, question distributions, exports, and print reporting |

Shared client utilities are held in `public/js/common.js`, including authentication initialization, navigation behavior, toasts, and reusable modal helpers.

---

## 7. Functional Features

### 7.1 Administrator authentication

- Login endpoint validates administrator credentials.
- Passwords are salted and hashed with Node’s `scrypt` primitive.
- Session middleware protects administrator-only APIs and pages.
- Logout destroys the current session.
- The local demo account is intended only for development and defense demonstration; production deployments should replace it with environment-managed credentials.

### 7.2 Survey lifecycle management

Each survey has one of three lifecycle states:

| Status | Meaning |
|---|---|
| Draft | Saved for later editing; not public |
| Active | Published and available to participants, subject to limits/deadlines |
| Closed | No longer accepts new responses |

Administrators can create, edit, publish, close, search, filter, share, and analyze surveys. Deletion is restricted when survey responses exist, protecting research data from accidental loss.

### 7.3 Supported question types

1. Short text
2. Multiple choice (2–6 options)
3. Rating scale (1–5)
4. Yes / No

The builder supports required questions, dynamic option editing, removal, and Up/Down reordering. When a survey already has recorded responses, question changes are locked to preserve response interpretation and research integrity.

### 7.4 Draft recovery and preview

- The builder saves a recovery copy in the administrator browser’s local storage after a short debounce interval.
- On return, the administrator can explicitly restore or discard a newer local copy.
- Browser recovery is not represented as a server-side autosave system.
- Preview renders the current unsaved questionnaire state in a modal.
- Preview mode cannot submit a public response or write respondent data.

### 7.5 Public survey participation

The public survey experience has no administrator sidebar and is intentionally focused on the participant task. It includes:

- Survey title, description, and research branding.
- Required-field validation.
- Live answer completion progress.
- A research participation notice and explicit consent checkbox.
- Rating, radio-choice, Yes/No, and text controls.
- Loading, closed, expired, full-capacity, duplicate-response, error, and thank-you states.
- Responsive controls suitable for phones and touch devices.

### 7.6 Survey sharing and QR code

For active surveys, administrators can open a sharing dialog containing:

- The public survey URL.
- Copy-to-clipboard support.
- A QR code generated locally in the browser.
- QR image download for printed material or presentations.

### 7.7 Response deadline

- An optional date/time field is stored as a UTC ISO timestamp.
- Blank means the researcher controls closure manually.
- An active survey cannot be published with a past deadline.
- After the deadline passes, public retrieval and submission are blocked with the `SURVEY_EXPIRED` code.
- Existing analytics and exported data remain available.

### 7.8 Maximum response limit

- Administrators can set an optional whole-number limit from 1 to 1,000,000.
- When capacity is reached, public viewing/submission is blocked using `SURVEY_RESPONSE_LIMIT_REACHED`.
- The server validates capacity during response admission and stores response data in a SQLite transaction.
- Lowering a limit does not delete existing responses.

### 7.9 Duplicate-response protection

- An administrator may enable one response per browser for an individual survey.
- After a successful response, the browser stores a survey-scoped completion marker containing only a version and timestamp.
- The marker does not contain survey answers, identity data, or a fingerprint.
- This is best-effort protection: another device, another browser, or cleared storage can submit again.

---

## 8. Analytics and Reporting

### Summary metrics

The analytics screen calculates and presents:

- Total response count.
- Average score across rating questions.
- Most recent response date.
- Seven-day response growth compared with the preceding seven-day period when a comparison baseline exists.

### Question-level analysis

| Question type | Analysis shown |
|---|---|
| Rating | Average, positive/neutral/negative breakdown, Canvas distribution |
| Multiple choice | Option counts, percentages, Canvas horizontal bars |
| Yes / No | Yes/No counts, percentages, Canvas comparison bars |
| Short text | Recent written responses |

### Date filtering

- Supports inclusive `from` and `to` date filters.
- Validates impossible calendar dates and reversed date ranges on the server.
- Updates metrics, charts, insights, CSV export, and print context together.
- Preserves all-time totals while showing the selected-period totals.

### Automated Research Insight Engine

The insight engine is deterministic and rule-based. It is not a machine-learning model and does not send research data to an external AI service.

Examples of insight logic include:

- Positive, neutral, and negative rating classifications.
- Rating averages and the most frequent rating.
- Most-selected multiple-choice option.
- Yes/No majority identification.
- Response-growth interpretation.

Every insight is labelled transparently as a rule-based summary generated from survey responses.

### Exports and presentation support

- RFC 4180-compatible CSV export.
- CSV filename includes the selected date range when filtering is active.
- Download individual Canvas charts as PNG images.
- Browser print stylesheet supports printing or saving analytics as PDF.

---

## 9. Database Model

```text
users ─────< surveys ─────< questions
                  │
                  └─────< responses ─────< answers >──── questions
```

### Principal entities

| Table | Selected fields | Purpose |
|---|---|---|
| `users` | id, name, email, password_hash | Administrator identity and credentials |
| `surveys` | title, description, status, response_deadline, response_limit, one_response_per_browser | Survey configuration and lifecycle |
| `questions` | survey_id, question_text, question_type, options_json, is_required, sort_order | Survey prompts and display order |
| `responses` | survey_id, submitted_at | One completed participant submission |
| `answers` | response_id, question_id, answer_text | Individual response values |

Foreign-key constraints are enabled to maintain relational consistency.

---

## 10. API Overview

### Authentication

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Administrator survey operations

- `GET /api/dashboard`
- `GET /api/surveys`
- `POST /api/surveys`
- `GET /api/surveys/:id`
- `PUT /api/surveys/:id`
- `DELETE /api/surveys/:id`
- `POST /api/surveys/:id/publish`
- `POST /api/surveys/:id/close`
- `GET /api/surveys/:id/analytics`
- `GET /api/surveys/:id/export.csv`

### Public participant operations

- `GET /api/public/surveys/:id`
- `POST /api/public/surveys/:id/responses`

Protected endpoints require a valid administrator session. Public endpoints enforce active status, deadlines, response limits, required question validation, and accepted input rules.

---

## 11. User Workflows

### Administrator workflow

1. Sign in.
2. Open the dashboard to review research activity.
3. Create a survey and enter title/description.
4. Add questions, choose question type, configure options, and mark required items.
5. Optionally configure deadline, response limit, and browser duplicate-response protection.
6. Preview the respondent form.
7. Save a draft or publish the survey.
8. Copy the public link or use the QR code.
9. Monitor responses in analytics.
10. Filter evidence, download CSV/PNG files, print/save PDF, or close the survey.

### Participant workflow

1. Open the shared public link or scan the QR code.
2. Read the survey information.
3. Answer the displayed questions.
4. Review progress and required fields.
5. Confirm research participation consent.
6. Submit once and receive confirmation.

---

## 12. UI/UX Redesign Summary

The interface was redesigned in seven delivered stages:

1. Shared design system and responsive application shell.
2. Administrator login experience.
3. Dashboard metrics and recent-survey workspace.
4. Survey management and filtering workspace.
5. Survey builder and action bar.
6. Focused public participant form.
7. Analytics reporting interface and final responsive polish.

### Design decisions

- Original black, cream, and gray palette retained.
- Professional rounded card system with subtle borders and restrained shadows.
- Persistent admin sidebar and compact contextual header.
- Clear visual hierarchy through labels, typography, whitespace, and status treatments.
- Mobile layouts convert sidebars and toolbars into usable single-column or drawer-friendly experiences.
- Public participant pages intentionally omit administrator navigation.
- No fake notifications, fabricated statistics, or unrelated project-management features were added.

---

## 13. Security and Data Integrity

### Implemented protections

- Salted password hashing using `scrypt`.
- Session-based administrator authorization.
- Parameterized SQL queries to reduce SQL injection risk.
- HTML escaping and `textContent` use for untrusted response values.
- Required-answer validation in both browser flow and server logic.
- Survey deletion safeguards after responses exist.
- Deadline and capacity enforcement on server-side public routes.
- Transactional response admission for the single Node.js process.
- Consent requirement before public response submission.

### Important deployment considerations

- This project is optimized for a single administrator and a small academic/demo environment.
- Browser duplicate protection is not identity verification.
- In a multi-instance production deployment, capacity enforcement should use a shared transactional database rather than a local embedded database.
- Production credentials, session secrets, HTTPS, backups, logging, rate limiting, and role-based access control should be configured through deployment environment settings.

---

## 14. Testing and Quality Assurance

### Automated suite

The project includes `test_suite.js`, which performs end-to-end API and asset checks.

Run it with:

```bash
node test_suite.js
```

The latest verified run completed with:

```text
62 PASSED, 0 FAILED
```

### Verified areas

- Valid and invalid administrator login.
- Session issuance and protected-route access control.
- Survey creation, question attachment, publication, closure, and deletion safeguards.
- Public survey loading and response submission.
- Required answer validation.
- Analytics totals, percentages, averages, trends, and rule-based insights.
- Date validation, filtered analytics, and filtered CSV generation.
- Deadlines, expiry behavior, and analytics preservation after expiry.
- Response limits, capacity enforcement, and limit-lowering safety.
- Browser duplicate-response protection settings and completion markers.
- Presence of the six main HTML pages and critical assets.
- Survey preview, local draft recovery, QR asset availability, and accessible chart PNG support.
- Workspace collections, target/limit validation, survey readiness, duplication, templates, private notes, saved views, pinning, archive/restore, activity history, and cross-survey comparison.

---

## 14A. Research Workspace Expansion

The research workspace adds structured organization without changing the three-state survey lifecycle. Administrators can group studies in Collections, set a non-blocking target sample size, pin important work, archive Draft/Closed studies, keep private research notes, and inspect an activity trail of successful administrative changes.

Templates and duplicate-survey actions create editable Draft surveys with copied questionnaire structure but without responses, answers, analytics, archive state, pins, or expired deadlines. Saved Views store validated workspace filters or analytics date ranges. The comparison feature accepts two to four authenticated survey IDs and shows actual stored/calculated collection metrics; missing rating data is shown as `—` rather than invented as zero.

### Manual browser verification completed during UI work

- Login and redirect behavior.
- Builder preview with disabled submission.
- Public answer-progress updates and consent interface.
- Closed-survey message state.
- Analytics metrics, date filters, Canvas charts, CSV export action, print/PDF action, and chart PNG buttons.

---

## 15. Installation and Local Run Guide

### Prerequisites

- Node.js 16 or newer.
- npm.

### Commands

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

Optional demo-data command:

```bash
node seed.js
```

The seed script provides a realistic sample dataset suitable for showing metrics, trends, charts, automated insights, filtering, CSV export, PNG chart download, and print/PDF reporting during a defense presentation.

---

## 16. Deployment

The repository contains a Vercel configuration and has been deployed through the connected GitHub repository:

- Repository: `monourhosan/Research-Survey-Analytics-Dashboard`
- Primary branch: `main`

For deployment verification, confirm that Vercel is configured with the correct Node/Express entry point and that the deployed environment supports the application’s database persistence requirements. Embedded file databases are appropriate for local development and demonstration; persistent hosted storage should be considered for long-term production usage.

---

## 17. Limitations and Future Enhancements

### Current limitations

- Single-administrator focus.
- Embedded database and single-process response-limit transaction scope.
- Browser-level duplicate-response control is best-effort rather than identity-based.
- No email invitations, external identity provider, or notification system.
- No multi-language survey interface.

### Recommended future work

1. Role-based access control for researchers, collaborators, and reviewers.
2. Persistent managed database for multi-instance hosting.
3. Email invitations and respondent reminder scheduling.
4. Survey templates and reusable question libraries.
5. More advanced analytics, cross-tabulation, and demographic segmentation where ethically appropriate.
6. Multiple language support and accessibility preference settings.
7. Data retention controls and researcher-configurable privacy notices.
8. Exportable complete report bundles combining CSV, charts, and PDF summaries.

---

## 18. Conclusion

Research Survey Analytics Dashboard demonstrates a complete research-data workflow in a compact full-stack web application. It balances practical functionality with an explainable technical architecture: administrators can author and control surveys, participants can submit focused responses, and researchers can turn those responses into metrics, visual evidence, exports, and transparent rule-based insights.

The completed UI redesign makes the system suitable for an internship defense, final project demonstration, and portfolio presentation while preserving the original Vanilla JavaScript, Express, and `sql.js` architecture.

---

## 19. Key Project Files

```text
server.js                       Express API server and business rules
database.js                     sql.js database initialization and schema
seed.js                         Demonstration dataset generator
test_suite.js                   Automated verification suite
public/login.html               Administrator sign-in interface
public/dashboard.html           Dashboard overview
public/surveys.html             Survey management workspace
public/create-survey.html       Survey builder and editor
public/survey.html              Public participant survey
public/analytics.html           Analytics and reporting interface
public/css/styles.css           Shared design system and responsive styling
public/js/common.js             Shared frontend utilities
public/js/create-survey.js      Builder logic, draft recovery, preview
public/js/survey.js             Public response handling and progress
public/js/analytics.js          Analytics rendering, Canvas charts, exports
```
