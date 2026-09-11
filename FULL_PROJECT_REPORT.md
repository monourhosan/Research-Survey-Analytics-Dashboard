# Research Survey Analytics Dashboard

## Complete Project Report

**Project type:** Full-stack research survey and analytics web application

**Primary stack:** HTML5, CSS3, Vanilla JavaScript, Node.js, Express, `sql.js`

**Application model:** Single-administrator research workspace with public respondent surveys

**Prepared for:** Internship Defense / CSE499 project presentation

---

## 1. Executive Summary

Research Survey Analytics Dashboard is a lightweight, full-stack web application for designing research surveys, sharing them with respondents, collecting answers, and turning submitted data into practical analytics. It is designed for academic research and internship-defense demonstrations where the researcher needs a controlled survey workflow without depending on a third-party form platform.

The application separates administrator and participant experiences. An authenticated administrator can create, edit, preview, publish, organize, analyze, archive, and reuse surveys. A respondent can open a public survey link, provide consent, answer questions, and submit a response without creating an account. The administrator then receives aggregated metrics, question-level charts, CSV exports, printable reports, and deterministic automated insights.

The project keeps its architecture intentionally transparent. The frontend uses standard browser technologies with no frontend framework, the backend is Express, and the relational data is stored through `sql.js`. This makes the source code easy to explain, demonstrate, deploy, and maintain.

---

## 2. Problem Statement

Researchers often need an affordable and privacy-conscious way to collect structured feedback and analyze it quickly. Generic form tools may introduce subscription costs, limited control over the respondent experience, vendor dependency, or a workflow that does not fit a particular research project.

Manual spreadsheet analysis also takes time and increases the chance of calculation or reporting mistakes. This project addresses those issues by providing a complete survey lifecycle in one application:

- Create structured research instruments.
- Publish a controlled public response link.
- Enforce deadlines, response limits, and required answers.
- Monitor collection activity and sample-size progress.
- Analyze survey outcomes immediately.
- Export response data and presentation-ready charts.

---

## 3. Project Objectives

1. Provide a secure administrator workspace for managing research surveys.
2. Let researchers author multiple question types without programming.
3. Make public survey participation simple on desktop and mobile browsers.
4. Preserve data integrity through server-side validation and transactional writes.
5. Produce clear analytics, statistics, charts, and downloadable records.
6. Support repeatable research work through templates, collections, saved views, and draft recovery.
7. Provide a polished, responsive interface suitable for an internship defense demonstration.

---

## 4. User Roles

### Administrator / Researcher

The administrator signs in through a session-protected account and can:

- Create, edit, preview, duplicate, publish, close, archive, restore, and pin surveys.
- Build questions, configure collection rules, and review readiness checks.
- Organize studies in research collections.
- Add private notes and inspect activity history.
- Save templates, create new surveys from templates, and save reusable views.
- Review analytics, date-filter data, download CSV files and chart PNG files, and print reports.

### Public Respondent

The respondent can:

- Open an active survey using its public URL or QR code.
- Review the research description and participation notice.
- Provide required consent and answer required questions.
- Submit one response, subject to the survey's active status, deadline, capacity, and optional browser duplicate-response setting.

---

## 5. Main Functional Features

### 5.1 Administrator Authentication

- Session-based login and logout.
- Password hashing based on Node.js `crypto` with `scrypt` and salts.
- Protected API routes and protected administration pages.
- Demonstration credentials available locally for defense use.

### 5.2 Survey Authoring

- Create surveys with a title and research description.
- Edit existing drafts and preserved survey content.
- Create four supported question types:
  - Short text
  - Multiple choice
  - Rating (1–5)
  - Yes / No
- Mark questions as required.
- Reorder and remove questions before publication.
- Preview the exact current builder state without creating a response.

### 5.3 Survey Lifecycle and Collection Controls

- Draft, active, and closed survey statuses.
- Server-side validation before a survey is published.
- Optional response deadline stored in UTC.
- Optional maximum response limit from 1 to 1,000,000.
- Optional target response count, separate from the hard maximum response limit.
- Clear public messages when a survey is expired, closed, inactive, or full.
- Optional one-response-per-browser protection using a survey-scoped browser marker.

