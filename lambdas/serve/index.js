const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.TABLE_NAME;
const ASSETS_URL = process.env.ASSETS_URL || '';
const BASE_URL = 'https://connections-helper.anystupididea.com';

// Get today's date in ET timezone (YYYY-MM-DD format)
function getTodayET() {
  const now = new Date();
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return etDate.toISOString().split('T')[0];
}

// Validate date format YYYY-MM-DD
function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

// Generate HTML page
function generateHTML(puzzleDate, words, fetchedAt, todayDate) {
  const isToday = puzzleDate === todayDate;
  const isYesterday = puzzleDate === getYesterday(todayDate);
  const formattedDate = new Date(puzzleDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const wordsHTML = words
    .map((w) => {
      const defsHTML = w.definitions
        .map((d) => `<li><span class="pos">(${d.partOfSpeech})</span> ${d.definition}</li>`)
        .join('');
      const culturalHTML = w.culturalRef
        ? `<div class="cultural">${w.culturalRef}</div>`
        : '';
      return `
        <div class="word-card">
          <h3>${w.word}</h3>
          ${defsHTML ? `<ul class="definitions">${defsHTML}</ul>` : '<p class="no-def">No dictionary definition found</p>'}
          ${culturalHTML}
        </div>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connections Helper - ${formattedDate}</title>

  <!-- Favicon (served from CloudFront) -->
  <link rel="icon" type="image/x-icon" href="${ASSETS_URL}/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="${ASSETS_URL}/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="${ASSETS_URL}/favicon-16x16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="${ASSETS_URL}/apple-touch-icon.png">

  <!-- Open Graph / Social -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${BASE_URL}/">
  <meta property="og:title" content="Connections Helper - ${formattedDate}">
  <meta property="og:description" content="Get definitions for today's NYT Connections puzzle words. Solve smarter, not harder!">
  <meta property="og:image" content="${ASSETS_URL}/og-image.png">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Connections Helper - ${formattedDate}">
  <meta name="twitter:description" content="Get definitions for today's NYT Connections puzzle words.">
  <meta name="twitter:image" content="${ASSETS_URL}/og-image.png">

  <!-- PWA -->
  <meta name="theme-color" content="#667eea">

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
    }
    header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
    }
    header .date {
      font-size: 1.2rem;
      opacity: 0.9;
    }
    .tip {
      background: rgba(255,255,255,0.15);
      border-radius: 10px;
      padding: 15px 20px;
      margin-bottom: 25px;
      color: white;
      font-size: 1.1rem;
      text-align: center;
    }
    .tip strong {
      color: #ffd700;
    }
    .words-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 15px;
    }
    @media (min-width: 1200px) {
      .words-grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }
    .word-card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
      transition: transform 0.2s;
    }
    .word-card:hover {
      transform: translateY(-3px);
    }
    .word-card h3 {
      color: #333;
      font-size: 1.4rem;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #667eea;
    }
    .definitions {
      list-style: none;
      margin-bottom: 10px;
    }
    .definitions li {
      color: #555;
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .pos {
      color: #888;
      font-style: italic;
      font-size: 0.9em;
    }
    .no-def {
      color: #999;
      font-style: italic;
    }
    .cultural {
      background: #fff3cd;
      color: #856404;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 0.95rem;
      margin-top: 10px;
    }
    footer {
      text-align: center;
      color: rgba(255,255,255,0.7);
      margin-top: 30px;
      font-size: 0.9rem;
    }
    footer a {
      color: rgba(255,255,255,0.9);
    }
    .nav-links {
      text-align: center;
      margin-bottom: 20px;
    }
    .nav-links a {
      color: white;
      text-decoration: none;
      padding: 8px 16px;
      background: rgba(255,255,255,0.2);
      border-radius: 20px;
      margin: 0 5px;
      transition: background 0.2s;
    }
    .nav-links a:hover {
      background: rgba(255,255,255,0.3);
    }
    .nav-links a.active {
      background: rgba(255,255,255,0.5);
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Connections Helper</h1>
      <div class="date">${formattedDate}</div>
    </header>

    <div class="tip">
      <strong>TIP:</strong> Shuffle immediately! Adjacent words are often misdirects.
    </div>

    <div class="nav-links">
      <a href="/"${isToday ? ' class="active"' : ''}>Today</a>
      <a href="/${getYesterday(todayDate)}"${isYesterday ? ' class="active"' : ''}>Yesterday</a>
    </div>

    <div class="words-grid">
      ${wordsHTML}
    </div>

    <footer>
      <p>Data fetched at ${new Date(fetchedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</p>
      <p>&copy; 2025&ndash;${new Date().getFullYear()} <a href="https://anystupididea.com">Any Stupid Idea</a> | <a href="https://anystupididea.com/terms.html">Terms</a> | <a href="https://anystupididea.com/privacy.html">Privacy</a></p>
    </footer>
  </div>
</body>
</html>`;
}

// Generate "not found" HTML
function generateNotFoundHTML(puzzleDate) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connections Helper - Not Found</title>
  <link rel="icon" type="image/x-icon" href="${ASSETS_URL}/favicon.ico">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      text-align: center;
      padding: 20px;
    }
    .container {
      max-width: 500px;
    }
    h1 { font-size: 3rem; margin-bottom: 20px; }
    p { font-size: 1.2rem; opacity: 0.9; margin-bottom: 20px; }
    a {
      color: white;
      text-decoration: none;
      padding: 12px 24px;
      background: rgba(255,255,255,0.2);
      border-radius: 25px;
      display: inline-block;
    }
    a:hover { background: rgba(255,255,255,0.3); }
  </style>
</head>
<body>
  <div class="container">
    <h1>?</h1>
    <p>Puzzle for ${puzzleDate} not found.</p>
    <p>It may not have been fetched yet, or it's outside our 7-day history.</p>
    <a href="/">Go to Today's Puzzle</a>
  </div>
</body>
</html>`;
}

// Get yesterday's date
function getYesterday(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

// Main handler
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event));

  // Get today's date for navigation
  const todayDate = getTodayET();

  // Determine which date to fetch
  let puzzleDate = event.pathParameters?.date || todayDate;

  // Validate date format
  if (!isValidDate(puzzleDate)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: '<h1>Invalid date format. Use YYYY-MM-DD.</h1>',
    };
  }

  try {
    // Fetch from DynamoDB
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { puzzle_date: puzzleDate },
      })
    );

    if (!result.Item) {
      console.log(`No puzzle found for ${puzzleDate}`);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html' },
        body: generateNotFoundHTML(puzzleDate),
      };
    }

    const { words, fetched_at } = result.Item;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
      body: generateHTML(puzzleDate, words, fetched_at, todayDate),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: '<h1>Internal Server Error</h1><p>Please try again later.</p>',
    };
  }
};
