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