### 5.4 Research Workspace Expansion

The Research Workspace functionality extends the original survey manager into a practical research operations interface.

- **Collections:** Group related studies in named collections with descriptions and collection-level progress summaries.
- **Pinned studies:** Keep priority surveys at the top of the inventory.
- **Archive and restore:** Safely remove draft or closed studies from the normal view without deleting their data.
- **Readiness checklist:** Evaluate title, questions, options, deadline, target, and capacity consistency before publishing.
- **Duplicate surveys:** Make an editable draft copy of a survey while excluding responses and response history.
- **Templates:** Save a survey structure as a reusable template, rename or delete it, and create a new draft from it.
- **Private notes:** Store administrator-only research notes which are never exposed through public survey routes or CSV export.
- **Activity trail:** Log important workspace actions such as creation, updates, publishing, archiving, pinning, and template work.
- **Saved views:** Save validated survey-list filters and analytics date ranges for reuse.
- **Cross-survey comparison:** Compare two to four surveys using live response, target, deadline, rating, and recent-collection metrics.

### 5.5 Public Survey Experience

- Dedicated respondent-facing survey page.
- Responsive, distraction-free layout.
- Consent confirmation before submission.
- Client-side guidance plus server-side enforcement for required answers.
- Clear success screen after accepted submission.
- QR-code sharing for phone-scannable access.

### 5.6 Analytics and Reporting

- Total response count.
- Average rating calculation.
- Latest response timestamp.
- Seven-day response growth comparison.
- Question-level response distributions and percentages.
- HTML5 Canvas chart rendering without Chart.js or D3.
- Rule-based automated research insight summary.
- Inclusive date filters for metrics, charts, insights, and exports.
- RFC 4180-compliant CSV export.
- Downloadable PNG copies of chart visuals.
- Browser print layout for a PDF-ready analytics report.
- Saved analytics date-range views.

### 5.7 Draft Recovery

- Builder changes are debounced and saved locally in the administrator browser.
- A newer unsaved draft can be restored or discarded explicitly.
- Local recovery data is cleared only after a successful server save.
- This feature is intentionally local browser recovery, not server-side collaboration or cloud autosave.

---

## 6. Technology Stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | HTML5 | Page structure and accessible form controls |
| Styling | CSS3 | Design system, responsive layout, cards, sidebar, dialogs, print rules |
| Frontend logic | Vanilla JavaScript | UI state, API calls, rendering, filters, Canvas charts |
| Backend | Node.js | Server runtime |
| Web framework | Express | Routing, static files, API endpoints, session integration |
| Database engine | `sql.js` | SQLite-compatible relational persistence using WebAssembly |
| Authentication | `express-session`, Node `crypto` | Session state and password hashing |
| Charts | HTML5 Canvas | Native chart visualizations and PNG output |
| Deployment | Vercel-compatible Node deployment configuration | Hosted application build and routing |

No frontend framework or external charting library is required. This decision makes the project smaller, easier to inspect, and suitable for explaining core web-development concepts during a defense.

---

## 7. System Architecture

```text
Administrator Browser / Public Respondent Browser
                │
                │ HTML, CSS, JavaScript, Fetch API
                ▼
         Express.js Application Server
         ├─ Authentication and session guard
         ├─ Survey lifecycle and validation API
         ├─ Public response submission API
         ├─ Analytics and export API
         └─ Research Workspace API
                │
                │ Parameterized SQL queries
                ▼
           sql.js / SQLite Database
         ├─ users
         ├─ surveys / questions
         ├─ responses / answers
         ├─ collections / templates
         ├─ notes / activity logs
         └─ saved views
```

The server is the authority for all state-changing business rules. The browser improves usability with immediate feedback, but it cannot bypass active status, response deadlines, response limits, authentication, or validation rules.

---

## 8. Database Design

### Core Tables

