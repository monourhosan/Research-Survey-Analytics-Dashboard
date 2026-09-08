/**
 * Research Survey Analytics Dashboard
 * Demo Seeding Script
 * 
 * Generates:
 * - 1 Sample Active Research Survey ("Customer Satisfaction Survey")
 * - 4 Diverse Questions (Rating, Multiple Choice, Yes/No, Text)
 * - 25 Realistic Sample Responses distributed across past 14 days
 * - Idempotent protection: Does not duplicate if already seeded
 */

const {
  db,
  dbRun,
  dbGet,
  initDatabase
} = require('./database');

async function seed() {
  await initDatabase();

  const surveyTitle = 'Customer Satisfaction Survey';
  const existing = await dbGet('SELECT id FROM surveys WHERE title = ?', [surveyTitle]);

  if (existing) {
    console.log(`[SEED] Survey "${surveyTitle}" already exists (ID: ${existing.id}).`);
    console.log('[SEED] Skipping duplicate creation to protect dataset integrity.');
    process.exit(0);
  }

  console.log(`[SEED] Creating sample survey: "${surveyTitle}"...`);

  // Insert Survey
  const surveyResult = await dbRun(
    `INSERT INTO surveys (title, description, status, created_at, updated_at) 
     VALUES (?, ?, 'active', datetime('now', '-14 days'), datetime('now'))`,
    [
      surveyTitle,
      'A comprehensive research survey assessing user satisfaction, product engagement, and support quality across multiple digital touchpoints.'
    ]
  );
  const surveyId = surveyResult.lastID;

  // Insert Questions
  console.log('[SEED] Creating survey questions...');

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

  // 25 Realistic Sample Responses
  // 15 in recent 7 days (days -1 to -6)
  // 10 in previous 7 days (days -8 to -13) -> Demonstrates +50% growth trend
  const sampleData = [
    // Previous 7-day period (10 responses)
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

    // Recent 7-day period (15 responses)
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

  console.log(`[SEED] Inserting ${sampleData.length} sample responses and answers...`);

  for (const item of sampleData) {
    const respResult = await dbRun(
      "INSERT INTO responses (survey_id, submitted_at) VALUES (?, datetime('now', ?))",
      [surveyId, `-${item.dayOffset} days`]
    );
    const respId = respResult.lastID;

    // Q1 Answer (Rating)
    await dbRun(
      'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
      [respId, q1Id, String(item.r)]
    );

    // Q2 Answer (Multiple Choice)
    await dbRun(
      'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
      [respId, q2Id, item.mc]
    );

    // Q3 Answer (Yes/No)
    await dbRun(
      'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
      [respId, q3Id, item.yn]
    );

    // Q4 Answer (Text)
    if (item.t) {
      await dbRun(
        'INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)',
        [respId, q4Id, item.t]
      );
    }
  }

  console.log('[SEED] Demo dataset seeded successfully!');
  console.log(`[SEED] Survey ID: ${surveyId}`);
  console.log('[SEED] Total responses inserted: 25');
  console.log('[SEED] You can now view analytics at http://localhost:3000/analytics.html?id=' + surveyId);
  process.exit(0);
}

seed().catch(err => {
  console.error('[SEED] Fatal error seeding data:', err);
  process.exit(1);
});
