# Research Survey Analytics Dashboard
## Comprehensive Web Application Report

**Project type:** CSE499 final-semester internship project
**Application style:** Full-stack research survey, collaboration, and analytics platform
**Technology stack:** HTML5, CSS3, Vanilla JavaScript, Node.js, Express, `sql.js`/SQLite, Canvas API
**Report scope:** Current completed implementation, including the collaborative workspace and security improvements.

---

## 1. Executive Summary

Research Survey Analytics Dashboard is a self-contained web application for the complete survey research workflow. Researchers can create surveys, share a public respondent link, collect responses, analyze results, export data, and manage research work in a single system.

The application was designed as a lightweight academic project without React, Vue, Chart.js, or an external database service. The user interface is built with HTML, CSS, and Vanilla JavaScript. The backend is an Express application, and data is stored in a SQLite-compatible database provided by `sql.js`.

The final version supports two collaboration roles:

- **Administrator** — has all research-workspace permissions and can manage Team Member accounts.
- **Team Member** — can create and manage research work, surveys, analytics, collections, templates, notes, and exports, but cannot manage accounts or security controls.

Public respondents do not need an account. Their routes are separate from the administrative workspace and do not expose team or internal research-management data.

---

## 2. Problem Statement

Academic researchers often need a private, affordable, and understandable way to design questionnaires and analyze participant feedback. Commercial tools can create vendor lock-in, recurring subscription costs, data-location concerns, and interfaces that are unnecessarily complex for smaller research projects.

This project addresses that problem by providing a locally deployable research system that combines:

1. Survey authoring.
2. Public data collection.
3. Live research operations monitoring.
4. Statistical analysis and visualization.
5. CSV export and printable reports.
6. Small-team collaboration with server-side access control.

---

## 3. Objectives

- Create structured surveys with reusable question types.
- Allow respondents to submit answers through a public URL.
- Prevent invalid, expired, duplicate, or over-capacity submissions.
- Provide clear quantitative analytics and deterministic research insights.
- Support CSV, PNG chart, QR-code, and print/PDF workflows.
- Let a research team organize surveys, templates, notes, and saved views.
- Protect accounts with password hashing, active-account checks, and role authorization.
- Maintain an understandable, defense-ready architecture built from standard web technologies.

---

## 4. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript | Accessible responsive pages, dynamic UI, dialogs, Canvas rendering |
| Backend | Node.js + Express | REST APIs, validation, authorization, analytics logic |
| Database | `sql.js` SQLite-compatible database | Relational persistence without a native database dependency |
| Security | Node.js `crypto` | Salted `scrypt` password hashes, signed session cookies |
| QR codes | `qrcode-generator` | Local public-survey QR-code generation |
| Charts | Native HTML5 Canvas | High-DPI survey charts and downloadable PNG images |
| Deployment | Wasmer Edge and Vercel-compatible configuration | Hosted runtime support |
| Verification | `node test_suite.js` | Automated backend, security, public-flow, and regression testing |

The project deliberately keeps its dependency footprint small. It does not require a frontend framework, native SQLite binding, or external analytics service.

---

## 5. High-Level Architecture

```text
Browser
  ├─ Public respondent pages
  └─ Authenticated research workspace
             │ HTTPS / JSON / CSV
             ▼
Express Application (server.js)
  ├─ Authentication and role guards
  ├─ Survey and response APIs
  ├─ Dashboard and analytics calculations
  ├─ Workspace, template, collection, and activity APIs
  └─ Public respondent APIs
             │ Parameterized queries
             ▼
sql.js / SQLite-compatible database (database.js)
  ├─ Users and activity records
  ├─ Surveys and questions
  ├─ Responses and answers
  └─ Workspace metadata
```

`database.js` initializes the schema, performs safe idempotent migrations, seeds a demonstration administrator and sample survey when needed, and persists the database where the environment permits it.

---

## 6. Main Functional Modules

### 6.1 Authentication and Collaboration

- Separate Administrator and Team Member login choices.
- Server-side verification of the stored role; changing a browser request cannot elevate an account.
- Secure salted password hashing with Node.js `scrypt`.
- Active/inactive account state.
- Administrator-only Team Members settings page.
- Add, edit, disable, reactivate, and reset Team Member accounts.
- Soft removal: disabling an account preserves history and never deletes survey data.
- Temporary passwords for created/reset members.
- Mandatory password replacement before a temporary-password account can access workspace APIs.
- Personal **Account & Security** page for password changes.
- Signed portable session identity cookie that avoids hosted-worker login/dashboard loops.
- Each protected request reloads the user record, so disabled users lose access on their next request.

### 6.2 Survey Authoring

Researchers can create and edit survey drafts with:

- Survey title and research description.
- Required or optional questions.
- Short-text, multiple-choice, rating (1–5), and yes/no question types.
- Multiple-choice option validation.
- Question ordering controls.
- Draft, active/published, and closed states.
- Preview before publishing.
- Browser-local draft recovery for unsaved work.
- Readiness checklist before publishing.
- Optional response deadline.
- Optional response capacity limit.
- Optional one-response-per-browser protection.
- Optional response target for research-progress tracking.

### 6.3 Public Respondent Experience

Public survey pages are intentionally independent from workspace accounts.

- Respondents access an active survey through `/survey.html?id=<surveyId>`.
- Required questions and consent are validated.
- Expired surveys return a clear `SURVEY_EXPIRED` state.
- Full surveys return a clear response-limit state.
- Submissions are validated server-side before answers are stored.
- Optional browser completion markers reduce accidental repeat responses.
- A completion page confirms a successful submission.
- Public APIs do not expose internal accounts, notes, activity, password data, or workspace metadata.

### 6.4 Analytics and Research Insights

Analytics are available to authenticated Administrator and Team Member accounts.

- Total responses and latest response time.
- Average rating calculations.
- Multiple-choice counts and percentages.
- Date-filtered totals, charts, insights, and exports.
- Seven-day response growth comparison.
- Native Canvas bar and rating charts.
- High-DPI chart rendering for projectors and high-resolution displays.
- Downloadable chart PNG files.
- Print-friendly layout and browser Save as PDF support.
- RFC 4180-compatible CSV export.
- Rule-based automated insights based on computed values rather than a hidden AI model.

### 6.5 Dashboard Operations

The dashboard is more than a static overview. It provides operational research awareness through:

- Survey portfolio metrics.
- Attention-required panel for approaching deadlines, capacity warnings, and readiness issues.
- 7/30/90-day global response activity chart.
- Live Response Pulse using bounded authenticated polling.
- UTC-aligned 84-day response calendar heatmap.
- Upcoming deadline and response-target monitoring.
- Recent activity timeline.
- Research Health Score, a deterministic and explainable operational indicator.
- Milestones and achievement badges.
- Quick actions.
- Command palette opened with Ctrl/Cmd + K.

### 6.6 Research Workspace Management

- Collections for grouping surveys.
- Pinning important surveys.
- Safe archive and restore operations.
- Reusable survey templates.
- Duplicate survey drafts without copying respondent answers.
- Private research notes excluded from public routes and exports.
- Saved workspace and analytics views.
- Comparison of two to four real surveys.
- Activity history with actor attribution for newly recorded authenticated actions.

---

## 7. Database Design

| Table | Main purpose |
|---|---|
| `users` | Account identity, role, active state, salted password hash, login metadata, temporary-password state |
| `surveys` | Survey configuration, lifecycle status, deadlines, capacity, targets, collection/archive/pin state |
| `questions` | Ordered survey questions and question configuration |
| `responses` | Accepted survey submissions and timestamps |
| `answers` | Individual answers belonging to responses and questions |
| `collections` | Named survey groups |
| `survey_templates` | Reusable survey templates stored as safe configuration data |
| `survey_notes` | Private workspace notes associated with surveys |
| `activity_logs` | Research and account activity, survey reference, safe details, and nullable actor reference |
| `saved_views` | Persisted workspace and analytics filters |

### Data Integrity

- Foreign keys are enabled.
- Important input values are validated server-side.
- SQL parameters are used instead of string-built queries.
- Schema migration checks are idempotent, allowing older databases to gain new columns without destroying existing data.
- Activity actor references are nullable, so historical activity remains valid.

---

## 8. Authorization Model and Route Audit

| Route category | Access rule |
|---|---|
| Public respondent APIs: `/api/public/*` | Public |
| Login/logout/current-session APIs | Public where appropriate |
| Password change API | Active signed-in account only |
| Dashboard, surveys, analytics, exports, collections, templates, notes, saved views, comparisons, activity | Active authenticated Administrator or Team Member |
| Team member management: `/api/team-members/*` | Administrator only |
| Static public survey assets | Public |

The server enforces authorization. UI hiding is only a convenience and is never the security boundary.

### Two-Role Capability Summary

| Capability | Administrator | Team Member |
|---|:---:|:---:|
| Dashboard and analytics | Yes | Yes |
| Create/edit/publish/close surveys | Yes | Yes |
| Exports, collections, templates, notes, comparisons | Yes | Yes |
| Archive and restore | Yes | Yes |
| Account and password change | Yes | Yes |
| Manage Team Members | Yes | No |
| Disable/reactivate/reset member passwords | Yes | No |

The system intentionally does not claim granular per-survey permission rules, multiple-owner administration, or additional roles such as Viewer or Manager.

---

## 9. Security Measures