| Table | Purpose |
|---|---|
| `users` | Administrator account records and password data |
| `surveys` | Survey identity, description, lifecycle state, settings, targets, and workspace status |
| `questions` | Survey questions, type, options, required flag, and sort order |
| `responses` | One accepted submission per response event |
| `answers` | Individual answers associated with a response and question |

### Research Workspace Tables

| Table | Purpose |
|---|---|
| `collections` | Named groups of related research studies |
| `survey_templates` | Reusable JSON representations of survey structures |
| `survey_notes` | Private administrator notes for a study |
| `activity_logs` | Audit-style records of important administrator actions |
| `saved_views` | Reusable workspace filters and analytics date ranges |

### Important Survey Fields

- `status`: `draft`, `active`, or `closed`
- `response_deadline`: optional UTC deadline
- `response_limit`: optional hard maximum number of accepted responses
- `target_responses`: optional research sample-size goal
- `one_response_per_browser`: optional browser-level duplicate protection
- `collection_id`: optional collection membership
- `is_archived`: workspace archive state
- `is_pinned`: workspace priority state

The schema is migrated defensively, so existing databases gain new workspace fields and tables without deleting prior survey records.

---

## 9. Key API Groups

### Authentication

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Survey Management

- `GET /api/dashboard`
- `GET /api/surveys`
- `POST /api/surveys`
- `GET /api/surveys/:id`
- `PUT /api/surveys/:id`
- `POST /api/surveys/:id/publish`
- `POST /api/surveys/:id/close`
- `GET /api/surveys/:id/readiness`
- `POST /api/surveys/:id/duplicate`
- `POST /api/surveys/:id/archive`
- `POST /api/surveys/:id/restore`
- `POST /api/surveys/:id/pin`
- `GET /api/surveys/compare?ids=id1,id2`

### Collections, Templates, Notes, and Views

- `GET`, `POST /api/collections`
- `PUT`, `DELETE /api/collections/:id`
- `GET /api/templates`
- `POST /api/surveys/:id/templates`
- `PUT`, `DELETE /api/templates/:id`
- `POST /api/templates/:id/create-survey`
- `GET`, `POST /api/surveys/:id/notes`
- `PUT`, `DELETE /api/notes/:id`
- `GET /api/activity`
- `GET`, `POST /api/saved-views`
- `PUT`, `DELETE /api/saved-views/:id`

### Public Participation and Analytics

- `GET /api/public/surveys/:id`
- `POST /api/public/surveys/:id/responses`
- `GET /api/surveys/:id/analytics`
- `GET /api/surveys/:id/export.csv`

All state-changing administrator endpoints require an authenticated session. Public endpoints expose only the data needed for active participant surveys and never expose administrator notes, internal activity, or private workspace metadata.

---

## 10. Validation, Integrity, and Security

### Authentication and Authorization

- Protected administration pages redirect unauthenticated users to login.
- Protected API routes require a valid administrator session.
- Passwords are stored as salted `scrypt` hashes, never plaintext.

### Input Validation

- Survey, collection, template, and note names are trimmed and length limited.
- Question types are restricted to supported values.
- Multiple-choice questions require a valid option set.
- Date filters reject invalid calendar dates and reversed ranges.
- Response limits and targets must be whole positive numbers within the configured maximum.
- Targets cannot exceed an enabled maximum response limit.

### Data Integrity

- SQL statements use parameterized placeholders.
- Responses are checked against survey status, deadline, capacity, required answers, and duplicate settings on the server.
- Response admission and answer creation are grouped through the database workflow.
- Surveys that contain submitted responses are protected from unsafe deletion.
- Duplicated surveys copy form structure only, never respondent data.
- Archived surveys retain their historical data and can be restored.

### Privacy

- Private research notes are available only to authenticated administrators.
- CSV exports contain response data, not administrator-only notes or activity history.
- Browser duplicate-response protection stores only a minimal survey-scoped completion marker; it does not store answers, identity data, or fingerprinting data.

---

## 11. Interface and Design Work

The interface was redesigned around a consistent research-workspace experience while preserving the established project color palette. Key design improvements include:

