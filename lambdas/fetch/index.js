const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const OpenAI = require('openai');
const culturalRefs = require('./cultural-refs');

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

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant for NYT Connections puzzle players. For each word, provide brief cultural context that might help solve the puzzle - things like wordplay, slang meanings, celebrity references, brand names, movie/TV references, homophones, or alternate meanings that a dictionary wouldn't cover. Keep each entry under 100 characters. Return ONLY a valid JSON object mapping each word to its cultural note, or null if the word is purely dictionary-based with no notable cultural context.`,
        },
        {
          role: 'user',
          content: `Provide cultural context for these NYT Connections puzzle words: ${wordList}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1000,
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

// Fetch definition from free dictionary API
async function getDefinition(word) {
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`
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
    console.error(`Error fetching definition for ${word}:`, error);
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

    // Fetch definitions for each word
    console.log('Fetching definitions...');
    const words = [];
    for (const card of allCards) {
      const word = card.content;
      const definitions = await getDefinition(word);
      // AI refs take priority, fall back to hardcoded refs
      const culturalRef = aiCulturalRefs[word] || culturalRefs[word] || null;

      words.push({
        word,
        definitions: definitions || [],
        culturalRef,
      });
    }

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
