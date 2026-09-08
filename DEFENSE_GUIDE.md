# CSE499 Internship Defense Guide
**Research Survey Analytics Dashboard**

This guide is prepared specifically for your university Internship Defense Presentation. It covers the elevator pitch, architecture breakdown, live demo walkthrough sequence, and comprehensive answers to common viva questions.

---

## A. 30-Second Elevator Pitch

> *"Honorable committee members, my project is the **Research Survey Analytics Dashboard**, a full-stack web application designed for academic researchers to create surveys, collect public participant data, and analyze results in real time. Unlike bloated commercial survey tools, my system is lightweight, self-contained, and features an **Automated Insight Engine** that computes factual statistical summaries and visualizes distributions using native HTML5 Canvas without any external front-end libraries."*

---

## B. Problem Statement

1. **Vendor Lock-in & Privacy**: Popular cloud survey tools (like Google Forms or SurveyMonkey) store research data on third-party servers, posing data governance concerns for institutional research.
2. **Analysis Friction**: Most free survey builders provide raw spreadsheets, forcing researchers to manually clean data, compute percentages, and build charts in external software.
3. **Software Overload**: Many modern web frameworks introduce excessive dependencies, making local deployment and long-term maintenance brittle.

---

## C. Project Objective

To build an efficient, secure, and easily explainable research survey platform that:
- Allows researchers to author surveys with four standard question types.
- Provides public, authentication-free survey URLs for participants.
- Enforces relational data integrity in a local SQLite database.
- Renders responsive distribution charts via native HTML5 Canvas.
- Automatically generates deterministic text insights from response metrics.
- Exports clean, RFC 4180-compliant CSV files.
- Filters analytics by response date and produces print-ready research summaries.

---

## D. Technology Stack Explanation

| Layer | Technology | Why Chosen? |
| :--- | :--- | :--- |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript | Adheres strictly to web standards. Ensures fast execution, zero build steps, and complete transparency of logic. |
| **Visuals** | HTML5 `<canvas>` (2D Context) | Custom-drawn bar and distribution charts with high-DPI scaling. Eliminates reliance on heavy libraries like Chart.js. |
| **Backend** | Node.js + Express.js | Event-driven, non-blocking I/O model ideal for concurrent survey submissions and clean RESTful endpoint routing. |
| **Auth** | `express-session` + Node `crypto` | Industry-standard session cookies with server-side storage and cryptographic password hashing (`scrypt`). |
| **Database** | SQLite via `sql.js` (WebAssembly) | ACID-compliant, zero-configuration relational storage with foreign key support. Data remains in a portable local file. |

---

## E. End-to-End System Workflow

```
[ Researcher / Admin ]
          │
          ▼
   1. Logs in (Session Auth)
          │
          ▼
   2. Creates Survey & Questions (Draft mode)
          │
          ▼
   3. Publishes Survey (Status becomes 'active')
          │
          ▼
   4. Shares Public Link (http://localhost:3000/survey.html?id=1)
          │
          ▼
[ Public Respondent ] (No login needed)
          │
          ▼
   5. Submits Answers ──► Express.js Backend API
                                  │
                                  ▼
                         Validates & Inserts into SQLite
                         (responses & answers tables)
                                  │
                                  ▼
[ Real-Time Analytics Engine ] ◄──┘
   - Computes frequencies, percentages, rating averages
   - Calculates 7-day trend growth vs. previous period
   - Renders crisp HTML5 Canvas charts
   - Triggers Rule-Based Automated Insights
   - Applies validated date-range filters
   - Streams matching CSV data on demand
   - Produces a print-ready / Save as PDF view
```

---

## F. Database Structure & Relational Design

The database contains 5 normalized tables with enforced foreign key cascading:

1. `users`: Stores administrator credentials (`id`, `name`, `email`, `password_hash`, `created_at`).
2. `surveys`: Stores survey headers and status (`id`, `title`, `description`, `status`, `created_at`, `updated_at`). Status values are `'draft'`, `'active'`, and `'closed'`.
3. `questions`: Holds survey questions (`id`, `survey_id`, `question_text`, `question_type`, `options_json`, `is_required`, `sort_order`).
4. `responses`: Represents a respondent submission event (`id`, `survey_id`, `submitted_at`).
5. `answers`: Stores individual answers tied to a response and question (`id`, `response_id`, `question_id`, `answer_text`).

---

## G. REST API Design

