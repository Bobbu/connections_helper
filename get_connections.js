const puppeteer = require('puppeteer');

// Common cultural references and alternate meanings that dictionary APIs miss
const culturalRefs = {
  'DUCKLING': 'The Ugly Duckling (fairy tale)',
  'NAPOLEON': 'French emperor; pig in "Animal Farm"; layered pastry',
  'PRINCESS': '"The Little Princess" (book/film)',
  'PIGLET': 'Winnie the Pooh character',
  'EMPEROR': '"The Emperor\'s New Clothes"; Emperor penguin',
  'MERMAID': '"The Little Mermaid" (fairy tale/film)',
  'PORKY': 'Porky Pig (Looney Tunes); British slang "porky pie" = lie',
  'BABE': 'The pig from movie "Babe"; slang for attractive person',
  'COLONEL': 'Homophone of "kernel"',
  'WOULD': 'Homophone of "wood"',
  'FAWN': 'Also: (verb) to flatter or grovel; seek favor through flattery',
  'FLATTER': 'Also: (verb) to praise insincerely; to make look better',
  'CHALK': '"Chalk it up to..." = attribute to; "by a long chalk" = by far',
  'GUSH': 'Also: to praise effusively or excessively',
  'HERCULE': 'Hercule Poirot (detective); HERCULES minus S',
  'POIROT': 'Hercule Poirot (Agatha Christie detective); silent T',
  'PIAZZA': 'Mike Piazza (NY Mets); Italian plaza',
  'SEAVER': 'Tom Seaver (NY Mets pitcher)',
  'GOODEN': 'Dwight Gooden (NY Mets pitcher)',
  'STRAWBERRY': 'Darryl Strawberry (NY Mets); Strawberry Fields',
};

async function getDefinition(word) {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`);
    if (!response.ok) return null;
    const data = await response.json();

    // Extract unique definitions (limit to 3)
    const definitions = [];
    for (const entry of data) {
      for (const meaning of entry.meanings || []) {
        for (const def of meaning.definitions || []) {
          if (definitions.length < 3 && def.definition) {
            const short = def.definition.length > 80
              ? def.definition.substring(0, 77) + '...'
              : def.definition;
            definitions.push(`(${meaning.partOfSpeech}) ${short}`);
          }
        }
      }
    }
    return definitions.length > 0 ? definitions : null;
  } catch {
    return null;
  }
}

(async () => {
  console.log('Fetching NYT Connections puzzle...\n');

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.goto('https://www.nytimes.com/games/connections', { waitUntil: 'networkidle2' });

  // Click Play button to load the game
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Play');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  // Dismiss any popups
  await page.evaluate(() => {
    document.querySelector('[aria-label="Close"]')?.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Extract the 16 game card labels from page text
  const labels = await page.evaluate(() => {
    const text = document.body.innerText;
    const matches = text.match(/\b[A-Z]{2,15}\b/g) || [];
    const skipWords = new Set([
      'SUBSCRIBE', 'GAMES', 'LOGIN', 'BACK', 'PLAY', 'NEW', 'THE', 'NYT',
      'LOG', 'FOR', 'ALL', 'YOUR', 'IN', 'ABOUT', 'YORK', 'TIMES', 'FAQS',
      'SKIP', 'LEARN', 'MORE', 'CROSSWORD', 'CROSSWORDS', 'COMMUNITY'
    ]);
    return [...new Set(matches)].filter(w => !skipWords.has(w)).slice(0, 16);
  });

  await browser.close();

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  console.log('═'.repeat(65));
  console.log(`  NYT CONNECTIONS - ${today}`);
  console.log('═'.repeat(65));
  console.log('\n🔀 TIP: Shuffle immediately to avoid misdirect traps!\n');
  console.log('─'.repeat(65));

  // Fetch and display definitions for each word
  for (const word of labels) {
    console.log(`\n${word}`);

    // Get dictionary definition
    const defs = await getDefinition(word);
    if (defs) {
      defs.forEach(d => console.log(`  • ${d}`));
    }

    // Add cultural references if available
    if (culturalRefs[word]) {
      console.log(`  ★ ${culturalRefs[word]}`);
    }

    if (!defs && !culturalRefs[word]) {
      console.log(`  • (No definition found - likely a proper noun)`);
    }
  }

  console.log('\n' + '─'.repeat(65));
  console.log('Good luck finding the four groups!');
  console.log('═'.repeat(65) + '\n');
})();
