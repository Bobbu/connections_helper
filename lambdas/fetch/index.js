const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const OpenAI = require('openai');
const culturalRefs = require('./cultural-refs');

// Prompts are loaded once per cold start and reused across warm invocations.
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'prompts/cultural-refs-system.txt'),
  'utf8'
).trim();
const USER_PROMPT_TEMPLATE = fs.readFileSync(
  path.join(__dirname, 'prompts/cultural-refs-user.txt'),
  'utf8'
).trim();

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const secretsClient = new SecretsManagerClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const OPENAI_SECRET_NAME = process.env.OPENAI_SECRET_NAME;

// Cache for OpenAI API key (persists across warm Lambda invocations)
let cachedApiKey = null;

// Get OpenAI API key from Secrets Manager
async function getOpenAIKey() {
  if (cachedApiKey) return cachedApiKey;

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: OPENAI_SECRET_NAME })
    );
    cachedApiKey = response.SecretString;
    return cachedApiKey;
  } catch (error) {
    console.error('Error fetching OpenAI key from Secrets Manager:', error);
    return null;
  }
}

// Get cultural references from OpenAI for all words in a single batch
async function getAICulturalReferences(words) {
  try {
    const apiKey = await getOpenAIKey();
    if (!apiKey) {
      console.log('No OpenAI API key available, skipping AI cultural references');
      return {};
    }

    const openai = new OpenAI({ apiKey });
    const wordList = words.join(', ');
    const userPrompt = USER_PROMPT_TEMPLATE.replace('{{wordList}}', wordList);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log('Empty response from OpenAI');
      return {};
    }

    const parsed = JSON.parse(content);
    console.log('AI cultural references:', JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    console.error('Error fetching AI cultural references:', error);
    return {};
  }
}

// Get today's date in ET timezone (YYYY-MM-DD format)
function getTodayET() {
  const now = new Date();
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return etDate.toISOString().split('T')[0];
}

// Fetch puzzle from NYT API
async function fetchPuzzle(puzzleDate) {
  const url = `https://www.nytimes.com/svc/connections/v2/${puzzleDate}.json`;
  console.log(`Fetching from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NYT API returned ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// dictionaryapi.dev sits behind Cloudflare; on a cache miss with a sick origin it
// stalls ~20s before returning a 522 rather than failing fast. Definitions are a
// nice-to-have, so we cap each request well short of that and move on.
const DEFINITION_TIMEOUT_MS = 5000;

// Fetch definition from free dictionary API
async function getDefinition(word) {
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
      { signal: AbortSignal.timeout(DEFINITION_TIMEOUT_MS) }
    );
    if (!response.ok) return null;
    const data = await response.json();

    const definitions = [];
    for (const entry of data) {
      for (const meaning of entry.meanings || []) {
        for (const def of meaning.definitions || []) {
          if (definitions.length < 3 && def.definition) {
            const short = def.definition.length > 100
              ? def.definition.substring(0, 97) + '...'
              : def.definition;
            definitions.push({
              partOfSpeech: meaning.partOfSpeech,
              definition: short,
            });
          }
        }
      }
    }
    return definitions.length > 0 ? definitions : null;
  } catch (error) {
    if (error.name === 'TimeoutError') {
      console.warn(`Definition lookup timed out for ${word}`);
    } else {
      console.error(`Error fetching definition for ${word}:`, error);
    }
    return null;
  }
}

// Main handler
exports.handler = async (event) => {
  console.log('Starting puzzle fetch...');

  const puzzleDate = getTodayET();
  console.log(`Fetching puzzle for date: ${puzzleDate}`);

  try {
    // Fetch puzzle from NYT API
    const puzzle = await fetchPuzzle(puzzleDate);
    console.log(`Puzzle ID: ${puzzle.id}, Editor: ${puzzle.editor}`);

    // Visual puzzles use image_url + image_alt_text instead of content. The alt
    // text is the answer, so we don't extract definitions — we just record the
    // puzzle exists so serve can render a "go play on NYT" page.
    const isVisual = puzzle.categories.some((cat) =>
      cat.cards.some((card) => card.content == null)
    );

    if (isVisual) {
      console.log('Visual puzzle detected — storing minimal record');
      const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            puzzle_date: puzzleDate,
            puzzle_id: puzzle.id,
            editor: puzzle.editor,
            illustrator: puzzle.illustrator ?? null,
            is_visual: true,
            fetched_at: new Date().toISOString(),
            ttl,
          },
        })
      );
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Visual puzzle stored',
          puzzleDate,
          puzzleId: puzzle.id,
          isVisual: true,
        }),
      };
    }

    // Extract words and categories
    const categories = puzzle.categories.map((cat) => ({
      title: cat.title,
      words: cat.cards.map((card) => card.content),
    }));

    // Get all words in display order (by position)
    const allCards = puzzle.categories
      .flatMap((cat) => cat.cards)
      .sort((a, b) => a.position - b.position);

    const wordList = allCards.map((card) => card.content);

    // Fetch AI cultural references for all words in parallel with definitions
    console.log('Fetching AI cultural references...');
    const aiCulturalRefs = await getAICulturalReferences(wordList);

    // Fetch definitions concurrently. Definitions are optional enrichment — a slow
    // or down dictionary must never cost us the puzzle itself, so every lookup is
    // individually capped and failures degrade to an empty list.
    console.log('Fetching definitions...');
    const definitionResults = await Promise.all(
      allCards.map((card) => getDefinition(card.content))
    );

    const words = allCards.map((card, i) => ({
      word: card.content,
      definitions: definitionResults[i] || [],
      // AI refs take priority, fall back to hardcoded refs
      culturalRef: aiCulturalRefs[card.content] || culturalRefs[card.content] || null,
    }));

    const withDefs = words.filter((w) => w.definitions.length > 0).length;
    console.log(`Definitions resolved for ${withDefs}/${words.length} words`);

    // Calculate TTL (7 days from now)
    const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

    // Store in DynamoDB
    console.log('Storing in DynamoDB...');
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          puzzle_date: puzzleDate,
          puzzle_id: puzzle.id,
          editor: puzzle.editor,
          words,
          categories, // Store categories (answers) for optional reveal
          fetched_at: new Date().toISOString(),
          ttl,
        },
      })
    );

    console.log('Successfully stored puzzle data');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Puzzle fetched and stored successfully',
        puzzleDate,
        puzzleId: puzzle.id,
        wordCount: words.length,
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
      }),
    };
  }
};