- Persistent desktop sidebar with responsive mobile navigation.
- Clear page hierarchy using eyebrow labels, titles, summaries, and action areas.
- Card-based overview metrics and workspace panels.
- Improved survey inventory with search, status filters, collection filters, pin/archive filters, comparison selection, and saved views.
- Builder controls for response targets, readiness, draft recovery, preview, deadlines, capacity, and template creation.
- Analytics filters, print control, CSV export, saved view control, and Canvas chart actions.
- Responsive spacing, typography, controls, and table handling for smaller screens.

The result is intended to look professional on both a defense projector and a personal laptop while remaining readable for ordinary users.

---

## 12. Testing and Verification

The project includes an automated Node-based verification suite in `test_suite.js`. The suite exercises core application behavior and regression-sensitive paths.

### Verified Areas

- Login success, invalid login, session cookie, and protected-route behavior.
- Survey creation, question persistence, publication, closing, and public access.
- Required-answer validation and successful public submissions.
- Analytics accuracy for ratings, percentages, insights, date filtering, and CSV export.
- Deadlines, response limits, and browser duplicate-response settings.
- Builder preview, local draft recovery, QR asset availability, and chart PNG controls.
- Collections, target responses, readiness checks, duplication, templates, notes, pins, comparison, views, archiving, restoring, and activity history.

### Latest Recorded Result

```text
TEST SUITE RESULTS: 62 PASSED, 0 FAILED
```

Static JavaScript syntax checks and `git diff --check` were also run during implementation.

---

## 13. Installation and Local Execution

### Prerequisites

- Node.js 16 or newer
- npm

### Commands

```bash
npm install
npm start
```

Open the local application at:

```text
http://localhost:3000
```

To execute the automated verification suite:

```bash
node test_suite.js
```

For an optional presentation data set, run:

```bash
node seed.js
```

---

## 14. Deployment Notes

The project contains Vercel configuration and has been prepared for Vercel-compatible deployment. In a serverless deployment, persistent database storage needs careful consideration because file-backed local data can be ephemeral depending on the host. For a production multi-user deployment, the recommended next step is a managed relational database and persistent session store.

The application currently prioritizes a transparent academic project architecture and reliable local demonstration workflow.

---

## 15. Strengths for Internship Defense

1. **Complete lifecycle:** The project is not only a form; it covers design, collection, administration, analysis, export, and reporting.
2. **Real business rules:** Deadlines, capacity limits, authentication, server validation, and archive safety demonstrate practical backend work.
3. **Research operations focus:** Collections, targets, notes, templates, activity history, saved views, and comparison show a clear advancement beyond a basic survey application.
4. **No hidden framework magic:** The use of Vanilla JavaScript and Canvas makes the implementation easy to explain in viva questions.
5. **Evidence of quality:** The project has a repeatable automated test suite with 62 passing tests.
6. **Professional presentation:** Responsive dashboard layouts, printed reports, exports, QR sharing, and chart downloads give strong demonstration material.

---

## 16. Current Limitations and Future Enhancements

The project is complete for its academic scope, but these are appropriate future improvements:

- Multi-administrator accounts, roles, and collaborator permissions.
- Persistent cloud database and session storage for production hosting.
- Email invitations, reminders, and scheduled survey closure notifications.
- Conditional question branching and skip logic.
- Response segmentation, demographic filters, and crosstab analytics.
- Advanced statistical tests and configurable report templates.
- Accessible multilingual respondent flows.
- Server-generated branded PDF reports.
- Stronger cross-device respondent authentication when identity-based duplicate prevention is required.

---

## 17. Conclusion

Research Survey Analytics Dashboard delivers a complete and defense-ready research survey platform. It combines survey authoring, controlled data collection, workspace organization, data integrity rules, private research management, visual analytics, and exportable reporting in a coherent full-stack application.

The final system demonstrates frontend development, backend API engineering, database design, authentication, validation, testing, responsive interface design, and practical research workflow thinking. It is therefore well suited as an internship defense project and as a foundation for a more fully deployed research information system.
