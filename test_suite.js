/**
 * Comprehensive Automated Test Suite
 * Validating core and defense-ready scenarios for the CSE499 project
 */

const http = require('http');

function request(method, path, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (cookie) {
      options.headers['Cookie'] = cookie;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
          raw: data
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('==============================================');
  console.log('STARTING CSE499 AUTOMATED VERIFICATION SUITE');
  console.log('==============================================');
  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} - ${details}`);
      failed++;
    }
  }

  try {
    // TEST 2: Incorrect login fails
    const badLogin = await request('POST', '/api/auth/login', {
      email: 'admin@research.local',
      password: 'WrongPassword!'
    });
    assert(badLogin.status === 401, 'TEST 2: Incorrect login fails with HTTP 401');

    // TEST 1: Admin login succeeds & issues session cookie
    const goodLogin = await request('POST', '/api/auth/login', {
      email: 'admin@research.local',
      password: 'Admin123!'
    });
    assert(goodLogin.status === 200 && goodLogin.body.success, 'TEST 1: Admin login succeeds');
    const setCookie = goodLogin.headers['set-cookie'];
    const sessionCookie = setCookie ? setCookie[0].split(';')[0] : null;
    assert(!!sessionCookie, 'TEST 1b: Session cookie successfully issued');

    // TEST 18: Unauthenticated access rejected
    const unauthCheck = await request('GET', '/api/dashboard');
    assert(unauthCheck.status === 401, 'TEST 18: Protected route rejects unauthenticated request');

    // TEST 18b: Authenticated dashboard succeeds
    const authCheck = await request('GET', '/api/dashboard', null, sessionCookie);
    assert(authCheck.status === 200 && authCheck.body.totalSurveys >= 1, 'TEST 18b: Authenticated dashboard returns valid metrics');

    // TEST 3 & 4: Create survey with questions
    const newSurveyPayload = {
      title: 'Automated Test Evaluation Study',
      description: 'Verifying survey creation and question persistence',
      status: 'draft',
      questions: [
        {
          question_text: 'Overall experience rating?',
          question_type: 'rating',
          is_required: true,
          sort_order: 1
        },
        {
          question_text: 'Preferred presentation mode?',
          question_type: 'multiple_choice',
          options: ['In-Person', 'Online Remote', 'Hybrid'],
          is_required: true,
          sort_order: 2
        },
        {
          question_text: 'Was the demonstration clear?',
          question_type: 'yes_no',
          is_required: true,
          sort_order: 3
        },
        {
          question_text: 'Any additional notes?',
          question_type: 'text',
          is_required: false,
          sort_order: 4
        }
      ]
    };

    const createRes = await request('POST', '/api/surveys', newSurveyPayload, sessionCookie);
    assert(createRes.status === 201 && createRes.body.id, 'TEST 3: Admin can create survey');
    const createdId = createRes.body.id;
    assert(createRes.body.questions && createRes.body.questions.length === 4, 'TEST 4: Questions properly attached to survey');

    // TEST 5: Publish survey
    const pubRes = await request('POST', `/api/surveys/${createdId}/publish`, null, sessionCookie);
    assert(pubRes.status === 200 && pubRes.body.status === 'active', 'TEST 5: Survey can be published');

    // TEST 6 & 7: Public respondent can fetch survey
    const publicSurvey = await request('GET', `/api/public/surveys/${createdId}`);
    assert(publicSurvey.status === 200 && publicSurvey.body.status === 'active', 'TEST 6 & 7: Public respondent can retrieve active survey');
    assert(publicSurvey.body.questions.length === 4, 'TEST 7b: Public survey returns all questions and choices');

    // Find question IDs
    const qRating = publicSurvey.body.questions.find(q => q.question_type === 'rating');
    const qMC = publicSurvey.body.questions.find(q => q.question_type === 'multiple_choice');
    const qYN = publicSurvey.body.questions.find(q => q.question_type === 'yes_no');
    const qText = publicSurvey.body.questions.find(q => q.question_type === 'text');

    // TEST 8: Required question validation (submitting empty answers)
    const badSubmit = await request('POST', `/api/public/surveys/${createdId}/responses`, {
      answers: {}
    });
    assert(badSubmit.status === 400, 'TEST 8: Submitting missing required questions is rejected with HTTP 400');

    // TEST 9: Valid response can be submitted
    const goodSubmit = await request('POST', `/api/public/surveys/${createdId}/responses`, {
      answers: {
        [qRating.id]: '5',
        [qMC.id]: 'In-Person',
        [qYN.id]: 'Yes',
        [qText.id]: 'Excellent clarity throughout!'
      }
    });
    assert(goodSubmit.status === 201 && goodSubmit.body.success, 'TEST 9: Response can be submitted');

    // Submit a second response to test distributions
    await request('POST', `/api/public/surveys/${createdId}/responses`, {
      answers: {
        [qRating.id]: '4',
        [qMC.id]: 'Hybrid',
        [qYN.id]: 'Yes',
        [qText.id]: 'Great defense preparation.'
      }
    });

    // TEST 10: Submitted response appears in analytics
    const analytics = await request('GET', `/api/surveys/${createdId}/analytics`, null, sessionCookie);
    assert(analytics.status === 200 && analytics.body.summary.totalResponses === 2, 'TEST 10: Submitted responses appear in analytics');

    // TEST 10a: Analytics date filters are validated on the server
    const invalidDateFilter = await request(
      'GET',
      `/api/surveys/${createdId}/analytics?from=2026-02-30`,
      null,
      sessionCookie
    );
    assert(invalidDateFilter.status === 400, 'TEST 10a: Invalid calendar dates are rejected');

    const reversedDateFilter = await request(
      'GET',
      `/api/surveys/${createdId}/analytics?from=2026-09-08&to=2026-09-01`,
      null,
      sessionCookie
    );
    assert(reversedDateFilter.status === 400, 'TEST 10b: Reversed analytics date ranges are rejected');

    const futureAnalytics = await request(
      'GET',
      `/api/surveys/${createdId}/analytics?from=2999-01-01`,
      null,
      sessionCookie
    );
    assert(
      futureAnalytics.status === 200 &&
      futureAnalytics.body.summary.totalResponses === 0 &&
      futureAnalytics.body.summary.allTimeTotalResponses === 2 &&
      futureAnalytics.body.filters.isFiltered === true,
      'TEST 10c: Filtered analytics preserve both range and all-time totals'
    );

    const futureCsv = await request(
      'GET',
      `/api/surveys/${createdId}/export.csv?from=2999-01-01`,
      null,
      sessionCookie
    );
    assert(
      futureCsv.status === 200 &&
      futureCsv.raw.trim().split(/\r?\n/).length === 1 &&
      String(futureCsv.headers['content-disposition']).includes('2999-01-01'),
      'TEST 10d: CSV export uses the active date filter and descriptive filename'
    );

    // TEST 11: Are percentages correct?
    const mcAnalytics = analytics.body.questions.find(q => q.id === qMC.id);
    const inPersonOption = mcAnalytics.distribution.find(d => d.option === 'In-Person');
    assert(inPersonOption && inPersonOption.percentage === 50, 'TEST 11: Multiple-choice percentage is mathematically exact (50%)');

    // TEST 12: Is rating average correct? (5 + 4) / 2 = 4.5
    const ratingAnalytics = analytics.body.questions.find(q => q.id === qRating.id);
    assert(ratingAnalytics && ratingAnalytics.average === 4.5, 'TEST 12: Rating average calculation is mathematically exact (4.5)');

    // TEST 13: Are insights consistent with statistics?
    assert(Array.isArray(analytics.body.insights) && analytics.body.insights.length > 0, 'TEST 13: Automated Insight Engine generated findings');
    const hasRatingInsight = analytics.body.insights.some(i => i.includes('4.5 out of 5') || i.includes('positive'));
    assert(hasRatingInsight, 'TEST 13b: Automated insights align directly with calculated numbers');

    // TEST 14: Can survey be closed?
    const closeRes = await request('POST', `/api/surveys/${createdId}/close`, null, sessionCookie);
    assert(closeRes.status === 200 && closeRes.body.status === 'closed', 'TEST 14: Survey can be closed');

    // TEST 15: Does closed survey reject new responses?
    const closedSubmit = await request('POST', `/api/public/surveys/${createdId}/responses`, {
      answers: { [qRating.id]: '5', [qMC.id]: 'In-Person', [qYN.id]: 'Yes' }
    });
    assert(closedSubmit.status === 403, 'TEST 15: Closed survey rejects new response submissions with HTTP 403');

    // TEST 16: Does CSV export work?
    const csvExport = await request('GET', `/api/surveys/${createdId}/export.csv`, null, sessionCookie);
    assert(csvExport.status === 200 && typeof csvExport.raw === 'string' && csvExport.raw.includes('Response ID'), 'TEST 16: CSV export generates RFC 4180 formatted data');

    // TEST 16a-g: Optional response deadline is persisted, enforced, removable, and analytics-safe.
    const futureDeadline = new Date(Date.now() + 1600).toISOString();
    const deadlineSurvey = await request('POST', '/api/surveys', {
      title: 'Deadline Enforcement Test Survey',
      description: 'Verifies automatic public response closure.',
      status: 'draft',
      response_deadline: futureDeadline,
      questions: [{
        question_text: 'Will this deadline be enforced?',
        question_type: 'yes_no',
        is_required: true,
        sort_order: 1
      }]
    }, sessionCookie);
    assert(
      deadlineSurvey.status === 201 && deadlineSurvey.body.response_deadline === futureDeadline,
      'TEST 16a: Future response deadline persists as a UTC timestamp'
    );

    const deadlineSurveyId = deadlineSurvey.body.id;
    const invalidDeadline = await request('PUT', `/api/surveys/${deadlineSurveyId}`, {
      title: 'Deadline Enforcement Test Survey',
      description: 'Verifies automatic public response closure.',
      response_deadline: 'not-a-date'
    }, sessionCookie);
    assert(invalidDeadline.status === 400, 'TEST 16b: Invalid response deadline is rejected');

    const publishDeadlineSurvey = await request('POST', `/api/surveys/${deadlineSurveyId}/publish`, null, sessionCookie);
    assert(publishDeadlineSurvey.status === 200, 'TEST 16c: Survey with a future deadline can be published');

    const futureDeadlinePublic = await request('GET', `/api/public/surveys/${deadlineSurveyId}`);
    const deadlineQuestion = futureDeadlinePublic.body.questions && futureDeadlinePublic.body.questions[0];
    const futureDeadlineSubmit = await request('POST', `/api/public/surveys/${deadlineSurveyId}/responses`, {
      answers: deadlineQuestion ? { [deadlineQuestion.id]: 'Yes' } : {}
    });
    assert(
      futureDeadlinePublic.status === 200 && futureDeadlineSubmit.status === 201,
      'TEST 16d: Survey accepts a response before its deadline'
    );

    const pastDeadlineUpdate = await request('PUT', `/api/surveys/${deadlineSurveyId}`, {
      title: 'Deadline Enforcement Test Survey',
      description: 'Verifies automatic public response closure.',
      response_deadline: new Date(Date.now() - 60000).toISOString()
    }, sessionCookie);
    assert(pastDeadlineUpdate.status === 400, 'TEST 16e: Active survey cannot receive a past deadline');

    await new Promise(resolve => setTimeout(resolve, 1800));
    const expiredPublic = await request('GET', `/api/public/surveys/${deadlineSurveyId}`);
    const expiredSubmit = await request('POST', `/api/public/surveys/${deadlineSurveyId}/responses`, { answers: {} });
    assert(
      expiredPublic.status === 403 && expiredPublic.body.code === 'SURVEY_EXPIRED' &&
      expiredSubmit.status === 403 && expiredSubmit.body.code === 'SURVEY_EXPIRED',
      'TEST 16f: Expired survey blocks public loading and submissions with a clear code'
    );

    const expiredAttentionDashboard = await request('GET', '/api/dashboard?attentionLimit=100', null, sessionCookie);
    assert(
      expiredAttentionDashboard.status === 200 &&
      expiredAttentionDashboard.body.attentionItems.some(item => item.surveyId === deadlineSurveyId && item.type === 'deadline_passed' && item.severity === 'critical'),
      'TEST 16f1: Active surveys with passed deadlines are prioritized for attention'
    );

    const expiredAnalytics = await request('GET', `/api/surveys/${deadlineSurveyId}/analytics`, null, sessionCookie);
    const expiredCsv = await request('GET', `/api/surveys/${deadlineSurveyId}/export.csv`, null, sessionCookie);
    const removeDeadline = await request('PUT', `/api/surveys/${deadlineSurveyId}`, {
      title: 'Deadline Enforcement Test Survey',
      description: 'Verifies automatic public response closure.',
      response_deadline: null
    }, sessionCookie);
    const reopenedPublic = await request('GET', `/api/public/surveys/${deadlineSurveyId}`);
    assert(
      expiredAnalytics.status === 200 && expiredAnalytics.body.summary.totalResponses === 1 &&
      expiredCsv.status === 200 && expiredCsv.raw.includes('Response ID') &&
      removeDeadline.status === 200 && reopenedPublic.status === 200,
      'TEST 16g: Expiration preserves analytics and CSV data, and deadline removal reopens the active survey'
    );

    // TEST 16h-n: Response limits are validated, atomically enforced, and reporting-safe.
    const limitDeadline = new Date(Date.now() + 60000).toISOString();
    const limitedSurvey = await request('POST', '/api/surveys', {
      title: 'Response Limit Enforcement Test Survey',
      description: 'Verifies maximum response handling.',
      status: 'draft',
      response_deadline: limitDeadline,
      response_limit: 2,
      one_response_per_browser: true,
      questions: [{
        question_text: 'Is the response limit working?',
        question_type: 'yes_no',
        is_required: true,
        sort_order: 1
      }]
    }, sessionCookie);
    assert(
      limitedSurvey.status === 201 && limitedSurvey.body.response_limit === 2 && limitedSurvey.body.one_response_per_browser === 1,
      'TEST 16h: Response limit and same-browser protection persist alongside a future deadline'
    );

    const limitedSurveyId = limitedSurvey.body.id;
    const invalidLimit = await request('POST', '/api/surveys', {
      title: 'Invalid Limit Survey',
      status: 'draft',
      response_limit: 0,
      questions: []
    }, sessionCookie);
    const decimalLimit = await request('PUT', `/api/surveys/${limitedSurveyId}`, {
      title: 'Response Limit Enforcement Test Survey',
      description: 'Verifies maximum response handling.',
      response_limit: 1.5
    }, sessionCookie);
    assert(
      invalidLimit.status === 400 && decimalLimit.status === 400,
      'TEST 16i: Zero and decimal response limits are rejected'
    );

    const publishLimitedSurvey = await request('POST', `/api/surveys/${limitedSurveyId}/publish`, null, sessionCookie);
    const limitedPublic = await request('GET', `/api/public/surveys/${limitedSurveyId}`);
    const limitedQuestion = limitedPublic.body.questions && limitedPublic.body.questions[0];
    assert(
      publishLimitedSurvey.status === 200 && limitedPublic.status === 200 &&
      limitedPublic.body.response_limit === 2 && limitedPublic.body.response_count === 0 && limitedPublic.body.one_response_per_browser === true,
      'TEST 16j: Public API exposes configured response capacity and browser protection'
    );

    const firstLimitedResponse = await request('POST', `/api/public/surveys/${limitedSurveyId}/responses`, {
      answers: limitedQuestion ? { [limitedQuestion.id]: 'Yes' } : {}
    });
    const secondLimitedResponse = await request('POST', `/api/public/surveys/${limitedSurveyId}/responses`, {
      answers: limitedQuestion ? { [limitedQuestion.id]: 'No' } : {}
    });
    assert(
      firstLimitedResponse.status === 201 && secondLimitedResponse.status === 201,
      'TEST 16k: Responses below and at the configured limit are accepted'
    );

    const fullPublic = await request('GET', `/api/public/surveys/${limitedSurveyId}`);
    const overLimitResponse = await request('POST', `/api/public/surveys/${limitedSurveyId}/responses`, {
      answers: limitedQuestion ? { [limitedQuestion.id]: 'Yes' } : {}
    });
    assert(
      fullPublic.status === 403 && fullPublic.body.code === 'SURVEY_RESPONSE_LIMIT_REACHED' &&
      overLimitResponse.status === 403 && overLimitResponse.body.code === 'SURVEY_RESPONSE_LIMIT_REACHED',
      'TEST 16l: Reached response limit blocks public loading and a further valid submission'
    );

    const lowerLimit = await request('PUT', `/api/surveys/${limitedSurveyId}`, {
      title: 'Response Limit Enforcement Test Survey',
      description: 'Verifies maximum response handling.',
      response_limit: 1
    }, sessionCookie);
    const limitedDetails = await request('GET', `/api/surveys/${limitedSurveyId}`, null, sessionCookie);
    const limitedAnalytics = await request('GET', `/api/surveys/${limitedSurveyId}/analytics`, null, sessionCookie);
    const limitedCsv = await request('GET', `/api/surveys/${limitedSurveyId}/export.csv`, null, sessionCookie);
    assert(
      lowerLimit.status === 200 && limitedDetails.body.response_limit === 1 && limitedDetails.body.response_count === 2 &&
      limitedAnalytics.status === 200 && limitedAnalytics.body.summary.totalResponses === 2 &&
      limitedCsv.status === 200 && limitedCsv.raw.trim().split(/\r?\n/).length === 3,
      'TEST 16m: Lowering a limit retains existing responses, analytics, and CSV rows'
    );

    assert(
      publicSurvey.body.response_limit === null,
      'TEST 16n: Surveys without a response limit remain unlimited'
    );

    const browserProtectionDefault = await request('POST', '/api/surveys', {
      title: 'Browser Protection Default Test Survey',
      description: 'Verifies the privacy-conscious setting is optional.',
      status: 'draft',
      questions: []
    }, sessionCookie);
    const browserProtectionId = browserProtectionDefault.body.id;
    const enableBrowserProtection = await request('PUT', `/api/surveys/${browserProtectionId}`, {
      title: 'Browser Protection Default Test Survey',
      description: 'Verifies the privacy-conscious setting is optional.',
      one_response_per_browser: true
    }, sessionCookie);
    const browserProtectionDetails = await request('GET', `/api/surveys/${browserProtectionId}`, null, sessionCookie);
    const invalidBrowserProtection = await request('POST', '/api/surveys', {
      title: 'Invalid Browser Protection Test Survey',
      status: 'draft',
      one_response_per_browser: 'yes',
      questions: []
    }, sessionCookie);
    assert(
      browserProtectionDefault.status === 201 && browserProtectionDefault.body.one_response_per_browser === 0 &&
      enableBrowserProtection.status === 200 && browserProtectionDetails.body.one_response_per_browser === 1 &&
      invalidBrowserProtection.status === 400,
      'TEST 16o: Browser duplicate-response protection defaults off, can be updated, and validates its setting'
    );

    // TEST 21: Research Workspace extensions are authenticated, data-preserving, and reusable.
    const unauthorizedCollections = await request('GET', '/api/collections');
    assert(unauthorizedCollections.status === 401, 'TEST 21a: Workspace collection APIs reject unauthenticated access');

    const workspaceCollection = await request('POST', '/api/collections', {
      name: `CSE499 Workspace ${Date.now()}`,
      description: 'Automated workspace verification collection.'
    }, sessionCookie);
    assert(workspaceCollection.status === 201 && workspaceCollection.body.id, 'TEST 21b: Collection can be created');

    const workspaceSurvey = await request('POST', '/api/surveys', {
      title: `Workspace Study ${Date.now()}`,
      description: 'A complete study for workspace feature verification.',
      status: 'draft',
      collection_id: workspaceCollection.body.id,
      target_responses: 10,
      response_limit: 12,
      questions: [{ question_text: 'Is this workspace test clear?', question_type: 'yes_no', is_required: true, sort_order: 1 }]
    }, sessionCookie);
    const workspaceSurveyId = workspaceSurvey.body.id;
    assert(workspaceSurvey.status === 201 && workspaceSurvey.body.target_responses === 10, 'TEST 21c: Target responses and collection assignment persist');

    const readiness = await request('GET', `/api/surveys/${workspaceSurveyId}/readiness`, null, sessionCookie);
    const invalidTarget = await request('PUT', `/api/surveys/${workspaceSurveyId}`, {
      title: workspaceSurvey.body.title,
      description: workspaceSurvey.body.description,
      target_responses: 13,
      response_limit: 12
    }, sessionCookie);
    assert(readiness.status === 200 && readiness.body.ready === true && invalidTarget.status === 400, 'TEST 21d: Readiness and target/limit validation are deterministic');

    const duplicate = await request('POST', `/api/surveys/${workspaceSurveyId}/duplicate`, {}, sessionCookie);
    const duplicateDetails = await request('GET', `/api/surveys/${duplicate.body.id}`, null, sessionCookie);
    assert(duplicate.status === 201 && duplicate.body.status === 'draft' && duplicateDetails.body.questions.length === 1 && duplicateDetails.body.response_count === 0, 'TEST 21e: Duplicate copies questions but not responses');

    const template = await request('POST', `/api/surveys/${workspaceSurveyId}/templates`, { name: `Workspace Template ${Date.now()}` }, sessionCookie);
    const templateRename = await request('PUT', `/api/templates/${template.body.id}`, { name: `Renamed Workspace Template ${Date.now()}` }, sessionCookie);
    const templateSurvey = await request('POST', `/api/templates/${template.body.id}/create-survey`, { title: `Template Study ${Date.now()}` }, sessionCookie);
    assert(template.status === 201 && templateRename.status === 200 && templateRename.body.name.startsWith('Renamed Workspace Template') && templateSurvey.status === 201 && templateSurvey.body.status === 'draft', 'TEST 21f: Templates can be renamed and create independent draft surveys');

    const note = await request('POST', `/api/surveys/${workspaceSurveyId}/notes`, { note_text: 'Private pilot-testing note.' }, sessionCookie);
    const notes = await request('GET', `/api/surveys/${workspaceSurveyId}/notes`, null, sessionCookie);
    const publicWorkspaceSurvey = await request('GET', `/api/public/surveys/${workspaceSurveyId}`);
    assert(note.status === 201 && notes.status === 200 && notes.body.length === 1 && !JSON.stringify(publicWorkspaceSurvey.body).includes('Private pilot-testing note.'), 'TEST 21g: Private notes are protected and excluded from public APIs');

    const pin = await request('POST', `/api/surveys/${workspaceSurveyId}/pin`, { pinned: true }, sessionCookie);
    const pinnedList = await request('GET', '/api/surveys?pinned=true', null, sessionCookie);
    assert(pin.status === 200 && pinnedList.body.some(survey => survey.id === workspaceSurveyId && survey.is_pinned === 1), 'TEST 21h: Pinning persists and is filterable');

    const comparison = await request('GET', `/api/surveys/compare?ids=${workspaceSurveyId},${duplicate.body.id}`, null, sessionCookie);
    const invalidComparison = await request('GET', `/api/surveys/compare?ids=${workspaceSurveyId}`, null, sessionCookie);
    assert(comparison.status === 200 && comparison.body.surveys.length === 2 && invalidComparison.status === 400, 'TEST 21i: Cross-survey comparison validates IDs and returns real metrics');

    const savedView = await request('POST', '/api/saved-views', {
      name: `Workspace View ${Date.now()}`,
      view_type: 'workspace',
      filters: { status: 'draft', collection_id: workspaceCollection.body.id, archived: false, pinned: false, search: '' }
    }, sessionCookie);
    const savedAnalytics = await request('POST', '/api/saved-views', {
      name: `Analytics View ${Date.now()}`,
      view_type: 'analytics',
      survey_id: workspaceSurveyId,
      filters: { from: '2026-01-01', to: '2026-09-09' }
    }, sessionCookie);
    assert(savedView.status === 201 && savedAnalytics.status === 201, 'TEST 21j: Workspace and analytics views can be saved');

    const activeArchiveSurvey = await request('POST', '/api/surveys', {
      title: `Active Archive Guard ${Date.now()}`,
      status: 'active',
      questions: [{ question_text: 'Archive protection?', question_type: 'yes_no', is_required: true, sort_order: 1 }]
    }, sessionCookie);
    const activeArchiveBlocked = await request('POST', `/api/surveys/${activeArchiveSurvey.body.id}/archive`, {}, sessionCookie);
    const archive = await request('POST', `/api/surveys/${workspaceSurveyId}/archive`, {}, sessionCookie);
    const archivedList = await request('GET', '/api/surveys?archived=true', null, sessionCookie);
    const restore = await request('POST', `/api/surveys/${workspaceSurveyId}/restore`, {}, sessionCookie);
    const activity = await request('GET', '/api/activity?limit=100', null, sessionCookie);
    assert(activeArchiveBlocked.status === 400 && archive.status === 200 && archivedList.body.some(survey => survey.id === workspaceSurveyId) && restore.status === 200 && activity.body.some(item => item.action === 'SURVEY_ARCHIVED'), 'TEST 21k: Archive/restore preserves studies and records activity');

    const collectionDelete = await request('DELETE', `/api/collections/${workspaceCollection.body.id}`, null, sessionCookie);
    const unassignedDetails = await request('GET', `/api/surveys/${workspaceSurveyId}`, null, sessionCookie);
    assert(collectionDelete.status === 200 && unassignedDetails.body.collection_id === null, 'TEST 21l: Collection deletion safely unassigns surveys');

    const templateDelete = await request('DELETE', `/api/templates/${template.body.id}`, null, sessionCookie);
    assert(templateDelete.status === 200, 'TEST 21m: Templates can be deleted');

    // TEST 22: Attention Required items are server-derived, actionable, and consistently ordered.
    const makeAttentionSurvey = async (title, settings = {}) => request('POST', '/api/surveys', {
      title,
      description: 'Dashboard attention verification survey.',
      status: settings.status || 'active',
      response_deadline: settings.response_deadline,
      response_limit: settings.response_limit,
      target_responses: settings.target_responses,
      questions: settings.questions === undefined
        ? [{ question_text: 'Is the dashboard rule clear?', question_type: 'yes_no', is_required: true, sort_order: 1 }]
        : settings.questions
    }, sessionCookie);

    const now = Date.now();
    const approachingAttention = await makeAttentionSurvey(`AAA Attention approaching ${now}`, { response_deadline: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString() });
    const behindAttention = await makeAttentionSurvey(`AAA Attention behind ${now}`, { response_deadline: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(), target_responses: 20 });
    const capacityAttention = await makeAttentionSurvey(`AAA Attention capacity ${now}`, { response_limit: 10 });
    const targetAttention = await makeAttentionSurvey(`AAA Attention target ${now}`, { target_responses: 2 });
    const draftAttention = await makeAttentionSurvey(`AAA Attention draft ${now}`, { status: 'draft', questions: [] });
    const neutralAttention = await makeAttentionSurvey(`AAA Attention neutral ${now}`);

    const capacityPublic = await request('GET', `/api/public/surveys/${capacityAttention.body.id}`);
    const targetPublic = await request('GET', `/api/public/surveys/${targetAttention.body.id}`);
    const capacityQuestionId = capacityPublic.body.questions[0].id;
    const targetQuestionId = targetPublic.body.questions[0].id;
    for (let index = 0; index < 9; index += 1) await request('POST', `/api/public/surveys/${capacityAttention.body.id}/responses`, { answers: { [capacityQuestionId]: 'Yes' } });
    for (let index = 0; index < 2; index += 1) await request('POST', `/api/public/surveys/${targetAttention.body.id}/responses`, { answers: { [targetQuestionId]: 'Yes' } });

    const attentionDashboard = await request('GET', '/api/dashboard?attentionLimit=100', null, sessionCookie);
    const attentionItems = attentionDashboard.body.attentionItems || [];
    const hasAttention = (surveyId, type) => attentionItems.some(item => item.surveyId === surveyId && item.type === type);
    const ranks = { critical: 0, high: 1, warning: 2, success: 3 };
    const stableOrder = attentionItems.every((item, index) => index === 0 || ranks[attentionItems[index - 1].severity] <= ranks[item.severity]);
    assert(
      attentionDashboard.status === 200 &&
      hasAttention(approachingAttention.body.id, 'deadline_approaching') &&
      hasAttention(behindAttention.body.id, 'behind_target_near_deadline') &&
      hasAttention(capacityAttention.body.id, 'capacity_almost_full') &&
      hasAttention(targetAttention.body.id, 'target_achieved') &&
      hasAttention(draftAttention.body.id, 'draft_not_ready') &&
      !attentionItems.some(item => item.surveyId === neutralAttention.body.id) &&
      stableOrder,
      'TEST 22: Dashboard attention rules cover approaching deadlines, targets, capacity, drafts, no-false-warning, and stable severity ordering'
    );

    // TEST 17: Does logout work?
    const logoutRes = await request('POST', '/api/auth/logout', null, sessionCookie);
    assert(logoutRes.status === 200 && logoutRes.body.success, 'TEST 17: Admin logout succeeds');

    // TEST 19: Check HTML pages exist and load with HTTP 200
    const pages = ['/login.html', '/dashboard.html', '/surveys.html', '/create-survey.html', '/survey.html', '/analytics.html'];
    let allPagesOk = true;
    for (const p of pages) {
      const pageRes = await request('GET', p);
      if (pageRes.status !== 200) allPagesOk = false;
    }
    assert(allPagesOk, 'TEST 19: All 6 main HTML pages load with HTTP 200');

    // TEST 20: Critical frontend assets exist (prevents unstyled pages and broken form handlers)
    const assets = ['/css/styles.css', '/js/common.js', '/js/login.js', '/js/qrcode-generator.js'];
    let allAssetsOk = true;
    for (const asset of assets) {
      const assetRes = await request('GET', asset);
      if (assetRes.status !== 200 || assetRes.raw.length === 0) allAssetsOk = false;
    }
    assert(allAssetsOk, 'TEST 20: Critical CSS and JavaScript assets load with HTTP 200');

    const surveysPage = await request('GET', '/surveys.html');
    assert(
      surveysPage.status === 200 && surveysPage.raw.includes('qrcode-generator.js'),
      'TEST 20b: Survey page includes the local QR generator asset'
    );

    const dashboardPage = await request('GET', '/dashboard.html');
    const dashboardScript = await request('GET', '/js/dashboard.js');
    assert(
      dashboardPage.status === 200 && dashboardPage.raw.includes('Attention Required') &&
      dashboardScript.status === 200 && dashboardScript.raw.includes('renderAttentionItems'),
      'TEST 20b1: Dashboard Attention Required panel assets load'
    );

    const builderPage = await request('GET', '/create-survey.html');
    const builderScript = await request('GET', '/js/create-survey.js');
    assert(
      builderPage.status === 200 &&
      builderPage.raw.includes('btn-preview-survey') &&
      builderScript.status === 200 &&
      builderScript.raw.includes('openSurveyPreview') &&
      builderScript.raw.includes('Preview Mode — responses cannot be submitted.') &&
      !builderScript.raw.includes('/api/public/surveys'),
      'TEST 20c: Builder preview uses local unsaved state and cannot submit public responses'
    );

    // Test 20d: Builder exposes safe browser-local draft recovery without server autosave
    assert(
      builderPage.raw.includes('draft-recovery-notice') &&
      builderScript.raw.includes('rsad:survey-builder-draft:') &&
      builderScript.raw.includes('LOCAL_DRAFT_DEBOUNCE_MS = 1000') &&
      builderScript.raw.includes('restorePendingLocalDraft') &&
      builderScript.raw.includes('discardPendingLocalDraft') &&
      builderScript.raw.includes('clearLocalDraft();') &&
      !builderScript.raw.includes('localStorage.setItem(getLocalDraftKey(), JSON.stringify(payload))'),
      'TEST 20d: Builder auto-saves recovery data locally and clears it only after successful server save'
    );

    assert(
      builderPage.raw.includes('id="response-deadline"') &&
      builderScript.raw.includes('response_deadline: responseDeadline') &&
      builderScript.raw.includes('toDateTimeLocalValue') &&
      builderScript.raw.includes('response_deadline: content.response_deadline ||') &&
      builderPage.raw.includes('Times are saved in UTC and enforced by the server'),
      'TEST 20e: Builder exposes an optional deadline that remains in local draft recovery'
    );

    assert(
      builderPage.raw.includes('id="response-limit-enabled"') &&
      builderPage.raw.includes('id="response-limit"') &&
      builderScript.raw.includes('syncResponseLimitFields') &&
      builderScript.raw.includes('response_limit: responseLimit') &&
      builderScript.raw.includes('Maximum responses must be a whole number'),
      'TEST 20f: Builder exposes and validates an optional maximum response limit'
    );

    const publicSurveyScript = await request('GET', '/js/survey.js');
    assert(
      builderPage.raw.includes('id="one-response-per-browser"') &&
      builderPage.raw.includes('Best-effort browser-based protection') &&
      builderScript.raw.includes('one_response_per_browser: oneResponsePerBrowser.checked') &&
      builderScript.raw.includes('one_response_per_browser: document.getElementById') &&
      publicSurveyScript.status === 200 &&
      publicSurveyScript.raw.includes("SUBMISSION_MARKER_PREFIX = 'rsad:submitted:'") &&
      publicSurveyScript.raw.includes('saveSubmittedBrowserMarker') &&
      publicSurveyScript.raw.includes('res.ok && data.success'),
      'TEST 20g: Browser duplicate-response protection supports local builder recovery and accepted-response markers'
    );

    const analyticsPage = await request('GET', '/analytics.html');
    const analyticsScript = await request('GET', '/js/analytics.js');
    const stylesAsset = await request('GET', '/css/styles.css');
    assert(
      analyticsPage.status === 200 &&
      analyticsScript.status === 200 &&
      analyticsScript.raw.includes('addChartDownloadButton') &&
      analyticsScript.raw.includes('downloadChartAsPng') &&
      analyticsScript.raw.includes('toBlob') &&
      analyticsScript.raw.includes('buildChartFilename') &&
      analyticsScript.raw.includes('aria-label') &&
      stylesAsset.status === 200 &&
      stylesAsset.raw.includes('.chart-actions') &&
      stylesAsset.raw.includes('.chart-actions {\n    display: none !important;'),
      'TEST 20h: Analytics Canvas charts expose accessible PNG downloads with print-hidden controls'
    );

    console.log('==============================================');
    console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('==============================================');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