1. Passwords are never stored as plaintext.
2. Passwords are salted and hashed with `scrypt`.
3. Password hashes, salts, sessions, and temporary passwords are excluded from safe account APIs.
4. Session cookies store only a signed, expiring identity payload.
5. Each protected request verifies that the user still exists, is active, and has a valid role.
6. Disabling a member blocks new logins and active sessions on their next protected request.
7. Temporary/reset passwords require a password change before workspace use.
8. Password changes verify the current password, apply server-side length validation, and rotate the session identity.
9. Server-side role checks prevent request-body or query-string role escalation.
10. Activity actors come from the trusted signed-in user, not client input.
11. Private notes, answers, and team data are not exposed through public respondent routes.

---

## 10. Deployment and Runtime Notes

The project contains configuration for serverless/Vercel-compatible deployment and a Wasmer Edge application configuration.

- The app serves HTML, CSS, JavaScript, and APIs from the Express process.
- `sql.js` supports WebAssembly SQLite execution and a fallback when the runtime cannot load the WASM file.
- The session implementation uses a signed portable cookie rather than a process-memory store, which prevents hosted login/dashboard switching when workers restart or requests are handled independently.
- A health endpoint is available at `/api/health`.

Recommended deployment practice:

1. Set a unique production `SESSION_SECRET` environment variable.
2. Use HTTPS in production.
3. Keep the database storage path on persistent storage if long-term hosted persistence is required.
4. Run the automated suite before publishing a release.

---

## 11. Automated Verification

The project includes `test_suite.js`, which starts the Express app using an isolated temporary database and exercises key user flows.

Latest verified result:

```text
108 passed, 0 failed
```

The suite covers, among other checks:

- Administrator and Team Member authentication.
- Role selection and role-injection protection.
- Admin-only team-management APIs.
- Add, edit, disable, reactivate, and reset-password behavior.
- Forced temporary-password change flow.
- Personal password changes.
- Existing-session invalidation after disabling a user.
- Activity actor attribution and spoofing protection.
- Survey creation, question storage, publishing, closing, deadlines, and capacity limits.
- Public response validation and privacy isolation.
- Analytics calculations, date filters, exports, response pulse, and heatmap logic.
- Collections, templates, notes, saved views, comparisons, archive/restore, and dashboard features.
- Static page and critical asset availability.

Run verification with:

```bash
node test_suite.js
node --check server.js
git diff --check
```

---

## 12. Important Project Files

| File or folder | Responsibility |
|---|---|
| `server.js` | Express app, routing, authorization, analytics, export, public APIs |
| `database.js` | SQLite initialization, migrations, persistence, password utilities |
| `test_suite.js` | Automated regression and security verification |
| `public/dashboard.html` | Main research operations dashboard |
| `public/create-survey.html` | Survey builder and editing UI |
| `public/survey.html` | Public respondent survey UI |
| `public/analytics.html` | Survey analytics and export UI |
| `public/settings.html` | Administrator Team Members settings |
| `public/account.html` | Personal account and password security page |
| `public/js/` | Page controllers and shared browser behavior |
| `public/css/styles.css` | Shared responsive visual system |
| `app.yaml` | Wasmer runtime configuration |
| `vercel.json` | Vercel-compatible build configuration |

---

## 13. Defense Demonstration Flow

For an internship defense, a concise demonstration can follow this order:

1. Open the login page and explain Administrator versus Team Member access.
2. Sign in as an Administrator and show the dashboard metrics, live pulse, heatmap, attention list, and health score.
3. Create a short draft survey and add different question types.
4. Open Preview, explain the readiness checks, then publish the survey.
5. Use the public link or QR code to demonstrate the respondent experience.
6. Submit a valid response and return to analytics.
7. Show date filters, deterministic insights, CSV export, PNG chart download, and print/PDF preparation.
8. Open Settings → Team Members and demonstrate controlled collaboration management.
9. Explain disabling a member and mandatory password changes as security controls.
10. Show the activity timeline and explain actor attribution.
11. Close or archive a survey and explain that historical analytics and responses remain protected.

---

## 14. Limitations and Future Scope

The current application is complete for its intended academic scope, but possible future enhancements include:

- Email invitations and real password-delivery workflows.
- Password-recovery email service.
- Granular survey-level permissions.
- Multiple administrator-owner support with safeguards.
- External persistent managed database for large-scale multi-instance deployment.
- Formal audit export and richer activity filtering.
- Advanced statistical analysis and configurable research reports.
- Optional respondent anonymity notices, localization, and accessibility audits with real users.

These are future improvements. The current implemented scope is accurately a two-role Administrator/Team Member collaboration model.

---

## 15. Conclusion

Research Survey Analytics Dashboard demonstrates a complete full-stack web application lifecycle: secure account access, survey creation, public data collection, analytics, visualization, export, collaborative workspace organization, and activity tracking.

Its main strengths are the transparent Vanilla JavaScript architecture, server-side validation and authorization, explainable rule-based analytics, privacy separation between public respondents and researchers, and an automated test suite that verifies both core functionality and security-sensitive workflows.

This makes the project suitable as an internship-defense artifact because both its user-facing features and its implementation decisions can be demonstrated clearly.