The API follows REST architectural principles:
- **Separation of Concerns**: Client and server communicate strictly via JSON over HTTP.
- **Stateless Requests & Session Auth**: Admin routes are protected by checking `req.session.userId`; unauthenticated requests receive HTTP 401 Unauthorized.
- **Clean Resource URIs**:
  - `POST /api/auth/login`
  - `GET /api/dashboard`
  - `GET /api/surveys`
  - `POST /api/surveys`
  - `GET /api/surveys/:id`
  - `POST /api/surveys/:id/publish`
  - `POST /api/surveys/:id/close`
  - `GET /api/public/surveys/:id`
  - `POST /api/public/surveys/:id/responses`
  - `GET /api/surveys/:id/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - `GET /api/surveys/:id/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`

---

## H. The Automated Insight Engine (Signature Feature)

> [!IMPORTANT]
> **Key Defense Point**: Clearly state to your evaluators:
> *"The Automated Insight Engine is **deterministic, rule-based JavaScript logic**, NOT black-box artificial intelligence or machine learning."*

### Why this is advantageous:
1. **100% Explainable**: Every generated sentence is mathematically proven by the numbers displayed right on the screen.
2. **Zero Latency & Zero Cost**: Runs instantly in Node.js without calling costly external APIs (like OpenAI or Gemini).
3. **Reproducible**: Given the same dataset, the insights are consistent and reliable.

### Core Mathematical Rules:
- **Rating Averages**: Computes $\bar{x} = \frac{\sum x_i}{N}$. Averages $\ge 4.0$ trigger *"Overall sentiment is strongly positive."* Averages $< 3.0$ trigger *"Results indicate an area that may require attention."*
- **Positive/Negative Proportions**: Aggregates 4 and 5 stars as positive; 1 and 2 stars as negative.
- **Statistical Mode**: Identifies the most frequently chosen multiple-choice and rating options.
- **7-Day Trend Comparison**: Measures percentage velocity $\frac{\text{Current} - \text{Previous}}{\text{Previous}} \times 100\%$ over two contiguous 7-day windows.

---

## I. 5-Minute Live Demonstration Script

Follow this exact 12-step sequence during your presentation:

1. **Step 1: Open Login Page (`/login.html`)**
   - Click *"Auto-fill Demo Credentials"* (`admin@research.local` / `Admin123!`).
   - Point out that passwords are encrypted using `scrypt`. Click *"Sign In"*.
2. **Step 2: Show the Overview Dashboard (`/dashboard.html`)**
   - Highlight the 4 metric cards: Total Surveys, Active Surveys, Closed Surveys, Total Responses.
   - Mention that data is retrieved directly from SQLite via `/api/dashboard`.
3. **Step 3: Demonstrate Survey Inventory Search (`/surveys.html`)**
   - Search for `Customer` and switch the status filter to `Active`.
   - Explain that filtering is instant and helps an admin manage a larger survey collection.
   - Click *"Analytics"* on the pre-seeded *"Customer Satisfaction Survey"*.
4. **Step 4: Apply a Research Date Filter (`/analytics.html?id=1`)**
   - Choose a start and end date that covers part of the seeded 14-day response history, then click *"Apply Filter"*.
   - Point out the filtered count and the all-time total shown together.
   - Explain: *"The backend validates the dates and applies one parameterized period to every metric, chart, insight, and CSV export."*
5. **Step 5: Demonstrate Insights and Canvas Charts**
   - Read one rule-based insight and verify it against a chart below.
   - Explain: *"These charts are drawn natively onto HTML5 Canvas using Vanilla JavaScript, with no chart package."*
6. **Step 6: Export and Print the Same Analysis**
   - Click *"Export Responses as CSV"* and explain that the active date period is preserved.
   - Click *"Print / Save PDF"* and preview the clean A4 research report layout.
7. **Step 7: Create a New Survey (`/create-survey.html`)**
   - Click *"Create Survey"*.
   - Enter Title: `Faculty Internship Evaluation 2026`.
   - Add a Rating Question: `How would you rate the student presentation?`.
   - Add a Multiple Choice Question: `Which section was most impressive?` (Options: `Architecture`, `Database Design`, `Automated Insights`).
   - Add a Yes/No Question: `Would you recommend this project for full marks?`.
8. **Step 8: Reorder and Publish**
   - Click the Up and Down controls to show dynamic client-side array manipulation.
   - Save, then click *"Publish Survey"* and show that its status becomes `active`.
9. **Step 9: Open the Public Respondent Page (`/survey.html?id=2`)**
    - Click *"Copy Link"* and open the URL in a new browser tab or incognito window.
    - Point out: *"Notice that there is no admin sidebar—this is a distraction-free public questionnaire for respondents."*
10. **Step 10: Demonstrate Progress, Validation, and Consent**
    - Answer each question and show the live completion progress moving to 100%.
    - Point out the voluntary participation notice and check the consent box.
    - Explain that missing required answers are highlighted and also rejected by the server.
11. **Step 11: Submit a Live Response**
    - Click *"Submit Response"*.
    - Show the confirmation screen: *"Thank You! Your response has been recorded successfully."*
12. **Step 12: Complete the Real-Time Loop**
    - Return to the admin window, clear any old date filter, and open analytics for the new survey.
    - Show that the response count immediately changed to 1, completing the author-publish-respond-analyze workflow.

---

## J. Top 17 Viva Questions & Short Answers

### 1. Why did you choose SQLite over MySQL or PostgreSQL?
> *"SQLite is an ACID-compliant, self-contained relational database that requires zero server configuration and stores data in a single file (`data/survey.db`). This project runs the SQLite engine through `sql.js`, a WebAssembly build, while preserving standard SQL, foreign keys, and the portable database file."*

### 2. Why did you use Node.js?
> *"Node.js offers an asynchronous, event-driven I/O model. It uses the V8 engine to execute JavaScript on the server side, allowing me to use a unified language (JavaScript) across both the front end and back end."*

### 3. What is Express.js?
> *"Express.js is a minimal and flexible Node.js web application framework. It provides routing, HTTP request/response handling, and middleware integration (such as session management and body parsing). It keeps the backend code clean and structured."*

### 4. What is a REST API?
> *"REST stands for Representational State Transfer. It is an architectural style where resources (like surveys and responses) are identified by clean URIs and manipulated using standard HTTP verbs (`GET`, `POST`, `PUT`, `DELETE`)."*

### 5. What does CRUD mean in this project?
> *"CRUD stands for Create, Read, Update, Delete. In my application:
> - **Create**: `POST /api/surveys`
> - **Read**: `GET /api/surveys` and `GET /api/surveys/:id`
> - **Update**: `PUT /api/surveys/:id`
> - **Delete**: `DELETE /api/surveys/:id`"*

### 6. How do you ensure relational data integrity between tables?
> *"I enabled SQLite foreign key support using `PRAGMA foreign_keys = ON;`. In the schema, `questions`, `responses`, and `answers` reference parent tables using `FOREIGN KEY (...) REFERENCES ... ON DELETE CASCADE`. If a survey is deleted, all associated questions and answers are cleaned up automatically."*

### 7. How did you prevent SQL Injection?
> *"I never concatenate raw user input strings directly into SQL queries. Instead, I use **parameterized queries** with placeholder question marks (`?`) and pass values separately through the database adapter."*

### 8. How did you prevent Cross-Site Scripting (XSS)?
> *"When displaying user-submitted respondent text (such as comments or question labels), the frontend uses `element.textContent` and HTML entity escaping rather than unchecked `innerHTML` injection."*

### 9. How does authentication work?
> *"I implemented cookie-based session authentication using `express-session`. When the admin logs in, credentials are verified against an `scrypt` salted password hash. Upon success, a unique session ID is issued in an `HttpOnly` cookie. Middleware on protected routes validates `req.session.userId` before granting access."*

### 10. How does the Automated Insight Engine work?
> *"The Insight Engine uses pure JavaScript algorithms to analyze the dataset. It calculates descriptive statistical metrics—such as percentage distributions, mean ratings, and modes. It then evaluates these against predefined, transparent business rules to generate clear human-readable sentences."*

### 11. Why did you not use Machine Learning or an AI API?
> *"For standard survey analysis, machine learning introduces non-determinism, hallucinations, and unnecessary API costs. Rule-based analysis is 100% explainable, perfectly reproducible, runs with zero latency, and provides factual summaries that can be directly verified against the numbers on the screen."*

### 12. How did you build charts without Chart.js or D3?
> *"I used the native HTML5 `<canvas>` 2D rendering context (`ctx`). I programmed custom functions that calculate bar coordinates, render proportional bars, scale for high-DPI displays (`window.devicePixelRatio`), and render labels and percentages directly onto the canvas."*

### 13. How does CSV export work without a library?
> *"The backend fetches all responses and answers for the survey, formats the first row with question headers, and iterates through responses to construct comma-separated lines following RFC 4180 rules (escaping commas and quotes). The server sends this with `Content-Type: text/csv` and `Content-Disposition: attachment`."*

### 14. What happens when a survey is closed?
> *"Its status in the database is updated to `'closed'`. When a respondent visits `/survey.html?id=:id`, the public API returns an HTTP 403 status with the message: 'This survey is no longer accepting responses.' Existing analytics remain fully accessible to the admin."*

### 15. Why can't an admin delete a survey that already has responses?
> *"To maintain research data integrity. Allowing deletion of surveys with active responses would destroy collected participant data. Instead, the system requires the researcher to close the survey to archive it safely."*

### 16. How do you keep filtered charts and CSV exports consistent?
> *"The browser sends the same optional `from` and `to` parameters to both endpoints. The server validates real ISO calendar dates, rejects a reversed range, builds an inclusive parameterized timestamp condition, and uses it for totals, question answers, insights, and CSV rows. The interface also shows the filtered count beside the all-time count so the scope is never ambiguous."*

### 17. Is the PDF report generated by an external library?
> *"No. The analytics page has a dedicated CSS print layout using standard browser printing. It removes navigation, formats cards for A4, keeps charts visible, and lets the researcher print or choose Save as PDF without another dependency."*
